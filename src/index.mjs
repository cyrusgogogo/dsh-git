import { GitService } from './host/git-service.mjs';
import { GitError, redact } from './host/git-runner.mjs';
import { AiCommitService } from './host/ai-commit.mjs';
import { Envelope, PluginConfig } from './shared/protocol.mjs';

export const name = 'dsh-git';
export const inject = ['connection', 'workspaceRegistry'];
export const Config = PluginConfig;

export function createHandler(service) {
  return async (request) => {
    if (request.headers.get('content-type')?.split(';')[0]?.toLowerCase() !== 'application/json') return new Response('Expected application/json', { status: 415 });
    // Connection already bounds request bodies. Keep a stricter plugin-specific cap as well.
    const body = await request.text();
    if (Buffer.byteLength(body) > 128 * 1024) return new Response('Request too large', { status: 413 });
    let parsed;
    try { parsed = JSON.parse(body); } catch { return new Response('Invalid JSON', { status: 400 }); }
    const input = Envelope.safeParse(parsed);
    if (!input.success) {
      return Response.json({ type: 'server-response', rpcId: typeof parsed?.rpcId === 'string' ? parsed.rpcId : 'invalid', result: { ok: false, error: { code: 'INVALID_REQUEST', message: 'Git 请求参数不合法。', details: { issues: input.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) } } } });
    }
    const { rpcId, payload } = input.data;
    let result;
    try { result = { ok: true, value: await service.execute(payload, request.signal) }; }
    catch (error) {
      result = { ok: false, error: { code: error instanceof GitError ? error.code : 'GIT_ERROR', message: redact(error.message || 'Git 操作未完成。'), details: error instanceof GitError ? error.details : {} } };
    }
    return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'cache-control': 'no-store' } });
  };
}

export function apply(ctx, config) {
  const service = new GitService(ctx.workspaceRegistry, config, undefined, new AiCommitService(() => ctx.get('llm')));
  ctx.effect(() => () => service.dispose(), 'dsh-git: processes and queued operations');
  // Public, carrier-neutral Fetch registry: inherits Connection authentication,
  // Host/Origin checks and Desktop IPC instead of opening a separate HTTP server.
  ctx.connection.fetch.register({
    path: '/api/dsh-git', methods: ['POST'], requestBody: 'buffered', fetch: createHandler(service),
  });
}

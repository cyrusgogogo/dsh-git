import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { GitModel } from '../src/client/model.mjs';
import { Envelope, Request as GitRequest } from '../src/shared/protocol.mjs';
import { createHandler } from '../src/index.mjs';

// Replay the pre-AI host contract through the same JSON RPC boundary. Rebuilding
// a client does not replace a host plugin module already loaded in Node memory.
const oldOperations = GitRequest.options.filter((option) => !['aiModels', 'aiCommit'].includes(option.shape.op.value)).map((option) => option.shape.op.value === 'mutate' ? option.extend({ mutation: z.discriminatedUnion('action', option.shape.mutation.options.filter((mutation) => mutation.shape.action.value !== 'commitAndPush')) }) : option);
const oldEnvelope = Envelope.extend({ payload: z.discriminatedUnion('op', oldOperations) });
function oldHost() {
  return async (request) => {
    const body = await request.json();
    const result = oldEnvelope.safeParse(body);
    if (result.success) {
      assert.ok(['snapshot', 'history'].includes(result.data.payload.op), 'Never fall back to a legacy write operation');
      const value = result.data.payload.op === 'history' ? { commits: [], hasMore: false } : { state: 'ready', head: 'a'.repeat(40), branch: 'main', files: [{ path: 'staged.txt', staged: true }], branches: [], remotes: [] };
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } });
    }
    return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'INVALID_REQUEST', message: 'Git 请求参数不合法。', details: { issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) } } } });
  };
}
function rpc(handler) {
  return async (payload, signal) => {
    const response = await handler(new Request('http://localhost/api/dsh-git', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', method: 'dsh-git', rpcId: 'compat-test', payload }), signal }));
    return (await response.json()).result;
  };
}

test('new client / pre-AI host reports restart guidance instead of a model-configuration error', async (t) => {
  const model = new GitModel(rpc(oldHost()), { storage: null });
  t.after(() => model.dispose());
  await model.loadAiModels();
  assert.match(model.state.aiModelsError, /宿主.*不支持|前后端版本不一致/);
  assert.match(model.state.aiModelsError, /重启.*DSH|DSH.*重启/);
  assert.doesNotMatch(model.state.aiModelsError, /^Git 请求参数不合法/);
});

test('old host AI generation and combined submission give the same compatibility guidance without fallback writes', async (t) => {
  const calls = [];
  const transport = rpc(oldHost());
  const model = new GitModel((payload, signal) => { calls.push(payload); return transport(payload, signal); }, { storage: null });
  t.after(() => model.dispose());
  model.patch({ workspaceId: 'w', data: { state: 'ready', head: 'a'.repeat(40), branch: 'main', files: [{ path: 'staged.txt', staged: true }] } });
  model.showDialog({ type: 'commit' });
  assert.equal(await model.generateCommit(), false);
  assert.equal(model.state.error.code, 'HOST_UPGRADE_REQUIRED');
  assert.equal(await model.mutate({ action: 'commitAndPush', branch: 'main', message: 'feat: preview' }), false);
  assert.equal(model.state.error.code, 'HOST_UPGRADE_REQUIRED');
  assert.deepEqual(calls.filter((payload) => ['aiCommit', 'mutate'].includes(payload.op)).map((payload) => payload.op), ['aiCommit', 'mutate']);
  assert.deepEqual(calls.filter((payload) => payload.op === 'mutate').map((payload) => payload.mutation.action), ['commitAndPush']);
});

test('automatic AI entry on a staged old host verifies snapshots then reports compatibility without legacy writes', async (t) => {
  const calls = [];
  const transport = rpc(oldHost());
  const model = new GitModel((payload, signal) => { calls.push(payload); return transport(payload, signal); }, { storage: null });
  t.after(() => model.dispose());
  model.patch({ workspaceId: 'w', data: { state: 'ready', head: 'a'.repeat(40), branch: 'main', files: [{ path: 'staged.txt', staged: true, unstaged: false }] } });
  model.showDialog({ type: 'commit', ai: true });
  for (let count = 0; count < 10 && (model.state.aiPreparing || model.state.aiBusy); count++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((payload) => payload.op), ['snapshot', 'snapshot', 'aiCommit']);
  assert.equal(model.state.error.code, 'HOST_UPGRADE_REQUIRED');
  assert.match(model.state.error.message, /前后端版本不一致/);
  assert.deepEqual(model.state.aiSelectedPaths, ['staged.txt']);
  assert.equal(model.state.aiPreparing, false); assert.equal(model.state.busy, '');
});

test('known-operation field validation errors are not mislabeled as an outdated host', async (t) => {
  const model = new GitModel(rpc(createHandler({ execute: async () => { assert.fail('Invalid input must not execute'); } })), { storage: null });
  t.after(() => model.dispose());
  await assert.rejects(model.request('invalid-ai', { op: 'aiCommit', workspaceId: 'w', expected: { head: 'not-a-hash', branch: 'main' } }), (error) => { assert.equal(error.code, 'INVALID_REQUEST'); assert.equal(error.message, 'Git 请求参数不合法。'); return true; });
});

test('updated host without models is a configuration state, not a protocol incompatibility', async (t) => {
  const model = new GitModel(rpc(createHandler({ execute: async () => ({ available: false, models: [] }) })), { storage: null });
  t.after(() => model.dispose());
  await model.loadAiModels();
  assert.equal(model.state.aiModelsErrorCode, 'AI_UNAVAILABLE');
  assert.doesNotMatch(model.state.aiModelsError, /版本不一致|重启/);
});

test('updated JSON RPC host accepts model discovery without requiring a workspace', async (t) => {
  const calls = [];
  const model = new GitModel(rpc(createHandler({ execute: async (payload) => { calls.push(payload); return { available: true, models: [{ provider: 'host', model: 'model', label: 'Host model' }] }; } })), { storage: null });
  t.after(() => model.dispose());
  await model.loadAiModels();
  assert.equal(model.state.aiModelsError, '');
  assert.deepEqual(calls, [{ op: 'aiModels' }]);
  assert.equal(model.state.aiModels[0].model, 'model');
});

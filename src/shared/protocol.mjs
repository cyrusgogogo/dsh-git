import { z } from 'zod';

const text = z.string().min(1).max(1024).refine((s) => !s.includes('\0'), '不能包含空字符');
const ref = text.max(300).refine((s) => !s.startsWith('-'), '分支不能以 - 开头');
const file = text.max(32768);
const scope = { workspaceId: text.max(200), worktreePath: file.optional() };
const hash = z.string().regex(/^[a-f\d]{40,64}$/i);
const operation = z.enum(['merge', 'rebase', 'cherry-pick']);
const expected = z.object({ head: hash.nullable(), branch: z.string().max(300).refine((s) => !s.includes('\0'), '不能包含空字符').nullable() });
const message = z.string().trim().min(1).max(16000).refine((s) => !s.includes('\0'), '不能包含空字符');
const aiRoute = z.string().trim().max(256).refine((s) => !s.includes('\0'), '不能包含空字符').default('');
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('createBranch'), name: ref, start: ref, checkout: z.boolean().default(true) }),
  z.object({ action: z.literal('checkout'), ref }),
  z.object({ action: z.literal('checkoutRebase'), ref }),
  z.object({ action: z.literal('renameBranch'), branch: ref, name: ref }),
  z.object({ action: z.literal('deleteBranch'), ref }),
  z.object({ action: z.literal('merge'), ref }),
  z.object({ action: z.literal('rebase'), ref }),
  z.object({ action: z.literal('pull'), branch: ref }),
  z.object({ action: z.literal('push'), branch: ref, remote: ref.optional() }),
  z.object({ action: z.literal('fetch') }),
  z.object({ action: z.literal('stage'), paths: z.array(file).min(1).max(1000) }),
  z.object({ action: z.literal('unstage'), paths: z.array(file).min(1).max(1000) }),
  z.object({ action: z.literal('commit'), message, stagedTree: hash.optional() }),
  z.object({ action: z.literal('commitAndPush'), message, branch: ref, remote: ref.optional(), stagedTree: hash.optional() }),
  z.object({ action: z.literal('pullRemote'), ref, strategy: z.enum(['rebase', 'merge']) }),
  z.object({ action: z.literal('setUpstream'), branch: ref, upstream: ref }),
  z.object({ action: z.literal('createWorktree'), path: file, ref, newBranch: ref.optional() }),
  z.object({ action: z.literal('removeWorktree'), path: file }),
  z.object({ action: z.literal('lockWorktree'), path: file, lock: z.boolean() }),
  z.object({ action: z.literal('cherryPick'), hash }),
  z.object({ action: z.literal('continueOperation'), operation }),
  z.object({ action: z.literal('abortOperation'), operation }),
]);
export const Request = z.discriminatedUnion('op', [
  z.object({ op: z.literal('initialize'), workspaceId: text.max(200), confirmed: z.literal(true) }).strict(),
  z.object({ op: z.literal('snapshot'), ...scope }),
  z.object({ op: z.literal('history'), ...scope, ref: ref.optional(), search: z.string().max(300).default(''), author: z.string().max(150).default(''), path: z.string().max(2048).default(''), dateRange: z.enum(['', 'today', '7d', '30d', '90d', '1y']).default(''), skip: z.number().int().min(0).max(100000).default(0) }),
  z.object({ op: z.literal('commit'), ...scope, hash: z.string().regex(/^[a-f\d]{40,64}$/i) }),
  z.object({ op: z.literal('diff'), ...scope, kind: z.enum(['working', 'staged', 'commit', 'compare']), ref: ref.optional(), hash: z.string().regex(/^[a-f\d]{40,64}$/i).optional(), path: file.optional() }),
  z.object({ op: z.literal('aiModels') }).strict(),
  z.object({ op: z.literal('aiCommit'), ...scope, expected, provider: aiRoute, model: aiRoute, prompt: z.string().max(16000).refine((s) => !s.includes('\0'), '不能包含空字符').default('') }),
  z.object({ op: z.literal('mutate'), ...scope, expected, confirmed: z.boolean().default(false), mutation }),
]);
export const Envelope = z.object({ type: z.literal('client-request'), method: z.literal('dsh-git'), rpcId: text.max(200), payload: Request });
export const CONFIG_DEFAULTS = { maxCommits: 300, commandTimeoutMs: 30000, networkTimeoutMs: 120000 };
export const PluginConfig = z.object({
  maxCommits: z.number().int().min(20).max(1000).default(CONFIG_DEFAULTS.maxCommits),
  commandTimeoutMs: z.number().int().min(1000).max(120000).default(CONFIG_DEFAULTS.commandTimeoutMs),
  networkTimeoutMs: z.number().int().min(1000).max(600000).default(CONFIG_DEFAULTS.networkTimeoutMs),
});

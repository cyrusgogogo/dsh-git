import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture } from './helpers.mjs';

const quote = (text) => `'${text.replace(/'/g, `'"'"'`)}'`;
test('timeout terminates a Git hook process tree and lets disposal finish', async (t) => {
  const f = await fixture(); t.after(() => f.cleanup());
  const pidFile = path.join(f.base, 'hook.pid');
  const script = path.join(f.base, 'long-hook.mjs');
  await writeFile(script, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`);
  await writeFile(path.join(f.root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\nexec ${quote(process.execPath.replace(/\\/g, '/'))} ${quote(script.replace(/\\/g, '/'))}\n`, { mode: 0o755 });
  f.service.runner.config.commandTimeoutMs = 1200;
  const start = Date.now();
  await assert.rejects(f.service.runner.run(f.root, ['commit', '--allow-empty', '-m', 'must time out'], { readOnly: false }), (error) => error.code === 'TIMEOUT');
  assert.ok(Date.now() - start < 7500, 'timeout must not wait forever for inherited pipes');
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH', 'owned hook must not survive timeout');
  await f.service.dispose();
});

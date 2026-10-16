import { spawn } from 'node:child_process';

export class GitError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'GitError'; this.code = code; this.details = details; }
}
export function redact(text) {
  return text.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@')
    .replace(/((?:access_token|token|password)=)[^\s&]+/gi, '$1[redacted]');
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
/** Teardown completes before the request, repository lock or plugin disposal settles. */
function terminate(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { killGroup(child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    return new Promise((resolve) => setTimeout(() => {
      try { killGroup(child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      resolve();
    }, 350));
  }
  return new Promise((resolve) => {
    let killer;
    let timer;
    const done = () => { clearTimeout(timer); child.kill(); resolve(); };
    try {
      killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, shell: false });
      killer.once('error', done); killer.once('close', done);
      timer = setTimeout(() => { killer.kill(); done(); }, 4000);
    } catch { done(); }
  });
}

/** Host-local operator Git. No shell, no browser-supplied executable or argv. */
export class GitRunner {
  constructor(config) { this.config = config; this.lifetime = new AbortController(); this.running = new Set(); }
  async run(cwd, args, { signal, network = false, allow = [0], truncate = false, maxBytes = 8 * 1024 * 1024, readOnly = true } = {}) {
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', LC_ALL: 'C', GIT_PAGER: 'cat', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' });
    if (readOnly) env.GIT_OPTIONAL_LOCKS = '0';
    let settle;
    const stopped = new Promise((resolve) => { settle = resolve; });
    this.running.add(stopped);
    try {
      return await new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn('git', ['--no-pager', '--literal-pathspecs', '-c', 'color.ui=false', '-c', 'core.quotepath=false', ...args], {
            cwd, env, windowsHide: true, detached: process.platform !== 'win32', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (error) { reject(error); return; }
        let out = [], err = [], bytes = 0, errorBytes = 0, overflow = false, failure, teardown, watchdog, finished = false;
        const finish = async (code, processError) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer); combined.removeEventListener('abort', abort);
          await teardown;
          clearTimeout(watchdog);
          const stdout = Buffer.concat(out).toString('utf8');
          const stderr = redact(Buffer.concat(err).toString('utf8').trim());
          if (failure) reject(failure);
          else if (processError) reject(processError.code === 'ENOENT' ? new GitError('GIT_NOT_INSTALLED', '未找到 Git。请安装 Git 并确保它位于 DSH 的 PATH 中。') : processError);
          else if (!allow.includes(code)) reject(new GitError('GIT_COMMAND_FAILED', stderr || 'Git 操作未完成。', { exitCode: code }));
          else resolve({ stdout, stderr, code, truncated: overflow });
        };
        const stop = (error) => {
          if (failure || finished) return;
          failure = error;
          teardown = terminate(child);
          // A broken helper retaining pipe handles must not hang unload forever.
          watchdog = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.kill('SIGKILL'); void finish(null); }, 5500);
        };
        const abort = () => stop(new GitError('CANCELLED', 'Git 操作已取消。'));
        const timer = setTimeout(() => stop(new GitError('TIMEOUT', 'Git 操作超时。网络操作请检查凭据与连接后重试。')), network ? this.config.networkTimeoutMs : this.config.commandTimeoutMs);
        combined.addEventListener('abort', abort, { once: true });
        if (combined.aborted) abort();
        child.stdout.on('data', (chunk) => {
          const remaining = Math.max(0, maxBytes - bytes);
          if (remaining) out.push(chunk.subarray(0, remaining));
          bytes += chunk.length;
          if (bytes > maxBytes) { overflow = true; if (!truncate) stop(new GitError('OUTPUT_LIMIT', 'Git 输出超过安全上限，请缩小查询范围。')); }
        });
        child.stderr.on('data', (chunk) => {
          const remaining = Math.max(0, 16384 - errorBytes);
          if (remaining) err.push(chunk.subarray(0, remaining));
          errorBytes += chunk.length;
        });
        child.once('error', (error) => { void finish(null, error); });
        child.once('close', (code) => { void finish(code); });
      });
    } finally { settle(); this.running.delete(stopped); }
  }
  async dispose() { this.lifetime.abort(); await Promise.all([...this.running]); }
}

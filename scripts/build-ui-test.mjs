import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
await mkdir('.artifacts', { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [require.resolve('esbuild/bin/esbuild'), 'tests/ui/harness.jsx', '--bundle', '--format=iife', '--platform=browser', '--target=es2022', '--jsx=automatic', '--define:process.env.NODE_ENV="production"', '--outfile=.artifacts/ui-harness.js'], { stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`UI harness build failed: ${code}`)));
});

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });
await mkdir('.artifacts', { recursive: true });

// Use esbuild's public CLI with inherited stdio. Its API starts a pipe-backed
// service, which is deliberately unavailable in the Windows DSH file sandbox.
export function build(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('esbuild/bin/esbuild'), ...args], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`esbuild exited with ${code}`)));
  });
}
const shared = ['--bundle', '--log-level=info', ...(watch ? ['--watch=forever'] : [])];
const host = ['src/index.mjs', ...shared, '--platform=node', '--format=esm', '--target=node22', '--packages=external', '--outfile=dist/index.mjs'];
// DSH 0.2.0-rc.2 materializes factories through this registration facade.
const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`;
const client = [
  'src/client/index.jsx', ...shared, '--platform=browser', '--format=cjs', '--target=es2022', '--jsx=automatic',
  '--external:react', '--external:react/*', '--external:react-dom', '--external:react-dom/*', '--loader:.css=text',
  '--define:process.env.NODE_ENV="production"', '--metafile=.artifacts/client-meta.json', `--banner:js=${banner}`, '--footer:js=return module.exports; } });', '--outfile=dist/client.js',
];
await Promise.all([build(host), build(client)]);
console.log(`Built ${manifest.name}@${manifest.version}`);

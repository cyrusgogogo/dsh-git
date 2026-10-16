import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const metadata = JSON.parse(await readFile('.artifacts/client-meta.json', 'utf8'));
const names = new Set(['zod']);
for (const file of Object.keys(metadata.inputs)) {
  const normalized = file.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('node_modules/');
  if (index < 0) continue;
  const parts = normalized.slice(index + 'node_modules/'.length).split('/');
  names.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
}
const sections = ['# Third-party notices', '', 'The browser bundle contains portions of the following packages. React / ReactDOM are shared with the DSH host rather than bundled. Zod is an external runtime dependency; its notice is included for completeness.', ''];
for (const name of [...names].sort()) {
  const directory = path.join('node_modules', name);
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license', 'license.md', 'license.txt']) {
    try { license = await readFile(path.join(directory, filename), 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let source = '';
  if (!license && name === 'react-remove-scroll-bar' && manifest.version === '2.3.8') {
    license = await readFile('licenses/react-remove-scroll-bar.LICENSE.txt', 'utf8');
    source = 'The 2.3.8 npm tarball declares MIT but omits a license file. Notice reproduced from [the upstream repository](https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/master/LICENSE); [published package metadata](https://registry.npmjs.org/react-remove-scroll-bar/2.3.8) confirms the MIT declaration.';
  }
  if (!license) throw new Error(`Missing upstream license: ${name}`);
  sections.push(`## ${name}@${manifest.version}`, '', `Declared license: ${manifest.license || 'see below'}`, '', ...(source ? [source, ''] : []), '```text', license.trim(), '```', '');
}
try { await readFile('THIRD_PARTY_NOTICES.md', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile('THIRD_PARTY_NOTICES.md', sections.join('\n'));
console.log(`Recorded notices for ${names.size} packages.`);

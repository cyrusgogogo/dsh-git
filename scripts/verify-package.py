"""Validate a prebuilt plugin archive without extracting or installing it."""
import hashlib
import json
import pathlib
import sys
import tarfile

root = pathlib.Path.cwd().resolve()
project_manifest = json.loads((root / 'package.json').read_text(encoding='utf8'))
archive = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else f"dsh-git-{project_manifest['version']}.tgz").resolve()
if archive.parent != root or not archive.name.startswith('dsh-git-') or archive.suffix != '.tgz':
    raise ValueError('Expected the project-owned dsh-git tarball in the project root')
with tarfile.open(archive, 'r:gz') as package:
    members = package.getmembers()
    names = {member.name for member in members}
    for member in members:
        parts = pathlib.PurePosixPath(member.name).parts
        assert parts and parts[0] == 'package' and '..' not in parts, member.name
        assert member.isfile() or member.isdir(), f'Unexpected link/special entry: {member.name}'
        assert not any(part in {'.git', 'node_modules', '.pnpm-store', '.reference', '.permission-recovery', '.test-tmp', '.env'} for part in parts), member.name
    def read(name):
        stream = package.extractfile('package/' + name)
        assert stream is not None, name
        return stream.read()
    manifest = json.loads(read('package.json'))
    assert manifest['name'] == 'dsh-git' and manifest['dsh']['client']['platform'] == 'web'
    assert manifest['version'] == project_manifest['version'], 'Archive version must match the current release'
    for value in manifest['exports'].values():
        assert 'package/' + value.removeprefix('./') in names, value
    assert manifest['main'] == manifest['exports']['.']
    patch = manifest['dsh']['bundle']['patch'].removeprefix('./')
    text = read(patch).decode('utf8')
    assert text.startswith('- insert:\n') and 'id: dsh-git' in text and 'name: dsh-git' in text
    for name in ['dist/index.mjs', 'dist/client.js', patch, 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/verification.md']:
        assert read(name) == (root / name).read_bytes(), f'Archive does not match tested project file: {name}'
    assert b'window.__ModuleLoader__.load(' in read('dist/client.js')
    assert b'factory: (require)' in read('dist/client.js')
    assert 'react' not in manifest.get('dependencies', {}), 'React must be host-shared'
    assert not any(key in manifest.get('scripts', {}) for key in ['prepare', 'preinstall', 'install', 'postinstall']), 'Prebuilt package must not require install-time execution'
report = {
    'archive': archive.name,
    'bytes': archive.stat().st_size,
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'packageFiles': sorted(name for name in names if not name.endswith('/')),
    'status': 'passed',
}
output = root / '.artifacts' / 'package-check.json'
output.parent.mkdir(exist_ok=True)
if output.exists():
    output.read_bytes()
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2))

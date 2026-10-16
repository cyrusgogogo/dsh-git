import json, struct, pathlib

archive = pathlib.Path(r'C:\Users\cyrus\AppData\Local\Programs\DeepSeek Harness\resources\app.asar')
output = pathlib.Path('.reference/host')
wanted = {'cordis', 'dsh-client-ui-layout', 'dsh-client-ui-slots', 'dsh-client-ui-renderer', 'dsh-client-ui-workspace', 'dsh-client-ui-session', 'dsh-client-ui-conversation', 'dsh-client-connection', 'dsh-host-webserver', 'dsh-workspace', 'dsh-client-modules', 'dsh-client-ui', 'dsh-typert', 'dsh-api', 'dsh-client-ui-shared'}
with archive.open('rb') as stream:
    prefix = stream.read(16)
    header_size = struct.unpack('<I', prefix[4:8])[0]
    json_size = struct.unpack('<I', prefix[12:16])[0]
    header = json.loads(stream.read(json_size))
    data_offset = 8 + header_size
    found = []
    def visit(node, parts):
        if 'files' in node:
            for name, child in node['files'].items():
                visit(child, parts + [name])
            return
        path = '/'.join(parts)
        if '/node_modules/@deepseek-ai/' not in '/' + path:
            return
        package = path.split('/node_modules/@deepseek-ai/')[-1].split('/')[0]
        if package not in wanted or 'offset' not in node:
            return
        if not (path.endswith(('.js', '.mjs', '.ts', '.json', '.md'))):
            return
        if '/node_modules/' in path.split('/node_modules/@deepseek-ai/')[-1]:
            return
        relative = path[path.index('node_modules/@deepseek-ai/'):]
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        stream.seek(data_offset + int(node['offset']))
        target.write_bytes(stream.read(node['size']))
        if path.endswith('/package.json'):
            found.append(relative)
    visit(header, [])
    print('\n'.join(found))
    print('Extracted host API references into', output.resolve())

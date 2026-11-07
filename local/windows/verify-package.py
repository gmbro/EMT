"""Host-independent package checks; not a claim of Windows runtime testing."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('worker', ROOT/'local/qwen/worker-windows.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
raw, lang = worker.decode_request({'pcm':base64.b64encode(bytes(320)).decode(), 'language':'ko-KR'})
assert len(raw) == 320 and lang == 'Korean'
for request in [None, {}, {'pcm':'??', 'language':'auto'}, {'pcm':base64.b64encode(bytes(321)).decode(), 'language':'auto'}, {'pcm':'AAAA', 'language':'auto', 'url':'https://example.com'}]:
    try:
        worker.decode_request(request)
        raise AssertionError('invalid input accepted')
    except (ValueError, KeyError, TypeError):
        pass
archive = ROOT/'public/downloads/emt-qwen-windows.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == (archive.with_suffix('.sha256')).read_text().split()[0]
with zipfile.ZipFile(archive) as z:
    prefix = 'EMT-Qwen-Windows/'
    names = z.namelist()
    assert len(names) == len(set(names))
    assert all(n.startswith(prefix) and '..' not in Path(n).parts for n in names)
    assert all(not any(part in Path(n).parts for part in ['.env.local','.git','.vercel','reports','node_modules','.qwen-models','.venv-qwen']) for n in names)
    for name in ['설치.cmd','실행.cmd','번역키설정.cmd','package-lock.json','local/qwen/worker-windows.py','local/qwen/platform.mjs']:
        assert prefix+name in names
    for entry in json.loads(z.read(prefix+'manifest.json')):
        assert hashlib.sha256(z.read(prefix+entry['path'])).hexdigest() == entry['sha256']
    env = z.read(prefix+'.env.example').decode()
    assert 'GEMINI_API_KEY=\n' in env
    for name in names:
        if name.endswith('.py'):
            compile(z.read(name), name, 'exec')
print('Package manifest, checksum, input validation and Python syntax passed; Windows execution not tested.')

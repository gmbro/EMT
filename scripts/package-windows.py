"""Allowlisted source distribution; never includes developer credentials/history."""
from pathlib import Path
import hashlib
import json
import zipfile
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/downloads'

def files():
    names = ['package.json', 'package-lock.json', 'vite.config.js', 'vercel.json', 'index.html', '.env.example', 'public/model-licenses.md']
    for folder, suffixes in [('src', {'.js','.jsx','.mjs','.css','.json'}), ('api', {'.js','.mjs'}), ('local/qwen', {'.mjs','.py'}), ('local/windows', {'.py','.txt','.cmd','.lock'}), ('public/fonts', {'.woff2','.txt','.json'}), ('public/samples', {'.wav'})]:
        names += [p.relative_to(ROOT).as_posix() for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in suffixes and '__pycache__' not in p.parts]
    return sorted(set(names))

def build():
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT/'emt-qwen-windows.zip'
    manifest = []
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in files():
            data = (ROOT/name).read_bytes()
            archive.writestr('EMT-Qwen-Windows/'+name, data)
            manifest.append({'path':name, 'sha256':hashlib.sha256(data).hexdigest()})
        for name in ['설치.cmd', '실행.cmd', '번역키설정.cmd']:
            archive.writestr('EMT-Qwen-Windows/'+name, (ROOT/'local/windows'/name).read_bytes())
        archive.writestr('EMT-Qwen-Windows/읽어주세요.txt', (ROOT/'local/windows/guide.txt').read_bytes())
        archive.writestr('EMT-Qwen-Windows/manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    (OUT/'emt-qwen-windows.sha256').write_text(checksum+'  emt-qwen-windows.zip\n')
    (OUT/'windows-guide.txt').write_bytes((ROOT/'local/windows/guide.txt').read_bytes())
    with tempfile.TemporaryDirectory() as temp:
        stub = Path(temp) / 'launcher.exe'
        subprocess.run([os.environ.get('GO', 'go'), 'build', '-trimpath', '-ldflags=-s -w', '-o', str(stub), str(ROOT/'local/windows/installer/main.go')], check=True, env={**os.environ, 'CGO_ENABLED':'0', 'GOOS':'windows', 'GOARCH':'amd64'})
        (OUT/'EMT-Setup.exe').write_bytes(stub.read_bytes() + target.read_bytes())
    print(json.dumps({'files':len(manifest), 'bytes':target.stat().st_size, 'sha256':checksum}))

if __name__ == '__main__':
    build()

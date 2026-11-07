"""Explicit local installation; never downloads/runs remote shell scripts."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / '.venv-qwen' / 'Scripts' / 'python.exe'

def run(args):
    subprocess.run([str(x) for x in args], cwd=ROOT, check=True)

def main():
    if platform.system() != 'Windows' or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise RuntimeError('Windows x64 only. ARM Windows is not supported by this installer.')
    if sys.version_info[:2] != (3, 12) or sys.maxsize < 2**32:
        raise RuntimeError('Install Python 3.12 x64 from python.org first.')
    node = shutil.which('node')
    if not node or int(subprocess.check_output([node, '-p', 'process.versions.node.split(".")[0]'], text=True)) < 22:
        raise RuntimeError('Install Node.js 22 or newer LTS from nodejs.org, then reopen this window.')
    if shutil.disk_usage(ROOT).free < 15 * 1024**3:
        raise RuntimeError('At least 15 GB free disk space is required for setup.')
    print('Installs packages in this folder and downloads Qwen weights. No API key is bundled.')
    choice = input('NVIDIA GPU with current driver: type GPU. Otherwise press Enter for CPU (slow): ').strip().upper()
    if choice not in ('', 'CPU', 'GPU'):
        raise RuntimeError('Choose GPU or CPU and run setup again.')
    if not PYTHON.exists():
        run([sys.executable, '-m', 'venv', ROOT / '.venv-qwen'])
    torch_version, channel = ('2.11.0', 'cu128') if choice == 'GPU' else ('2.15.0', 'cpu')
    run([PYTHON, '-m', 'pip', 'install', 'torch=='+torch_version, '--index-url', 'https://download.pytorch.org/whl/'+channel])
    lock = 'requirements-gpu.lock' if choice == 'GPU' else 'requirements-cpu.lock'
    run([PYTHON, '-m', 'pip', 'install', '-r', ROOT / 'local/windows' / lock])
    # Run npm's JS entry point without cmd.exe interpolation or shell=True.
    npm_cli = Path(node).parent / 'node_modules/npm/bin/npm-cli.js'
    if not npm_cli.is_file():
        raise RuntimeError('Use the official Node.js Windows installer (npm component required).')
    run([node, npm_cli, 'ci', '--no-audit', '--no-fund'])
    run([PYTHON, ROOT / 'local/qwen/worker-windows.py', '--download'])
    if choice == 'GPU':
        run([PYTHON, '-c', 'import torch; assert torch.cuda.is_available(), "CUDA unavailable. Update NVIDIA driver or rerun CPU setup."'])
    run([PYTHON, ROOT / 'local/qwen/worker-windows.py', '--check'])
    print('Setup complete. Run 실행.cmd. Keep its terminal open during the meeting.')
    print('Transcription needs no API key. For translation, copy .env.example to .env.local and enter your own Gemini key.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print('Setup stopped: '+str(error), file=sys.stderr)
        sys.exit(1)

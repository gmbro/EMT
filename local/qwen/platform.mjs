import {fileURLToPath} from 'node:url';
export function qwenProcessPaths(platform=process.platform){
 return {
  python:fileURLToPath(new URL(platform==='win32'?'../../.venv-qwen/Scripts/python.exe':'../../.venv-qwen/bin/python',import.meta.url)),
  worker:fileURLToPath(new URL(platform==='win32'?'./worker-windows.py':'./worker.py',import.meta.url)),
 };
}

@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
if not exist ".venv-qwen\Scripts\python.exe" goto missing
if not exist "node_modules\vite\bin\vite.js" goto missing
call npm run dev:qwen
pause
exit /b
:missing
echo 설치.cmd를 먼저 실행해 주세요.
pause
exit /b 1

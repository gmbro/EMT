@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
py -3.12 local\windows\setup.py
if errorlevel 1 echo 설치에 실패했습니다. 위 오류를 확인해 주세요.
pause

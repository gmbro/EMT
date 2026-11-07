@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env.local" copy ".env.example" ".env.local" >nul
notepad ".env.local"
echo 저장 후 실행.cmd를 다시 실행해 주세요. API 키를 다른 사람에게 보내지 마세요.
pause

@echo off
cd /d "%~dp0\..\.."
if not exist "backend\logs" mkdir "backend\logs"
node --no-warnings backend\src\server.js >> backend\logs\server-out.log 2>> backend\logs\server-err.log

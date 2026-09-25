@echo off
cd /d "C:\novo\CARTAS DE PESO SOBRAL"
"C:\Program Files\nodejs\node.exe" --no-warnings src\server.js >> logs\server-out.log 2>> logs\server-err.log

@echo off
title iDoom Studio - Spaces for Doom
cd /d "%~dp0"
echo Stopping any existing server on port 3456...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Starting iDoom Studio server on http://localhost:3456 ...
start "" http://localhost:3456
node server.js
pause

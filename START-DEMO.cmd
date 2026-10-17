@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
echo.
echo Marias Fashion Boutique - local demo
echo http://127.0.0.1:4173/#/
echo http://127.0.0.1:4173/#/admin
echo.
start "" "http://127.0.0.1:4173/#/"
node tests\server.js
if errorlevel 1 (
  echo.
  echo Server stopped or port 4173 is already in use.
  pause
)

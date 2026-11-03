@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer and add it to PATH.
  goto failed
)
where codex >nul 2>nul
if errorlevel 1 (
  echo Please install Codex CLI, sign in, and add it to PATH.
  goto failed
)
call codex plugin marketplace add "%~dp0."
if errorlevel 1 goto failed
call codex plugin add codex-feishu-bot@local-feishu
if errorlevel 1 goto failed
node "%~dp0dist\main.cjs" dashboard
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1

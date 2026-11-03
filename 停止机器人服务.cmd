@echo off
cd /d "%~dp0"
node "%~dp0dist\main.cjs" stop
if errorlevel 1 pause

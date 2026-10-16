@echo off
cd /d "%~dp0"
node scripts/project.mjs start
if errorlevel 1 pause

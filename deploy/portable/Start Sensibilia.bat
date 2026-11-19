@echo off
setlocal
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
title Sensibilia (close this window to stop)
"%~dp0app\python\python.exe" -m sensibilia.portable start
if errorlevel 1 ( echo. & pause ) 

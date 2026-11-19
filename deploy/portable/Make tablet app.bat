@echo off
setlocal
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
title Sensibilia tablet app
"%~dp0app\python\python.exe" -m sensibilia.portable tablet-app
if errorlevel 1 ( echo. & pause ) else ( pause )

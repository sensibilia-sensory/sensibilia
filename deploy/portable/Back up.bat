@echo off
setlocal
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
title Sensibilia backup
"%~dp0app\python\python.exe" -m sensibilia.portable backup
if errorlevel 1 ( echo. & pause ) else ( timeout /t 20 )

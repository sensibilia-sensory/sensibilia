@echo off
setlocal
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
title Sensibilia restore
"%~dp0app\python\python.exe" -m sensibilia.portable restore
if errorlevel 1 ( echo. & pause ) else ( pause )

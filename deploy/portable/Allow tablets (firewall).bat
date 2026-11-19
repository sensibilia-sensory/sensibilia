@echo off
setlocal
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
echo Windows will ask for permission. Choose Yes.
"%~dp0app\python\python.exe" -m sensibilia.portable firewall

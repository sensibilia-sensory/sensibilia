@echo off
setlocal
rem Installs the optional analysis add-on (R with SensoMineR). Needs internet once, about 230 MB,
rem or a folder made with "Download analysis for another computer.bat": drop it on this file.
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
title Sensibilia - add analysis
if "%~1"=="" (
  "%~dp0app\python\python.exe" -m sensibilia.analysis_setup install
) else (
  "%~dp0app\python\python.exe" -m sensibilia.analysis_setup install --from "%~1"
)
echo.
pause

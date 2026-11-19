@echo off
setlocal
rem For a laboratory computer without internet: run this on a computer with internet, copy the
rem folder "analysis-download" to the laboratory computer, and drop it on "Add analysis (R).bat".
set "SENSIBILIA_PORTABLE_HOME=%~dp0"
cd /d "%~dp0"
title Sensibilia - download analysis add-on
"%~dp0app\python\python.exe" -m sensibilia.analysis_setup download "%~dp0analysis-download"
echo.
pause

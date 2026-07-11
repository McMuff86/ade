@echo off
if "%~1"=="--version" (
  echo ade-diagnostic-shim 1.0.0
  exit /b 0
)
exit /b 2

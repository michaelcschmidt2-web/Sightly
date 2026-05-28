@echo off
setlocal
title Sightly Vision
wsl.exe bash -lc "cd ~/agent-workspace/sightly && ./run-sightly-desktop.sh"
if errorlevel 1 (
  echo.
  echo Sightly failed to start. Check WSL and the launcher log:
  echo ~/agent-workspace/sightly/.launcher/sightly-desktop.log
  pause
)

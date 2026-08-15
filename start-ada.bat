@echo off
REM ── One-click launcher for Ada ────────────────────────────────
REM Double-click this. It starts Docker (if needed), brings up the
REM full Ada stack inside WSL, and opens the app in your browser.
REM Copy this file to your Desktop for easy access.

echo Starting Ada... (this can take ~30-60s the first time)
wsl.exe -e bash -lic "cd ~/dev/ada && ./ada up"

echo Opening Ada in your browser...
start "" http://localhost:5173

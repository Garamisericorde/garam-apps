@echo off
title G-Presets
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" %*
if errorlevel 1 (echo Installation failed. See the error above.) else (echo G-Presets installed. Open Discord and enable ProfilePresets in Vencord settings.)
pause

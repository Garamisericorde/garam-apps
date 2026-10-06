@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Profile superonline
if errorlevel 1 (echo Installation failed.) else (echo G-DPI service installed.)
pause

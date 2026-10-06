@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" -Action remove
if errorlevel 1 (echo Removal failed.) else (echo G-DPI service removed.)
pause

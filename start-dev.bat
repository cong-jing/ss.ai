@echo off
chcp 65001 > nul

REM Delegate to PowerShell script to avoid batch Ctrl+C confirmation prompt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"

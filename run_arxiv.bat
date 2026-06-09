@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================================
echo   ArXiv daily paper agent starting...
echo   Current time: %date% %time%
echo ====================================================

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Missing virtual environment: .venv
    echo Run: py -3.9 -m venv .venv
    echo Then install dependencies: .venv\Scripts\python.exe -m pip install arxiv requests
    pause
    exit /b 1
)

".venv\Scripts\python.exe" "daily_paper.py"

if %ERRORLEVEL% equ 0 (
    echo.
    echo [OK] Script finished.
) else (
    echo.
    echo [ERROR] Script failed. Please check API keys, webhook, or network access.
)

echo.
echo Window will close in 10 seconds...
timeout /t 10 >nul

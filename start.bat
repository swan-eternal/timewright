@echo off
setlocal
title Timewright

cd /d "%~dp0"

echo.
echo  ============= Timewright =============
echo   This starts Timewright and opens
echo   the home page in your browser.
echo   Keep this window open while you
echo   work. Close it when done.
echo  ======================================
echo.

where timewright >nul 2>nul
if errorlevel 1 (
    echo  [!] Timewright is not installed yet.
    echo  Double-click install.bat first.
    echo.
    pause
    exit /b 1
)

echo.
echo  Starting Timewright. Your browser will open the
echo  home page - edit a world there, or create a new one.
echo.
echo  If the browser does not open by itself, go to
echo  http://localhost:5176 in your browser.
echo.
call timewright home
echo.
echo  Timewright stopped. You can close this window.
echo.
pause

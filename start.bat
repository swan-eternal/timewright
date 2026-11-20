@echo off
setlocal
title Timewright editor

cd /d "%~dp0"

echo.
echo  ============= Timewright =============
echo   This opens the Timewright editor in
echo   your browser. Keep this window open
echo   while you work. Close it when done.
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

set "WORLD="
set /p WORLD="Which world? (or press Enter for my-world): "
if "%WORLD%"=="" set "WORLD=my-world"

if not exist "%WORLD%" (
    echo.
    echo  There is no folder named "%WORLD%" here.
    echo  Worlds live inside the timewright folder - check the
    echo  spelling, or run install.bat to create one.
    echo.
    pause
    exit /b 1
)

echo.
echo  Starting the editor for "%WORLD%" ...
echo  If a browser window does not open by itself, go to
echo  http://localhost:5175 in your browser.
echo.
call timewright edit --world "%WORLD%"
echo.
echo  The editor stopped. You can close this window.
echo.
pause

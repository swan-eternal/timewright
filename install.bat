@echo off
setlocal
title Timewright installer

cd /d "%~dp0"

echo.
echo  ================= Timewright =================
echo   This installs the Timewright timeline tool.
echo   It needs an internet connection and a few
echo   minutes. It is safe to run this file twice.
echo  =============================================
echo.

if not exist package.json (
    echo  [!] It looks like this file is still inside the ZIP.
    echo.
    echo  Please extract first: right-click the ZIP file and
    echo  choose "Extract All", open the extracted folder,
    echo  then double-click install.bat again.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo  [!] Node.js was not found on this computer.
    echo.
    echo  Node.js is the engine Timewright runs on. It is free
    echo  and safe. Your browser is now opening nodejs.org:
    echo.
    echo    1. Click the big green "LTS" Download button
    echo    2. Run the installer, keep clicking Next
    echo    3. Come back and double-click install.bat again
    echo.
    start "" https://nodejs.org/
    pause
    exit /b 1
)

set "NMAJOR="
for /f "delims=. tokens=1" %%v in ('node --version') do set "NMAJOR=%%v"
if defined NMAJOR set "NMAJOR=%NMAJOR:v=%"
if not defined NMAJOR set "NMAJOR=22"
if %NMAJOR% LSS 22 (
    echo  [!] Your Node.js is version %NMAJOR%, but 22 or newer
    echo  is needed. Your browser is opening nodejs.org - install
    echo  the current LTS, then run this file again.
    echo.
    start "" https://nodejs.org/
    pause
    exit /b 1
)

echo  [ok] Node.js found.
echo.
echo  [..] Installing Timewright. This takes a few minutes
echo       and the window will scroll a lot of text - normal.
echo.
call npm install
if errorlevel 1 goto failed

echo.
echo  [..] Adding the timewright command to this computer...
call npm link
if errorlevel 1 goto failed

echo.
echo  [ok] Timewright is installed.
echo.
set "WORLD="
set /p WORLD="Name your first world (or press Enter for my-world): "
if "%WORLD%"=="" set "WORLD=my-world"
if exist "%WORLD%" (
    echo  A folder named "%WORLD%" already exists here - keeping it.
) else (
    call timewright init "%WORLD%"
)
echo.
echo  All set. To open the editor later, come back to this
echo  folder and double-click start.bat
echo.
echo  You can close this window now.
echo.
pause
exit /b 0

:failed
echo.
echo  [!] Something went wrong. Scroll up: if a line starts
echo  with "error", note it down and ask for help. Or close
echo  this window and simply run install.bat again.
echo.
pause
exit /b 1

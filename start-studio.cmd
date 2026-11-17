@echo off
rem Start the Timewright Studio and open it in your browser.
rem
rem   start-studio.cmd                a world in this folder, or the example
rem   start-studio.cmd C:\my-world    a world folder
rem   start-studio.cmd C:\my-world 5176   ...on a different port
rem
rem The first run installs the dependencies and builds the tool. Ctrl-C stops it.

setlocal
cd /d "%~dp0"

set "WORLD=%~1"
set "PORT=%~2"
if "%PORT%"=="" set "PORT=5175"

if "%WORLD%"=="" (
  if exist "world.yaml" (
    set "WORLD=%CD%"
  ) else if exist "world.yml" (
    set "WORLD=%CD%"
  ) else if exist "examples\napoleon" (
    set "WORLD=%CD%\examples\napoleon"
  ) else (
    echo No world folder found. Try: start-studio.cmd ^<world-folder^>
    exit /b 1
  )
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
)
if not exist dist\cli\index.js (
  echo Building the Studio...
  call npm run build
)

echo.
echo   Studio: http://127.0.0.1:%PORT%/
echo   World:  %WORLD%
echo   Stop:   Ctrl-C
echo.

rem Open the browser once the server has had a moment to start.
start "" /b cmd /c "ping -n 6 127.0.0.1 >nul && start "" http://127.0.0.1:%PORT%/"

call node dist\cli\index.js edit --world "%WORLD%" --port %PORT%

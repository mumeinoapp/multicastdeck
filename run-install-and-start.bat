@echo off
cd /d "%~dp0"
echo Current directory: %cd%
echo.
echo === npm install ===
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. See errors above.
  pause
  exit /b 1
)
echo.
echo === npm start ===
call npm start
pause

@echo off
cd /d "%~dp0"
echo Current directory: %cd%
echo.

echo === git commit / tag / push (v0.3.2) ===
call git add -A
call git commit -m "v0.3.2: Pro feature grayout for free users, YouTube icon/emote fixes, UI polish"
if errorlevel 1 (
  echo.
  echo git commit failed or nothing to commit. Continuing anyway...
)
call git tag -a v0.3.2 -m "v0.3.2"
if errorlevel 1 (
  echo.
  echo git tag failed ^(maybe it already exists^). Continuing anyway...
)
call git push origin main
if errorlevel 1 (
  echo.
  echo git push origin main failed. See errors above.
  pause
  exit /b 1
)
call git push origin v0.3.2
if errorlevel 1 (
  echo.
  echo git push origin v0.3.2 ^(tag^) failed. See errors above.
  pause
  exit /b 1
)
echo.

if "%GH_TOKEN%"=="" (
  echo GH_TOKEN is not set.
  echo Set your GitHub Personal Access Token ^(repo scope^) first, e.g.:
  echo   set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
  echo Then run this file again.
  pause
  exit /b 1
)

echo === npm install ===
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. See errors above.
  pause
  exit /b 1
)

echo.
echo === npm run release (electron-builder --win --publish always) ===
call npm run release
if errorlevel 1 (
  echo.
  echo Release build failed. See errors above.
  pause
  exit /b 1
)

echo.
echo Done. Check https://github.com/mumeinoapp/multicastdeck/releases
echo The release was created as a Draft - open it, paste in the CHANGELOG.md
echo v0.3.2 section as the description, then click "Publish release".
pause

@echo off
setlocal
title YanZhao Knowledge Manager
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" goto no_node

echo Starting YanZhao Knowledge Manager...
echo URL: http://127.0.0.1:4178/manager/
echo Keep this window open while using the manager.
echo.
start "" "http://127.0.0.1:4178/manager/"
"%NODE_EXE%" "manager\server.mjs"

echo.
echo The manager has stopped. Review the error above.
pause
exit /b 1

:no_node
echo Node.js was not found.
echo Please send a screenshot of this window to Codex.
pause
exit /b 1

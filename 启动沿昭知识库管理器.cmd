@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装后再启动。
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4178/manager/"
node manager\server.mjs
if errorlevel 1 pause


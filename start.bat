@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example. You can edit it later to add real provider keys.
)
call npm install
if errorlevel 1 exit /b 1
call npm run migrate
call npm run seed
start http://localhost:3000
call npm start

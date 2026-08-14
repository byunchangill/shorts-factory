@echo off
rem Shopping Shorts Factory - build the UI and run the server (called by launch.vbs)
cd /d "%~dp0..\.."

if not exist "node_modules\" call npm install

rem Rebuild the UI every launch so code changes are never silently stale.
rem build:fast skips tsc --noEmit (typecheck is a dev concern, not a launch one).
call npm run build:fast -w client

call npm run start -w server

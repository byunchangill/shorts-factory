@echo off
rem Shopping Shorts Factory - kill whatever is listening on the API port
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4310" ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>&1
exit /b 0

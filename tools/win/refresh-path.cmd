@echo off
rem winget으로 방금 깐 프로그램을 이번 실행에서 바로 쓰기 위한 PATH 갱신.
rem 설치는 레지스트리의 PATH를 바꾸지만, 이미 떠 있는 프로세스는 예전 사본을 계속 쓴다.
rem
rem 기존 PATH를 갈아치우지 않고 뒤에 덧붙이기만 한다 — 레지스트리 값에는
rem %SystemRoot% 같은 미확장 변수가 들어 있어 그대로 대입하면 멀쩡한 PATH가 깨진다.

for /f "tokens=2,*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SF_SYS=%%b"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "SF_USR=%%b"

if defined SF_SYS set "PATH=%PATH%;%SF_SYS%"
if defined SF_USR set "PATH=%PATH%;%SF_USR%"

rem winget이 실행 파일 바로가기를 모아두는 곳 — 위 두 값이 미확장이라 놓치는 경우가 있다
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links" set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links"

set "SF_SYS="
set "SF_USR="
exit /b 0

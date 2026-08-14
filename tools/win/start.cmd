@echo off
chcp 65001 >nul
rem 쇼핑쇼츠 팩토리 — 화면을 빌드하고 서버를 띄운다 (launch.vbs가 창 없이 호출).
rem 무거운 첫 설치는 setup.cmd가 미리 끝내둔다.

call "%~dp0refresh-path.cmd"

cd /d "%~dp0..\.."

if not exist "node_modules\" call npm install

rem 실행할 때마다 화면을 다시 빌드한다 — 코드를 고쳐도 옛 화면이 뜨는 일이 없다.
rem build:fast는 tsc --noEmit을 건너뛴다 (타입 검사는 개발 때 할 일이다).
call npm run build:fast -w client

call npm run start -w server

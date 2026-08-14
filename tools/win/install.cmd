@echo off
chcp 65001 >nul
rem 쇼핑쇼츠 팩토리 — 더블클릭 설치.
rem 최신 설치 스크립트를 받아 그대로 실행한다. 이 파일 자체는 바뀔 일이 없다.

echo.
echo  쇼핑쇼츠 팩토리 설치를 시작합니다...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/byunchangill/shorts-factory/main/tools/win/install.ps1 | iex"

if errorlevel 1 (
  echo.
  echo  [!] 설치에 실패했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.
  echo.
)
pause

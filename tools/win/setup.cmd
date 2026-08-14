@echo off
chcp 65001 >nul
rem 쇼핑쇼츠 팩토리 — 처음 한 번만 도는 준비 작업.
rem 이미 갖춰진 것은 건너뛰므로 두 번째 실행부터는 몇 초 만에 끝난다.

cd /d "%~dp0..\.."

echo.
echo  ================================================
echo   쇼핑쇼츠 팩토리 — 처음 실행 준비
echo  ================================================
echo.
echo  필요한 프로그램을 확인합니다. 이미 있으면 건너뜁니다.
echo  설치 중 "이 앱이 장치를 변경하도록 허용" 창이 뜨면 예를 눌러주세요.
echo.

where winget >nul 2>&1
if errorlevel 1 goto :nowinget

set "SF_DID="
call :ensure node    OpenJS.NodeJS.LTS "Node.js"
call :ensure ffmpeg  Gyan.FFmpeg       "ffmpeg (영상 처리)"
call :ensure ffprobe Gyan.FFmpeg       "ffprobe (영상 정보)"
call :ensure yt-dlp  yt-dlp.yt-dlp     "yt-dlp (영상 다운로드)"

if defined SF_DID call "%~dp0refresh-path.cmd"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] Node.js를 찾지 못했습니다. 이 창을 닫고 아이콘을 다시 눌러주세요.
  echo      그래도 안 되면 https://nodejs.org 에서 직접 설치해주세요.
  echo.
  pause
  exit /b 1
)

echo.
echo  [3/3] 앱 준비 중 (처음에는 몇 분 걸립니다)...
if not exist "node_modules\" call npm install
call npm run build:fast -w client

echo.
echo  준비가 끝났습니다. 잠시 후 앱이 열립니다.
timeout /t 3 >nul
exit /b 0

:ensure
where %1 >nul 2>&1
if not errorlevel 1 (
  echo  [있음] %~3
  exit /b 0
)
echo  [설치] %~3 ...
winget install -e --id %2 --accept-package-agreements --accept-source-agreements --silent
set "SF_DID=1"
exit /b 0

:nowinget
echo.
echo  [!] 이 PC에는 winget이 없어 자동 설치를 할 수 없습니다.
echo      아래 3가지를 직접 설치한 뒤 아이콘을 다시 눌러주세요.
echo.
echo      Node.js   https://nodejs.org
echo      ffmpeg    https://ffmpeg.org/download.html
echo      yt-dlp    https://github.com/yt-dlp/yt-dlp/releases
echo.
pause
exit /b 1

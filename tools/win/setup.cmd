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
echo  [앱] 준비 중 (처음에는 몇 분 걸립니다)...
if not exist "node_modules\" call npm install
call npm run build:fast -w client

rem 2차 AI 인페인팅은 선택 기능이라 맨 마지막에 둔다 —
rem 여기서 실패하거나 오래 걸려도 앱 자체는 이미 쓸 수 있는 상태다.
call :iopaint

echo.
echo  준비가 끝났습니다. 잠시 후 앱이 열립니다.
timeout /t 3 >nul
exit /b 0


rem ── 도우미 ────────────────────────────────────────────────

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

rem 2차 AI 인페인팅(IOPaint). 선택 기능이고 PyTorch가 딸려 와 수 GB를 받는다.
rem 한 번 시도한 뒤에는 성공하든 실패하든 표시를 남겨 매번 다시 붙잡지 않는다.
:iopaint
if not exist "workspace\" mkdir "workspace"
where iopaint >nul 2>&1
if not errorlevel 1 (
  echo  [있음] iopaint (2차 AI 인페인팅)
  echo done> "workspace\.iopaint-attempted"
  exit /b 0
)

echo.
echo  [설치] iopaint (2차 AI 인페인팅) — 선택 기능입니다.
echo         PyTorch가 함께 받아져 2GB가 넘습니다. 시간이 꽤 걸립니다.
echo         실패해도 앱은 정상 동작합니다 (1차 제거는 ffmpeg로 됩니다).
echo.

rem Python 3.13은 PyTorch 지원이 아직 안 따라온 경우가 있어 3.12를 쓴다
where py >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    echo  [설치] Python 3.12 ...
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
    call "%~dp0refresh-path.cmd"
  )
)

rem `if not defined X where ... && set ...` 로 한 줄에 쓰면 안 된다 —
rem && 가 if 전체의 성공에 붙어서, 이미 py를 찾았을 때도 python으로 덮어쓴다
set "SF_PY="
where py >nul 2>&1 && set "SF_PY=py"
if not defined SF_PY (
  where python >nul 2>&1 && set "SF_PY=python"
)

if not defined SF_PY (
  echo  [건너뜀] Python을 찾지 못해 iopaint를 설치하지 못했습니다.
  echo           나중에 필요하면 tools\install-inpaint.md 를 참고하세요.
  echo skipped> "workspace\.iopaint-attempted"
  exit /b 0
)

%SF_PY% -m pip install --upgrade pip
%SF_PY% -m pip install iopaint
call "%~dp0refresh-path.cmd"

where iopaint >nul 2>&1
if errorlevel 1 (
  echo  [건너뜀] iopaint 설치에 실패했습니다. 앱은 그대로 쓸 수 있습니다.
  echo           나중에 필요하면 tools\install-inpaint.md 를 참고하세요.
) else (
  echo  [완료] iopaint 설치됨
)
echo done> "workspace\.iopaint-attempted"
exit /b 0

:nowinget
echo.
echo  [!] 이 PC에는 winget이 없어 자동 설치를 할 수 없습니다.
echo      아래를 직접 설치한 뒤 아이콘을 다시 눌러주세요.
echo.
echo      Node.js   https://nodejs.org
echo      ffmpeg    https://ffmpeg.org/download.html
echo      yt-dlp    https://github.com/yt-dlp/yt-dlp/releases
echo.
echo      2차 AI 인페인팅(선택)은 tools\install-inpaint.md 참고
echo.
pause
exit /b 1

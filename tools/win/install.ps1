# 쇼핑쇼츠 팩토리 — 설치 / 업데이트
#
# 아무것도 없는 윈도우에서 이것 하나만 돌리면 된다. 소스를 받아 자리를 잡고
# 바탕화면 아이콘을 만든 뒤 앱을 띄운다. 필요한 프로그램(Node·ffmpeg·yt-dlp·
# Python·iopaint)은 앱이 처음 뜰 때 setup.cmd가 알아서 깐다.
#
# 업데이트도 같은 스크립트를 다시 돌리는 것으로 끝난다 — 앱 폴더만 갈아끼우고
# 작업 데이터는 건드리지 않는다.

$ErrorActionPreference = 'Stop'

$Repo    = 'byunchangill/shorts-factory'
$AppRoot = Join-Path $env:LOCALAPPDATA 'ShortsFactory'
$AppDir  = Join-Path $AppRoot 'app'
$WsDir   = Join-Path $AppRoot 'workspace'
$Port    = 4310

function Say($msg) { Write-Host "  $msg" }

Write-Host ''
Write-Host '  ================================================'
Write-Host '   쇼핑쇼츠 팩토리 설치'
Write-Host '  ================================================'
Write-Host ''
Say "설치 위치 : $AppDir"
Say "작업 데이터: $WsDir  (업데이트해도 지워지지 않습니다)"
Write-Host ''

# ── 1. 최신 버전 확인 ───────────────────────────────────────
Say '최신 버전을 확인합니다...'
$headers = @{ 'User-Agent' = 'shorts-factory-installer' }
$sha = (Invoke-RestMethod "https://api.github.com/repos/$Repo/commits/main" -Headers $headers).sha

# ── 2. 돌고 있는 서버 종료 ──────────────────────────────────
# node_modules를 물고 있으면 폴더를 갈아끼울 수 없다
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# ── 3. 소스 내려받기 ────────────────────────────────────────
Say '소스를 내려받습니다...'
$zip = Join-Path $env:TEMP 'shorts-factory.zip'
$tmp = Join-Path $env:TEMP 'shorts-factory-extract'

$ProgressPreference = 'SilentlyContinue'   # 진행 막대가 다운로드를 크게 느리게 한다
Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip -Headers $headers

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$src = Join-Path $tmp 'shorts-factory-main'

# ── 4. 자리 잡기 ────────────────────────────────────────────
# node_modules는 다시 받으면 몇 분이 걸린다. 잠시 빼뒀다가 되돌린다.
$keep = Join-Path $AppRoot 'node_modules.keep'
$nm   = Join-Path $AppDir 'node_modules'

if (Test-Path $nm) {
  Say '설치된 의존성은 그대로 둡니다...'
  if (Test-Path $keep) { Remove-Item $keep -Recurse -Force }
  Move-Item $nm $keep
}

if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
Copy-Item (Join-Path $src '*') $AppDir -Recurse -Force

if (Test-Path $keep) { Move-Item $keep $nm }

# ── 5. 작업 데이터는 앱 폴더 밖에 둔다 ──────────────────────
# 업데이트가 앱 폴더를 통째로 갈아끼우므로, 안에 두면 포맷·산출물·API 키가 날아간다
New-Item -ItemType Directory -Path $WsDir -Force | Out-Null

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText(
  (Join-Path $AppDir 'tools\win\local-config.cmd'),
  "@echo off`r`nrem 설치본 전용 설정 — 설치 스크립트가 만든다`r`nset `"SHORTS_WORKSPACE=$WsDir`"`r`n",
  $utf8NoBom)

# 이 파일이 있으면 설치본, 없으면 개발자의 깃 클론이다 (업데이트 확인 여부가 갈린다)
[IO.File]::WriteAllText((Join-Path $AppDir '.version'), $sha, $utf8NoBom)

Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue

# ── 6. 바탕화면 아이콘 ──────────────────────────────────────
Say '바탕화면 아이콘을 만듭니다...'
& wscript.exe (Join-Path $AppDir 'tools\win\create-shortcut.vbs')

# ── 7. 실행 ─────────────────────────────────────────────────
Write-Host ''
Say '설치가 끝났습니다. 앱을 실행합니다.'
Say '필요한 프로그램을 까느라 처음에는 시간이 걸립니다 (10~30분).'
Write-Host ''
& wscript.exe (Join-Path $AppDir 'tools\win\launch.vbs')

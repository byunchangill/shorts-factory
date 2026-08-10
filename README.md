# 🏭 쇼핑쇼츠 팩토리

쿠팡 제품 기반 쇼핑쇼츠(9:16)를 반복 생산하는 로컬 웹앱.
웹 UI가 영상 처리(다운로드·정리·TTS·조립)를 맡고, 대본·포맷 설계는 **Claude Code 요청서**로 처리하는 반자동 파이프라인입니다.

## 메뉴

- **해외영상 짜집기** — 쿠팡 상세페이지 파일 첨부 + 영상 URL 무제한 입력 → yt-dlp 다운로드 → 자막/이모지/워터마크 제거(1차: ffmpeg 크롭/블러/보간, 2차: AI 인페인팅) → 제품 맞춤 대본 → 컷 선택 → TTS → 최종 조립
- **제품정보리뷰** — 채널 고유 포맷(훅·씬 구성·톤·브랜딩)을 먼저 설계하고, 그 포맷으로 반복 생산 (수익화 채널 특화)

## 설치

```bash
# 1. 의존성
npm install

# 2. 미디어 도구 (필수)
pip install yt-dlp edge-tts
# ffmpeg: https://ffmpeg.org/download.html (winget install ffmpeg / brew install ffmpeg)

# 3. AI 인페인팅 (선택 — 2차 워터마크 제거)
pip install iopaint    # 상세: tools/install-inpaint.md

# 4. 점검
npm run doctor
```

## 실행

```bash
npm run dev
# 웹 UI: http://localhost:5173  /  API: http://localhost:4310
```

## 사용 흐름 (해외영상 짜집기 기준)

1. 대시보드 → 해외영상 짜집기 → **새 폴더** (제품 단위)
2. 폴더의 **지침** 탭에서 대본/영상 지침 작성, **제품자료** 탭에 쿠팡 상세페이지 캡처 첨부
3. **새 영상 작업** → 영상 URL 붙여넣기(무제한) → 다운로드
4. 클립마다 프레임 위에 제거 영역 드래그 → **1차 제거** (필요시 AI 인페인팅)
5. **대본 요청서 발행** → 표시된 명령을 Claude Code 터미널에 붙여넣기 → 결과 자동 반영 → 승인/반려
6. 컷 선택 → TTS → 사용 권리 확인 → **조립** → 검수 → 업로드 킷

Claude Code 요청서 실행 예:
```bash
claude "/answer-job workspace/menu-a/무선청소기/jobs/20260810-001-1편/requests/p01-script"
```

## 주의

- 해외 영상 재사용은 **원저작자 허락/라이선스 확인이 사용자 책임**입니다. 워터마크를 제거해도 저작권은 사라지지 않으며, 조립 전 권리 확인 체크가 필수입니다.
- 업로드 킷에는 쿠팡파트너스 공시문구가 자동 포함됩니다.

## 테스트

```bash
npm test   # 상태머신 / ffmpeg filtergraph 빌더 / 자막 빌더 단위 테스트
```

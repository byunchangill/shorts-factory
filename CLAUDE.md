# 쇼핑쇼츠 팩토리 v2

쿠팡 제품 기반 쇼핑쇼츠를 반복 생산하는 로컬 웹앱. 웹 UI(작업 관리·영상 처리)와 Claude Code(대본·포맷·분석)가 `workspace/` 파일시스템을 공유하며 협업하는 **반자동 파이프라인**이다.

## 아키텍처

- `server/` — Express API (:4310). yt-dlp/ffmpeg/edge-tts 서브프로세스 실행, 잡 상태머신, SSE 푸시, 요청서 결과 감지(chokidar)
- `client/` — React + Vite (:5173). 진행 상황 중심 UI
- `shared/` — zod 스키마 단일 소스 (`types.ts`), 상태/라벨 상수 (`constants.ts`)
- `workspace/` — 모든 사용자 데이터 (gitignore). 서버와 Claude Code가 공유

실행: `npm run dev` (API+UI 동시) / 점검: `npm run doctor` / 테스트: `npm test`

## 두 메뉴

| 메뉴 | 폴더 | 흐름 |
|---|---|---|
| A. 해외영상 짜집기 | `workspace/menu-a/` | URL 다운로드 → 자막/워터마크 제거(1차 ffmpeg, 2차 AI인페인팅) → 대본 → 컷 → TTS → 조립 |
| B. 제품정보리뷰 | `workspace/menu-b/` | 고유 포맷 선택 → 대본 → 씬 이미지 → TTS → 조립 |

프로젝트(세부 폴더) 구조: `{menu}/{project}/` 아래 `project.json`, `guidelines/`(대본·영상·채널 지침), `product/`(쿠팡 상세페이지 첨부), `jobs/{jobId}/`.

## 요청서 프로토콜 (Claude Code 연동의 핵심)

웹앱이 `jobs/{jobId}/requests/{packetId}/`에 `request.md`(목적+지침+제품정보+소재현황+산출물 명세+검증 규칙)를 발행하면, Claude Code가 `/answer-job <요청서 경로>`로 처리한다.

**절대 규칙:**
1. Claude Code는 요청서 폴더의 `result/`에만 쓴다. `job.json`, `packet.json`, `clip.json` 등 상태 파일은 서버 전용.
2. 산출물 작성 완료 후 마지막에 `result/.done` 빈 파일을 생성한다 — 서버가 감지해 zod 검증 후 자동 반영한다.
3. 산출물 파일명·스키마는 request.md의 "산출물 명세"를 정확히 따른다.

## 콘텐츠 규칙

- 원본 영상 문장 재사용 금지 — 구조·페이싱만 참고
- 과장 금지: "무조건", "100%", "기적", "완치" 등
- 대본 총 낭독 45~58초 (한국어 250~290자)
- 업로드 킷에 쿠팡파트너스 공시문구 필수: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
- 해외영상 재사용은 사용 권리 확인이 선행 — 조립 전 rights-confirm 게이트가 막는다

## 코드 규칙

- 상태 파일 쓰기는 반드시 `writeJsonAtomic` 경유, 잡 상태 변경은 `transition()`(전이표 검증) 경유
- 서브프로세스는 `util/exec.ts`의 `run()` 사용 — 인자 배열 방식만, 셸 문자열 조립 금지
- 스키마 변경은 `shared/types.ts`에서만 (서버·클라이언트·요청서 검증이 모두 여기 의존)
- 커밋: feat/fix/refactor/docs/test 접두어

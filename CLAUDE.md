# 쇼핑쇼츠 팩토리 v2

쿠팡 제품 기반 쇼핑쇼츠를 반복 생산하는 로컬 웹앱. 웹 UI(작업 관리·영상 처리)와 **AI(Claude Code / API / 웹 챗)**가 `workspace/` 파일시스템을 매개로 협업하는 **반자동 파이프라인**이다.

## 아키텍처

- `server/` — Express API (:4310). yt-dlp/ffmpeg/TTS 서브프로세스 실행, 잡 상태머신, SSE 푸시, 요청서 결과 감지(chokidar), LLM·유튜브 API 호출
- `client/` — React + Vite (:5173). 진행 상황 중심 UI
- `shared/` — zod 스키마 단일 소스 (`types.ts`), 상태/라벨 상수 (`constants.ts`)
- `workspace/` — 모든 사용자 데이터 + API 키 (gitignore). 서버와 Claude Code가 공유

실행: `npm run dev` (API+UI) / 점검: `npm run doctor` / 단위 테스트: `npm test` / E2E: `npm run harness`

`npm run harness`(`tools/harness.ts`)는 합성 영상으로 파이프라인 전 구간을 실제로 돌려 영상 1편을 만든다.
파이프라인·상태 전이·요청서 왕복을 건드렸다면 이걸 통과해야 한다. 격리 작업공간(`SHORTS_WORKSPACE`)을 쓰므로
실제 데이터에 영향이 없고, API 키 없이 동작한다.

## 두 메뉴 + 리서치

| 메뉴 | 폴더 | 흐름 |
|---|---|---|
| A. 해외영상 짜집기 | `workspace/menu-a/` | URL 다운로드 → 자막/워터마크 제거(1차 ffmpeg, 2차 AI인페인팅) → 대본 → 컷 → 음성 → 조립 |
| B. 제품정보리뷰 | `workspace/menu-b/` | 고유 포맷 선택 → 대본 → 씬 이미지 → 음성 → 조립 |
| 유튜브 리서치 | — | 키워드/쇼츠 검색, 인기 쇼츠, 타채널 분석, 내 채널 분석(OAuth). 검색 결과를 메뉴 A 잡의 소스로 바로 전달 |

프로젝트(세부 폴더) 구조: `{menu}/{project}/` 아래 `project.json`, `guidelines/`(대본·영상·채널 지침), `product/`(쿠팡 상세페이지 첨부), `jobs/{jobId}/`.

## 요청서 프로토콜 (AI 연동의 핵심)

웹앱이 `jobs/{jobId}/requests/{packetId}/`에 `request.md`(목적+지침+제품정보+소재현황+산출물 명세+검증 규칙)를 발행한다. **어떤 AI로도 처리할 수 있는 자기완결 문서**이며 실행 방식은 3가지:

1. **Claude Code** — `/answer-job <요청서 경로>` 스킬로 처리
2. **API 자동 실행** — 서버가 등록된 키로 Anthropic/OpenAI/Gemini 호출 (`server/src/ai/`)
3. **수동 복사/붙여넣기** — 프롬프트를 웹 챗에 붙여넣고 답변을 앱에 붙여넣기

세 방식 모두 결과가 `result/`에 파일로 떨어지고 `.done` 마커로 동일한 검증·반영 경로를 탄다.

**절대 규칙 (파일 접근이 가능한 AI):**
1. 요청서 폴더의 `result/`에만 쓴다. `job.json`, `packet.json`, `clip.json` 등 상태 파일은 서버 전용
2. 산출물 작성 완료 후 마지막에 `result/.done` 빈 파일 생성 — 서버가 감지해 zod 검증 후 자동 반영
3. 산출물 파일명·스키마는 request.md의 "산출물 명세"를 정확히 따른다

## 산출물 저장 (2단 구조)

- `workspace/` — 버전·상태 추적용 내부 저장소 (덮어쓰지 않고 `*_v{n}` 보존)
- **내보내기 폴더** — 사용자가 실제로 쓰는 결과물. `{exportRoot}/{제품명}/` 아래 `최종영상/ 영상/ 음성/ 대본/ 이미지/ 업로드킷/`으로 정리. 잡 완료 시 자동 + 수동 버튼 (`server/src/pipeline/exporter.ts`)

## 음성

씬에 음성 파일이 첨부돼 있으면 그 파일을 쓰고, 없는 씬만 합성한다. 엔진은 **타입캐스트 API**(캐릭터 선택·미리듣기) 또는 **edge-tts**(키 없을 때 무료 폴백). 어느 경로든 `voice/timing.json` 인터페이스는 동일하며 이 타이밍이 자막·조립의 기준이다.

## 콘텐츠 규칙

- 원본 영상 문장 재사용 금지 — 구조·페이싱만 참고
- 과장 금지: "무조건", "100%", "기적", "완치" 등
- 대본 총 낭독 45~58초 (한국어 250~290자)
- 업로드 킷에 쿠팡파트너스 공시문구 필수: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
- 해외영상 재사용은 사용 권리 확인이 선행 — 조립 전 rights-confirm 게이트가 막는다

## 코드 규칙

- 상태 파일 쓰기는 반드시 `writeJsonAtomic` 경유. 읽기-수정-쓰기는 `mutateJob()`을 쓴다 — 파일 락으로
  직렬화되어 동시 갱신이 유실되지 않는다 (`withFileLock`)
- 잡 상태 변경은 `transition()`(인접 단계만 허용) 또는 `advanceTo()`(목표까지 한 칸씩 전진) 경유.
  단계를 건너뛰는 `transition()` 호출은 실패한다
- 백그라운드 작업(`void fn()`)에는 반드시 `.catch()`를 단다 — 없으면 로컬 서버가 통째로 죽는다
- 서브프로세스는 `util/exec.ts`의 `run()` 사용 — 인자 배열 방식만, 셸 문자열 조립 금지
- 스키마 변경은 `shared/types.ts`에서만 (서버·클라이언트·요청서 검증이 모두 여기 의존)
- API 키는 `workspace/secrets.json`에만 저장, 응답에는 마스킹된 값만 (`store/secrets.ts`)
- 유튜브 API는 반드시 `youtube/client.ts`의 `ytFetch` 경유 — 쿼터 확인·차감·캐시가 여기 있다. 무료 한도(10,000유닛/일) 밖의 기능은 구현하지 않는다
- 커밋: feat/fix/refactor/docs/test 접두어

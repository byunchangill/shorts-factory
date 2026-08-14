# 쇼핑쇼츠 팩토리 v2

쿠팡 제품 기반 쇼핑쇼츠를 반복 생산하는 로컬 웹앱. 웹 UI(작업 관리·영상 처리)와 **AI(Claude Code / API / 웹 챗)**가 `workspace/` 파일시스템을 매개로 협업하는 **반자동 파이프라인**이다.

## 아키텍처

- `server/` — Express API (:4310). yt-dlp/ffmpeg/TTS 서브프로세스 실행, 잡 상태머신, SSE 푸시, 요청서 결과 감지(chokidar), LLM·유튜브 API 호출
- `client/` — React + Vite (:5173). 진행 상황 중심 UI
- `shared/` — zod 스키마 단일 소스 (`types.ts`), 상태/라벨 상수 (`constants.ts`)
- `workspace/` — 모든 사용자 데이터 + API 키 (gitignore). 서버와 Claude Code가 공유

실행: `npm run dev` (API+UI) / 점검: `npm run doctor` / 단위 테스트: `npm test` / E2E: `npm run harness`

**실행 경로가 둘이다.** 개발은 `npm run dev` — vite(:5173)가 화면을, tsx 서버(:4310)가 API를 맡고
`/api`·`/media`는 프록시된다. 쓰기만 할 때는 `npm start` — 서버가 `client/dist`를 직접 서빙해
**:4310 하나로 화면까지** 낸다 (`mountClient`, `app.ts`). dist 유무는 등록 시점이 아니라 요청마다
본다 — 서버를 띄운 뒤 빌드해도 동작해야 하고, 없으면 "빌드하세요" 안내를 낸다.
SPA 폴백은 `/api`·`/media`를 반드시 비켜간다 — 안 그러면 없는 엔드포인트가 200 HTML로 답해
프론트가 JSON 파싱에서 터진다. 윈도우는 `tools/win/`의 아이콘으로 터미널 없이 연다 (README 참고)
샘플 심기: `npm run seed` (또는 새 영상 작업 모달의 "샘플 사용하기") — `samples/`의 실제 영상으로 잡 하나를
**영상 분석 단계까지** 만든다. 그 뒤는 직접 밟아 시험하는 것이 목적이라 채우지 않는다
(`--full`로 음성 단계까지 채울 수 있다). 원본은 항상 복사해 쓰고 옮기지 않는다.
`workspace/`가 깃에 없어 새 PC에서 화면이 비는 문제를 메운다 (`samples/README.md`)

`npm run harness`(`tools/harness.ts`)는 합성 영상으로 파이프라인 전 구간을 실제로 돌려 영상 1편을 만든다.
파이프라인·상태 전이·요청서 왕복을 건드렸다면 이걸 통과해야 한다. 격리 작업공간(`SHORTS_WORKSPACE`)을 쓰므로
실제 데이터에 영향이 없고, API 키 없이 동작한다.

## 두 메뉴 + 리서치

| 메뉴 | 폴더 | 흐름 |
|---|---|---|
| A. 해외영상 짜집기 | `workspace/menu-a/` | URL 다운로드 → 자막/워터마크 제거(1차 ffmpeg, 2차 AI인페인팅) → 대본 → 컷 → 음성 → 조립 |
| B. 제품정보리뷰 | `workspace/menu-b/` | 고유 포맷 선택 → 대본 → 씬 이미지 → 음성 → 조립 |
| 유튜브 리서치 | — | 키워드/쇼츠 검색, 인기 쇼츠, 타채널 분석, 내 채널 분석(OAuth). 검색 결과를 메뉴 A 잡의 소스로 바로 전달 |

프로젝트 = **카테고리 폴더**(생활용품·주방 등)이고 그 안의 잡 하나가 영상 한 편이다.
구조: `{menu}/{project}/` 아래 `project.json`, `guidelines/`(대본·영상·채널 지침), `product/`(쿠팡 상세페이지 첨부), `jobs/{jobId}/`.

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
- **삭제는 지우지 않는다** — 카테고리·잡 삭제는 폴더를 `workspace/.trash/{menu}/`로 옮긴다
  (`server/src/store/remove.ts`). 되돌리려면 원래 자리로 옮기면 된다. 옮긴 뒤 잡·요청서 인덱스에서
  빼는 것까지가 한 세트다 — 안 빼면 사라진 폴더를 가리키는 잡이 화면에 남는다. 내보내기 폴더는 건드리지 않는다

## 음성

경로는 두 가지뿐이다: **타입캐스트 API 합성**(캐릭터 선택·미리듣기) 또는 **씬별 음성 파일 첨부**.
합성 음성에는 `settings.speechRate`(기본 1.25) 배속이 적용된다 — 첨부 파일은 사용자가 의도한 속도로 보고 건드리지 않는다.
씬에 파일이 첨부돼 있으면 그 파일을 쓰고, 없는 씬만 타입캐스트로 합성한다. 둘 다 없으면 400으로 막는다.
어느 경로든 `voice/timing.json` 인터페이스는 동일하며 이 타이밍이 자막·조립의 기준이다.

## 콘텐츠 규칙

- 원본 영상 문장 재사용 금지 — 구조·페이싱만 참고
- 과장 금지: "무조건", "100%", "기적", "완치" 등
- **영상 길이는 메뉴마다 다르다** — 제품정보리뷰 18~26초(권장 22), 해외영상 짜집기 20~30초(권장 27).
  나레이션은 1.25배속(`settings.speechRate`)으로 낭독한다. 분량은 `charBudget(rate, menu)`
  (shared/constants.ts)가 계산한다 — 숫자도 메뉴 분기도 하드코딩하지 않는다
- 업로드 킷에 쿠팡파트너스 공시문구 필수: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
- 해외영상 재사용은 사용 권리 확인이 선행 — 조립 전 rights-confirm 게이트가 막는다

**제품정보리뷰(menu-b) 전용 규칙** — 해외영상 짜집기는 별도 지침을 따로 세운다. 메뉴별 규칙은
`server/src/claude/scriptRules.ts` 한 곳에 모으고, 요청서 문구는 `MENU_B_RULES`(packets.ts)에 둔다.

- **단점 씬 1개 필수.** 제품의 단점·주의사항을 말하는 씬에 `isDownside: true`. 없으면 요청서 반영이
  거부된다(`scriptRuleErrors`). 광고와 리뷰를 가르는 장치라 형식 요건이 아니라 내용 요건이다 —
  서버는 표시 유무만 보고, 내용이 진짜 단점인지는 `shorts-qc`가 읽고 판정한다
- **해시태그 3~5개, 중복 금지.** 유튜브는 설명란 해시태그가 15개를 넘으면 전부 무시한다
- **설명 마지막에 다음 편 예고 한 줄.** 요청서가 시리즈 회차를 계산해 넣어준다(`seriesContext`)

## 하네스: 쇼핑쇼츠 제작·개발

**목표:** 콘텐츠 품질(검수 게이트)과 코드 안정성(실행 검증)을 에이전트 팀으로 보장한다.

**트리거:**
- 대본·기획·업로드킷 등 **콘텐츠 제작** 요청 → `shorts-content-team` 스킬
- 기능 추가·버그 수정 등 **코드 변경** 요청 → `shorts-dev-team` 스킬
- 대본 **검수만** 필요 → `shorts-script-qc` 스킬
- 요청서 1건을 빠르게 혼자 처리 → 기존 `answer-job` 스킬 (팀 미사용)
- 단순 질문, 오타 수정 등은 팀 없이 직접 응답한다

**"하네스" 용어 주의 — 이 리포에는 두 가지가 있다:**
| 표현 | 의미 |
|---|---|
| "하네스 돌려줘/검증해줘" | `npm run harness` — E2E 파이프라인 테스트 (`tools/harness.ts`) |
| "하네스 구축/구성/점검해줘" | 전역 `harness` 스킬 — 에이전트 팀 자체를 만들거나 고치는 작업 |

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-08-10 | 초기 구성 (콘텐츠 팀 4명 + 개발 팀 3명) | 전체 | - |
| 2026-08-11 | 제품정보리뷰 전용 규칙 (단점 씬·해시태그 3~5개·다음 편 예고·22초) | scriptwriter, qc, packager, shorts-script-qc | 채널 진단 반영 — 재사용 판정 방어와 구독 전환 |

## 코드 규칙

- 상태 파일 쓰기는 반드시 `writeJsonAtomic` 경유. 읽기-수정-쓰기는 `mutateJob()`을 쓴다 — 파일 락으로
  직렬화되어 동시 갱신이 유실되지 않는다 (`withFileLock`)
- 잡 상태 변경은 `transition()`(인접 단계만 허용) 또는 `advanceTo()`(목표까지 한 칸씩 전진) 경유.
  단계를 건너뛰는 `transition()` 호출은 실패한다
- 백그라운드 작업(`void fn()`)에는 반드시 `.catch()`를 단다 — 없으면 로컬 서버가 통째로 죽는다
- 서브프로세스는 `util/exec.ts`의 `run()` 사용 — 인자 배열 방식만, 셸 문자열 조립 금지
- ffmpeg **필터 안에는 절대경로를 넣지 않는다** — `filterFileArg()`로 파일명만 넘기고 그 폴더를 cwd로 잡는다.
  필터그래프의 콜론 이스케이프는 ffmpeg 빌드마다 해석이 달라 신뢰할 수 없다 (윈도우 `C:`에서 터진다).
  **concat 목록**에는 `toConcatPath()` 경유 — 데먹서가 백슬래시를 이스케이프로 읽는다.
  필터 밖 인자(`-i`, 출력 경로)는 절대경로 그대로 쓴다
- 작업공간 파일 감시 대상은 `isWatchIgnored()`로 좁힌다 — 원자적 쓰기 임시 파일을 감시하면
  윈도우에서 rename이 EPERM으로 막힌다
- **`app.listen()`보다 앞에 `await`를 두지 않는다.** 초기화는 `boot.ts`의 `bootstrap()`에서 돌리고,
  준비 전 요청은 503으로 답한다. 포트가 안 열리면 웹 UI 전체가 원인 없는 ECONNREFUSED로 죽는다
- 외부 도구 실행에는 반드시 시간 상한을 둔다. execa의 `timeout`만으로는 부족하다 —
  자식을 죽여도 손자가 stdout 파이프를 물고 있으면 프로미스가 끝나지 않는다 (`checkTool` 참고)
- **개발 서버는 `node --import tsx --watch`. `tsx watch`로 되돌리지 않는다** —
  Windows에서 concurrently 파이프를 거치면 자식 프로세스가 출력도 없이 뜨지 않는다 (실제 발생)
- 서버 콘솔은 `workspace/logs/server.log`에도 남는다 (`util/log.ts`, `npm run logs`).
  터미널에 아무것도 안 보일 때 여기가 유일한 단서다
- 스키마 변경은 `shared/types.ts`에서만 (서버·클라이언트·요청서 검증이 모두 여기 의존)
- API 키는 `workspace/secrets.json`에만 저장, 응답에는 마스킹된 값만 (`store/secrets.ts`)
- 유튜브 API는 반드시 `youtube/client.ts`의 `ytFetch` 경유 — 쿼터 확인·차감·캐시가 여기 있다. 무료 한도(10,000유닛/일) 밖의 기능은 구현하지 않는다
- 커밋: feat/fix/refactor/docs/test 접두어

---

## 클로드 설정 (2026-08-13)

### 스킬 — `.claude/skills/`

| 묶음 | 개수 | 내용 |
|---|---:|---|
| 이 저장소 자체 | 6 | answer-job · create-format · shorts-content-team · shorts-dev-team · shorts-script-qc · shorts-viral-script |
| ECC에서 복사 | 13 | 아래 표. 출처·이유는 `.claude/skills/NOTICE.md` |
| 에이전트 | 7 | `.claude/agents/` |

복사해 온 13개와 고른 이유:

| 스킬 | 왜 |
|---|---|
| `contract-first` | `shared/types.ts`의 zod 스키마를 client·server가 같이 쓴다 |
| `click-path-audit` | 잡 상태머신 + SSE. 버튼마다 상태 전이를 전수 추적한다 |
| `cost-aware-llm-pipeline` | LLM API를 부르는 앱이다. 난이도별 모델 라우팅 |
| `remotion-video-creation` | Remotion 규칙 29개 |
| `react-patterns` `react-testing` `vite-patterns` | client/ |
| `api-design` `error-handling` `coding-standards` | server/ |
| `e2e-testing` `tdd-workflow` | `npm test` · `npm run harness` |
| `security-review` | `workspace/`에 API 키가 있다 |

🔴 **ECC를 플러그인으로 켜지 않는 이유** — 켜면 378개가 통째로 들어와
매 세션 40,459 토큰이다. 13개만 복사하면 약 1,030 토큰이고, 무엇보다
**클라우드(깃허브) 세션은 플러그인을 설치하지 않는다**(2026-08-13 실측).
저장소에 커밋된 `.claude/skills/` 파일만 클라우드에서 동작한다.

### 플러그인 — `.claude/settings.json`

`ui-ux-pro-max` 하나(1,167토큰). **로컬 전용이다 — 클라우드에서는 안 켜진다.**
전역에서는 꺼져 있고 이 저장소에서만 켠다.

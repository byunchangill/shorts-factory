# YT Shorts Production System - 구현 플랜

## 프로젝트 개요

YouTube 인기 영상을 분석하고, 구조만 오마주하여 저작권 안전한 새 쇼츠 콘텐츠를 반자동 생산하는 파이프라인.

- 3가지 콘텐츠 타입: 🐶 강아지 AI쇼츠 / 📖 썰툰 / 💊 건강 쇼츠
- 7단계 워크플로우: 검색 → 분석 → 대본 → 이미지 → 영상 → TTS합성 → QC → 패키징
- Claude Code + MCP 기반 실행 (Skills 7개 + MCP 5개)

---

## 현재 상태 분석

### 이미 완성된 것 (tar.gz 기준)
- ✅ CLAUDE.md (프로젝트 목적, 원칙, 워크플로우, 규칙)
- ✅ ARCHITECTURE.md (3계층 구조, 통합 맵)
- ✅ schemas/data-models.md (Job, Scene, Asset 스키마, 상태 머신, 이벤트 레지스트리)
- ✅ 7개 SKILL.md (youtube-researcher, script-creator, image-generator, video-maker, tts-sync, shorts-qc-reviewer, export-packager)
- ✅ .claude/settings.json (MCP 서버 5개 정의)
- ✅ config/health_compliance.json (건강 컴플라이언스 규칙)
- ✅ config/used_videos.json (사용 영상 배제 초기 구조)
- ✅ config/.env.example
- ✅ .gitignore

### 구현이 필요한 것 (실행 코드 전무)
- ❌ 실제 Node.js/Python 실행 코드 없음
- ❌ MCP 서버 연동 코드 없음
- ❌ package.json / 의존성 관리 없음
- ❌ 상태 관리 엔진 없음
- ❌ 에셋 파일 없음 (폰트, BGM)

---

## 기술 스택 선정

| 영역 | 선택 | 이유 |
|------|------|------|
| 런타임 | Node.js 18+ | MCP SDK 호환, 비동기 처리 |
| 언어 | TypeScript | 스키마 타입 안전성 |
| 상태 관리 | 자체 구현 (VALID_TRANSITIONS 기반) | 이미 상태 머신 설계 완료 |
| TTS | Python (edge-tts) | edge-tts가 Python 패키지 |
| 영상 처리 | FFmpeg (shell) | GPU 불필요, 검증된 도구 |
| 이미지 생성 | ComfyUI API | 로컬 SD + IP-Adapter |
| 패키지 매니저 | npm | Node.js 표준 |

---

## Phase 1: 프로젝트 기초 + 텍스트 파이프라인 (3~5일)

### 1-1. 프로젝트 초기화

```
yt-shorts-final/
├── package.json              # 의존성
├── tsconfig.json             # TypeScript 설정
├── src/
│   ├── index.ts              # 진입점 (CLI)
│   ├── types/                # 타입 정의
│   │   ├── job.ts            # Job, Scene, Asset 타입
│   │   ├── events.ts         # StateEvent 타입
│   │   └── config.ts         # 설정 타입
│   ├── core/                 # 핵심 엔진
│   │   ├── state-machine.ts  # VALID_TRANSITIONS + canTransition
│   │   ├── event-emitter.ts  # StateEvent 발행 + 검증
│   │   ├── job-manager.ts    # Job CRUD + 상태 전이
│   │   └── logger.ts         # production_log.json 관리
│   ├── skills/               # 스킬 실행 코드
│   │   ├── youtube-researcher.ts
│   │   ├── script-creator.ts
│   │   ├── image-generator.ts
│   │   ├── video-maker.ts
│   │   ├── tts-sync.ts
│   │   ├── shorts-qc-reviewer.ts
│   │   └── export-packager.ts
│   ├── mcp/                  # MCP 클라이언트 래퍼
│   │   ├── youtube-data.ts
│   │   ├── comfyui.ts
│   │   ├── shell.ts
│   │   └── filesystem.ts
│   └── utils/                # 유틸리티
│       ├── health-compliance.ts  # 금지표현 검사 + 재작성
│       ├── similarity-check.ts   # 유사도 검증
│       ├── used-videos.ts        # 사용 영상 배제 관리
│       └── korean-utils.ts       # 한국어 어간 추출, 단어 경계
├── config/
├── schemas/
├── assets/
│   ├── fonts/
│   └── bgm/
├── .claude/
│   ├── settings.json
│   └── skills/
└── output/
```

### 1-2. 핵심 모듈 구현 순서

**Day 1: 타입 + 상태 머신**
- `src/types/` — Job, Scene, ImageAsset, VideoAsset, StateEvent, HealthCompliance 타입 정의
- `src/core/state-machine.ts` — VALID_TRANSITIONS 코드 그대로 + canTransition + transition 함수
- `src/core/event-emitter.ts` — 이벤트 레지스트리 검증 + validateEvent 함수
- `src/core/job-manager.ts` — Job 생성, 상태 전이, workspace 디렉토리 생성

**Day 2: YouTube 검색 (youtube-researcher)**
- `src/mcp/youtube-data.ts` — YouTube Data API v3 래퍼 (search.list, videos.list)
- `src/utils/used-videos.ts` — used_videos.json CRUD, 배제 필터링, upsert, 자동 정리
- `src/skills/youtube-researcher.ts` — 키워드 확장, 검색+배제, 구조 분석, 종합 점수 산정
- 쿼리 확장 (QUERY_EXPANSION, FALLBACK_QUERIES) 구현

**Day 3: 대본 생성 (script-creator)**
- `src/utils/health-compliance.ts` — 금지 표현 검사 (exact_keyword, contains_keyword, template)
  - matchExactKeyword (한국어 경계 매칭 + ALLOWED_SUFFIXES)
  - rewriteSentence (4가지 strategy)
  - extractKoreanVerbStem (간이 어간 추출)
- `src/utils/similarity-check.ts` — phraseOverlap, structureOverlap, titleSimilarity
- `src/skills/script-creator.ts` — 카테고리별 대본 구조, 유사도 검증, 컴플라이언스 검증

**Day 4-5: TTS 테스트 + 통합**
- `src/skills/tts-sync.ts` — edge-tts 실행 (Python subprocess), 타이밍 계산
- SRT 자막 생성 로직
- 전체 텍스트 파이프라인 통합 테스트 (검색 → 대본 → TTS)

---

## Phase 2: 이미지 파이프라인 (1~2주)

### 2-1. ComfyUI 연동
- `src/mcp/comfyui.ts` — ComfyUI API 클라이언트 (워크플로우 실행, 결과 폴링)
- 카테고리별 체크포인트/LoRA 설정 (CATEGORY_SETTINGS)
- 공통 네거티브 프롬프트

### 2-2. Style Bible + Character Bible
- `src/skills/image-generator.ts` — 2단 구조 구현
  - Step 1: Style Bible 자동 생성 (카테고리별 프리셋)
  - Step 2: Character Bible 생성 (frozen/flexible 분리)
  - Step 3: 씬 1 기준 이미지 (시드 고정)
  - Step 4: 씬 2~N IP-Adapter 참조 생성

### 2-3. 버전 관리 + 재생성
- generation_log.json 관리
- 버전 디렉토리 구조 (images/versions/)
- 재생성: frozen 항목 보존 + 시드 변경
- 복원: 이전 버전 파일 복사
- 업스케일 (realesrgan or ffmpeg fallback)

---

## Phase 3: 영상 + 합성 (1주)

### 3-1. Video Maker (dog/health 전용)
- `src/skills/video-maker.ts` — Ken Burns FFmpeg 커맨드 생성
  - 모션 프리셋 6종 (gentle_zoom_in, subtle_float, slow_pan, dramatic_push, info_zoom_in, info_slide 등)
  - camera + emotion → 프리셋 자동 매핑
  - 씬 전환 (xfade crossfade)
  - 영상 버전 관리

### 3-2. TTS Sync 완성
- `src/skills/tts-sync.ts` — 전체 프로세스 구현
  - 씬별 개별 TTS 생성
  - 음성 길이 기반 영상 길이 재생성
  - 자막 SRT 생성 (한국어 분할)
  - BGM 믹싱 (카테고리별 BGM + 볼륨)
  - 최종 합성 FFmpeg 커맨드
  - 썰툰: 이미지 슬라이드쇼 + 음성

### 3-3. QC Reviewer
- `src/skills/shorts-qc-reviewer.ts` — 6개 체크리스트 자동 검수
  - 저작권 안전성 (유사도 재검증)
  - 이미지 일관성 (Claude 비전 분석)
  - 영상 규격 (ffprobe: 해상도, FPS, 코덱, 길이)
  - 음성 싱크 (타이밍 오차 검출)
  - 콘텐츠 정책 (카테고리별)
  - 파일 완결성 (필수 파일 존재 확인)
- QC 등급 산정 (PASS / WARNING / FAIL)

---

## Phase 4: 패키징 + 마무리 (지속)

### 4-1. Export Packager
- `src/skills/export-packager.ts`
  - 출력 디렉토리 구조 생성
  - upload_info.json 생성 (YouTube 메타데이터)
  - production_log.json 완성
  - ZIP 패키징

### 4-2. CLI / 인터랙션 레이어
- `src/index.ts` — Claude Code에서의 사용자 인터랙션 포인트 관리
  - Step 2 후: 5개 영상 → 사용자 선택
  - Step 3 후: 대본 확인 → 수정 요청
  - Step 4 후: 이미지 → 개별 재생성/복원
  - Step 5a 후: 영상 → 재생성
  - Step 6 후: QC → 수정 또는 통과

### 4-3. 추후 개선
- AnimateDiff 영상 모드 추가
- 유사도 정량화 (n-gram, Levenshtein, sentence-transformers)
- 형태소 분석기 통합 (MeCab-ko/Kiwi)
- 프롬프트 최적화 + LoRA 튜닝

---

## 핵심 의존성

```json
{
  "dependencies": {
    "typescript": "^5.x",
    "@anthropic-ai/sdk": "latest",
    "zod": "^3.x",
    "dotenv": "^16.x",
    "googleapis": "^130.x"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "tsx": "^4.x",
    "vitest": "^1.x"
  }
}
```

Python (별도 requirements.txt):
```
edge-tts
mutagen
```

시스템 요구사항:
```
node >= 18 / ffmpeg >= 5.0 / python >= 3.10
ComfyUI + SD 체크포인트 + IP-Adapter (Phase 2)
에셋: NanumSquareRoundB.ttf, BGM 3종
```

---

## 구현 우선순위 요약

| 순서 | 모듈 | 중요도 | 난이도 |
|------|------|--------|--------|
| 1 | 타입 정의 + 상태 머신 | ★★★ | 낮음 |
| 2 | Job Manager + Event System | ★★★ | 중간 |
| 3 | YouTube Researcher (검색+배제) | ★★★ | 중간 |
| 4 | Script Creator (대본+검증) | ★★★ | 중간 |
| 5 | Health Compliance (금지표현) | ★★☆ | 높음 |
| 6 | TTS Sync (음성+자막) | ★★★ | 중간 |
| 7 | Image Generator (ComfyUI) | ★★★ | 높음 |
| 8 | Video Maker (FFmpeg) | ★★☆ | 중간 |
| 9 | QC Reviewer | ★★☆ | 중간 |
| 10 | Export Packager | ★☆☆ | 낮음 |

---

## 주의사항

1. **MCP 서버는 Claude Code가 관리** — 코드에서 직접 MCP 서버를 띄우지 않음. `.claude/settings.json`에 정의된 MCP 서버를 Claude Code가 자동 연결하고, 스킬 코드는 MCP 도구를 호출하는 방식.
2. **상태 머신이 단일 소스** — 모든 상태 전이는 VALID_TRANSITIONS를 거쳐야 함. 다이어그램과 충돌 시 코드 우선.
3. **건강 컴플라이언스 필수** — 건강 콘텐츠는 대본 생성 후 반드시 금지표현 스캔 + 자동 수정 + 면책 삽입.
4. **버전 관리 철저** — 이미지/영상 재생성 시 이전 버전 보존. 복원 가능해야 함.
5. **사용 영상 배제** — used_videos.json을 통해 중복 제작 방지.

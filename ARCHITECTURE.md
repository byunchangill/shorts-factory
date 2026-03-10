# 아키텍처: GPT 설계 사상 + Claude 실행 코드 통합

## 3계층 구조

```
┌─────────────────────────────────────────────────────────────┐
│ A. Skills 계층 (지능 모듈) - "어떻게 하는지"                     │
│    Claude가 어떤 순서와 기준으로 일을 할지 정하는 작업 지침          │
│                                                             │
│  📍 youtube-researcher  → 검색 전략, 점수 산정, 구조 분석 기준   │
│  📍 script-creator      → 오마주 규칙, 대본 구조, 유사도 검증    │
│  📍 image-generator     → Style/Character Bible, 일관성 전략   │
│  📍 video-maker         → 모션 프리셋 매핑, 카메라 효과          │
│  📍 tts-sync            → 음성 설정, 싱크 로직, 합성 커맨드      │
│  📍 shorts-qc-reviewer  → 검수 체크리스트, 통과/실패 기준        │
│  📍 export-packager     → 파일 구조, 메타데이터, 패키징          │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ B. MCP 계층 (실행 도구) - "무엇에 연결하는지"                     │
│    외부 시스템 호출용 도구 서버                                   │
│                                                             │
│  🔌 youtube-data  → YouTube API 검색/자막                     │
│  🔌 web-search    → 보조 정보 검색                              │
│  🔌 comfyui       → SD 이미지/AnimateDiff 영상                  │
│  🔌 shell         → FFmpeg/Edge TTS/업스케일/ZIP                │
│  🔌 filesystem    → 파일 읽기/쓰기/버전 관리                     │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ C. Runtime 계층 (상태 관리) - "어디까지 됐는지"                   │
│    실행 상태, Job 저장, 버전 이력, 산출물 관리                     │
│                                                             │
│  📊 schemas/data-models.md → Job, Scene, Asset 스키마         │
│  📁 output/{job_id}/       → 작업별 산출물                      │
│  📋 production_log.json    → 전체 제작 이력                     │
│  🔄 versions/              → 이미지/영상 버전 복원               │
└─────────────────────────────────────────────────────────────┘
```

## 전체 흐름 (7단계)

```
사용자: "강아지"
    │
    ▼
┌────────────────────────────────────────────────────┐
│ Step 1-2: youtube-researcher                        │
│ 🔌 youtube-data + web-search                        │
│                                                    │
│  키워드 확장 → YouTube 검색 → 상세 분석              │
│  → 종합 점수 산정 (조회수 + 최근성 + 구조 재활용성    │
│    + 댓글 반응 + 정책 리스크)                        │
│  → TOP 5 제시                                       │
│                                                    │
│  💡 GPT: 종합 점수 산정 (조회수만이 아님)              │
│  💡 내 것: 실제 API 호출 코드                         │
└───────────────────┬────────────────────────────────┘
                    │ 사용자: "2번"
                    ▼
┌────────────────────────────────────────────────────┐
│ Step 3: script-creator                              │
│ 🔌 없음 (Claude 직접)                                │
│                                                    │
│  구조만 추출 → 표현 전부 재창작 → 대본 생성            │
│  → 유사도 검증 (문구/구조/제목)                       │
│  → 제목 후보 5개 + 썸네일 훅 5개                      │
│                                                    │
│  💡 GPT: 유사도 검증 + 제목/썸네일 훅 후보             │
│  💡 내 것: Claude 직접 생성, MCP 불필요                │
└───────────────────┬────────────────────────────────┘
                    │ 사용자: "확정" / "수정"
                    ▼
┌────────────────────────────────────────────────────┐
│ Step 4: image-generator                             │
│ 🔌 comfyui + filesystem + shell                     │
│                                                    │
│  [1] Style Bible 정의 → 확인                         │
│  [2] Character Bible 정의 → 확인                     │
│  [3] 씬 1 기준 이미지 (시드 고정) → 확인              │
│  [4] 씬 2~N IP-Adapter 참조 생성                     │
│  [5] 개별 재생성 / 이전 버전 복원 / 확정              │
│                                                    │
│  💡 GPT: Style Bible + Character Bible 2단 구조      │
│  💡 GPT: 버전 관리 + frozen/flexible 분리             │
│  💡 내 것: ComfyUI API 코드, IP-Adapter 설정값       │
└───────────────────┬────────────────────────────────┘
                    │ 사용자: "확정"
                    ▼
          ┌─────────┴─────────┐
          │                   │
    dog / health          sseoltoon
          │                   │
          ▼                   │
┌──────────────────────┐      │
│ Step 5a: video-maker │      │
│ 🔌 shell + comfyui   │      │
│                      │      │
│ Ken Burns / AnimateDiff     │
│ 모드별 프리셋 자동 매핑│      │
│ 재생성 + 버전 관리    │      │
│                      │      │
│ 💡 GPT: dog/health   │      │
│   별도 프리셋         │      │
│ 💡 내 것: FFmpeg 코드 │      │
└──────────┬───────────┘      │
           │                  │
           ▼                  ▼
┌────────────────────────────────────────────────────┐
│ Step 5b: tts-sync                                   │
│ 🔌 shell                                            │
│                                                    │
│  Edge TTS 씬별 생성 → 음성 길이 기준 타이밍 조정      │
│  → 자막 SRT 생성 → BGM 믹싱 → 최종 합성             │
│                                                    │
│  💡 GPT: 음성이 타이밍의 기준                         │
│  💡 내 것: edge-tts 코드, FFmpeg 합성 커맨드          │
└───────────────────┬────────────────────────────────┘
                    ▼
┌────────────────────────────────────────────────────┐
│ Step 6: shorts-qc-reviewer  ★ GPT에서 채택          │
│ 🔌 shell + filesystem                               │
│                                                    │
│  저작권 안전성 / 이미지 일관성 / 영상 규격            │
│  / 음성 싱크 / 콘텐츠 정책 / 파일 완결성 체크        │
│  → PASS / WARNING / FAIL                            │
└───────────────────┬────────────────────────────────┘
                    │ PASS
                    ▼
┌────────────────────────────────────────────────────┐
│ Step 7: export-packager                             │
│ 🔌 filesystem + shell                               │
│                                                    │
│  파일 정리 → ZIP 패키징 → 다운로드 제공              │
│  + production_log.json (전체 제작 이력)              │
│  + upload_info.json (YouTube 메타데이터)             │
│                                                    │
│  💡 GPT: production_log + 추적 가능성                │
│  💡 내 것: 실행 가능한 패키징 스크립트                 │
└────────────────────────────────────────────────────┘
```

## GPT vs 내 설계 통합 맵

| 영역 | GPT에서 가져온 것 | 내 설계에서 유지한 것 |
|------|-----------------|-------------------|
| 이미지 일관성 | Style Bible + Character Bible 2단 | ComfyUI/IP-Adapter 실행 코드 |
| 오마주 안전 | 유사도 검증 (phrase/structure/title) | Claude 직접 분석 (MCP 불필요) |
| 재생성 | 버전 관리 + frozen/flexible 분리 | 시드 기반 재생성 코드 |
| QC 검수 | shorts-qc-reviewer 스킬 (신규) | ffprobe 기반 자동 검증 |
| 데이터 모델 | Job/Scene/Asset 스키마 | script.json 기반 실행 |
| 점수 산정 | 종합 점수 (5개 지표) | YouTube API 호출 코드 |
| 제작 이력 | production_log.json | 단계별 타임스탬프 |
| MCP 구조 | 아이디어 (6개→) | 실용적 5개로 통합 |
| Skills 구조 | 아이디어 (9개→) | 실용적 7개로 통합 |

## 구축 순서

```
Phase 1: 텍스트 파이프라인 (3~5일)
├── CLAUDE.md + Skills 세팅 ✅ (완료)
├── schemas 정의 ✅ (완료)
├── YouTube 검색 + 분석 (youtube-data MCP 연결)
├── 대본 생성 + 유사도 검증 (Claude 직접)
└── Edge TTS 나레이션 테스트

Phase 2: 이미지 파이프라인 (1~2주)
├── ComfyUI 설치 + comfyui MCP 연결
├── Style Bible / Character Bible 테스트
├── IP-Adapter 캐릭터 일관성 테스트
├── 재생성 + 버전 관리 구현
└── 카테고리별 LoRA/체크포인트 선정

Phase 3: 영상 + 합성 (1주)
├── Ken Burns FFmpeg 커맨드 테스트
├── 음성 기준 타이밍 동기화
├── 자막 + BGM 합성
└── QC 검수 프로세스 구현

Phase 4: 패키징 + 품질 (지속)
├── 최종 패키징 + 다운로드
├── production_log 자동 생성
├── AnimateDiff 추가 (선택)
└── 프롬프트 최적화 + LoRA 튜닝
```

## 필수 준비물

```bash
# config/.env
YOUTUBE_API_KEY=your_key      # Google Cloud Console
BRAVE_API_KEY=your_key        # brave.com/search/api (선택)
COMFYUI_URL=http://127.0.0.1:8188

# 로컬 환경
node >= 18 / ffmpeg >= 5.0 / python >= 3.10
pip install edge-tts mutagen

# 이미지 생성
ComfyUI + SD 체크포인트 + IP-Adapter 모델

# 에셋
assets/fonts/NanumSquareRoundB.ttf
assets/bgm/{emotional-piano, suspense-beat, calm-corporate}.mp3
```

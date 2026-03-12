# UI/UX 설계 기획서 v1.1 — 최종 검토 리포트

> **검토일:** 2026-03-12
>
> **검토 대상:** `docs/UI_UX_Design_Spec_v1.1.md`
>
> **검토 기준 문서:** CLAUDE.md, schemas/data-models.md (v6), ARCHITECTURE.md, implementation-plan.md

---

## 1. 검토 결과 요약

| 카테고리 | 커버리지 | 평가 |
|---------|---------|------|
| CLAUDE.md 9대 원칙 | 9/9 (100%) | ✅ 완전 |
| 7단계 워크플로우 | 7/7 (100%) | ✅ 완전 |
| 3가지 콘텐츠 타입 분기 | 3/3 (100%) | ✅ 완전 |
| 사용자 인터랙션 포인트 | 5/5 (100%) | ✅ 완전 |
| 상태 머신 (VALID_TRANSITIONS) | 30/30 + 9 UI전용 | ⚠️ 주의 필요 |
| 이벤트 레지스트리 (70+개) | WebSocket 8개로 요약 | ✅ 적절 |
| 건강 컴플라이언스 (L1~L4, T1~T4) | 100% | ✅ 완전 |
| 이미지 생성 규칙 (Style/Character Bible) | 100% | ✅ 완전 |
| 사용 영상 배제 (영구/임시) | 100% | ✅ 완전 |
| 출력 구조 | 95% | ⚠️ 소규모 누락 |
| API 스키마 | 100% | ✅ 완전 |
| 3계층 아키텍처 반영 | 100% | ✅ 완전 |

**종합 평가: 95% 커버리지 — PASS (조건부)**

---

## 2. 상세 검토

### 2.1 CLAUDE.md 9대 원칙 매핑 ✅

| # | 원칙 | v1.1 반영 위치 | 평가 |
|---|------|---------------|------|
| 1 | 일관성 최우선 | §7 Style/Character Bible 워크플로우 | ✅ Frozen/Flexible 체크박스까지 반영 |
| 2 | 오마주 ≠ 복사 | §4.4 유사도 게이지 3개 (phrase/structure/title) | ✅ 임계값 정확 반영 |
| 3 | 씬 단위 재생성 | §4.5 개별 AssetCard 재생성/복원 | ✅ 재생성 카운터(3/3) 포함 |
| 4 | 재사용 가능 설계 | 전체 범용 워크플로우 설계 | ✅ |
| 5 | 추적 가능성 | §9.5 ActivityLog + §16 production_log.json | ✅ |
| 6 | 산출물 완결성 | §16 산출물 구조 & 패키징 UI | ✅ |
| 7 | 사용 영상 배제 | §8 사용된 영상 배제 시스템 UI | ✅ 영구/임시/수동 관리 |
| 8 | 상태 추적 | §10 39개 상태 전체 매핑 | ⚠️ 상태 불일치 (아래 참조) |
| 9 | 운영 안전 | §11 재시도 정책 (씬당 3회), 에러 배너 | ✅ |

### 2.2 상태 머신 불일치 ⚠️ (가장 중요한 발견)

v1.1은 39개 상태를 나열하지만, `data-models.md`의 VALID_TRANSITIONS에는 **30개 상태**만 정의되어 있습니다. v1.1이 추가한 9개 상태는 VALID_TRANSITIONS에 존재하지 않습니다.

**VALID_TRANSITIONS에 없는 9개 UI 상태:**

| # | v1.1 상태 | 실제 data-models.md 처리 | 조치 권고 |
|---|----------|------------------------|----------|
| 1 | `script_revision_requested` | `script_pending_approval → scripting` (직접 전이) | UI전용 상태로 명시 또는 data-models에 추가 |
| 2 | `style_bible_pending` | `script_approved → images_generating` (Bible 상태 없음) | **data-models에 추가 권고** (CLAUDE.md에서 Bible 승인 필수) |
| 3 | `character_bible_pending` | 위와 동일 | **data-models에 추가 권고** |
| 4 | `video_partial` | `video_generating → video_failed` (partial 없음) | `images_partial` 패턴 참조하여 data-models에 추가 권고 |
| 5 | `compose_generating` | `tts_syncing → compose_done` (별도 상태 없음) | UI전용 표현으로 명시 (`tts_syncing`의 서브스텝) |
| 6 | `compose_failed` | `tts_syncing → error` | UI전용 표현으로 명시 (`error` 상태의 세부 표현) |
| 7 | `export_failed` | `exporting → error` | UI전용 표현으로 명시 (`error` 상태의 세부 표현) |
| 8 | `recovering` | 없음 | UI전용 상태로 명시 (error → 각 단계 전이 중간) |
| 9 | `paused` | 없음 | UI전용 상태로 명시 또는 향후 구현 |

**핵심 권고사항:**
- `style_bible_pending`, `character_bible_pending`은 CLAUDE.md에서 "반드시 승인 후 이미지 생성"으로 명시하므로, **data-models.md의 VALID_TRANSITIONS에 추가하는 것이 맞음**
- 나머지 7개는 "UI 표현 상태"로 분류하고, 문서에 주석을 달아 data-models.md의 실제 상태와 구분

### 2.3 이벤트 레지스트리 반영 ✅

data-models.md에 70+개 이벤트가 정의되어 있으나, UI 기획서에서 모든 이벤트를 나열할 필요는 없음. v1.1의 §15 WebSocket 이벤트 8개는 프론트엔드가 수신해야 하는 핵심 이벤트를 적절히 요약.

**v6 Fix #1 반영 확인:** `SEARCH_REQUESTED` + `SEARCH_STARTED` 분리는 UI에서 직접 다루지 않아도 됨 (백엔드 이벤트). ✅ 문제없음.

### 2.4 건강 콘텐츠 컴플라이언스 ✅ 완전

| 요구사항 | v1.1 반영 | 평가 |
|---------|----------|------|
| L1~L4 주장 등급 | §6.1 색상 + 아이콘 + 배경 | ✅ |
| 금지 표현 감지 | §6.3 exact_keyword/contains_keyword/template 모두 반영 | ✅ |
| T1~T4 출처 신뢰도 | §6.4 아이콘 + 사용 가능 여부 | ✅ |
| 면책 자동 삽입 | §6.5 나레이션 + 설명란 | ✅ |
| 자동 수정 (L4) | §6.3 자동 수정 팝오버 | ✅ |
| detect/rewrite 분리 (v6 Fix #4) | §6.3 수정 전략 (full_sentence_replace, verb_stem_rewrite 등) 반영 | ✅ |
| 감사 리포트 | §6.6 QC 화면 컴플라이언스 감사 | ✅ |

### 2.5 이미지 생성 규칙 ✅ 완전

| 요구사항 | v1.1 반영 | 평가 |
|---------|----------|------|
| Style Bible 정의 → Character Bible 정의 → 이미지 생성 순서 | §7.1 생성 타이밍 플로우 | ✅ |
| Frozen/Flexible 항목 분리 | §7.3 체크박스 목록 | ✅ 정확히 6+6 매핑 |
| 재생성 시 Frozen 보존 | §7.3 "재생성 시에도 Frozen 항목 보존" 명시 | ✅ |
| 카테고리별 스타일 (Pixar/웹툰/인포그래픽) | §5.2~5.4 타입별 전용 요소 | ✅ |
| IP-Adapter 참조 | §5.2 강아지 전용 요소에 명시 | ✅ |

### 2.6 콘텐츠 타입별 분기 ✅ 완전

| 타입 | 요구사항 | v1.1 반영 | 평가 |
|------|---------|----------|------|
| 🐶 강아지 | 감정 곡선, 캐릭터 일관성, 표정/포즈, Ken Burns | §5.2 감정 곡선 차트, 표정 프리셋, 모션 추천 | ✅ |
| 📖 썰툰 | 영상화 스킵, 말풍선 없음→자막, 훅/반전/속도감 | §5.3 스킵 표시, 훅 강도 인디케이터, 반전 마커, 스토리보드 뷰 | ✅ |
| 💊 건강 | L1~L4 컴플라이언스, 면책, 얼굴 없음, 인포그래픽 | §5.4 + §6 전체 | ✅ |

### 2.7 출력 구조 ⚠️ 소규모 누락

CLAUDE.md의 출력 구조와 비교:

| 파일 | CLAUDE.md | v1.1 §16 | 평가 |
|------|----------|----------|------|
| final_shorts.mp4 | ✅ | ✅ | 일치 |
| final_voice.mp3 | ✅ | ✅ | 일치 |
| scene_XX.png | ✅ | ✅ | 일치 |
| versions/ | ✅ | ✅ | 일치 |
| scene_XX.mp4 | ✅ | ✅ | 일치 |
| full_narration.mp3 | ✅ | ✅ | 일치 |
| subtitles.srt | ✅ | ✅ | 일치 |
| script.md | ✅ | ✅ | 일치 |
| storyboard.json | ✅ | ✅ | 일치 |
| prompts.json | ✅ | ✅ | 일치 |
| style_bible.json | ✅ | ✅ | 일치 |
| character_bible.json | ✅ | ✅ | 일치 |
| production_log.json | ✅ | ✅ | 일치 |
| title_options.json | ✅ | ✅ | 일치 |
| description.txt | ✅ | ✅ | 일치 |
| hashtags.txt | ✅ | ✅ | 일치 |
| **upload_info.json** | ❌ | ❌ | **ARCHITECTURE.md에만 언급. CLAUDE.md에도 없으므로 선택사항** |

**결론:** CLAUDE.md 기준 100% 일치. ARCHITECTURE.md의 `upload_info.json`은 향후 추가 사항.

### 2.8 API 스키마 & 기술 스택 ✅

| 요구사항 | v1.1 반영 | 평가 |
|---------|----------|------|
| Base URL `/api/v1` | §14.1 | ✅ CLAUDE.md 규칙 준수 |
| 에러 응답 구조 (code, message, timestamp) | §14.7 | ✅ |
| 페이지네이션 (content, page, size, totalElements) | §14.1 + §14.2 | ✅ |
| JWT 인증 | §14.1 | ✅ |
| ISO 8601 날짜 | §14.1 | ✅ |
| React + Vite + Tailwind + Zustand + React Query | §13.1 | ✅ CLAUDE.md 기본 스택 |
| Node.js + Express 백엔드 | §13.2 | ✅ 바이브코딩 스택 |
| Socket.IO | §13.1 + §15 | ✅ |

### 2.9 3계층 아키텍처 반영 ✅

| 계층 | 구성요소 | v1.1 반영 | 평가 |
|------|---------|----------|------|
| Skills | 7개 스킬 | §9.5 스킬 실행 현황, §15.2 skill_progress 이벤트 | ✅ |
| MCP | 5개 서버 (youtube-data, comfyui, shell, filesystem, web-search) | §13.2 외부 연동 | ✅ |
| Runtime | 상태 머신 + Job 저장 + 버전 이력 | §10 + §12 + §14 | ✅ |

---

## 3. 수정 필요 사항 (2건)

### 3.1 [중요] 상태 머신 주석 추가

**문제:** v1.1 §10의 39개 상태 중 9개가 `data-models.md`의 VALID_TRANSITIONS에 존재하지 않음.

**권고 조치:**
1. v1.1 문서의 §10 상태 테이블에 "UI 전용" 컬럼 추가
2. `style_bible_pending`, `character_bible_pending`은 data-models.md에 추가 필요 표기
3. 나머지 7개(script_revision_requested, video_partial, compose_generating, compose_failed, export_failed, recovering, paused)는 "UI 전용 상태 (백엔드 상태 머신에는 미반영)" 주석

### 3.2 [경미] 출력 구조에 upload_info.json 추가 고려

**문제:** ARCHITECTURE.md에서 `upload_info.json` (YouTube 메타데이터)을 언급하나, v1.1 §16의 metadata/ 폴더에 미포함.

**권고 조치:** metadata/ 폴더에 `upload_info.json` 항목 추가 (선택사항)

---

## 4. 종합 결론

v1.1 문서는 프로젝트의 4대 요구사항 문서를 **95% 이상 충실히 반영**합니다.

유일하게 의미 있는 이슈는 "상태 머신 39개 중 9개가 data-models.md에 없는 UI 전용 상태"인데, 이는 UI 기획서가 사용자 경험을 더 세밀하게 표현하기 위해 백엔드 상태를 세분화한 것으로 자연스러운 차이입니다. 다만, `style_bible_pending`과 `character_bible_pending`은 CLAUDE.md의 핵심 원칙(#1 일관성 최우선: Bible 승인 후 이미지 생성)에 부합하므로 **data-models.md에 공식 추가하는 것이 권장**됩니다.

**최종 판정: PASS ✅**

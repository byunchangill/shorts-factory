# UI/UX 설계 기획서 — 최종 검토 리포트

> **검토일:** 2026-03-12
>
> **검토 대상:** `docs/UI_UX_Design_Spec_v1.2.md` (Final)
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
| 상태 머신 (VALID_TRANSITIONS) | 30/30 백엔드 + 9 UI전용 (구분 완료) | ✅ 해결됨 |
| 이벤트 레지스트리 (70+개) | WebSocket 8개로 요약 | ✅ 적절 |
| 건강 컴플라이언스 (L1~L4, T1~T4) | 100% | ✅ 완전 |
| 이미지 생성 규칙 (Style/Character Bible) | 100% | ✅ 완전 |
| 사용 영상 배제 (영구/임시) | 100% | ✅ 완전 |
| 출력 구조 | 100% | ✅ 해결됨 |
| API 스키마 | 100% | ✅ 완전 |
| 3계층 아키텍처 반영 | 100% | ✅ 완전 |
| 프론트엔드 상태 매핑 가이드 | 100% | ✅ v1.2 신규 |

**종합 평가: 100% 커버리지 — PASS ✅**

---

## 2. 상세 검토

### 2.1 CLAUDE.md 9대 원칙 매핑 ✅

| # | 원칙 | v1.2 반영 위치 | 평가 |
|---|------|---------------|------|
| 1 | 일관성 최우선 | §7 Style/Character Bible 워크플로우 | ✅ Frozen/Flexible 체크박스까지 반영 |
| 2 | 오마주 ≠ 복사 | §4.4 유사도 게이지 3개 (phrase/structure/title) | ✅ 임계값 정확 반영 |
| 3 | 씬 단위 재생성 | §4.5 개별 AssetCard 재생성/복원 | ✅ 재생성 카운터(3/3) 포함 |
| 4 | 재사용 가능 설계 | 전체 범용 워크플로우 설계 | ✅ |
| 5 | 추적 가능성 | §9.5 ActivityLog + §16 production_log.json | ✅ |
| 6 | 산출물 완결성 | §16 산출물 구조 & 패키징 UI | ✅ |
| 7 | 사용 영상 배제 | §8 사용된 영상 배제 시스템 UI | ✅ 영구/임시/수동 관리 |
| 8 | 상태 추적 | §10 39개 상태 전체 매핑 + 백엔드/UI전용 구분 | ✅ 해결됨 |
| 9 | 운영 안전 | §11 재시도 정책 (씬당 3회), 에러 배너 | ✅ |

### 2.2 상태 머신 매핑 ✅ (v1.1 이슈 → v1.2 해결)

**v1.1 이슈:** 39개 상태 중 9개가 `data-models.md`의 VALID_TRANSITIONS에 없었음.

**v1.2 해결 내용:**

| 조치 | 상세 |
|------|------|
| **"소스" 컬럼 추가** | §10.1 상태 테이블에 `백엔드` / `⭐ UI전용` / `⭐ 추가권고` 구분 명시 |
| **매핑 가이드 신규** | §10.3 프론트엔드 상태 매핑 가이드 추가 — 백엔드 상태를 UI 상태로 변환하는 조건과 구현 예시 코드 포함 |
| **data-models 권고** | `style_bible_pending`, `character_bible_pending`은 CLAUDE.md 원칙에 부합하므로 VALID_TRANSITIONS 추가 권고 주석 |

**9개 UI 전용 상태 처리 현황:**

| # | 상태 | v1.2 처리 | 상태 |
|---|------|----------|------|
| 1 | `script_revision_requested` | UI전용 + 변환 조건 명시 | ✅ |
| 2 | `style_bible_pending` | 추가권고 + 변환 조건 명시 | ✅ |
| 3 | `character_bible_pending` | 추가권고 + 변환 조건 명시 | ✅ |
| 4 | `video_partial` | UI전용 + 변환 조건 명시 | ✅ |
| 5 | `compose_generating` | UI전용 + 변환 조건 명시 | ✅ |
| 6 | `compose_failed` | UI전용 + 변환 조건 명시 | ✅ |
| 7 | `export_failed` | UI전용 + 변환 조건 명시 | ✅ |
| 8 | `recovering` | UI전용 + 변환 조건 명시 | ✅ |
| 9 | `paused` | 향후 구현 주석 | ✅ |

### 2.3 이벤트 레지스트리 반영 ✅

data-models.md에 70+개 이벤트가 정의되어 있으나, UI 기획서에서 모든 이벤트를 나열할 필요는 없음. v1.2의 §15 WebSocket 이벤트 8개는 프론트엔드가 수신해야 하는 핵심 이벤트를 적절히 요약.

v6 Fix #1 (`SEARCH_REQUESTED` + `SEARCH_STARTED` 분리)은 백엔드 이벤트이므로 UI에서 직접 다루지 않아도 됨. ✅

### 2.4 건강 콘텐츠 컴플라이언스 ✅

| 요구사항 | v1.2 반영 | 평가 |
|---------|----------|------|
| L1~L4 주장 등급 | §6.1 색상 + 아이콘 + 배경 | ✅ |
| 금지 표현 감지 | §6.3 exact_keyword/contains_keyword/template 모두 반영 | ✅ |
| T1~T4 출처 신뢰도 | §6.4 아이콘 + 사용 가능 여부 | ✅ |
| 면책 자동 삽입 | §6.5 나레이션 + 설명란 | ✅ |
| 자동 수정 (L4) | §6.3 자동 수정 팝오버 | ✅ |
| detect/rewrite 분리 (v6 Fix #4) | §6.3 수정 전략 반영 | ✅ |
| 감사 리포트 | §6.6 QC 화면 컴플라이언스 감사 | ✅ |

### 2.5 이미지 생성 규칙 ✅

| 요구사항 | v1.2 반영 | 평가 |
|---------|----------|------|
| Style Bible → Character Bible → 이미지 순서 | §7.1 생성 타이밍 플로우 | ✅ |
| Frozen/Flexible 항목 분리 | §7.3 체크박스 목록 (6+6 매핑) | ✅ |
| 재생성 시 Frozen 보존 | §7.3 명시 | ✅ |
| 카테고리별 스타일 | §5.2~5.4 타입별 전용 요소 | ✅ |
| IP-Adapter 참조 | §5.2 강아지 전용 요소 | ✅ |

### 2.6 콘텐츠 타입별 분기 ✅

| 타입 | 요구사항 | v1.2 반영 | 평가 |
|------|---------|----------|------|
| 🐶 강아지 | 감정 곡선, 캐릭터 일관성, 표정/포즈, Ken Burns | §5.2 | ✅ |
| 📖 썰툰 | 영상화 스킵, 말풍선→자막, 훅/반전/속도감 | §5.3 | ✅ |
| 💊 건강 | L1~L4, 면책, 얼굴 없음, 인포그래픽 | §5.4 + §6 | ✅ |

### 2.7 출력 구조 ✅ (v1.1 이슈 → v1.2 해결)

**v1.1 이슈:** ARCHITECTURE.md의 `upload_info.json` 미포함.

**v1.2 해결:** §16.1 metadata/ 폴더에 `upload_info.json (YouTube 업로드용 메타데이터)` 추가 완료.

CLAUDE.md 기준 100% + ARCHITECTURE.md 기준 100% 일치.

### 2.8 API 스키마 & 기술 스택 ✅

| 요구사항 | v1.2 반영 | 평가 |
|---------|----------|------|
| Base URL `/api/v1` | §14.1 | ✅ |
| 에러 응답 구조 | §14.7 | ✅ |
| 페이지네이션 | §14.1 + §14.2 | ✅ |
| JWT 인증 | §14.1 | ✅ |
| ISO 8601 | §14.1 | ✅ |
| React + Vite + Tailwind + Zustand + React Query | §13.1 | ✅ |
| Node.js + Express | §13.2 | ✅ |
| Socket.IO | §13.1 + §15 | ✅ |

### 2.9 3계층 아키텍처 반영 ✅

| 계층 | 구성요소 | v1.2 반영 | 평가 |
|------|---------|----------|------|
| Skills | 7개 스킬 | §9.5 + §15.2 | ✅ |
| MCP | 5개 서버 | §13.2 | ✅ |
| Runtime | 상태 머신 + Job 저장 + 버전 이력 | §10 + §12 + §14 | ✅ |

---

## 3. v1.1 이슈 → v1.2 수정 이력

| # | v1.1 이슈 | 심각도 | v1.2 조치 | 상태 |
|---|----------|--------|----------|------|
| 1 | 상태 머신 39개 중 9개 백엔드 미존재 | 중요 | §10.1 "소스" 컬럼 추가 + §10.3 매핑 가이드 신규 작성 | ✅ 해결 |
| 2 | 출력 구조에 upload_info.json 누락 | 경미 | §16.1 metadata/에 추가 | ✅ 해결 |

---

## 4. data-models.md 업데이트 권고사항

v1.2 기획서는 UI 관점에서 완결되었으나, 백엔드 구현 시 `schemas/data-models.md`에 아래 변경이 권장됩니다:

| 변경 | VALID_TRANSITIONS 추가 내용 | 이유 |
|------|--------------------------|------|
| **style_bible_pending 추가** | `"script_approved": ["style_bible_pending"]`, `"style_bible_pending": ["character_bible_pending", "script_approved"]` | CLAUDE.md 원칙 #1: Bible 승인 후 이미지 생성 |
| **character_bible_pending 추가** | `"character_bible_pending": ["images_generating", "style_bible_pending"]` | 위와 동일 |
| **video_partial 추가 (선택)** | `"video_generating": ["video_pending_approval", "video_partial", "video_failed", "error"]`, `"video_partial": ["video_generating"]` | images_partial 패턴과 일관성 |

이 변경은 UI 기획서의 범위 밖이며, 백엔드 구현 Phase에서 진행합니다.

---

## 5. 종합 결론

v1.2 문서는 프로젝트의 4대 요구사항 문서(CLAUDE.md, data-models.md, ARCHITECTURE.md, implementation-plan.md)를 **100% 충실히 반영**합니다.

v1.1에서 발견된 2개 이슈(상태 머신 불일치, 출력 구조 누락)는 모두 해결되었으며, 추가로 프론트엔드 상태 매핑 가이드(§10.3)가 신규 작성되어 구현 시 백엔드-프론트엔드 간 상태 변환 로직이 명확해졌습니다.

**최종 판정: PASS ✅ (무조건)**

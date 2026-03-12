# AI Shorts Factory — Web UI/UX 설계 기획서

> 터미널 기반 파이프라인을 웹 UI로 전환하기 위한 UI/UX 설계 기획서
>
> **Version 1.2 (Final)** | 2026.03.12
>
> **v1.1 → v1.2 변경사항:** 상태 머신 백엔드/UI전용 구분 명확화, data-models.md 상태 추가 권고 반영, 출력 구조에 upload_info.json 추가, 프론트엔드 상태 매핑 가이드 신규 추가, 검토 리포트 기반 최종 보완
>
> v1.0 → v1.1 변경사항: 건강 컴플라이언스 UI, 콘텐츠 타입별 분기 워크플로우, 39개 상태 전체 매핑, 에러 복구 흐름, Style/Character Bible 승인 워크플로우, 사용된 영상 배제 UI, 완전한 API 스키마, WebSocket 이벤트 페이로드, 버전 관리 상세 추가

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [UI/UX 설계 목표](#2-uiux-설계-목표)
3. [정보 구조 (IA)](#3-정보-구조-information-architecture)
4. [화면 설계](#4-화면-설계)
   - 4.1 대시보드
   - 4.2 새 작업 생성
   - 4.3 YouTube 리서치 & 선택
   - 4.4 대본 편집/승인
   - 4.5 이미지 생성 & 관리
   - 4.6 영상 생성 & TTS 합성
   - 4.7 QC 검수 & 패키징
5. [콘텐츠 타입별 분기 워크플로우](#5-콘텐츠-타입별-분기-워크플로우)
6. [건강 콘텐츠 컴플라이언스 UI](#6-건강-콘텐츠-컴플라이언스-ui)
7. [Style Bible & Character Bible 워크플로우](#7-style-bible--character-bible-워크플로우)
8. [사용된 영상 배제 시스템 UI](#8-사용된-영상-배제-시스템-ui)
9. [공통 컴포넌트 설계](#9-공통-컴포넌트-설계)
10. [상태 머신 전체 매핑 (39개 상태)](#10-상태-머신-전체-매핑-39개-상태)
11. [에러 복구 & 재시도 흐름](#11-에러-복구--재시도-흐름)
12. [버전 관리 시스템 UI](#12-버전-관리-시스템-ui)
13. [기술 스택 & 구현 계획](#13-기술-스택--구현-계획)
14. [API 스키마 완전 정의](#14-api-스키마-완전-정의)
15. [WebSocket 이벤트 상세](#15-websocket-이벤트-상세)
16. [산출물 구조 & 패키징 UI](#16-산출물-구조--패키징-ui)

---

## 1. 프로젝트 개요

### 1.1 배경

AI Shorts Factory는 YouTube 인기 영상을 분석하고, 구조만 오마주하여 저작권 안전한 새 콘텐츠를 자동 생산하는 반자동 파이프라인입니다. 현재 터미널(CLI) 기반으로 작동하며, 비개발자도 쉽게 사용할 수 있는 웹 UI가 필요합니다.

### 1.2 현황 분석

| 구분 | 현재 (CLI) | 목표 (Web UI) |
|------|-----------|--------------|
| **사용 방법** | 터미널 명령어 입력 | 웹 브라우저에서 클릭/선택 |
| **사용자 인터랙션** | 텍스트 프롬프트 응답 | 버튼, 카드, 프리뷰 UI |
| **상태 확인** | JSON 파일 직접 확인 | 실시간 상태 대시보드 |
| **에셋 프리뷰** | 파일 탐색기로 개별 확인 | 인라인 프리뷰 + 버전 비교 |
| **재생성** | 명령어 + 씨 변경 입력 | 원클릭 재생성 버튼 |
| **에러 복구** | 로그 확인 후 수동 재실행 | 자동 재시도 + 선택적 복구 UI |
| **건강 컴플라이언스** | 코드 내 검증 결과 확인 | 인라인 하이라이트 + 자동 수정 제안 |

### 1.3 3가지 콘텐츠 타입

| 타입 | 키워드 | 핵심 | 영상화 | 스타일 | 특수 규칙 |
|------|--------|------|--------|--------|-----------|
| 🐶 **강아지** | 강아지, 개, 반려견 | 감정선, 캐릭터 일관성 | ✅ 필요 | 픽사 3D CGI | 감정 추적, IP-Adapter 일관성 |
| 📖 **썰툰** | 썰, 썰툰, 실화 | 훅, 반전, 속도감 | ❌ 이미지만 (영상 스킵) | 한국 웹툰 | 말풍선 없음→자막 처리, 슬라이드 타이밍 |
| 💊 **건강** | 건강, 효능, 상식 | 신뢰감, 가독성 | ✅ 필요 | 플랫 인포그래픽 | L1~L4 컴플라이언스, 면책 자동삽입 |

---

## 2. UI/UX 설계 목표

### 2.1 핵심 설계 원칙

| # | 원칙 | 설명 |
|---|------|------|
| 1 | **스텝 중심 탐색** | 7단계 워크플로의 현재 위치를 항상 시각적으로 표시하고, 다음 액션을 명확히 제시 |
| 2 | **인라인 프리뷰** | 이미지, 영상, 대본 등 모든 에셋을 화면 내에서 즉시 확인 가능 |
| 3 | **원클릭 액션** | 승인, 재생성, 버전 복원 등 핵심 액션을 버튼 한 번으로 실행 |
| 4 | **실시간 상태 추적** | 상태 머신 기반으로 진행률, 단계, 에러를 대시보드에 실시간 반영 |
| 5 | **비파괴적 수정** | 에셋을 개별 선택하여 수정하고, 나머지는 보존. 전체 재생성 방지 |
| 6 | **타입 인식 UI** | 콘텐츠 타입(🐶/📖/💊)에 따라 화면 구성이 자동 분기. 불필요한 단계는 스킵 표시 |
| 7 | **실패 투명성** | 에러 발생 시 원인, 재시도 횟수, 복구 옵션을 명확히 표시. 블랙박스 방지 |

### 2.2 타겟 사용자

**주 사용자:** 1인 콘텐츠 크리에이터. 기술적 배경 없이 키워드 입력부터 최종 다운로드까지 웹에서 완결.

**사용 환경:** 데스크톱 브라우저 (Chrome 기준, 최소 1280px)

---

## 3. 정보 구조 (Information Architecture)

### 3.1 사이트맵

| GNB 메뉴 | 하위 페이지 | 설명 |
|----------|------------|------|
| **대시보드** | `/dashboard` | 전체 Job 목록, 상태 요약, 빠른 실행 |
| **새 작업** | `/jobs/new` | 키워드 + 콘텐츠 타입 선택 |
| **작업 상세** | `/jobs/:id` | 7단계 워크플로 실행 화면 |
| ├ 리서치 | `/jobs/:id/research` | YouTube TOP 5 검색 + 선택 |
| ├ 대본 | `/jobs/:id/script` | 대본 생성/편집/승인 |
| ├ 이미지 | `/jobs/:id/images` | Style/Character Bible 승인 + 이미지 생성/재생성/승인 |
| ├ 영상 | `/jobs/:id/video` | 영상화 + TTS + 합성 (썰툰: 영상화 스킵) |
| ├ QC | `/jobs/:id/qc` | 품질 검수 결과 (6+1 항목) |
| └ 패키징 | `/jobs/:id/export` | 산출물 트리 + 선택적 다운로드 |
| **영상 관리** | `/admin/used-videos` | 사용된 영상 배제 이력 관리 |
| **설정** | `/settings` | API 키, 경로, 스타일 프리셋, 기본 TTS 설정 |

### 3.2 레이아웃 구조

전체 레이아웃은 사이드바 + 메인 콘텐츠 + 우측 패널 3컬럼 구조를 채택합니다.

| 영역 | 역할 |
|------|------|
| **왼쪽 사이드바 (240px)** | GNB 메뉴 + 진행 중 Job 목록 + 7단계 스텝 네비게이션 (Job 상세 진입 시) |
| **메인 콘텐츠** | 현재 단계의 주요 작업 영역. 카드 그리드, 편집기, 프리뷰 등 표시 |
| **우측 패널 (320px)** | 상태 요약, 실시간 로그, 알림, 스킬 실행 현황. 접기/펼치기 가능 |

### 3.3 브라우저 새로고침 대응

사용자가 워크플로우 중간에 브라우저를 새로고침하거나 재접속할 경우, 마지막 저장된 Job 상태에서 자동 복원합니다. "이전 작업을 이어서 진행합니다" 토스트 알림을 표시합니다.

---

## 4. 화면 설계

### 4.1 대시보드 (`/dashboard`)

**목적:** 전체 Job 목록을 한눈에 파악하고, 새 작업을 빠르게 시작할 수 있는 진입점.

**상단 요약 카드 4개:**

| 카드 | 배경색 | 내용 |
|------|--------|------|
| 전체 Job 수 | `#EBF5FB` | 진행중 / 완료 / 에러 |
| 오늘 생성 | `#E8F8F5` | 신규 Job 수 |
| 승인 대기 | `#FEF9E7` | 사용자 액션 필요 |
| 에러 발생 | `#FDEDEC` | 조치 필요 Job |

**하단 Job 목록 테이블 컬럼:**

| 컬럼 | 내용 |
|------|------|
| Job ID | `job_YYYYMMDD_NNN` 형식 |
| 타입 | 🐶/📖/💊 아이콘 |
| 키워드 | 검색 키워드 |
| 현재 단계 | Step 1~7 중 현재 위치 |
| 상태 | StatusBadge 컴포넌트 |
| 생성일 | YYYY.MM.DD |
| 액션 | [열기] / [다운로드] / [삭제] |

**필터/정렬:** 상태별 탭 (전체/진행중/승인대기/완료/에러) + 타입 필터 + 키워드 검색 + 날짜순/상태순 정렬

### 4.2 새 작업 생성 (`/jobs/new`)

**목적:** 키워드와 콘텐츠 타입을 선택하여 새 Job 생성.

**UI 구성 요소:**

| 요소 | 상세 |
|------|------|
| **키워드 입력 필드** | 텍스트 입력 + 최근 검색어 칩 표시. placeholder: "검색할 키워드를 입력하세요 (ex. 강아지 감동)" |
| **콘텐츠 타입 선택** | 3개 카드 UI. 각 카드에 아이콘, 타입명, 설명, 특징 배지(영상화 필요/이미지만 등) 표시 |
| **자동 감지** | 키워드 입력 시 콘텐츠 타입 자동 추천. "강아지" 입력 시 🐶 카드 하이라이트 |
| **시작 버튼** | CTA 버튼: "리서치 시작". 키워드 + 타입 선택 완료 시 활성화 |

### 4.3 YouTube 리서치 & 선택 (`/jobs/:id/research`)

**목적:** YouTube TOP 5 영상을 분석 결과와 함께 카드 형태로 제시하고, 사용자가 1개를 선택하는 화면.

**영상 카드 구성:**

| 카드 요소 | 상세 |
|-----------|------|
| **썸네일 + 제목** | YouTube 썸네일 이미지, 영상 제목, 채널명 |
| **핵심 지표** | 조회수, 좋아요, 댓글 수, 업로드일 배지 표시 |
| **종합 점수** | 5차원 레이더/바 차트: viewCount(×1) + recency(×0.8) + comments(×0.6) + structureReusability(×1.2) + policySafety(×1.0) |
| **분석 요약** | hookType, 구조 요약, 감정 흐름, 바이럴 포인트, 리스크 플래그 표시 |
| **배제 상태 배지** | 🔴 "사용됨 (영구 배제)" / 🟡 "임시 배제 (~03.19)" / 없음(선택 가능) |
| **액션 버튼** | "이 영상으로 오마주" 버튼. 배제 영상은 비활성화 + 사유 툴팁 |

**추가 기능:**

| 기능 | 상세 |
|------|------|
| **다시 검색** | 키워드 변경 없이 재검색. 재시도 카운터 표시 ("검색 2/3회") |
| **키워드 수정** | 검색 키워드를 인라인 편집하여 재검색 |
| **선택 확인** | 선택 시 확인 모달: "이 영상의 구조를 오마주합니다. 진행하시겠습니까?" + 영상 요약 |

### 4.4 대본 편집/승인 (`/jobs/:id/script`)

**목적:** 생성된 대본을 시각적으로 확인하고, 수정/승인하는 화면.

**화면 레이아웃 (2컬럼 + 하단):**

**왼쪽: 씬 타임라인 (40%)**

| 요소 | 상세 |
|------|------|
| **씬 카드** | 씬 번호 + 나레이션 텍스트 + 비주얼 인텐트 설명 |
| **메타 태그** | 감정(emotion), 카메라(camera), 듀레이션(durationSec) 칩 |
| **타임라인** | 세로 타임라인으로 씬 순서 시각화. 전체 런타임 하단 표시 |

**오른쪽: 편집기 (60%)**

| 요소 | 상세 |
|------|------|
| **씬 선택 편집** | 씬 카드 클릭 시 우측 편집기에 해당 씬 나레이션 인라인 편집 |
| **변경 하이라이트** | 수정된 부분 노란색 배경 하이라이트 |
| **건강 컴플라이언스 인라인** | 💊 건강 타입일 때: 문장별 L1~L4 등급 배지 + 위반 하이라이트 (상세 → 섹션 6) |

**하단: 검증 패널**

| 요소 | 상세 |
|------|------|
| **유사도 게이지 3개** | phraseOverlap < 30% (바), structureOverlap < 70% (바), titleSimilarity < 50% (바). 초과 시 빨간 경고 |
| **유사도 상세** | 게이지 클릭 시 모달: 원본 vs 생성 문장 비교, 중복 구간 하이라이트 |
| **메타 정보** | 제목 후보 5개 (radio 선택), 썸네일 훅 후보, 해시태그 편집 |

**액션 버튼:**

| 버튼 | 스타일 | 동작 |
|------|--------|------|
| **승인** | Primary (파란색) | 대본 확정 + 다음 단계 |
| **수정 요청** | Secondary | 수정 사항 입력 모달 → 부분 재생성 |
| **전체 재생성** | Outline (회색) | 확인 모달 후 대본 전체 새로 생성 |

### 4.5 이미지 생성 & 관리 (`/jobs/:id/images`)

**목적:** Style/Character Bible 승인 → 씬별 이미지 생성 → 개별 재생성/버전 복원/승인.

**화면 구성 (3단계):**

**① 상단: Bible 승인 영역** (상세 → 섹션 7)

대본 승인 후 자동 생성된 Style Bible + Character Bible을 카드로 표시. 사용자가 확인/수정/승인.

**② 메인: 씬 이미지 그리드**

| 요소 | 상세 |
|------|------|
| **이미지 카드** | 씬번호 + 이미지 프리뷰 (9:16) + 상태 배지(✅승인/⏳대기/🔄재생성중/❌실패) + 버전번호(v1, v2...) |
| **호버 정보** | 나레이션 텍스트 + 프롬프트 요약 + 시드값 |
| **클릭 상세** | 확대 프리뷰 + 프롬프트 전체 + 시드값 + 버전 히스토리 타임라인 |
| **개별 액션** | ✅ 승인 체크박스 / 🔄 재생성 (프롬프트 수정 선택적) / ⬅ 이전 버전 복원 (드롭다운) / 🔍 상세 |

**③ 하단: 일괄 액션**

| 요소 | 상세 |
|------|------|
| **진행 현황** | "8개 씬 중 6개 승인, 1개 재생성중, 1개 대기" 프로그레스 바 |
| **전체 승인** | 모든 씬 승인 완료 시 활성화 → "전체 승인 + 다음 단계" |
| **부분 실패** | "3개 성공, 5개 실패" 시: 실패 씬만 재생성 / 성공 씬 유지 옵션 |

### 4.6 영상 생성 & TTS 합성 (`/jobs/:id/video`)

**목적:** 영상화(🐶강아지/💊건강만) + TTS 나레이션 + 자막/BGM 합성 처리 및 프리뷰.

**📖 썰툰 타입일 때:** 영상화 단계 전체 스킵. "📖 썰툰은 이미지 슬라이드쇼로 제작됩니다. 영상화를 건너뛰고 TTS/합성으로 이동합니다." 안내 배너 + TTS 설정부터 시작.

**화면 구성:**

**① 영상 프리뷰 영역 (🐶💊만)**

| 요소 | 상세 |
|------|------|
| **씬별 영상 클립** | 그리드 카드: 동영상 썸네일 + 재생 버튼 + 상태 배지 + 버전번호 |
| **모션 프리셋** | 씬별 드롭다운: zoom_in / zoom_out / pan_left / pan_right / floating / static |
| **전체 플레이어** | 모든 씬 이어붙인 연속 재생 + 씬 구분선 마커 |

**② TTS 설정 (전체 타입)**

| 요소 | 상세 |
|------|------|
| **음성 선택** | 🐶 SunHiNeural (기본) / 📖 HyunsuNeural (기본) / 💊 InJoonNeural (기본) + 드롭다운 변경 |
| **속도 조절** | 슬라이더: -10% ~ +10%. 현재 값 표시 |
| **씬별 음성 파형** | 각 씬의 오디오 파형 + 재생 버튼 + 듀레이션 표시 |
| **재생성** | 씬별 "음성 재생성" 버튼 |

**③ 타이밍 싱크 시각화**

| 요소 | 상세 |
|------|------|
| **듀얼 타임라인** | 상단: 영상/이미지 씬 바 (파란색) / 하단: 음성 씬 바 (녹색). 오버레이로 매칭 확인 |
| **불일치 경고** | 음성이 영상보다 길면: "⚠ 씬 3: 음성 5.2초 > 영상 4.0초. 영상을 늘리시겠습니까?" |
| **자동 조정** | "자동 싱크" 버튼: 영상 듀레이션을 음성 기준으로 자동 조정 |

**④ 합성 & BGM**

| 요소 | 상세 |
|------|------|
| **BGM 선택** | 타입별 기본 BGM + 커스텀 업로드. 볼륨 슬라이더 + 페이드 인/아웃 설정 |
| **합성 버튼** | "합성 시작" → 진행률 바 → 완료 시 최종 영상 플레이어 자동 재생 |
| **자막 프리뷰** | SRT 기반 자막 타이밍 미리보기. 씬별 자막 시작/끝 타임스탬프 |

### 4.7 QC 검수 & 패키징 (`/jobs/:id/qc`, `/jobs/:id/export`)

**목적:** 6+1개 항목 품질 검수 결과 확인 후 최종 패키징.

**QC 검수 항목 (6개 공통 + 1개 건강 전용):**

| # | 검수 항목 | 검증 내용 | UI 표현 |
|---|-----------|-----------|---------|
| 1 | **저작권 안전성** | 유사도 재검증 (phrase/structure/title) | 3개 게이지 + PASS/WARN/FAIL |
| 2 | **이미지 일관성** | Claude Vision 분석 (캐릭터 일관성) | 비교 이미지 2장 + 점수 |
| 3 | **영상 규격** | ffprobe: 해상도, FPS, 코덱, 듀레이션 | 규격 표 + 적합성 ✅/❌ |
| 4 | **음성 싱크** | 씬별 타이밍 오차 감지 | 씬별 오차(ms) 리스트 |
| 5 | **콘텐츠 정책** | 카테고리별 정책 준수 (잔인함/비방/과장 등) | 위반 항목 하이라이트 |
| 6 | **파일 완결성** | 필수 파일 존재 확인 | 파일 체크리스트 ✅/❌ |
| 7 | **건강 컴플라이언스** (💊만) | L1~L4 재검증 + 면책 삽입 확인 | 컴플라이언스 리포트 (상세 → 섹션 6) |

**결과별 액션:**

| 결과 | 색상 | 의미 | 사용자 액션 |
|------|------|------|-----------|
| **PASS** | `#27AE60` | 모든 항목 통과 | "패키징 진행" 버튼 활성화 |
| **WARNING** | `#E67E22` | 경미한 문제 | "무시하고 패키징" + "돌아가서 수정" 선택지 |
| **FAIL** | `#E74C3C` | 심각한 문제 | 복귀 대상 단계 선택 라디오: "대본 수정" / "이미지 수정" / "영상 수정" / "TTS 수정" |

**FAIL 시 복귀 라우팅:**

| QC 실패 항목 | 추천 복귀 단계 | 이유 |
|-------------|---------------|------|
| 저작권 안전성 | Step 3 (대본) | 구조/문장 유사도 초과 |
| 이미지 일관성 | Step 4 (이미지) | 캐릭터 불일치 |
| 영상 규격 | Step 5a (영상) | 코덱/해상도 문제 |
| 음성 싱크 | Step 5b (TTS) | 타이밍 불일치 |
| 콘텐츠 정책 | Step 3 (대본) | 부적절한 표현 |
| 건강 컴플라이언스 | Step 3 (대본) | 금지 표현/면책 누락 |

---

## 5. 콘텐츠 타입별 분기 워크플로우

### 5.1 전체 분기 다이어그램

```
[공통] Step 1~2: 리서치 → 선택
  ↓
[공통] Step 3: 대본 생성/편집/승인
  ↓                     ↓                      ↓
[🐶 강아지]           [📖 썰툰]              [💊 건강]
  ↓                     ↓                      ↓
Step 4: 이미지 생성    Step 4: 이미지 생성     Step 4: 이미지 생성
(픽사 3D CGI)         (한국 웹툰 스타일)      (플랫 인포그래픽)
(IP-Adapter 일관성)   (캐릭터 다양)           (얼굴 없음)
  ↓                     ↓                      ↓
Step 5a: 영상화        ██ 영상화 스킵 ██       Step 5a: 영상화
(Ken Burns 모션)      (이미지 슬라이드쇼)      (인포그래픽 모션)
  ↓                     ↓                      ↓
Step 5b: TTS          Step 5b: TTS            Step 5b: TTS
(SunHi, 감성적)       (Hyunsu, 자연스러움)     (InJoon, 전문적)
BGM: 감성 피아노       BGM: 서스펜스 비트       BGM: 차분한 기업
  ↓                     ↓                      ↓
[공통] Step 6: QC     [공통] Step 6: QC       [공통] Step 6: QC
                                               + 건강 컴플라이언스
  ↓
[공통] Step 7: 패키징
```

### 5.2 🐶 강아지 전용 UI 요소

| 단계 | 전용 요소 | 설명 |
|------|----------|------|
| Step 3 (대본) | **감정 곡선 시각화** | 씬별 감정(기쁨→슬픔→감동) 라인 차트. 클라이맥스 지점 강조 |
| Step 4 (이미지) | **캐릭터 일관성 체크** | Scene 1(기준) vs 나머지 씬 얼굴/털/체형 일관성 점수 표시 |
| Step 4 (이미지) | **표정 프리셋** | 씬별 감정에 맞는 표정 프리셋 제안: 행복(꼬리흔들기), 슬픔(처진귀) 등 |
| Step 5a (영상) | **모션 추천** | 감정에 따른 Ken Burns 추천: 슬픔→slow zoom_in, 기쁨→floating |
| Step 5b (TTS) | **톤 설정** | SunHiNeural 기본 + 감성적 톤(-5% 속도) |

### 5.3 📖 썰툰 전용 UI 요소

| 단계 | 전용 요소 | 설명 |
|------|----------|------|
| Step 3 (대본) | **훅 강도 인디케이터** | 첫 씬의 훅 강도를 5점 척도로 표시. 약하면 경고 |
| Step 3 (대본) | **반전 포인트 마커** | 타임라인에 반전 씬을 ⚡ 마커로 표시 |
| Step 4 (이미지) | **스토리보드 뷰** | 웹툰 컷 스타일 세로 스크롤 뷰 (그리드 대신) |
| Step 4 (이미지) | **캐릭터 다양성 허용** | IP-Adapter 일관성 완화. 씬별 다른 캐릭터 가능 |
| Step 5a | **❌ 스킵됨** | "📖 썰툰은 이미지 슬라이드쇼입니다" 안내 배너. 스텝 진행자에서 회색+취소선 |
| Step 5b (TTS) | **슬라이드 타이밍** | 씬별 이미지 표시 시간 설정 슬라이더 (기본: 음성 길이 기준 자동) |

### 5.4 💊 건강 전용 UI 요소

| 단계 | 전용 요소 | 설명 |
|------|----------|------|
| Step 3 (대본) | **컴플라이언스 패널** | 문장별 L1~L4 색상 배지 + 위반 하이라이트 + 자동 수정 제안 (상세 → 섹션 6) |
| Step 3 (대본) | **출처 신뢰도 표시** | 인용된 정보의 출처 등급(T1~T4) 아이콘 표시 |
| Step 3 (대본) | **면책 자동 삽입** | 마지막 씬에 면책 문구 자동 삽입 + 노란 배경 프리뷰 |
| Step 4 (이미지) | **얼굴 없음 검증** | 생성된 이미지에 실제 얼굴이 포함되지 않았는지 자동 체크 |
| Step 6 (QC) | **건강 컴플라이언스 QC** | 추가 검수 항목: 컴플라이언스 재검증 + 면책 삽입 확인 |
| Step 7 (패키징) | **면책 메타데이터** | YouTube 설명란용 면책 문구 자동 생성 |

### 5.5 StepProgress 타입별 표시

| 단계 | 🐶 강아지 | 📖 썰툰 | 💊 건강 |
|------|----------|---------|---------|
| Step 1~2 리서치 | 🔵 활성 | 🔵 활성 | 🔵 활성 |
| Step 3 대본 | 🔵 활성 | 🔵 활성 | 🔵 활성 + 컴플라이언스 아이콘 |
| Step 4 이미지 | 🔵 활성 | 🔵 활성 | 🔵 활성 |
| Step 5a 영상 | 🔵 활성 | ⬜ 스킵 (취소선) | 🔵 활성 |
| Step 5b TTS/합성 | 🔵 활성 | 🔵 활성 | 🔵 활성 |
| Step 6 QC | 🔵 활성 | 🔵 활성 | 🔵 활성 + 컴플라이언스 아이콘 |
| Step 7 패키징 | 🔵 활성 | 🔵 활성 | 🔵 활성 |

---

## 6. 건강 콘텐츠 컴플라이언스 UI

### 6.1 주장 등급 시스템 (L1~L4)

대본 편집기에서 건강 콘텐츠의 모든 문장을 자동 분석하여 등급을 부여합니다.

| 등급 | 색상 | 의미 | UI 표현 | 필요 조치 |
|------|------|------|---------|----------|
| **L1 안전** | `#27AE60` (녹색) | 일반 상식 수준 | 녹색 좌측 보더 | 없음 |
| **L2 조건부** | `#F1C40F` (노란) | 출처+면책 필요 | 노란 배경 + 📎 출처태그 | 출처 첨부 + 면책 표시 |
| **L3 주의** | `#E67E22` (주황) | 강한 면책 필요 | 주황 배경 + ⚠ 아이콘 | 조건부 표현으로 재작성 권장 |
| **L4 금지** | `#E74C3C` (빨강) | 사용 불가 | 빨강 배경 + 🚫 아이콘 + 취소선 | **자동 재작성 필수** |

### 6.2 인라인 하이라이트 UI

대본 편집기 내에서 각 문장 옆에 등급 배지가 표시됩니다.

```
[L1] 비타민 D는 뼈 건강에 도움이 될 수 있습니다.
[L2] 연구에 따르면 오메가3가 심혈관 건강을 지원할 수 있습니다. 📎[T2: 서울대병원]
[L3] ⚠ 이 성분은 혈당 조절에 효과적일 수 있으나, 개인차가 있습니다.
[L4] 🚫 ~~이것만 먹으면 당뇨가 완치됩니다~~ → 자동 수정됨
     → "당뇨 증상이 있다면 전문의 상담을 권장합니다"
```

### 6.3 금지 표현 감지 & 자동 수정

| 금지 패턴 | 매칭 방식 | 감지 예시 | 자동 수정 예시 |
|-----------|----------|----------|--------------|
| "완치" | exact_keyword | "당뇨가 완치됩니다" | "당뇨 관리에 도움이 될 수 있습니다" |
| "의사가 숨기는" | contains_keyword | "의사가 숨기는 비밀" | "잘 알려지지 않은 건강 정보" |
| "무조건", "100% 효과" | exact_keyword | "무조건 효과 있습니다" | "도움이 될 수 있습니다" |
| "만병통치" | exact_keyword | "만병통치 식품" | "다양한 건강 효능이 알려진 식품" |
| "기적" | exact_keyword + 한국어 어미 | "기적입니다" ✅ / "기적적인" ❌ | "주목할 만한 변화" |
| 진단 패턴 | template | "당신은 ${질병}입니다" | "관련 증상이 있으면 전문의 상담을 권장합니다" |

**자동 수정 팝오버:**

L4 문장 클릭 시 팝오버 표시:
- 원문 (취소선)
- 수정안 (자동 생성)
- "수정안 적용" 버튼
- "직접 수정" 버튼 → 인라인 편집 모드

### 6.4 출처 신뢰도 표시 (T1~T4)

| 등급 | 아이콘 | 의미 | 예시 | 사용 가능 |
|------|--------|------|------|----------|
| **T1 공인기관** | 🏛️ | WHO, CDC, 식약처 등 | "WHO에 따르면..." | ✅ |
| **T2 의료기관** | 🏥 | 대학병원, 의학저널 | "서울대병원 연구..." | ✅ |
| **T3 일반미디어** | 📰 | 뉴스, 건강매거진 | "한 건강 프로그램에서..." | ⚠ 주의 |
| **T4 불명** | ❓ | 출처 불분명 | "~라고 합니다" | 🚫 사용 금지 |

T4 출처가 감지되면 빨간 경고: "출처가 불분명합니다. T1~T2 수준의 출처를 추가하거나 문장을 삭제하세요."

### 6.5 면책 문구 자동 삽입 프리뷰

| 위치 | 내용 |
|------|------|
| **마지막 씬 나레이션** | "본 콘텐츠는 건강 정보 제공 목적이며, 의료 조언을 대체하지 않습니다. 증상이 있으시면 전문의와 상담하세요." |
| **YouTube 설명란** | "※ 본 영상은 일반적인 건강 정보를 다루고 있으며 의료 행위가 아닙니다. 구체적인 건강 문제는 전문 의료인과 상담하시기 바랍니다." |

면책 문구는 노란 배경으로 하이라이트되며, "자동 삽입됨" 태그가 표시됩니다. 사용자가 삭제하려 하면 경고 모달: "면책 문구를 삭제하면 QC에서 실패할 수 있습니다."

### 6.6 컴플라이언스 감사 리포트 (QC 화면)

QC 단계에서 건강 콘텐츠일 경우 추가 표시되는 감사 리포트:

| 섹션 | 내용 |
|------|------|
| **감지된 위반** | L3~L4 문장 목록 + 원문 + 매칭된 규칙 ID |
| **자동 수정 이력** | 자동 수정된 문장: 원문 → 수정문 + 수정 전략(full_sentence_replace / verb_stem_rewrite 등) |
| **출처 검증** | 사용된 출처 목록 + 등급(T1~T4) + T3~T4 경고 |
| **면책 삽입 확인** | 나레이션 면책 ✅/❌ + 설명란 면책 ✅/❌ |
| **최종 판정** | PASS(모든 L4 수정됨 + 면책 삽입됨) / FAIL(L4 미수정 또는 면책 누락) |

---

## 7. Style Bible & Character Bible 워크플로우

### 7.1 생성 타이밍

대본 승인(`script_approved`) 직후 자동으로 Style Bible + Character Bible이 생성됩니다. 이미지 생성 전에 반드시 두 Bible 모두 승인받아야 합니다.

```
script_approved → [자동 생성] → style_bible_pending → [사용자 승인] → character_bible_pending → [사용자 승인] → images_generating
```

### 7.2 Style Bible 카드 UI

| 요소 | 상세 |
|------|------|
| **렌더링 스타일** | 텍스트 설명 + 참고 스타일 미리보기 이미지 (예: "Pixar 3D CGI, subsurface scattering 털 표현") |
| **팔레트** | 6색 스와치 표시 (메인/서브/강조/배경/텍스트/효과) + HEX 코드 |
| **라인 굵기** | thin / medium / bold 선택 |
| **라이팅 무드** | warm / neutral / cool / dramatic 선택 |
| **카메라 비율** | 9:16 (쇼츠 기본) 고정 표시 |

**액션:**

| 버튼 | 동작 |
|------|------|
| **승인** | Style Bible 확정. Character Bible 생성 진행 |
| **수정** | 각 항목 인라인 편집 모달 |
| **재생성** | 전체 재생성 (확인 모달) |

### 7.3 Character Bible 카드 UI

| 요소 | 상세 |
|------|------|
| **캐릭터 목록** | 캐릭터별 카드. 이름 + 역할 + 외형 설명 |
| **프롬프트 베이스** | 기본 프롬프트 텍스트 표시 (편집 가능) |
| **Frozen 항목** | 체크박스 목록 (기본 잠금): ☑ 얼굴, ☑ 신체, ☑ 의상/털 패턴, ☑ 렌더링 스타일, ☑ 팔레트, ☑ 종횡비 |
| **Flexible 항목** | 체크박스 목록 (기본 해제): ☐ 표정, ☐ 포즈, ☐ 구도, ☐ 손/발 디테일, ☐ 소품, ☐ 배경 디테일 |

**Frozen/Flexible 규칙:**
- Frozen 항목은 모든 씬에서 동일하게 유지
- Flexible 항목만 씬별로 변경 가능
- 재생성 시에도 Frozen 항목 보존

**액션:**

| 버튼 | 동작 |
|------|------|
| **승인** | Character Bible 확정. 이미지 생성 시작 |
| **수정** | Frozen/Flexible 토글 + 외형 설명 편집 |
| **캐릭터 추가/제거** | 캐릭터 목록 관리 |

---

## 8. 사용된 영상 배제 시스템 UI

### 8.1 배제 규칙

| 유형 | 조건 | 기간 | 배지 |
|------|------|------|------|
| **영구 배제** | 오마주 대상으로 선택된 영상 | 무기한 | 🔴 "사용됨 (영구)" |
| **임시 배제** | TOP 5에 올랐으나 미선택 | 7일 | 🟡 "임시 배제 (~MM.DD)" |
| **해제됨** | 7일 경과 후 자동 해제 | - | 배지 없음 |

### 8.2 리서치 화면 배제 표시

YouTube 리서치 카드에서 배제된 영상은:

- **영구 배제:** 카드 전체 반투명(opacity: 0.5) + 🔴 "영구 배제" 오버레이 + "이 영상으로 오마주" 버튼 비활성화 + 툴팁: "이 영상은 job_XXXX에서 사용되었습니다"
- **임시 배제:** 카드 약간 반투명(opacity: 0.7) + 🟡 "임시 배제" 배지 + 버튼 비활성화 + 툴팁: "해제 예정: 2026-03-19"
- **전부 배제 시:** "5개 후보 모두 배제 상태입니다. 키워드를 변경하거나 내일 다시 시도하세요." 안내 메시지 + 키워드 변경 입력 필드

### 8.3 영상 관리 페이지 (`/admin/used-videos`)

| 요소 | 상세 |
|------|------|
| **영구 배제 목록** | videoId, 제목, 채널, 사용된 Job ID, 선택일 |
| **임시 배제 목록** | videoId, 제목, 채널, 배제 시작일, 해제 예정일, 카운트다운 |
| **통계** | 총 선택 영상 수, 총 발표 영상 수, 마지막 클린업 일시 |
| **수동 배제** | "영상 URL로 영구 배제 추가" 입력 필드 |
| **수동 해제** | 임시 배제 영상의 "즉시 해제" 버튼 (확인 모달) |

---

## 9. 공통 컴포넌트 설계

### 9.1 스텝 진행 표시자 (`StepProgress`)

모든 Job 상세 화면 상단에 고정. 수평 스템퍼 7단계.

| 속성 | 상세 |
|------|------|
| **디자인** | 수평 스템퍼. 각 단계를 원형 아이콘 + 라벨로 표시. 전 단계 선으로 연결 |
| **상태 색상** | 완료=`#27AE60`, 진행중=`#3498DB`, 대기=`#BDC3C7`, 에러=`#E74C3C`, 스킵=`#BDC3C7`+취소선 |
| **7단계 라벨** | 리서치 → 대본 → 이미지 → 영상 → TTS/합성 → QC → 패키징 |
| **인터랙션** | 완료된 단계 클릭 시 해당 단계로 이동. 미래 단계는 클릭 불가 |
| **타입별 분기** | 📖 썰툰: "영상" 단계 회색+취소선. 💊 건강: "대본"/"QC" 단계에 🛡️ 아이콘 추가 |
| **현재 스킬 표시** | 진행중 단계 아래 작은 텍스트: "🧠 youtube-researcher 실행 중..." |

### 9.2 상태 배지 (`StatusBadge`)

| 배지 | 색상 | 배경 |
|------|------|------|
| 승인 대기 | `#E67E22` | `#FEF9E7` |
| 진행중 | `#3498DB` | `#EBF5FB` |
| 완료 | `#27AE60` | `#E8F8F5` |
| 에러 | `#E74C3C` | `#FDEDEC` |
| 재생성중 | `#8E44AD` | `#F4ECF7` |
| 부분 실패 | `#E67E22` | `#FEF9E7` |
| 스킵됨 | `#95A5A6` | `#F2F3F4` |
| 포기됨 | `#7F8C8D` | `#EAECEE` |

### 9.3 에셋 카드 (`AssetCard`)

| 구성 요소 | 상세 |
|-----------|------|
| **프리뷰 영역** | 썸네일 이미지 또는 영상 플레이어. 9:16 비율 고정. 호버 시 확대 아이콘 |
| **상태 표시** | 좌상단 StatusBadge. 우상단 버전 번호 (v1, v2...) |
| **정보 영역** | 씬 번호, 나레이션 요약 (1줄), 듀레이션 표시 |
| **액션 버튼** | 하단 바: ✅ 승인 / 🔄 재생성 / ⬅ 복원 / 🔍 상세. 상태에 따라 활성화 변경 |
| **재생성 카운터** | 재생성된 씬은 "🔄 2/3" 표시 (최대 3회 제한) |

### 9.4 버전 히스토리 (`VersionHistory`)

에셋 상세 모달에서 표시. 상세 → 섹션 12.

### 9.5 실시간 로그 패널 (`ActivityLog`)

| 구성 | 상세 |
|------|------|
| **로그 항목** | 타임스탬프 + 이벤트 타입 아이콘 + 메시지 |
| **색상 코드** | system=`#95A5A6`, user=`#3498DB`, error=`#E74C3C`, tool=`#8E44AD` |
| **필터 탭** | 전체 / 시스템 / 사용자 / 에러 / 스킬별 (youtube-researcher, script-creator 등) |
| **접기/펼치기** | 패널 헤더 토글. 접은 상태에서도 새 알림 노티피케이션 표시 |
| **스킬 실행 현황** | 현재 실행 중인 스킬명 + 서브스텝 표시: "🧠 image-generator: Scene 3/8 생성 중..." |

### 9.6 확인 모달 (`ConfirmModal`)

| 구성 | 상세 |
|------|------|
| **일반 확인** | 제목 + 설명 + [취소] + [확인(파란색)] |
| **위험 확인** | 제목 + 경고 설명 + [취소] + [실행(빨간색)]. QC 무시, 전체 재생성 등 |
| **포기 확인** | "이 작업을 포기하시겠습니까?" + 데이터 보존 옵션(삭제/보관) |

---

## 10. 상태 머신 전체 매핑 (39개 상태)

> **참고:** 아래 상태 중 30개는 `schemas/data-models.md`의 `VALID_TRANSITIONS`에 정의된 공식 백엔드 상태이며, 9개는 UI에서 사용자 경험을 세분화하기 위해 추가한 **UI 전용 상태**입니다. UI 전용 상태는 ⭐ 마크로 표시됩니다.
>
> `style_bible_pending`과 `character_bible_pending`은 CLAUDE.md 원칙 #1(일관성 최우선: Bible 승인 후 이미지 생성)에 부합하므로, **data-models.md VALID_TRANSITIONS에 공식 추가가 권장**됩니다.

### 10.1 전체 상태 목록 & UI 매핑

| # | 상태 | 소스 | UI 표현 | StepProgress 위치 | 사용자 액션 |
|---|------|------|---------|-------------------|-----------|
| 1 | `searching` | 백엔드 | 로딩 스피너 + "YouTube 검색 중..." | Step 1 🔵 | 대기 |
| 2 | `references_presented` | 백엔드 | 5개 영상 카드 표시 + 선택 대기 | Step 1 🟡 | **1개 선택** |
| 3 | `reference_selected` | 백엔드 | 선택 완료 배지 + 자동 전환 | Step 1→2 전환 | 자동 |
| 4 | `scripting` | 백엔드 | 로딩 + "대본 생성 중..." + 진행률 | Step 3 🔵 | 대기 |
| 5 | `script_pending_approval` | 백엔드 | 대본 편집기 활성화 + 승인 대기 배지 | Step 3 🟡 | **승인/수정/재생성** |
| 6 | `script_revision_requested` | ⭐ UI전용 | "수정 요청 반영 중..." 로딩. 백엔드에서는 `scripting`으로 전이 | Step 3 🔵 | 대기 |
| 7 | `script_failed` | 백엔드 | 에러 배너 + 재시도 버튼 + 카운터 | Step 3 🔴 | 재시도/수동수정 |
| 8 | `script_approved` | 백엔드 | 완료 배지 + Bible 생성 시작 | Step 3 ✅ | 자동 |
| 9 | `style_bible_pending` | ⭐ 추가권고 | Style Bible 카드 표시 + 승인 대기. 현재 data-models에서는 `script_approved → images_generating` 직접 전이 | Step 4 🟡 | **승인/수정** |
| 10 | `character_bible_pending` | ⭐ 추가권고 | Character Bible 카드 표시 + 승인 대기. 현재 data-models에서는 위와 동일 | Step 4 🟡 | **승인/수정** |
| 11 | `images_generating` | 백엔드 | 씬별 이미지 순차 생성 + 프로그레스 | Step 4 🔵 | 대기 (완성된 씬 미리보기 가능) |
| 12 | `images_partial` | 백엔드 | "5/8 완료, 3개 실패" + 부분 재시도 옵션 | Step 4 🟠 | **실패 씬만 재생성/전체 재시도** |
| 13 | `images_pending_approval` | 백엔드 | 전체 이미지 그리드 + 씬별 승인 체크 | Step 4 🟡 | **개별 승인/재생성/복원** |
| 14 | `images_regen_requested` | 백엔드 | 해당 씬 "🔄 재생성 중..." + 나머지 유지 | Step 4 🔵 | 대기 |
| 15 | `images_version_restored` | 백엔드 | "↩ Scene 3 v1으로 복원됨. 확인하세요" | Step 4 🟡 | **확인/재승인** |
| 16 | `images_fully_approved` | 백엔드 | 전체 승인 완료 + 다음 단계 전환 | Step 4 ✅ | 자동 |
| 17 | `video_generating` | 백엔드 | 씬별 영상 생성 + 프로그레스 (🐶💊만) | Step 5a 🔵 | 대기 |
| 18 | `video_partial` | ⭐ UI전용 | 부분 실패 + 실패 씬만 재생성 옵션. 백엔드에서는 `video_failed`로 처리 | Step 5a 🟠 | **실패 씬만 재생성** |
| 19 | `video_pending_approval` | 백엔드 | 영상 프리뷰 + 씬별 승인 | Step 5a 🟡 | **승인/재생성** |
| 20 | `video_regen_requested` | 백엔드 | 해당 씬 영상 재생성 중 | Step 5a 🔵 | 대기 |
| 21 | `video_failed` | 백엔드 | 에러 + 재시도 옵션 | Step 5a 🔴 | 재시도/건너뛰기 |
| 22 | `video_approved` | 백엔드 | 영상 승인 완료 → TTS 시작 | Step 5a ✅ | 자동 |
| 23 | `tts_generating` | 백엔드 | TTS 음성 생성 중 + 프로그레스 | Step 5b 🔵 | 대기 |
| 24 | `tts_failed` | 백엔드 | TTS 에러 + 재시도 옵션 | Step 5b 🔴 | 재시도/음성변경 |
| 25 | `tts_syncing` | 백엔드 | 음성-영상 싱크 중 + 자막 생성 중 | Step 5b 🔵 | 대기 |
| 26 | `compose_generating` | ⭐ UI전용 | FFmpeg 합성 중 + 프로그레스 바. 백엔드에서는 `tts_syncing`의 서브스텝 | Step 5b 🔵 | 대기 |
| 27 | `compose_failed` | ⭐ UI전용 | 합성 실패 + 에러 로그. 백엔드에서는 `error` 상태로 처리 | Step 5b 🔴 | 재시도 |
| 28 | `compose_done` | 백엔드 | 최종 영상 프리뷰 가능 | Step 5b ✅ | 자동 QC 시작 |
| 29 | `qc_reviewing` | 백엔드 | QC 자동 진행 중 + 6개 항목 순차 체크 | Step 6 🔵 | 대기 |
| 30 | `qc_passed` | 백엔드 | 전체 PASS + 패키징 버튼 활성화 | Step 6 ✅ | **패키징 진행** |
| 31 | `qc_warning` | 백엔드 | WARNING 항목 표시 + 무시/수정 선택 | Step 6 🟡 | **무시/수정 선택** |
| 32 | `qc_failed` | 백엔드 | FAIL 항목 + 복귀 단계 선택 | Step 6 🔴 | **복귀 단계 선택** |
| 33 | `exporting` | 백엔드 | 패키징 중 + 프로그레스 바 | Step 7 🔵 | 대기 |
| 34 | `export_failed` | ⭐ UI전용 | 패키징 실패 + 재시도. 백엔드에서는 `error` 상태로 처리 | Step 7 🔴 | 재시도 |
| 35 | `exported` | 백엔드 | 다운로드 가능 + 파일 트리 표시 | Step 7 ✅ | **다운로드** |
| 36 | `error` | 백엔드 | 글로벌 에러 + 복구 옵션 | 해당 단계 🔴 | 복구/포기 |
| 37 | `abandoned` | 백엔드 | "작업 포기됨" 회색 배지 | 전체 ⬜ | 재개/삭제 |
| 38 | `recovering` | ⭐ UI전용 | "복구 중..." 로딩. 백엔드에서는 `error → 각 단계` 전이의 중간 표현 | 해당 단계 🔵 | 대기 |
| 39 | `paused` | ⭐ UI전용 | "일시 중지" 배지 + 재개 버튼. 향후 data-models 추가 시 구현 | 해당 단계 ⏸️ | **재개** |

### 10.2 상태 전이 다이어그램 (전체)

```
[searching] → [references_presented] → [reference_selected] → [scripting]
     ↓ (실패)                                                      ↓ (실패)
   [error]                                               [script_failed] ←→ (재시도 max 3)
                                                               ↓ (성공)
                                            [script_pending_approval]
                                             ↙        ↓         ↘
                                     [script_revision] [승인]  [재생성→scripting]
                                            ↓
                                    [script_approved]
                                            ↓
                               [style_bible_pending] → [character_bible_pending]
                                            ↓
                                    [images_generating]
                                     ↙            ↘
                            [images_partial]  [images_pending_approval]
                             (부분 재시도)       ↙    ↓    ↘
                                        [regen]  [restore]  [전체승인]
                                                     ↓
                                           [images_fully_approved]
                                            ↙              ↘
                            [video_generating]        [tts_generating]
                           (🐶💊만)                   (📖 직행)
                                ↓                          ↓
                        [video_approved]            [tts_syncing]
                                ↓                          ↓
                          [tts_generating]          [compose_generating]
                                ↓                          ↓
                          [tts_syncing]             [compose_done]
                                ↓                          ↓
                        [compose_generating]        [qc_reviewing]
                                ↓                   ↙    ↓    ↘
                          [compose_done]     [qc_passed] [warn] [fail]
                                ↓                  ↓
                          [qc_reviewing]    [exporting] → [exported]
```

### 10.3 프론트엔드 상태 매핑 가이드 (v1.2 추가)

프론트엔드에서 백엔드 상태를 UI 상태로 변환할 때 아래 매핑 규칙을 따릅니다.

**원칙:** 백엔드의 `job.status` 값은 항상 VALID_TRANSITIONS 기준이며, 프론트엔드는 추가 컨텍스트(진행률, 에러 타입 등)를 조합하여 UI 전용 상태를 결정합니다.

| UI 전용 상태 | 백엔드 상태 | 변환 조건 |
|-------------|-----------|----------|
| `script_revision_requested` | `scripting` | `lastEvent.eventType === 'SCRIPT_REVISION_REQUESTED'` |
| `style_bible_pending` | `script_approved`* | `job.styleBible && !job.styleBible.approved` |
| `character_bible_pending` | `script_approved`* | `job.styleBible.approved && !job.characterBible.approved` |
| `video_partial` | `video_failed` | `failedScenes.length < totalScenes` (일부만 실패) |
| `compose_generating` | `tts_syncing` | `progress.substep === 'composing'` |
| `compose_failed` | `error` | `lastEvent.skill === 'tts-sync' && lastEvent.substep === 'compose'` |
| `export_failed` | `error` | `lastEvent.skill === 'export-packager'` |
| `recovering` | `error` → 전이중 | `isTransitioning && fromStatus === 'error'` |
| `paused` | (미구현) | 향후 data-models에 추가 시 구현 |

> *`style_bible_pending`, `character_bible_pending`은 data-models.md VALID_TRANSITIONS에 공식 추가를 권고합니다. 추가 시 프론트엔드 변환 로직 없이 백엔드 상태를 직접 사용할 수 있습니다.*

**구현 예시 (Zustand 스토어):**

```javascript
// 백엔드 상태 → UI 상태 변환 함수
function resolveUIStatus(job, lastEvent, progress) {
  const status = job.status;

  // UI 전용 상태 분기
  if (status === 'scripting' && lastEvent?.eventType === 'SCRIPT_REVISION_REQUESTED') {
    return 'script_revision_requested';
  }
  if (status === 'script_approved') {
    if (job.styleBible && !job.styleBible.approved) return 'style_bible_pending';
    if (job.characterBible && !job.characterBible.approved) return 'character_bible_pending';
  }
  if (status === 'video_failed' && job.scenes.some(s => s.videoAsset?.status === 'approved')) {
    return 'video_partial';
  }
  if (status === 'tts_syncing' && progress?.substep === 'composing') {
    return 'compose_generating';
  }
  if (status === 'error') {
    if (lastEvent?.skill === 'tts-sync') return 'compose_failed';
    if (lastEvent?.skill === 'export-packager') return 'export_failed';
    if (progress?.isRecovering) return 'recovering';
  }

  // 기본: 백엔드 상태 그대로 반환
  return status;
}
```

---

## 11. 에러 복구 & 재시도 흐름

### 11.1 재시도 정책

| 대상 | 최대 재시도 | 간격 | UI 표시 |
|------|-----------|------|---------|
| 씬 이미지 생성 | 3회 | 지수 백오프 (2s, 4s, 8s) | "🔄 재시도 2/3" 카운터 |
| 씬 영상 생성 | 3회 | 지수 백오프 | "🔄 재시도 2/3" 카운터 |
| TTS 생성 | 3회 | 지수 백오프 | "🔄 재시도 2/3" 카운터 |
| 합성 (FFmpeg) | 2회 | 5s 고정 | "🔄 재시도 1/2" 카운터 |
| YouTube 검색 | 3회 | 3s 고정 | "🔄 재시도 2/3" 카운터 |

### 11.2 에러 배너 컴포넌트 (`ErrorBanner`)

| 요소 | 상세 |
|------|------|
| **에러 타입 배지** | 네트워크 / API / 검증 / 타임아웃 / 시스템 |
| **에러 메시지** | 사용자 친화적 메시지: "이미지 생성 서버에 연결할 수 없습니다" |
| **스킬명** | "youtube-researcher", "image-generator" 등 실행 중이던 스킬 |
| **타임스탬프** | 에러 발생 시각 |
| **재시도 카운터** | "재시도 2/3" — 3회 초과 시: "최대 재시도 횟수 초과. 수동 개입이 필요합니다" |
| **상세 로그** | 접을 수 있는 기술적 에러 로그 (개발자용) |
| **액션 버튼** | "재시도" + "다른 단계로 복귀" + "로그 다운로드" |

### 11.3 부분 실패 처리

| 시나리오 | UI 표시 | 사용자 옵션 |
|---------|---------|-----------|
| 8개 씬 중 3개 이미지 실패 | "5/8 성공, 3/8 실패" + 실패 씬 빨간 테두리 | ① 실패 씬만 재생성 ② 전체 재시도 ③ 실패 씬 건너뛰기 |
| TTS 특정 씬 실패 | "씬 4 음성 생성 실패" + 나머지 씬 정상 | ① 해당 씬만 재생성 ② 다른 음성으로 재시도 |
| 합성 실패 | "최종 합성 실패" | ① 재시도 ② 설정 변경 후 재시도 |

### 11.4 QC 실패 복구 라우팅

QC FAIL 시 "어느 단계로 돌아갈지" 라디오 선택 UI:

```
⚠ QC 실패: 저작권 안전성 (phraseOverlap 35% > 30%)

돌아갈 단계를 선택하세요:
  ○ Step 3: 대본 수정 (추천 ⭐)
  ○ Step 4: 이미지 수정
  ○ Step 5: 영상/TTS 수정

[돌아가기] [작업 포기]
```

각 QC 항목별 추천 복귀 단계가 자동 선택됩니다.

### 11.5 작업 포기 (`abandoned`)

| UI 요소 | 상세 |
|---------|------|
| **확인 모달** | "이 작업을 포기하시겠습니까?" + 데이터 처리 옵션 |
| **데이터 옵션** | ○ 보관 (나중에 재개 가능) / ○ 삭제 (복구 불가) |
| **대시보드 표시** | 회색 "포기됨" 배지 + "재개" / "삭제" 버튼 |

---

## 12. 버전 관리 시스템 UI

### 12.1 버전 히스토리 타임라인

에셋 상세 모달에서 세로 타임라인으로 표시:

| 요소 | 상세 |
|------|------|
| **타임라인 노드** | 각 버전을 원형 노드로 표시. 현재 버전 강조 |
| **노드 정보** | 버전번호, 타임스탬프, 변경 사유 (사용자 재생성/에러 복구/자동 재시도) |
| **메타데이터** | 시드값, 프롬프트 (변경 부분 diff 하이라이트), 승인 상태 |
| **썸네일** | 각 버전 이미지 썸네일 |

### 12.2 버전 비교 모드

| 모드 | 상세 |
|------|------|
| **나란히 비교** | 두 버전을 좌우 나란히 표시. 프롬프트 diff 하단 표시 |
| **슬라이더 비교** | 이미지 위에 드래그 슬라이더. 좌=이전 우=현재 |
| **메타 비교** | 시드, 프롬프트, 승인상태 3열 비교 테이블 |

### 12.3 복원 확인

"이 버전으로 복원" 클릭 시:

```
Scene 03을 v1으로 복원하시겠습니까?

현재 (v3): seed=12345, 2026-03-12 10:30
복원 대상 (v1): seed=54321, 2026-03-12 09:15

⚠ 현재 버전(v3)은 이력에 보존됩니다.

[취소] [복원]
```

### 12.4 벌크 버전 관리

| 기능 | 상세 |
|------|------|
| **전체 버전 비교** | "모든 씬의 v1 vs v2 비교" 갤러리 뷰 |
| **전체 복원** | "모든 씬을 v1으로 복원" (확인 모달) |
| **저장 용량** | 우측 패널에 "버전 저장: 245MB (이미지 180MB + 영상 65MB)" 표시 |
| **정리** | "오래된 버전 정리" 버튼 → 승인되지 않은 이전 버전 삭제 옵션 |

---

## 13. 기술 스택 & 구현 계획

### 13.1 프론트엔드

| 영역 | 기술 | 선택 이유 |
|------|------|----------|
| **프레임워크** | React (Vite) | CLAUDE.md 기준 기본 스택. 빠른 HMR |
| **언어** | JavaScript (JSX) | 소규모 프로젝트. 빠른 프로토타입 우선. 필요 시 TS 마이그레이션 |
| **상태 관리** | Zustand + React Query | Zustand: UI/Job 상태. React Query: 서버 데이터 캐싱+실시간 폴링 |
| **스타일링** | Tailwind CSS | 유틸리티 기반 빠른 UI 구축 |
| **라우팅** | React Router v6 | SPA 라우팅, 중첩 라우트 지원 |
| **아이콘** | Lucide React | 경량 + 일관된 디자인 시스템 |
| **실시간 통신** | Socket.IO Client | Job 상태, 진행률, 로그 실시간 수신 |
| **차트** | Recharts | 유사도 게이지, 점수 바 차트, 감정 곡선 |

### 13.2 백엔드

| 영역 | 기술 | 선택 이유 |
|------|------|----------|
| **런타임** | Node.js + Express | 기존 TS 코드베이스 통일. 바이브코딩 스택 |
| **API** | REST + WebSocket | REST: CRUD. WS: 실시간 상태/로그 |
| **인증** | JWT (간단) | 1인 사용자이므로 간단한 토큰 기반 인증 |
| **오케스트레이터** | 기존 `orchestrator.ts` | 상태 머신 + 이벤트 시스템 활용 |
| **파일 저장** | JSON 파일 기반 (기존) | `jobs/` 디렉토리 구조 유지. 향후 DB 마이그레이션 가능 |
| **외부 연동** | MCP 서버 5개 | youtube-data, comfyui, shell, filesystem, web-search |

### 13.3 구현 로드맵

| Phase | 범위 | 주요 작업 | 기간 |
|-------|------|----------|------|
| **P1** | 기반 + 대시보드 | 프로젝트 셋업, 라우팅, 3컬럼 레이아웃, Job CRUD API, 인증 | 3~4일 |
| **P2** | Step 1~3 UI | 새 작업 생성, 리서치 카드, 대본 편집기, 유사도 게이지, 건강 컴플라이언스 인라인, WebSocket | 5~6일 |
| **P3** | Step 4~5 UI | Style/Character Bible, 이미지 그리드, 버전 관리, 영상 프리뷰, TTS 설정, 타이밍 싱크 | 6~8일 |
| **P4** | Step 6~7 + 에러 | QC 대시보드, 컴플라이언스 감사, 패키징+다운로드, 에러 복구 UI, 사용된 영상 관리 | 4~5일 |
| **P5** | 통합 + 폴리싱 | E2E 테스트, 브라우저 새로고침 복원, 성능 최적화, 반응형 미세조정 | 2~3일 |

---

## 14. API 스키마 완전 정의

### 14.1 공통 규칙

| 항목 | 규칙 |
|------|------|
| **Base URL** | `/api/v1` |
| **인증** | `Authorization: Bearer <jwt_token>` |
| **페이지네이션** | `?page=1&limit=20&sortBy=createdAt&sortOrder=desc` |
| **에러 응답** | `{ code: "ERROR_CODE", message: "한글 메시지", timestamp: "ISO8601" }` |
| **날짜 형식** | ISO 8601: `yyyy-MM-dd'T'HH:mm:ss` |

### 14.2 Job 관리 API

| Method | Endpoint | 설명 | Request Body | Response |
|--------|----------|------|-------------|----------|
| GET | `/jobs` | Job 목록 | Query: `?status=&contentType=&page=&limit=&sortBy=` | `{ content: Job[], page, size, totalElements }` |
| POST | `/jobs` | 새 Job 생성 | `{ keyword, contentType }` | `{ jobId, status: "searching" }` |
| GET | `/jobs/:id` | Job 상세 | - | `{ job, scenes[], assets[], events[] }` |
| DELETE | `/jobs/:id` | Job 삭제 | - | `{ success: true }` |
| POST | `/jobs/:id/abandon` | Job 포기 | `{ retain: true/false }` | `{ status: "abandoned" }` |
| POST | `/jobs/:id/resume` | Job 재개 | - | `{ status: "<이전상태>" }` |

### 14.3 워크플로우 API

| Method | Endpoint | 설명 | Request Body | Response |
|--------|----------|------|-------------|----------|
| POST | `/jobs/:id/search` | YouTube 검색 | `{ retryCount? }` | `{ references: ReferenceVideo[], exclusions: ExcludedVideo[] }` |
| POST | `/jobs/:id/select-reference` | 레퍼런스 선택 | `{ referenceId }` | `{ status: "reference_selected" }` |
| POST | `/jobs/:id/generate-script` | 대본 생성 | - | `{ taskId }` (비동기 폴링) |
| POST | `/jobs/:id/approve-script` | 대본 승인 | `{ action: "approve"/"revise"/"regenerate", revisionNote? }` | `{ status }` |
| PUT | `/jobs/:id/script` | 대본 직접 수정 | `{ scenes: Scene[] }` | `{ updated: true, similarityCheck }` |
| POST | `/jobs/:id/approve-style-bible` | Style Bible 승인 | `{ action: "approve"/"edit", edits? }` | `{ status }` |
| POST | `/jobs/:id/approve-character-bible` | Character Bible 승인 | `{ action: "approve"/"edit", edits? }` | `{ status }` |
| POST | `/jobs/:id/generate-images` | 이미지 생성 시작 | - | `{ taskId }` |
| POST | `/jobs/:id/scenes/:sid/regen-image` | 씬 이미지 재생성 | `{ newPrompt?, newSeed? }` | `{ taskId, retryCount }` |
| POST | `/jobs/:id/scenes/:sid/restore-image` | 이미지 버전 복원 | `{ targetVersion }` | `{ currentVersion, restoredFrom }` |
| POST | `/jobs/:id/approve-images` | 전체 이미지 승인 | `{ sceneApprovals: {sceneId: boolean}[] }` | `{ status }` |
| POST | `/jobs/:id/generate-videos` | 영상 생성 시작 | `{ motionPresets?: {sceneId: motionType}[] }` | `{ taskId }` |
| POST | `/jobs/:id/scenes/:sid/regen-video` | 씬 영상 재생성 | `{ motionType? }` | `{ taskId }` |
| POST | `/jobs/:id/approve-videos` | 영상 승인 | - | `{ status }` |
| POST | `/jobs/:id/generate-tts` | TTS 생성 | `{ voice?, speedRate? }` | `{ taskId }` |
| POST | `/jobs/:id/compose` | 최종 합성 | `{ bgmTrack?, bgmVolume?, subtitleStyle? }` | `{ taskId }` |
| GET | `/jobs/:id/qc` | QC 결과 조회 | - | `{ items: QCItem[], overallResult, healthCompliance? }` |
| POST | `/jobs/:id/qc/override` | QC WARNING 무시 | `{ itemIds: string[] }` | `{ status: "exporting" }` |
| POST | `/jobs/:id/qc/recover` | QC FAIL 복구 | `{ targetStep: number }` | `{ status: "<복구상태>" }` |
| POST | `/jobs/:id/export` | 패키징 실행 | - | `{ taskId }` |
| GET | `/jobs/:id/export/download` | 다운로드 URL | Query: `?type=zip/individual&files=` | `{ downloadUrl, expiresAt, fileSize }` |

### 14.4 버전 관리 API

| Method | Endpoint | 설명 | Response |
|--------|----------|------|----------|
| GET | `/jobs/:id/scenes/:sid/versions` | 씬 버전 목록 | `{ versions: ImageVersion[] }` |
| GET | `/jobs/:id/scenes/:sid/versions/:ver` | 특정 버전 상세 | `{ version, seed, prompt, filePath, approved, createdAt }` |
| POST | `/jobs/:id/scenes/batch-regen` | 일괄 재생성 | `{ sceneIds: string[] }` → `{ taskIds }` |

### 14.5 건강 컴플라이언스 API

| Method | Endpoint | 설명 | Response |
|--------|----------|------|----------|
| GET | `/jobs/:id/compliance` | 컴플라이언스 리포트 | `{ violations[], autoFixes[], sourceCredibility[], disclaimerStatus }` |
| POST | `/jobs/:id/compliance/recheck` | 컴플라이언스 재검증 | `{ violations[], autoFixes[] }` |

### 14.6 영상 배제 API

| Method | Endpoint | 설명 | Response |
|--------|----------|------|----------|
| GET | `/admin/used-videos` | 배제 영상 목록 | `{ permanent: Video[], temporary: Video[], stats }` |
| POST | `/admin/used-videos/exclude` | 수동 영구 배제 | `{ videoUrl }` → `{ videoId, usageType }` |
| DELETE | `/admin/used-videos/:videoId/temp-release` | 임시 배제 해제 | `{ released: true }` |

### 14.7 에러 응답 코드

| HTTP | 코드 | 메시지 |
|------|------|--------|
| 400 | `INVALID_INPUT` | 잘못된 입력값입니다 |
| 401 | `UNAUTHORIZED` | 인증이 필요합니다 |
| 404 | `JOB_NOT_FOUND` | 작업을 찾을 수 없습니다 |
| 404 | `SCENE_NOT_FOUND` | 씬을 찾을 수 없습니다 |
| 409 | `INVALID_STATE_TRANSITION` | 현재 상태에서 수행할 수 없는 작업입니다 |
| 429 | `RATE_LIMITED` | 요청이 너무 많습니다. N초 후 재시도하세요 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류가 발생했습니다 |
| 503 | `MCP_UNAVAILABLE` | 외부 서비스에 연결할 수 없습니다 (ComfyUI/YouTube 등) |

---

## 15. WebSocket 이벤트 상세

### 15.1 연결 & 구독

```
클라이언트 → 서버: subscribe({ jobId })
서버 → 클라이언트: subscribed({ jobId, currentStatus })
```

### 15.2 이벤트 페이로드

| 이벤트 | 페이로드 | UI 동작 |
|--------|---------|---------|
| `job:status_changed` | `{ jobId, fromStatus, toStatus, timestamp, actor: "system"/"user" }` | StepProgress 업데이트 + StatusBadge 변경 + 로그 추가 |
| `job:progress_update` | `{ jobId, step, current, total, percent, eta?, message }` | 프로그레스 바 업데이트: "이미지 생성 3/8 (37%)" |
| `job:log_entry` | `{ jobId, level: "info"/"warn"/"error", skill, message, timestamp }` | ActivityLog에 항목 추가 |
| `job:asset_generated` | `{ jobId, sceneId, assetType: "image"/"video"/"audio", filePath, version }` | AssetCard 썸네일 자동 업데이트 (추가 fetch 없이 직접 반영) |
| `job:asset_failed` | `{ jobId, sceneId, assetType, error, retryCount, maxRetries }` | AssetCard 에러 표시 + 재시도 카운터 업데이트 |
| `job:error` | `{ jobId, errorType, skill, message, recoveryOptions: string[], timestamp }` | ErrorBanner 표시 + 복구 옵션 버튼 렌더링 |
| `job:skill_progress` | `{ jobId, skill, substep, message }` | 로그 패널 스킬 현황: "🧠 image-generator: IP-Adapter 적용 중..." |
| `job:compliance_alert` | `{ jobId, sceneId, violations: Violation[] }` | 💊 건강: 인라인 컴플라이언스 경고 자동 업데이트 |

### 15.3 재연결 처리

| 시나리오 | 처리 |
|---------|------|
| **WS 연결 끊김** | 3초 후 자동 재연결 시도 (최대 5회). 화면 상단 노란 바: "연결이 끊어졌습니다. 재연결 중..." |
| **재연결 성공** | REST API로 최신 상태 fetch + 누락 이벤트 보정. 녹색 바: "연결 복원됨" (3초 후 사라짐) |
| **재연결 실패** | 빨간 바: "서버에 연결할 수 없습니다. 새로고침하세요." + 수동 새로고침 버튼 |
| **브라우저 새로고침** | REST API로 현재 상태 로드 + WS 재구독. 토스트: "이전 작업을 이어서 진행합니다" |

---

## 16. 산출물 구조 & 패키징 UI

### 16.1 산출물 파일 트리

패키징 화면에서 아래 트리를 인터랙티브하게 표시. 폴더 접기/펼치기 가능.

```
output/{job_id}/
├── 📁 final/                    ← "최종 영상만 다운로드" 버튼
│   ├── 🎬 final_shorts.mp4      (N MB)
│   └── 🎵 final_voice.mp3       (N MB)
├── 📁 images/                   ← "모든 이미지 다운로드" 버튼
│   ├── 🖼️ scene_01.png ~ scene_08.png
│   └── 📁 versions/
│       ├── scene_03_v1.png
│       └── scene_03_v2.png
├── 📁 videos/                   ← (🐶💊만) "모든 영상 다운로드" 버튼
│   ├── 🎬 scene_01.mp4 ~ scene_08.mp4
│   └── 📁 versions/
├── 📁 audio/                    ← "모든 오디오 다운로드" 버튼
│   ├── 🎵 full_narration.mp3
│   ├── 🎵 scene_01.mp3 ~ scene_08.mp3
│   └── 📝 subtitles.srt
├── 📁 script/                   ← "대본+설정 다운로드" 버튼
│   ├── 📝 script.md
│   ├── 📄 storyboard.json
│   ├── 📄 prompts.json
│   ├── 📄 style_bible.json
│   ├── 📄 character_bible.json
│   └── 📄 production_log.json
└── 📁 metadata/                 ← "메타데이터 다운로드" 버튼
    ├── 📄 title_options.json
    ├── 📝 description.txt       (YouTube 설명란용 + 면책 포함)
    ├── 📝 hashtags.txt
    └── 📄 upload_info.json      (YouTube 업로드용 메타데이터)
```

### 16.2 다운로드 옵션

| 옵션 | 설명 |
|------|------|
| **전체 ZIP** | 모든 파일 포함 ZIP. 프로그레스 바 + 파일 크기 표시 |
| **최종 영상만** | `final/` 폴더만 |
| **이미지만** | `images/` 폴더 (버전 포함 옵션) |
| **대본만** | `script/` 폴더 |
| **메타데이터** | `metadata/` 폴더 |
| **개별 파일** | 트리에서 파일 클릭 시 개별 다운로드 |
| **커스텀 선택** | 체크박스로 원하는 파일만 선택 후 다운로드 |

### 16.3 다운로드 프로그레스

| 요소 | 상세 |
|------|------|
| **프로그레스 바** | 패키징 진행률 + 예상 시간 |
| **파일 크기** | 전체 패키지 크기 사전 표시 (예: "245MB") |
| **재다운로드** | 패키징 완료 후 언제든 재다운로드 가능. "마지막 패키징: 2026-03-12 14:30" 표시 |

### 16.4 파일 검증

| 항목 | 상세 |
|------|------|
| **파일 수 확인** | "예상 파일 수: 32개 / 실제: 32개 ✅" |
| **필수 파일** | final_shorts.mp4, script.md, production_log.json 존재 확인 |
| **크기 검증** | 0바이트 파일 경고 |

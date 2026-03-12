# 🎬 YT Shorts Factory

리서치 기반 YouTube Shorts 자동 제작 파이프라인.
키워드 하나로 YouTube 인기 영상 분석 → 대본 생성 → 이미지/영상 제작 → QC → 내보내기까지 웹 UI로 운영.

---

## 📁 프로젝트 구조

```
shorts-factory/
├── src/              ← Node.js 백엔드 (파이프라인 로직 + Express API)
│   ├── server.ts     ← Express REST API 서버 (포트 3001)
│   ├── index.ts      ← CLI 진입점 (웹 미사용 시)
│   ├── core/         ← Job 관리, 상태 머신, 이벤트
│   ├── types/        ← TypeScript 타입 정의
│   └── utils/        ← 유틸리티 (유사도 검증, 건강 컴플라이언스 등)
├── client/           ← React 프론트엔드 (Vite, 포트 5173)
│   ├── src/          ← 화면 컴포넌트 (10개 페이지)
│   └── package.json  ← 프론트엔드 의존성
├── config/           ← 환경설정, 사용된 영상 목록
├── jobs/             ← Job 상태 저장소 (자동 생성)
├── output/           ← 최종 산출물 (자동 생성)
└── package.json      ← 루트 (백엔드 + 동시 실행 스크립트)
```

---

## 🚀 빠른 시작

### 1. 의존성 설치

```bash
# 백엔드 + 프론트엔드 한번에 설치
npm run install:all
```

또는 개별 설치:
```bash
npm install                    # 백엔드
npm install --prefix client    # 프론트엔드
```

### 2. 개발 서버 실행

```bash
npm run dev
```

- **API 서버**: http://localhost:3001/api
- **웹 UI**: http://localhost:5174 (브라우저 자동 오픈)

### 3. 환경변수 설정

```bash
cp config/.env.example config/.env
```

```env
YOUTUBE_API_KEY=your_api_key_here
COMFYUI_URL=http://localhost:8188
PORT=3001
```

---

## 📋 주요 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 백엔드 + 프론트엔드 동시 실행 |
| `npm run dev:api` | Express API 서버만 실행 |
| `npm run dev:ui` | React UI만 실행 |
| `npm run dev:cli` | 기존 CLI 방식으로 실행 |
| `npm run build` | 전체 빌드 |
| `npm test` | 테스트 실행 |

---

## 🌐 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 서버 상태 |
| GET | `/api/jobs` | Job 목록 |
| POST | `/api/jobs` | Job 생성 |
| GET | `/api/jobs/:id` | Job 조회 |
| POST | `/api/jobs/:id/research` | 리서치 시작 |
| POST | `/api/jobs/:id/select-video` | 영상 선택 |
| POST | `/api/jobs/:id/script/start` | 대본 생성 |
| POST | `/api/jobs/:id/script/approve` | 대본 승인 |
| POST | `/api/jobs/:id/images/start` | 이미지 생성 |
| POST | `/api/jobs/:id/images/approve` | 이미지 승인 |
| POST | `/api/jobs/:id/video/start` | 영상 생성 |
| POST | `/api/jobs/:id/tts/start` | TTS 생성 |
| POST | `/api/jobs/:id/qc/start` | QC 실행 |
| POST | `/api/jobs/:id/export/start` | 내보내기 |
| GET | `/api/used-videos` | 사용된 영상 목록 |

---

## 🎯 콘텐츠 타입

| 타입 | 키워드 예시 | 영상화 |
|------|------------|--------|
| 🐶 강아지 AI쇼츠 | 강아지, 반려견, dog | ✅ |
| 📖 썰툰 | 썰, 썰툰, 실화 | ❌ (이미지만) |
| 💊 건강 쇼츠 | 건강, 효능, 비타민 | ✅ |

---

## 📦 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | Node.js + Express + TypeScript |
| 프론트엔드 | React 19 + Vite + Tailwind CSS |
| 상태관리 | Zustand + TanStack React Query |
| YouTube 검색 | YouTube Data API v3 |
| 이미지 생성 | Stable Diffusion (ComfyUI) |
| 영상화 | FFmpeg Ken Burns / AnimateDiff |
| TTS | Edge TTS |

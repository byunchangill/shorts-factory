# 🎬 AI Shorts Factory - Web UI

AI 쇼츠 제작 파이프라인을 웹 브라우저에서 제어하는 관리 UI.

## 실행 방법

```bash
cd shorts-factory-ui

# 패키지 설치 (node_modules가 없는 경우만)
npm install
# 또는 pnpm이 있다면:
pnpm install

# 개발 서버 시작 → 브라우저 자동 오픈
npm run dev
```

브라우저에서 **http://localhost:5173** 접속

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | React 19 + Vite |
| 언어 | JavaScript (JSX) |
| 스타일 | Tailwind CSS 3 |
| 상태 관리 | Zustand |
| 서버 상태 | TanStack React Query |
| 라우팅 | React Router v7 |
| UI 컴포넌트 | shadcn/ui + Radix UI |
| 아이콘 | Lucide React |
| 차트 | Recharts |

---

## 화면 구성

```
/dashboard              대시보드 — 작업 목록, 통계
/jobs/new               새 작업 생성 — 키워드 + 콘텐츠 타입 선택
/jobs/:id/research      리서치 — YouTube TOP 5 분석 및 선택
/jobs/:id/script        대본 편집기 — 씬별 편집 + 유사도 검증
/jobs/:id/images        이미지 — Style Bible → Character Bible → 이미지 그리드
/jobs/:id/video         영상/TTS — 영상 검토, TTS 설정, 합성
/jobs/:id/qc            QC 검수 — 6개 항목 + 건강 컴플라이언스
/jobs/:id/export        패키징 — 파일 트리, 다운로드
/admin/used-videos      영상 배제 관리
/settings               API 키, ComfyUI, TTS 설정
```

---

## 백엔드 연동

현재는 `src/data/mockData.js`의 목업 데이터를 사용합니다.
실제 백엔드 연동 시:

1. `src/data/mockData.js` → 실제 API 호출로 교체
2. `src/store/jobStore.js` → REST API 호출 로직 추가
3. WebSocket 실시간 연동: `socket.io-client` 설치 후 상태 업데이트 연결

```
백엔드 API: http://localhost:3000/api/v1
WebSocket:  http://localhost:3000
```

---

## 프로젝트 구조

```
src/
├── components/
│   ├── common/        StepProgress, StatusBadge, ActivityLog
│   └── layout/        AppLayout, Sidebar
├── data/
│   └── mockData.js    목업 데이터 (백엔드 연동 전)
├── pages/             라우트별 페이지 컴포넌트
├── store/
│   └── jobStore.js    Zustand 전역 상태
└── App.jsx            라우팅 설정
```

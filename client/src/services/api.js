/**
 * API 서비스 레이어 - Express 백엔드(3001)와 통신
 * Vite proxy 설정으로 /api 요청이 자동으로 localhost:3001로 전달됨
 */

const BASE = '/api';

// ── 공통 fetch 래퍼 ──
async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `API 오류: ${res.status}`);
  }
  return data;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const patch = (path, body) => request('PATCH', path, body);

// ─────────────────────────────────────────────
// Jobs
// ─────────────────────────────────────────────

/** Job 목록 조회 */
export const fetchJobs = () => get('/jobs');

/** Job 단건 조회 */
export const fetchJob = (jobId) => get(`/jobs/${jobId}`);

/** Job 생성 */
export const createJob = (keyword, contentType) =>
  post('/jobs', { keyword, contentType });

// ─────────────────────────────────────────────
// 워크플로우 단계
// ─────────────────────────────────────────────

/** Step 1-2: 리서치 시작 → references_presented */
export const startResearch = (jobId) =>
  post(`/jobs/${jobId}/research`);

/** Step 2: 영상 선택 → reference_selected */
export const selectVideo = (jobId, videoId) =>
  post(`/jobs/${jobId}/select-video`, { videoId });

/** Step 3: 대본 생성 시작 → scripting */
export const startScript = (jobId) =>
  post(`/jobs/${jobId}/script/start`);

/** Step 3: 대본 승인 대기 → script_pending_approval */
export const scriptPending = (jobId) =>
  post(`/jobs/${jobId}/script/pending`);

/** Step 3: 대본 승인 → script_approved */
export const approveScript = (jobId) =>
  post(`/jobs/${jobId}/script/approve`);

/** Step 4: 이미지 생성 시작 → images_generating */
export const startImages = (jobId) =>
  post(`/jobs/${jobId}/images/start`);

/** Step 4: 이미지 전체 승인 → images_fully_approved */
export const approveImages = (jobId) =>
  post(`/jobs/${jobId}/images/approve`);

/** Step 5a: 영상 생성 시작 → video_generating */
export const startVideo = (jobId) =>
  post(`/jobs/${jobId}/video/start`);

/** Step 5b: TTS 생성 시작 → tts_generating */
export const startTts = (jobId) =>
  post(`/jobs/${jobId}/tts/start`);

/** Step 6: QC 실행 → qc_reviewing */
export const startQc = (jobId) =>
  post(`/jobs/${jobId}/qc/start`);

/** Step 6: QC 통과 → qc_passed */
export const passQc = (jobId) =>
  post(`/jobs/${jobId}/qc/pass`);

/** Step 7: 내보내기 시작 → exporting */
export const startExport = (jobId) =>
  post(`/jobs/${jobId}/export/start`);

/** Step 7: 내보내기 완료 → exported */
export const completeExport = (jobId) =>
  post(`/jobs/${jobId}/export/done`);

// ─────────────────────────────────────────────
// 사용된 영상
// ─────────────────────────────────────────────

/** 참조 영상 목록 조회 (이미 검색된 결과) */
export const fetchReferences = (jobId) => get(`/jobs/${jobId}/references`);

/** 사용된 영상 목록 조회 */
export const fetchUsedVideos = () => get('/used-videos');

// ─────────────────────────────────────────────
// 헬스 체크
// ─────────────────────────────────────────────

/** 서버 연결 확인 */
export const checkHealth = () => get('/health');

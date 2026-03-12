/**
 * Job 전역 상태 관리 (Zustand)
 * mockData 제거 → 실제 Express API 연동
 */
import { create } from 'zustand';
import { fetchJobs, fetchJob, createJob as apiCreateJob } from '../services/api';

// 상태 → 진행률 계산
export function calcProgress(status) {
  const map = {
    searching: 5,
    references_presented: 15,
    reference_selected: 20,
    scripting: 30,
    script_pending_approval: 35,
    script_failed: 35,
    script_approved: 40,
    images_generating: 50,
    images_pending_approval: 55,
    images_partial: 52,
    images_regen_requested: 53,
    images_version_restored: 54,
    images_fully_approved: 60,
    video_generating: 65,
    video_pending_approval: 70,
    video_regen_requested: 68,
    video_failed: 65,
    video_approved: 72,
    tts_generating: 75,
    tts_syncing: 80,
    tts_failed: 75,
    compose_done: 85,
    qc_reviewing: 88,
    qc_passed: 92,
    qc_warning: 90,
    qc_failed: 88,
    exporting: 96,
    exported: 100,
    error: 0,
    abandoned: 0,
  };
  return map[status] ?? 0;
}

// 상태 → 현재 단계(1~7)
export function calcStep(status) {
  if (['searching', 'references_presented', 'reference_selected'].includes(status)) return 2;
  if (['scripting', 'script_pending_approval', 'script_failed', 'script_approved'].includes(status)) return 3;
  if (['images_generating', 'images_pending_approval', 'images_partial', 'images_regen_requested', 'images_version_restored', 'images_fully_approved'].includes(status)) return 4;
  if (['video_generating', 'video_pending_approval', 'video_regen_requested', 'video_failed', 'video_approved', 'tts_generating', 'tts_syncing', 'tts_failed', 'compose_done'].includes(status)) return 5;
  if (['qc_reviewing', 'qc_passed', 'qc_warning', 'qc_failed'].includes(status)) return 6;
  if (['exporting', 'exported'].includes(status)) return 7;
  return 1;
}

// API 응답 Job → UI용 Job 변환
function normalizeJob(job) {
  return {
    ...job,
    id: job.jobId, // 기존 UI 코드와 호환
    progress: calcProgress(job.status),
    currentStep: calcStep(job.status),
    errorCount: 0,
  };
}

const useJobStore = create((set, get) => ({
  // 상태
  jobs: [],
  selectedJobId: null,
  currentJob: null,
  isLoading: false,
  error: null,
  apiConnected: false,

  // UI 패널
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
  logPanelCollapsed: false,

  // ── Job 목록 로드 ──
  loadJobs: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await fetchJobs();
      const jobs = (data.jobs || []).map(normalizeJob);
      set({ jobs, isLoading: false, apiConnected: true });
    } catch (err) {
      console.error('Job 목록 로드 실패:', err);
      set({ isLoading: false, error: err.message, apiConnected: false, jobs: [] });
    }
  },

  // ── 단건 Job 로드 ──
  loadJob: async (jobId) => {
    set({ isLoading: true });
    try {
      const data = await fetchJob(jobId);
      const job = normalizeJob(data.job);
      set(state => ({
        isLoading: false,
        currentJob: job,
        jobs: state.jobs.find(j => j.jobId === jobId)
          ? state.jobs.map(j => j.jobId === jobId ? job : j)
          : [job, ...state.jobs],
      }));
      return job;
    } catch (err) {
      console.error('Job 로드 실패:', err);
      set({ isLoading: false });
      return null;
    }
  },

  // ── 작업 선택 ──
  selectJob: (jobId) => {
    const job = get().jobs.find(j => j.jobId === jobId || j.id === jobId);
    set({ selectedJobId: jobId, currentJob: job || null });
  },

  // ── 새 작업 생성 (API 호출) ──
  createJob: async (keyword, contentType) => {
    set({ isLoading: true });
    try {
      const data = await apiCreateJob(keyword, contentType);
      const job = normalizeJob(data.job);
      set(state => ({
        jobs: [job, ...state.jobs],
        isLoading: false,
      }));
      return job.jobId;
    } catch (err) {
      console.error('Job 생성 실패:', err);
      set({ isLoading: false, error: err.message });
      throw err;
    }
  },

  // ── 작업 상태 업데이트 (API 응답 반영) ──
  updateJob: (updatedJob) => {
    const job = normalizeJob(updatedJob);
    set(state => ({
      jobs: state.jobs.map(j => j.jobId === job.jobId ? job : j),
      currentJob: state.currentJob?.jobId === job.jobId ? job : state.currentJob,
    }));
  },

  // ── UI 패널 토글 ──
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleRightPanel: () => set(state => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),
  toggleLogPanel: () => set(state => ({ logPanelCollapsed: !state.logPanelCollapsed })),
}));

export default useJobStore;

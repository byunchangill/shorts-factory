/**
 * YT Shorts Factory — Express API 서버
 *
 * CLI 파이프라인을 HTTP REST API로 노출.
 * React 프론트엔드(client/)와 통신하며, 기존 core 로직을 재사용.
 */

import express from 'express';
import cors from 'cors';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { JobManager } from './core/job-manager.js';
import { onEvent } from './core/event-emitter.js';
import { searchWithExclusion } from './skills/youtube-researcher.js';
import type { ContentType } from './types/config.js';

// ── 환경변수 로드 (config/.env) ──
loadEnv({ path: resolve(process.cwd(), 'config', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const PROJECT_DIR = process.env.PROJECT_DIR || resolve(process.cwd());

// ── 미들웨어 ──
app.use(cors({ origin: 'http://localhost:5200' }));
app.use(express.json());

// ── JobManager 인스턴스 ──
const jobManager = new JobManager(PROJECT_DIR);

// ── 콘텐츠 타입 자동 감지 ──
function detectContentType(keyword: string): ContentType {
  const dogKeywords = ['강아지', '개', '반려견', '댕댕이', '멍멍이', 'dog', 'puppy'];
  const sseoltoonKeywords = ['썰', '썰툰', '실화', '레전드', '소름'];
  const healthKeywords = ['건강', '효능', '상식', '영양', '음식', '비타민', '운동'];

  const kw = keyword.toLowerCase();
  if (dogKeywords.some(d => kw.includes(d))) return 'dog';
  if (sseoltoonKeywords.some(s => kw.includes(s))) return 'sseoltoon';
  if (healthKeywords.some(h => kw.includes(h))) return 'health';
  return 'dog';
}

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────

// 헬스 체크
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Job 목록 조회 ──
app.get('/api/jobs', (_req, res) => {
  try {
    const jobs = jobManager.listJobs();
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: '잡 목록 조회 실패', detail: String(error) });
  }
});

// ── Job 생성 ──
app.post('/api/jobs', (req, res) => {
  try {
    const { keyword, contentType } = req.body as { keyword: string; contentType?: ContentType };

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ error: '키워드를 입력해주세요' });
    }

    const resolvedType: ContentType = contentType && ['dog', 'sseoltoon', 'health'].includes(contentType)
      ? contentType
      : detectContentType(keyword);

    const job = jobManager.createJob(keyword.trim(), resolvedType);
    res.status(201).json({ job });
  } catch (error) {
    res.status(500).json({ error: '잡 생성 실패', detail: String(error) });
  }
});

// ── Job 단건 조회 ──
app.get('/api/jobs/:id', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });
    res.json({ job });
  } catch (error) {
    res.status(500).json({ error: '잡 조회 실패', detail: String(error) });
  }
});

// ── Job 키워드 수정 ──
app.patch('/api/jobs/:id', (req, res) => {
  try {
    const { keyword } = req.body as { keyword?: string };
    if (!keyword) return res.status(400).json({ error: 'keyword 필드가 필요합니다' });

    const updated = jobManager.updateJob(req.params.id, { keyword });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '잡 수정 실패', detail: String(error) });
  }
});

// ── 리서치 시작 / 재검색 ──
app.post('/api/jobs/:id/research', async (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    let current = job;

    // 재검색 시: references_presented → searching 으로 먼저 되돌린 후 진행
    if (current.status === 'references_presented') {
      current = jobManager.transitionJob(current.jobId, 'searching', {
        eventType: 'SEARCH_RETRY',
        actor: 'user',
      });
    }

    // searching 상태에서만 진행 허용
    if (current.status !== 'searching') {
      return res.status(400).json({
        error: `현재 상태(${current.status})에서는 리서치를 시작할 수 없습니다`,
      });
    }

    // YouTube API 검색 (내부에서 references_presented 상태로 전이까지 처리)
    const references = await searchWithExclusion(
      current.keyword,
      current.contentType,
      current.jobId,
      PROJECT_DIR,
    );

    // 참조 영상 목록을 파일에 저장
    const referencesPath = resolve(PROJECT_DIR, 'jobs', current.jobId, 'references.json');
    writeFileSync(referencesPath, JSON.stringify(references, null, 2), 'utf-8');

    // 최신 job 상태 읽기 (searchWithExclusion이 상태를 변경함)
    const updatedJob = jobManager.getJob(current.jobId);
    res.json({ job: updatedJob, references });
  } catch (error) {
    res.status(500).json({ error: '리서치 실패', detail: String(error) });
  }
});

// ── 참조 영상 목록 조회 ──
app.get('/api/jobs/:id/references', (req, res) => {
  try {
    const referencesPath = resolve(PROJECT_DIR, 'jobs', req.params.id, 'references.json');
    if (!existsSync(referencesPath)) return res.json({ references: [] });
    const references = JSON.parse(readFileSync(referencesPath, 'utf-8'));
    res.json({ references });
  } catch (error) {
    res.status(500).json({ error: '참조 영상 조회 실패', detail: String(error) });
  }
});

// ── 영상 선택 (reference_selected 상태로 전이) ──
app.post('/api/jobs/:id/select-video', (req, res) => {
  try {
    const { videoId } = req.body as { videoId: string };
    if (!videoId) return res.status(400).json({ error: 'videoId가 필요합니다' });

    jobManager.updateJob(req.params.id, { selectedReferenceId: videoId });
    const transitioned = jobManager.transitionJob(req.params.id, 'reference_selected', {
      eventType: 'REFERENCE_SELECTED',
      actor: 'user',
      targetId: videoId,
    });
    res.json({ job: transitioned });
  } catch (error) {
    res.status(500).json({ error: '영상 선택 실패', detail: String(error) });
  }
});

// ── 대본 생성 시작 (scripting 상태로 전이) ──
app.post('/api/jobs/:id/script/start', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'scripting', {
      eventType: 'SCRIPT_GENERATION_STARTED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '대본 생성 시작 실패', detail: String(error) });
  }
});

// ── 대본 승인 대기 (script_pending_approval 상태로 전이) ──
app.post('/api/jobs/:id/script/pending', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'script_pending_approval', {
      eventType: 'SCRIPT_GENERATED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '대본 상태 전이 실패', detail: String(error) });
  }
});

// ── 대본 승인 (script_approved 상태로 전이) ──
app.post('/api/jobs/:id/script/approve', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'script_approved', {
      eventType: 'SCRIPT_APPROVED',
      actor: 'user',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '대본 승인 실패', detail: String(error) });
  }
});

// ── 이미지 생성 시작 (images_generating 상태로 전이) ──
app.post('/api/jobs/:id/images/start', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'images_generating', {
      eventType: 'IMAGES_GENERATION_STARTED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '이미지 생성 시작 실패', detail: String(error) });
  }
});

// ── 이미지 전체 승인 (images_fully_approved 상태로 전이) ──
app.post('/api/jobs/:id/images/approve', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'images_fully_approved', {
      eventType: 'IMAGES_ALL_APPROVED',
      actor: 'user',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '이미지 승인 실패', detail: String(error) });
  }
});

// ── 영상 생성 시작 (video_generating 상태로 전이) ──
app.post('/api/jobs/:id/video/start', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    if (!job.needsVideo) {
      return res.status(400).json({ error: '썰툰은 영상 생성 단계가 없습니다' });
    }

    const updated = jobManager.transitionJob(job.jobId, 'video_generating', {
      eventType: 'VIDEO_GENERATION_STARTED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '영상 생성 실패', detail: String(error) });
  }
});

// ── TTS 생성 시작 (tts_generating 상태로 전이) ──
app.post('/api/jobs/:id/tts/start', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'tts_generating', {
      eventType: 'TTS_GENERATION_STARTED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: 'TTS 시작 실패', detail: String(error) });
  }
});

// ── QC 실행 (qc_reviewing 상태로 전이) ──
app.post('/api/jobs/:id/qc/start', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'qc_reviewing', {
      eventType: 'QC_STARTED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: 'QC 시작 실패', detail: String(error) });
  }
});

// ── QC 통과 (qc_passed 상태로 전이) ──
app.post('/api/jobs/:id/qc/pass', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'qc_passed', {
      eventType: 'QC_PASSED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: 'QC 처리 실패', detail: String(error) });
  }
});

// ── 패키징/내보내기 시작 (exporting 상태로 전이) ──
app.post('/api/jobs/:id/export/start', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'exporting', {
      eventType: 'EXPORT_STARTED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '내보내기 시작 실패', detail: String(error) });
  }
});

// ── 패키징 완료 (exported 상태로 전이) ──
app.post('/api/jobs/:id/export/done', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '잡을 찾을 수 없습니다' });

    const updated = jobManager.transitionJob(job.jobId, 'exported', {
      eventType: 'EXPORT_COMPLETED',
      actor: 'system',
    });
    res.json({ job: updated });
  } catch (error) {
    res.status(500).json({ error: '내보내기 완료 처리 실패', detail: String(error) });
  }
});

// ── 사용된 영상 목록 ──
app.get('/api/used-videos', (_req, res) => {
  try {
    const usedVideosPath = resolve(PROJECT_DIR, 'config', 'used_videos.json');
    if (!existsSync(usedVideosPath)) {
      return res.json({ videos: {}, stats: { totalSelected: 0, totalPresented: 0, lastCleanupAt: null } });
    }
    const data = JSON.parse(readFileSync(usedVideosPath, 'utf-8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: '사용 영상 목록 조회 실패', detail: String(error) });
  }
});

// ── 서버 시작 ──
app.listen(PORT, () => {
  console.log(`
${'━'.repeat(50)}
🚀 Shorts Factory API Server
${'━'.repeat(50)}
📡 API:      http://localhost:${PORT}/api
🌐 Frontend: http://localhost:5200
📁 Project:  ${PROJECT_DIR}
${'━'.repeat(50)}
`);
});

// 이벤트 로깅
onEvent((event) => {
  const arrow = event.fromStatus && event.toStatus
    ? `${event.fromStatus} → ${event.toStatus}`
    : '(no state change)';
  console.log(`📡 [${event.eventType}] ${arrow} | actor: ${event.actor}`);
});

export default app;

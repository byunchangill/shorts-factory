import { asyncRouter } from '../util/asyncRouter.js';
import multer from 'multer';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import {
  MENUS, type JobState, EXPORT_DIRS,
} from '@shared/constants';
import { JobStateSchema, ZoneSchema, SegmentSchema, ProductSchema } from '@shared/types';
import * as jobs from '../store/jobs.js';
import { trashJob } from '../store/remove.js';
import { getProject, readProduct, writeProduct, listProductFiles } from '../store/projects.js';
import { loadSettings, paths, toMediaUrl, fromWorkspaceRel, toWorkspaceRel } from '../store/workspace.js';
import { probeVideo, extractFrames } from '../pipeline/probe.js';
import { progressOf, sourceEntryState, statesFor } from '../pipeline/stateMachine.js';
import { normalizeSourceUrl } from '../sourcing/links.js';
import {
  downloadAll, retrySource, isDownloading, attachSourceFile, removeSource, reconcileDownloadState,
} from '../pipeline/downloadQueue.js';
import { runTier1Clean } from '../pipeline/cleaner.js';
import {
  segmentsFromFrames, scaleZones, zonesInSegments, buildSelectedVideo, selectedPath,
} from '../pipeline/selected.js';
import { detectTextZones, ocrAvailable } from '../pipeline/ocrDetect.js';
import { getAvailableInpaintProvider } from '../pipeline/inpaint.js';
import { runTier2Scoped, autoRemovalMethod } from '../pipeline/tier2.js';
import { detectZoneRanges } from '../pipeline/detectZone.js';
import { synthesizeNarration, saveSceneVoiceFile, type SceneTiming } from '../pipeline/tts.js';
import {
  listVoices as listTypecastVoices, synthesize as typecastSynthesize, AUDIO_MIME,
} from '../pipeline/voice/typecast.js';
import { available as voiceboxAvailable, listProfiles as listVoiceboxProfiles } from '../pipeline/voice/voicebox.js';
import { assembleFinal } from '../pipeline/assemble.js';
import { upsertRow } from '../store/metrics.js';
import { exportJob, productDir, planExport } from '../pipeline/exporter.js';
import { createZip } from '../util/zip.js';
import { planCapcut } from '../pipeline/capcut.js';
import { resolveAssets } from '../store/assets.js';
import { usedAssetIds, assetLedgerRows, transformSummary } from '@shared/assetPolicy';
import { hasKey } from '../store/secrets.js';
import { readJson, slugify } from '../util/fsx.js';
import { nextSeqId } from '../util/ids.js';
import { extractZip, safeEntryPath } from '../util/zip.js';
import { broadcast } from '../sse.js';

const router = asyncRouter();

function refOr404(jobId: string): jobs.JobRef {
  const ref = jobs.resolveJob(jobId);
  if (!ref) throw Object.assign(new Error(`잡 없음: ${jobId}`), { status: 404 });
  return ref;
}

/** 잡 + 파생 정보 (진행률, 단계 목록) */
async function jobView(ref: jobs.JobRef) {
  const job = await jobs.readJob(ref);
  if (!job) return null;
  return {
    ...job,
    progress: progressOf(job.menu, job.state),
    pipeline: statesFor(job.menu),
    downloading: isDownloading(job.id),
  };
}

router.get('/projects/:menu/:pid/jobs', async (req, res) => {
  const menu = z.enum(MENUS).parse(req.params.menu);
  const list = await jobs.listJobs(menu, req.params.pid);
  res.json(list.map((j) => ({ ...j, progress: progressOf(j.menu, j.state), pipeline: statesFor(j.menu) })));
});

router.post('/projects/:menu/:pid/jobs', async (req, res) => {
  const menu = z.enum(MENUS).parse(req.params.menu);
  const body = z.object({ title: z.string().min(1) }).parse(req.body);

  /*
    제품정보리뷰는 포맷이 잡이 아니라 **카테고리**에 붙는다. 그래서 새 잡은 만들자마자
    `format_selected`로 보낸다 — 안 그러면 `draft`에 갇힌다. 거기서 나가는 화면도 경로도
    없어서, 화면에는 해외영상 짜집기용 "영상 주소를 넣으세요" 패널만 떴다(2026-08-13).
  */
  if (menu === 'menu-b') {
    const project = await getProject(menu, req.params.pid);
    if (!project?.formatId) {
      throw Object.assign(
        new Error(`카테고리 "${req.params.pid}"에 고유 포맷이 없습니다. 포맷을 먼저 지정하세요`),
        { status: 400 },
      );
    }
  }

  const job = await jobs.createJob(menu, req.params.pid, body.title);
  if (menu === 'menu-b') {
    const ref = { menu, projectId: req.params.pid, jobId: job.id };
    return res.status(201).json(await jobs.advanceTo(ref, 'format_selected', 'server'));
  }
  res.status(201).json(job);
});

router.get('/jobs/active', async (_req, res) => {
  const active = await jobs.listActiveJobs();
  res.json(active.map((j) => ({ ...j, progress: progressOf(j.menu, j.state), pipeline: statesFor(j.menu) })));
});

router.get('/jobs/:jid', async (req, res) => {
  const view = await jobView(refOr404(req.params.jid));
  if (!view) return res.status(404).json({ error: '잡 없음' });
  res.json(view);
});

router.post('/jobs/:jid/transition', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ to: JobStateSchema }).parse(req.body);
  const job = await jobs.transition(ref, body.to as JobState, 'user');
  res.json(job);

  // 완료 처리 시 산출물을 사용자 폴더로 자동 내보내기
  if (body.to === 'done') {
    const settings = await loadSettings();
    if (settings.exportOnDone) {
      runExport(ref).catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        await jobs.logJobEvent(ref, { type: 'export.failed', error: msg });
        broadcast('export.failed', { jobId: ref.jobId, error: msg });
      });
    }
  }
});

/**
 * 영상 작업 삭제 — 소재·클립·대본·요청서·산출물이 한 폴더라 통째로 옮긴다.
 * 지우지 않고 workspace/.trash 로 옮기므로 응답의 trashed 경로로 되돌릴 수 있다.
 */
router.delete('/jobs/:jid', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const result = await trashJob(ref);
  res.json({ ok: true, ...result });
});

router.get('/jobs/:jid/events', async (req, res) => {
  const ref = refOr404(req.params.jid);
  try {
    const raw = await fsp.readFile(paths.jobEvents(ref.menu, ref.projectId, ref.jobId), 'utf8');
    const lines = raw.trim().split('\n').slice(-100).map((l) => JSON.parse(l));
    res.json(lines);
  } catch {
    res.json([]);
  }
});

// ── 소스 URL / 다운로드 ───────────────────────────────────────────

router.put('/jobs/:jid/sources', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ urls: z.array(z.string().url()).min(1) }).parse(req.body);
  const job = await jobs.mutateJob(ref, (j) => {
    const existing = new Set(j.sources.map((s) => s.url));
    // rednote 같은 별칭 도메인은 여기서 정식 주소로 고친다 — 중복 판정도 고친 주소로 해야
    // 같은 글을 두 도메인으로 넣었을 때 두 번 받지 않는다
    for (const raw of body.urls) {
      const url = normalizeSourceUrl(raw);
      if (existing.has(url)) continue;
      const id = nextSeqId('s', j.sources.map((s) => s.id));
      j.sources.push({ id, url, origin: 'url', status: 'queued', attempts: 0, progress: 0 });
      existing.add(url);
    }
  });
  // 소재를 넣기 시작하는 단계가 메뉴마다 다르다 — 틀리면 "전이 불가"로 터지고
  // 소재는 이미 들어간 뒤라 반쯤 된 상태가 남는다
  if (job.state === sourceEntryState(ref.menu)) {
    await jobs.transition(ref, 'collecting', 'server');
  }
  res.json(await jobView(ref));
});

router.post('/jobs/:jid/download/start', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '잡 없음' });
  if (job.state === 'collecting') await jobs.transition(ref, 'downloading', 'server');

  // 이미 전부 받아둔 잡이 이전 실행에서 멈춰 있었다면 여기서 풀어준다
  // (다운로드할 게 없으면 아래 downloadAll은 즉시 끝나므로 어느 쪽이든 전진한다)
  if (await reconcileDownloadState(ref)) {
    return res.json({ started: false, advanced: true });
  }

  // 비동기 실행 — 진행률은 SSE로 푸시. 실패해도 서버가 죽지 않도록 반드시 catch한다
  void downloadAll(settings, ref)
    .then(() => reconcileDownloadState(ref))
    .catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      // 콘솔에도 남긴다 — 안 그러면 events.ndjson을 직접 열어보기 전까지 아무 흔적이 없다
      console.error(`[download] ${ref.jobId} 실패:`, msg);
      await jobs.logJobEvent(ref, { type: 'download.failed', error: msg }).catch(() => {});
      broadcast('download.failed', { jobId: ref.jobId, error: msg });
    });
  res.json({ started: true });
});

/**
 * 이미 받아둔 영상 파일 첨부.
 * yt-dlp가 못 받는 사이트(쇼핑몰 상세페이지 등)는 사용자가 직접 받아 올리면 된다.
 * 큰 파일이 메모리에 통째로 올라오지 않도록 sources/ 폴더에 바로 쓴다
 * (같은 폴더 안에서 rename하므로 볼륨을 넘지 않는다).
 */
let uploadSeq = 0;
const sourceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const ref = jobs.resolveJob(req.params.jid);
      if (!ref) return cb(new Error(`잡 없음: ${req.params.jid}`), '');
      const dir = path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'sources');
      fsp.mkdir(dir, { recursive: true }).then(() => cb(null, dir), (e) => cb(e as Error, ''));
    },
    filename: (_req, file, cb) => cb(null, `upload-${Date.now()}-${uploadSeq++}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

router.post('/jobs/:jid/sources/upload', sourceUpload.array('files', 50), async (req, res) => {
  const ref = refOr404(req.params.jid);
  const files = (req.files ?? []) as Express.Multer.File[];
  if (!files.length) return res.status(400).json({ error: '파일이 없습니다' });
  const settings = await loadSettings();

  for (const f of files) {
    // multer는 파일명을 latin1로 넘긴다 — 한글 파일명이 깨지지 않게 되돌린다
    const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
    await attachSourceFile(settings, ref, f.path, original);
  }

  const job = await jobs.readJob(ref);
  if (job?.state === sourceEntryState(ref.menu)) {
    await jobs.transition(ref, 'collecting', 'server');
  }
  // 첨부 파일은 받을 것이 없으므로, 남은 URL도 없다면 바로 정리 단계로 보낸다
  await reconcileDownloadState(ref);
  res.json(await jobView(ref));
});

router.delete('/jobs/:jid/sources/:sid', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const job = await jobs.readJob(ref);
  const source = job?.sources.find((s) => s.id === req.params.sid);
  if (!source) return res.status(404).json({ error: '소스 없음' });
  if (source.status === 'downloading') {
    return res.status(400).json({ error: '다운로드 중에는 삭제할 수 없습니다' });
  }
  // 대본이 이 소재를 참조하고 있으면 지울 수 없다 (조립 때 소재를 찾지 못한다)
  if (job!.script.currentVersion > 0 && source.status === 'downloaded') {
    return res.status(400).json({
      error: '대본이 이미 작성된 소재는 삭제할 수 없습니다. 대본을 먼저 수정하세요',
    });
  }
  await removeSource(ref, req.params.sid);

  // 남은 소스가 전부 끝났다면 다음 단계로 보낸다. 안 그러면 실패한 소스를 지운 사용자가
  // "영상 다운로드" 화면에 갇힌다 — 받을 것이 없는데 진행 버튼도 없는 상태가 된다
  await reconcileDownloadState(ref);
  res.json(await jobView(ref));
});

router.post('/jobs/:jid/sources/:sid/retry', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  const source = job?.sources.find((s) => s.id === req.params.sid);
  if (source?.origin === 'file') {
    return res.status(400).json({ error: '첨부 파일은 재시도 대상이 아닙니다. 삭제 후 다시 첨부하세요' });
  }
  void retrySource(settings, ref, req.params.sid).catch((e) => {
    broadcast('source.error', {
      jobId: ref.jobId, sourceId: req.params.sid,
      error: e instanceof Error ? e.message : String(e),
    });
  });
  res.json({ started: true });
});

router.post('/jobs/:jid/sources/:sid/skip', async (req, res) => {
  const ref = refOr404(req.params.jid);
  await jobs.mutateJob(ref, (j) => {
    const s = j.sources.find((x) => x.id === req.params.sid);
    if (s) s.status = 'skipped';
  });
  res.json(await jobView(ref));
});

router.put('/jobs/:jid/sources/:sid/license-note', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ note: z.string() }).parse(req.body);
  await jobs.mutateJob(ref, (j) => {
    const s = j.sources.find((x) => x.id === req.params.sid);
    if (s) s.licenseNote = body.note;
  });
  res.json({ ok: true });
});

// ── 클립 ──────────────────────────────────────────────────────────

router.get('/jobs/:jid/clips', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const clips = await jobs.listClips(ref);
  res.json(
    clips.map((c) => ({
      ...c,
      frameUrls: c.frames.map((f) => toMediaUrl(fromWorkspaceRel(f.file))),
      cleanUrls: c.cleanVersions.map((v) => ({ v: v.v, url: toMediaUrl(v.filePath) })),
      selectedUrl: c.selectedVideo ? toMediaUrl(c.selectedVideo) : undefined,
    })),
  );
});

// ── 프레임 (남은 것이 곧 사용할 장면) ─────────────────────────────

/**
 * 필요 없는 프레임 삭제.
 * 남아 있는 프레임이 요청서의 소재 이미지가 되고 컷 구간 후보의 기준이 되므로,
 * 지우는 행위가 곧 "이 장면은 안 쓴다"는 선택이다.
 * 여러 장을 한 번에 지울 수 있다 — 한 장씩 왕복하면 수십 장을 정리하기 힘들다.
 */
router.delete('/jobs/:jid/clips/:cid/frames', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const raw = req.query.file;
  const files = z.array(z.string().min(1)).min(1)
    .parse(Array.isArray(raw) ? raw : [raw].filter(Boolean));
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });

  const targets = clip.frames.filter((f) => files.includes(f.file));
  if (!targets.length) return res.status(404).json({ error: '프레임 없음' });
  if (clip.frames.length - targets.length < 1) {
    return res.status(400).json({ error: '프레임을 전부 지울 수는 없습니다 — 존을 그릴 화면이 없어집니다' });
  }

  clip.frames = clip.frames.filter((f) => !files.includes(f.file));
  await jobs.writeClip(ref, clip);
  for (const t of targets) {
    await fsp.rm(fromWorkspaceRel(t.file), { force: true }).catch(() => {});
  }
  res.json(clip);
});

/**
 * 전체 프레임 불러오기.
 * 예전에 만든 클립은 프레임이 5장뿐이라 훑어보고 고를 것이 없다.
 * 지운 프레임을 되살릴 때도 쓴다 (지운 것은 파일까지 지워지므로 다시 뽑는 수밖에 없다).
 * 존 좌표는 원본 픽셀 기준이므로 정리본이 아니라 **원본 소스**에서 뽑는다.
 */
router.post('/jobs/:jid/clips/:cid/frames/reextract', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const settings = await loadSettings();
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  const job = await jobs.readJob(ref);
  const source = job?.sources.find((s) => s.id === clip.sourceId);
  if (!source?.filePath) return res.status(400).json({ error: '소스 파일 없음' });
  const input = fromWorkspaceRel(source.filePath);

  res.json({ started: true }); // 장면 감지가 전체 디코딩이라 오래 걸린다 — 진행은 SSE로

  void (async () => {
    const probe = clip.probe ?? (await probeVideo(settings, input));
    const framesDir = path.join(jobs.clipDir(ref, clip.id), 'frames');
    // 장수가 줄어들 수도 있으므로 통째로 지우고 새로 뽑는다
    await fsp.rm(framesDir, { recursive: true, force: true });
    const { frames, sceneTimes } = await extractFrames(settings, input, framesDir, probe.duration);

    // 그 사이 사용자가 존을 편집했을 수 있다 — 다시 읽어 프레임만 갈아끼운다
    const latest = (await jobs.readClip(ref, clip.id)) ?? clip;
    latest.probe = probe;
    latest.sceneTimes = sceneTimes;
    latest.frames = frames.map((f) => ({
      file: toWorkspaceRel(f.filePath),
      t: f.t,
      recommended: f.recommended,
    }));
    await jobs.writeClip(ref, latest);
    await jobs.logJobEvent(ref, { type: 'clip.frames_reextracted', clipId: clip.id, count: frames.length });
    broadcast('clip', { jobId: ref.jobId, clipId: clip.id });
  })().catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    await jobs.logJobEvent(ref, { type: 'clip.frames_failed', clipId: clip.id, error: msg }).catch(() => {});
    broadcast('frames.failed', { jobId: ref.jobId, clipId: clip.id, error: msg });
  });
});

/**
 * 남은 프레임 주변을 컷 구간으로 만든다.
 * 프레임은 한 시점이므로 앞뒤로 폭을 준다. 겹치면 하나로 합친다.
 */
router.post('/jobs/:jid/clips/:cid/segments/from-frames', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ padSec: z.number().min(0.5).max(10).default(1.5) }).parse(req.body ?? {});
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  if (!clip.frames.length) return res.status(400).json({ error: '남은 프레임이 없습니다' });

  clip.segments = segmentsFromFrames(
    clip.frames, clip.probe?.duration ?? 0, body.padSec, clip.sceneTimes,
  );
  await jobs.writeClip(ref, clip);
  res.json(clip);
});

/**
 * 영상 재생성 — 정리 단계의 마무리를 한 번에 끝낸다.
 *
 * 클립마다 같은 일을 반복하는 자리였다. 사용자가 하는 일은 **쓸 장면 고르기**뿐이고,
 * 나머지(자막·워터마크 지우기 → 고른 구간만 잇기 → 소리 빼기 → 대본으로 넘어가기)는
 * 기계가 한다.
 *
 * `zonesFrom`의 존은 **존이 없는 클립에만** 채운다 — 클립마다 공들여 그린 것을
 * 덮어쓰지 않기 위해서다. 좌표는 클립 해상도에 맞춰 환산한다.
 *
 * 만들어진 `selected.mp4`는 **보기 위한 결과물**이다. 조립은 원본 시각 기준의
 * `cleanVersions` + `segments`를 그대로 쓴다 — 잘라낸 영상에 원본 시각을 대면 어긋난다.
 */
router.post('/jobs/:jid/regenerate', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({
    zonesFrom: z.string().optional(),
    padSec: z.number().min(0.5).max(10).default(1.5),
  }).parse(req.body ?? {});

  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '작업 없음' });

  const clips = await jobs.listClips(ref);
  if (!clips.length) return res.status(400).json({ error: '클립이 없습니다' });
  // 프레임을 다 지운 클립이 있으면 만들 영상이 없다 — 도중에 멈추지 말고 미리 막는다
  const empty = clips.filter((c) => !c.frames.length).map((c) => c.id);
  if (empty.length) {
    return res.status(400).json({ error: `쓸 장면이 하나도 없는 클립이 있습니다: ${empty.join(', ')}` });
  }
  const template = body.zonesFrom ? clips.find((c) => c.id === body.zonesFrom) : undefined;
  if (body.zonesFrom && !template) return res.status(404).json({ error: '존을 가져올 클립 없음' });

  // 검출기 유무는 한 번만 본다 — 클립마다 확인하면 그 자체로 몇 초씩 먹는다
  const useOcr = await ocrAvailable(settings);
  // 제거 방식도 한 번만 정한다 — 클립마다 도구를 찾으면 그 자체로 시간을 먹는다
  const autoMethod = autoRemovalMethod();
  res.json({ started: true, clips: clips.length, autoDetect: useOcr }); // 즉시 응답, 진행은 SSE

  void (async () => {
    let done = 0;
    for (const clip of clips) {
      broadcast('regenerate.progress', {
        jobId: ref.jobId, clipId: clip.id, done, total: clips.length, phase: 'start',
      });

      const source = job.sources.find((s) => s.id === clip.sourceId);
      if (!source?.filePath) throw new Error(`${clip.id}: 소스 파일이 없습니다`);
      const outDir = jobs.clipDir(ref, clip.id);
      let footage = fromWorkspaceRel(source.filePath);

      /*
        존이 없는 클립은 글자를 직접 찾아 채운다. 검출기가 없으면 사용자가 그려둔
        존을 옮겨 쓰고, 그것도 없으면 자르기만 한다 — 어느 쪽이든 멈추지는 않는다.
      */
      if (clip.zones.length === 0 && clip.probe) {
        if (useOcr) {
          clip.zones = await detectTextZones(
            settings, footage, clip.probe,
            (line) => broadcast('regenerate.progress', { jobId: ref.jobId, clipId: clip.id, line }),
            1, autoMethod,
          );
        } else if (template && template.id !== clip.id) {
          clip.zones = scaleZones(template.zones, template.probe, clip.probe);
        }
      }

      /*
        컷 구간을 먼저 잡는다. 지울 대상을 여기서 좁히기 위해서다 — 최종 영상에
        안 나오는 자막을 지우는 것은 시간만 쓰고 그 자리를 문질러 놓는 일이다.
        고른 장면이 처음부터 깨끗하면 1차 제거를 통째로 건너뛴다 (제거 사다리 0순위).
      */
      clip.segments = segmentsFromFrames(
        clip.frames, clip.probe?.duration ?? 0, body.padSec, clip.sceneTimes,
      );
      const inCut = zonesInSegments(clip.zones, clip.segments);

      // 1차 제거 — 지울 존이 있을 때만. 없으면 원본을 그대로 잘라 쓴다
      if (inCut.some((z) => z.method !== 'inpaint')) {
        const r = await runTier1Clean(
          settings, { ...clip, zones: inCut }, footage, outDir,
          (line) => broadcast('regenerate.progress', { jobId: ref.jobId, clipId: clip.id, line }),
        );
        clip.cleanVersions.push({
          v: r.version, tier: 1, params: r.params, filePath: r.filePath,
          createdAt: new Date().toISOString(),
        });
        clip.currentCleanVersion = r.version;
        footage = r.filePath;
      }

      /*
        2차 제거 — 인페인팅으로 지정된 존이 고른 구간에 걸려 있을 때만.
        도구가 없으면 조용히 건너뛴다 (1차까지만 하고 넘어간다).
        쓰는 구간만 잘라 돌리고 원래 자리에 이어붙이므로 시간축은 그대로다.
      */
      const t2 = await runTier2Scoped(
        settings, { ...clip, zones: inCut }, footage, inCut, outDir,
        (line) => broadcast('regenerate.progress', { jobId: ref.jobId, clipId: clip.id, line }),
      );
      if (t2) {
        clip.cleanVersions.push({
          v: t2.version, tier: 2, params: `inpaint:${t2.provider}`, filePath: t2.filePath,
          createdAt: new Date().toISOString(),
        });
        clip.currentCleanVersion = t2.version;
        footage = t2.filePath;
      }

      clip.selectedVideo = await buildSelectedVideo(
        settings, footage, clip.segments, selectedPath(outDir),
        (line) => broadcast('regenerate.progress', { jobId: ref.jobId, clipId: clip.id, line }),
      );
      await jobs.writeClip(ref, clip);

      done++;
      broadcast('regenerate.progress', {
        jobId: ref.jobId, clipId: clip.id, done, total: clips.length, phase: 'done',
      });
    }

    await jobs.logJobEvent(ref, { type: 'clips.regenerated', count: clips.length });
    await jobs.advanceTo(ref, 'scripting', 'server');
    broadcast('regenerate.finished', { jobId: ref.jobId, clips: clips.length });
  })().catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    await jobs.logJobEvent(ref, { type: 'clips.regenerate_failed', error: msg }).catch(() => {});
    broadcast('regenerate.failed', { jobId: ref.jobId, error: msg });
  });
});

router.put('/jobs/:jid/clips/:cid/zones', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ zones: z.array(ZoneSchema) }).parse(req.body);
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  clip.zones = body.zones;
  await jobs.writeClip(ref, clip);
  res.json(clip);
});

/**
 * 이 클립의 자막 자리 자동 찾기 — 그려둔 존을 **버리고** 다시 잡는다.
 *
 * "영상 재생성"은 존이 없는 클립에만 채운다 (공들여 그린 것을 덮지 않기 위해서다).
 * 그래서 한 번 그리고 나면 검출기를 다시 태울 길이 없었다 — 이 경로가 그것이다.
 * 검출은 항상 **원본**을 본다. 지운 영상을 보면 이미 사라진 글자를 찾게 된다.
 */
router.post('/jobs/:jid/clips/:cid/zones/auto', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const settings = await loadSettings();
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  if (!clip.probe) return res.status(400).json({ error: '분석 전이라 영상 정보가 없습니다' });
  if (!(await ocrAvailable(settings))) {
    return res.status(400).json({
      error: '글자 검출기가 없습니다 — pip install rapidocr-onnxruntime (설정에서 파이썬 경로 확인)',
    });
  }
  const job = await jobs.readJob(ref);
  const source = job?.sources.find((s) => s.id === clip.sourceId);
  if (!source?.filePath) return res.status(400).json({ error: '소스 파일 없음' });

  clip.zones = await detectTextZones(
    settings, fromWorkspaceRel(source.filePath), clip.probe,
    (line) => broadcast('clean.progress', { jobId: ref.jobId, clipId: clip.id, line }),
    1, autoRemovalMethod(),
  );
  await jobs.writeClip(ref, clip);
  res.json(clip);
});

/**
 * 존이 실제로 나타나는 구간 자동 찾기.
 * 판정이 애매하면 구간 없이 점수만 돌려준다 — 틀린 구간을 자신 있게 주지 않는다.
 */
router.post('/jobs/:jid/clips/:cid/zones/detect', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({
    zone: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  }).parse(req.body);
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  if (!clip.probe) return res.status(400).json({ error: '분석 전이라 프레임이 없습니다' });
  if (clip.frames.length < 2) {
    return res.status(400).json({ error: '프레임이 2장 미만이라 구간을 찾을 수 없습니다' });
  }

  const settings = await loadSettings();
  const frames = clip.frames.map((f) => ({ t: f.t, filePath: fromWorkspaceRel(f.file) }));
  const result = await detectZoneRanges(settings, frames, body.zone, clip.probe.duration);
  res.json(result);
});

router.post('/jobs/:jid/clips/:cid/clean', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ tier: z.union([z.literal(1), z.literal(2)]) }).parse(req.body);
  const settings = await loadSettings();
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });

  const job = await jobs.readJob(ref);
  const source = job?.sources.find((s) => s.id === clip.sourceId);
  if (!source?.filePath) return res.status(400).json({ error: '소스 파일 없음' });
  const inputPath =
    clip.currentCleanVersion && body.tier === 2
      ? clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion)!.filePath
      : fromWorkspaceRel(source.filePath);
  const outDir = jobs.clipDir(ref, clip.id);

  res.json({ started: true }); // 즉시 응답, 진행은 SSE

  try {
    if (body.tier === 1) {
      const r = await runTier1Clean(settings, clip, inputPath, outDir, (line) =>
        broadcast('clean.progress', { jobId: ref.jobId, clipId: clip.id, line }),
      );
      clip.cleanVersions.push({
        v: r.version, tier: 1, params: r.params, filePath: r.filePath,
        createdAt: new Date().toISOString(),
      });
      clip.currentCleanVersion = r.version;
    } else {
      const provider = await getAvailableInpaintProvider();
      if (!provider) {
        throw new Error(
          'AI 제거 도구가 없습니다 — 설정에서 VSR 저장소 폴더를 지정하거나 iopaint를 설치하세요 '
          + '(tools/install-inpaint.md)',
        );
      }
      const zones = clip.zones.filter((z) => z.method === 'inpaint');
      if (!zones.length) throw new Error('inpaint 방식으로 지정된 존이 없습니다');
      const version = (clip.cleanVersions.at(-1)?.v ?? 0) + 1;
      const outPath = path.join(outDir, `clean_v${version}.mp4`);
      await provider.run({
        settings, clip, inputVideo: inputPath, zones,
        workDir: path.join(outDir, 'inpaint_tmp'), outPath,
        onProgress: (msg) => broadcast('clean.progress', { jobId: ref.jobId, clipId: clip.id, line: msg }),
      });
      clip.cleanVersions.push({
        v: version, tier: 2, params: `inpaint:${provider.name}`, filePath: outPath,
        createdAt: new Date().toISOString(),
      });
      clip.currentCleanVersion = version;
    }
    await jobs.writeClip(ref, clip);
    await jobs.logJobEvent(ref, { type: 'clip.cleaned', clipId: clip.id, version: clip.currentCleanVersion });
    broadcast('clean.done', { jobId: ref.jobId, clipId: clip.id, version: clip.currentCleanVersion });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await jobs.logJobEvent(ref, { type: 'clip.clean_failed', clipId: clip.id, error: msg });
    broadcast('clean.failed', { jobId: ref.jobId, clipId: clip.id, error: msg });
  }
});

router.post('/jobs/:jid/clips/:cid/restore', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ version: z.number().int() }).parse(req.body);
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  if (!clip.cleanVersions.some((v) => v.v === body.version)) {
    return res.status(400).json({ error: '해당 버전 없음' });
  }
  clip.currentCleanVersion = body.version;
  await jobs.writeClip(ref, clip);
  res.json(clip);
});

router.put('/jobs/:jid/clips/:cid/segments', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ segments: z.array(SegmentSchema) }).parse(req.body);
  const settings = await loadSettings();
  const clip = await jobs.readClip(ref, req.params.cid);
  if (!clip) return res.status(404).json({ error: '클립 없음' });
  clip.segments = body.segments;
  await jobs.writeClip(ref, clip);

  // 한 소스가 오래 연속 노출되면 재사용 콘텐츠로 분류될 위험이 커진다.
  // 저장은 막지 않고 경고만 돌려준다 — 판단은 사용자 몫이다.
  const limit = settings.maxClipExposureSec;
  const overLong = clip.segments
    .filter((s) => s.used && s.out - s.in > limit)
    .map((s) => ({ id: s.id, seconds: Number((s.out - s.in).toFixed(1)) }));

  res.json({
    ...clip,
    warnings: overLong.length
      ? [{
          type: 'exposure',
          limit,
          segments: overLong,
          message:
            `${overLong.length}개 구간이 ${limit}초를 넘습니다. ` +
            `원본을 길게 연속 노출하면 재사용 콘텐츠로 분류될 위험이 커집니다. ` +
            `구간을 나누거나 사이에 텍스트 카드를 넣으세요.`,
        }]
      : [],
  });
});

// ── 대본 ──────────────────────────────────────────────────────────

router.get('/jobs/:jid/script', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '잡 없음' });
  const version = req.query.version ? Number(req.query.version) : job.script.currentVersion;
  if (!version) return res.json(null);
  res.json(await jobs.readScript(ref, version));
});

router.post('/jobs/:jid/script/approve', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const job = await jobs.mutateJob(ref, (j) => {
    if (!j.script.currentVersion) throw new Error('승인할 대본이 없습니다');
    j.script.approved = true;
  });
  // 승인 후엔 다음 실제 작업 단계로 보낸다.
  // menu-a는 곧장 음성이다 — 쓸 구간은 장면 고르기에서 이미 정해졌다
  await jobs.advanceTo(ref, job.menu === 'menu-a' ? 'voicing' : 'scening', 'user');
  await jobs.logJobEvent(ref, { type: 'script.approved', version: job.script.currentVersion });
  res.json(await jobView(ref));
});

// ── 편집 재료 (짤방·효과음) ───────────────────────────────────────

/**
 * 이 편에 쓸 재료 담기.
 *
 * 자료실(`/api/assets`)에서 고른 id를 그대로 들고 있다가 캡컷 재료 묶음에 같이 넣는다.
 * **여기서 파일이 있는지 확인하지 않는다** — 담아둔 뒤 자료실에서 지울 수 있고, 그때
 * 잡이 통째로 못 쓰게 되면 곤란하다. 없어진 것은 묶는 시점에 조용히 빠진다.
 */
router.put('/jobs/:jid/assets', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ assets: z.array(z.string().max(300)).max(60) }).parse(req.body);
  await jobs.mutateJob(ref, (j) => {
    j.assets = [...new Set(body.assets)];
  });
  res.json(await jobView(ref));
});

// ── 저작권 확인 게이트 ────────────────────────────────────────────

router.post('/jobs/:jid/rights-confirm', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ confirmed: z.boolean() }).parse(req.body);
  await jobs.mutateJob(ref, (j) => {
    j.rightsConfirmed = body.confirmed;
  });
  await jobs.logJobEvent(ref, { type: 'rights.confirmed', confirmed: body.confirmed });
  res.json({ ok: true });
});

/**
 * 발행 기록 — 유튜브 주소를 받아 잡과 성과 대장을 잇는다.
 *
 * 발행 자체는 사람이 유튜브에서 한다. 앱이 할 수 있는 건 **그 편이 어느 잡이었는지**를
 * 붙잡아 두는 것뿐이고, 그게 없으면 대장의 행이 어떤 대본에서 나왔는지 영영 모른다.
 * 지표는 나중에 `/metrics/refresh`가 채운다 — 발행 직후 숫자는 아직 뜻이 없다.
 */
router.post('/jobs/:jid/publish', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({
    videoId: z.string().min(1),
    publishedAt: z.string().optional(),
    hookSeed: z.string().optional(),
  }).parse(req.body);

  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '작업 없음' });
  // 주소를 통째로 붙여넣어도 받는다 — 사람은 11자리 id를 따로 꺼내지 않는다
  const videoId = body.videoId.match(/[\w-]{11}/)?.[0] ?? body.videoId;
  const publishedAt = body.publishedAt ?? new Date().toISOString().slice(0, 10);

  await jobs.mutateJob(ref, (j) => {
    j.videoId = videoId;
    j.publishedAt = publishedAt;
    if (body.hookSeed) j.hookSeed = body.hookSeed;
  });

  const row = await upsertRow({
    slug: ref.jobId,
    video_id: videoId,
    title_published: job.title,
    published: publishedAt,
    hook_seed: body.hookSeed ?? job.hookSeed ?? '',
    chips: '0', // 음성=자막이라 스펙 칩을 쓰지 않는다
  });
  await jobs.logJobEvent(ref, { type: 'publish.recorded', videoId, publishedAt });
  res.json({ ok: true, row });
});

// ── 음성 (타입캐스트 API 또는 씬별 파일 첨부) ─────────────────────

/** 두 합성 경로의 사용 가능 여부와 목소리 목록 — 화면이 이걸 보고 고르게 한다 */
router.get('/tts/engine', async (_req, res) => {
  const settings = await loadSettings();
  const typecastReady = await hasKey('typecast');
  let voices: unknown[] = [];
  let error: string | undefined;
  if (typecastReady) {
    try {
      voices = await listTypecastVoices();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Voicebox는 사용자가 켜 둔 로컬 서버다 — 꺼져 있어도 오류가 아니라 "없음"으로 답한다
  const voiceboxReady = await voiceboxAvailable(settings);
  let voiceboxProfiles: unknown[] = [];
  if (voiceboxReady) {
    voiceboxProfiles = await listVoiceboxProfiles(settings).catch(() => []);
  }

  res.json({
    provider: settings.voiceProvider,
    typecastReady, typecastVoices: voices, error,
    voiceboxReady, voiceboxProfiles, voiceboxUrl: settings.voiceboxUrl,
  });
});

/** 캐릭터 미리듣기 — 짧은 샘플 문장을 합성해 오디오로 바로 반환 */
router.post('/tts/preview', async (req, res) => {
  const body = z.object({
    voiceId: z.string().min(1),
    text: z.string().default('안녕하세요, 이 목소리로 나레이션을 만들어 드릴게요.'),
    emotion: z.string().optional(),
  }).parse(req.body ?? {});
  try {
    // 미리듣기도 실제 합성과 같은 속도로 들려줘야 판단이 맞는다
    const settings = await loadSettings();
    const audio = await typecastSynthesize(body.text, body.voiceId, {
      emotion: body.emotion,
      tempo: settings.speechRate,
    });
    res.setHeader('Content-Type', AUDIO_MIME);
    res.send(audio);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** 씬별 음성 파일 첨부 — 첨부된 씬은 합성을 건너뛴다 */
const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/jobs/:jid/voice/upload', voiceUpload.single('file'), async (req, res) => {
  const ref = refOr404(req.params.jid);
  const sceneId = z.string().min(1).parse(req.body?.sceneId);
  const file = req.file;
  if (!file) return res.status(400).json({ error: '파일이 없습니다' });

  const voiceDir = path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'voice');
  const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const fileName = await saveSceneVoiceFile(voiceDir, sceneId, file.buffer, original);
  await jobs.mutateJob(ref, (j) => {
    j.sceneVoiceFiles[sceneId] = fileName;
    j.voiceEngine = 'file';
  });
  await jobs.logJobEvent(ref, { type: 'voice.uploaded', sceneId, fileName });
  res.json({ sceneId, fileName });
});

router.delete('/jobs/:jid/voice/upload/:sceneId', async (req, res) => {
  const ref = refOr404(req.params.jid);
  await jobs.mutateJob(ref, (j) => {
    delete j.sceneVoiceFiles[req.params.sceneId];
  });
  res.json({ ok: true });
});

router.post('/jobs/:jid/tts', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({
    typecastVoiceId: z.string().optional(), // 타입캐스트 캐릭터
    emotion: z.string().optional(), // 감정 프리셋
  }).parse(req.body ?? {});
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '잡 없음' });
  if (!job.script.currentVersion || !job.script.approved) {
    return res.status(400).json({ error: '승인된 대본이 필요합니다' });
  }
  const script = await jobs.readScript(ref, job.script.currentVersion);
  if (!script) return res.status(400).json({ error: '대본 파일 없음' });

  const typecastVoiceId = body.typecastVoiceId ?? job.typecastVoiceId ?? settings.typecastVoiceId;
  const typecastEmotion = body.emotion ?? job.typecastEmotion;

  /*
    모든 씬에 파일이 첨부됐으면 합성 없이 진행할 수 있다.
    합성이 필요할 때 무엇을 확인할지는 **고른 방식마다 다르다** — 타입캐스트는 캐릭터와 API 키,
    Voicebox는 목소리와 서버가 떠 있는지다. 여기서 막지 않으면 씬을 몇 개 만든 뒤에 터진다.
  */
  const allUploaded = script.scenes.every((s) => job.sceneVoiceFiles[s.sceneId]);
  if (!allUploaded && settings.voiceProvider === 'voicebox') {
    if (!settings.voiceboxProfileId) {
      return res.status(400).json({ error: 'Voicebox 목소리를 설정에서 고르세요' });
    }
    if (!(await voiceboxAvailable(settings))) {
      return res.status(400).json({
        error: `Voicebox 서버에 닿지 않습니다 (${settings.voiceboxUrl}). ` +
          'voicebox-server를 켠 뒤 다시 시도하세요',
      });
    }
  } else if (!allUploaded) {
    if (!typecastVoiceId) {
      return res.status(400).json({
        error: '타입캐스트 캐릭터를 선택하거나, 음성이 없는 씬에 파일을 첨부하세요',
      });
    }
    if (!(await hasKey('typecast'))) {
      return res.status(400).json({
        error: '타입캐스트 API 키가 없습니다. API 키 메뉴에서 등록하거나 씬별 음성 파일을 첨부하세요',
      });
    }
  }

  const voiceDir = path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'voice');

  res.json({ started: true });
  try {
    await jobs.advanceTo(ref, 'voicing');
    await jobs.mutateJob(ref, (j) => {
      j.typecastVoiceId = typecastVoiceId;
      j.typecastEmotion = typecastEmotion;
      j.voiceEngine = allUploaded ? 'file' : 'typecast';
    });
    await synthesizeNarration({
      settings,
      script,
      voiceDir,
      jobId: ref.jobId,
      typecastVoiceId,
      typecastEmotion,
      sceneVoiceFiles: job.sceneVoiceFiles,
    });
    await jobs.logJobEvent(ref, {
      type: 'tts.done',
      engine: allUploaded ? 'file' : 'typecast',
      scenes: script.scenes.length,
    });
    broadcast('tts.done', { jobId: ref.jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await jobs.logJobEvent(ref, { type: 'tts.failed', error: msg });
    broadcast('tts.failed', { jobId: ref.jobId, error: msg });
  }
});

// ── 조립 ──────────────────────────────────────────────────────────

router.post('/jobs/:jid/assemble', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const body = z.object({ burnSubtitles: z.boolean().optional() }).parse(req.body ?? {});
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '잡 없음' });
  if (!job.rightsConfirmed && job.menu === 'menu-a') {
    return res.status(400).json({ error: '조립 전에 소스 영상 사용 권리 확인이 필요합니다' });
  }
  if (!job.script.currentVersion) return res.status(400).json({ error: '대본 없음' });
  const script = await jobs.readScript(ref, job.script.currentVersion);
  if (!script) return res.status(400).json({ error: '대본 파일 없음' });

  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  const timings = await readJson<SceneTiming[]>(path.join(jobDir, 'voice', 'timing.json'));
  if (!timings) return res.status(400).json({ error: 'TTS 타이밍 없음 — 음성을 먼저 생성하세요' });

  res.json({ started: true });
  try {
    await jobs.advanceTo(ref, 'assembling');
    const clips = await jobs.listClips(ref);
    const version = (job.output.currentVersion ?? 0) + 1;
    /*
      대본이 가리키는 짤·효과음의 실제 경로를 여기서 풀어 넘긴다.
      조립은 자료실을 직접 뒤지지 않는다 — 자료실이 없는 환경(하네스)에서도 돌아야 한다.
      자료실에서 지워진 id는 여기서 그냥 빠지고, 조립은 그 씬을 짤 없이 만든다.
    */
    const used = await resolveAssets(usedAssetIds(job.assets, script.scenes));
    const assetPaths = Object.fromEntries(
      used.map((a) => [a.id, fromWorkspaceRel(a.file)]),
    );
    const { path: finalPath, cuts } = await assembleFinal(settings, {
      menu: ref.menu, script, timings, clips, jobDir,
      resolveWorkspacePath: fromWorkspaceRel,
      burnSubtitles: body.burnSubtitles ?? settings.burnSubtitles,
      burnDisclosure: settings.burnDisclosure,
      version,
      headline: script.title,
      assetPaths,
      // 출처 게이트가 볼 기록. 잡에 담은 것 + 씬이 가리키는 것이 한 목록이다
      assets: used,
    });
    await jobs.mutateJob(ref, (j) => { j.output.currentVersion = version; });
    const j2 = await jobs.readJob(ref);
    if (j2?.state === 'assembling') await jobs.advanceTo(ref, 'review');
    /*
      컷 계획을 같이 남긴다 — 컷 조각은 렌더가 끝나면 지워져서, 나간 편이 씬 하나를
      몇 컷으로 쪼갰고 소재를 몇 개 썼는지 되짚을 길이 여기밖에 없다.
      `sources`가 1인 씬은 컷만 늘고 화면은 안 바뀐 씬이다.

      **소재 출처도 같이 남긴다** (2026-08-26). 자료실의 자료는 나중에 지워지거나 출처가
      고쳐질 수 있는데, 발행된 편이 무엇을 어디서 받아 썼는지는 그때 값이어야 한다.
      `transform`은 사람이 적은 메모가 아니라 **그때 설정에서 계산한 값**이다.
    */
    await jobs.logJobEvent(ref, {
      type: 'assemble.done',
      version,
      finalPath,
      cuts,
      assets: assetLedgerRows(used, transformSummary(settings)),
    });
    broadcast('assemble.done', { jobId: ref.jobId, version, url: toMediaUrl(finalPath) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await jobs.logJobEvent(ref, { type: 'assemble.failed', error: msg });
    broadcast('assemble.failed', { jobId: ref.jobId, error: msg });
  }
});

router.get('/jobs/:jid/output', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '잡 없음' });
  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  const out: { finalUrl?: string; uploadKit?: string } = {};
  if (job.output.currentVersion) {
    out.finalUrl = toMediaUrl(path.join(jobDir, 'output', `final_v${job.output.currentVersion}.mp4`));
  }
  try {
    out.uploadKit = await fsp.readFile(path.join(jobDir, 'output', 'upload-kit.md'), 'utf8');
  } catch { /* 없으면 생략 */ }
  res.json(out);
});

// ── 내보내기 (제품별 별도 폴더) ───────────────────────────────────

/** 내보내기 대상 폴더 경로 미리보기 */
/**
 * 캡컷 재료 묶음 내려받기.
 *
 * 웹에서 합치면 자막·음성·좌우반전·그레이딩·확대가 설정대로 걸린 완성본이 나온다.
 * 직접 편집하고 싶을 때 쓰는 다른 갈래다 — 캡컷에는 공식 연동 API가 없으므로
 * **끌어다 놓을 재료**를 이름 순서로 만들어 준다.
 */
router.get('/jobs/:jid/download/capcut', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '작업 없음' });
  if (!job.script.currentVersion) {
    return res.status(400).json({ error: '대본이 아직 없습니다' });
  }
  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  const script = await jobs.readScript(ref, job.script.currentVersion);
  if (!script) return res.status(400).json({ error: '대본을 읽지 못했습니다' });
  const timings = (await readJson<SceneTiming[]>(path.join(jobDir, 'voice', 'timing.json'))) ?? [];
  const clips = await jobs.listClips(ref);

  const entries: Array<{ name: string; data: Buffer }> = [];
  for (const item of planCapcut({
    settings, job, productName: ref.projectId, jobDir, script, timings, clips,
    // 담아둔 뒤 자료실에서 지운 것은 여기서 조용히 빠진다 (`resolveAssets`)
    assets: await resolveAssets(job.assets),
  })) {
    if (item.text !== undefined) {
      entries.push({ name: item.name, data: Buffer.from(item.text, 'utf8') });
      continue;
    }
    const data = await fsp.readFile(item.src!).catch(() => null);
    if (data) entries.push({ name: item.name, data });
  }
  if (!entries.length) return res.status(404).json({ error: '아직 담을 것이 없습니다' });

  const zip = createZip(entries);
  res.type('application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${ref.projectId}_캡컷.zip`)}`);
  res.setHeader('Content-Length', String(zip.length));
  res.end(zip);
});

/** 한 번에 묶어 내려보낼 수 있는 크기 — 넘으면 폴더 내보내기로 안내한다 */
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

/**
 * 산출물 묶음 내려받기 — 영상·음성·대본을 종류별로 따로.
 *
 * 폴더 내보내기(`POST /export`)는 **이 PC의 폴더**로 복사한다. 브라우저로 쓰는 사람에게는
 * 그 폴더가 없을 수도 있고, 원하는 것 하나만 받고 싶을 때가 많다. 같은 목록(`planExport`)에서
 * 골라 내려보내므로 폴더에 있는 것과 받은 것이 다르지 않다.
 *
 * 파일이 하나면 그대로, 여럿이면 zip으로 묶는다 — mp4 한 개를 zip으로 받게 하지 않는다.
 */
router.get('/jobs/:jid/download/:kind', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const kind = req.params.kind as keyof typeof EXPORT_DIRS;
  const dir = EXPORT_DIRS[kind];
  if (!dir) return res.status(400).json({ error: `모르는 묶음: ${req.params.kind}` });

  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) return res.status(404).json({ error: '작업 없음' });
  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  const script = job.script.currentVersion
    ? await jobs.readScript(ref, job.script.currentVersion) : null;
  const timings = await readJson<SceneTiming[]>(path.join(jobDir, 'voice', 'timing.json'));
  const clips = await jobs.listClips(ref);

  const items = (await planExport({
    settings, job, productName: ref.projectId, jobDir, script, timings, clips,
    assets: await resolveAssets(usedAssetIds(job.assets, script?.scenes ?? [])),
  })).filter((i) => i.dir === dir);

  /*
    목록에는 있어도 아직 안 만들어진 것이 있다 — 실제로 있는 것만 담는다.

    묶는 동안 메모리에 다 올라간다. 정리본 8개가 63MB인 것을 봤는데, 긴 소재가 여럿이면
    수백 MB가 될 수 있어 상한을 둔다 — 로컬 서버가 메모리로 죽는 것보다 안내가 낫다.
  */
  const entries: Array<{ name: string; data: Buffer }> = [];
  let bytes = 0;
  for (const i of items) {
    if (i.text !== undefined) {
      entries.push({ name: i.name, data: Buffer.from(i.text, 'utf8') });
      continue;
    }
    const data = await fsp.readFile(i.src!).catch(() => null);
    if (!data) continue;
    bytes += data.length;
    if (bytes > MAX_DOWNLOAD_BYTES) {
      return res.status(413).json({
        error: `${dir}이(가) ${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB를 넘습니다 — `
          + '「제품 폴더로 내보내기」를 쓰세요 (복사라 크기 제한이 없습니다)',
      });
    }
    entries.push({ name: i.name, data });
  }
  if (!entries.length) {
    return res.status(404).json({ error: `${dir}에 아직 받을 것이 없습니다` });
  }

  // 한글 파일명은 RFC 5987로 넘긴다 — 그냥 넣으면 브라우저가 깨뜨린다
  const send = (name: string, body: Buffer) => {
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  };

  if (entries.length === 1) {
    res.type(path.extname(entries[0].name) || 'application/octet-stream');
    return send(path.basename(entries[0].name), entries[0].data);
  }
  res.type('application/zip');
  return send(`${ref.projectId}_${dir}.zip`, createZip(entries));
});

router.get('/jobs/:jid/export', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  res.json({
    targetDir: productDir(settings, ref.projectId),
    exportedAt: job?.exportedAt,
    includeSources: settings.exportIncludeSources,
  });
});

router.post('/jobs/:jid/export', async (req, res) => {
  const ref = refOr404(req.params.jid);
  try {
    const result = await runExport(ref);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** 잡 산출물을 사용자 폴더로 복사. 완료 전환 시에도 자동 호출된다 */
export async function runExport(ref: jobs.JobRef) {
  const settings = await loadSettings();
  const job = await jobs.readJob(ref);
  if (!job) throw new Error('잡 없음');
  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  const script = job.script.currentVersion ? await jobs.readScript(ref, job.script.currentVersion) : null;
  const timings = await readJson<SceneTiming[]>(path.join(jobDir, 'voice', 'timing.json'));
  const clips = await jobs.listClips(ref);

  const result = await exportJob({
    settings, job, productName: ref.projectId, jobDir, script, timings, clips,
    assets: await resolveAssets(usedAssetIds(job.assets, script?.scenes ?? [])),
  });
  await jobs.mutateJob(ref, (j) => { j.exportedAt = new Date().toISOString(); });
  await jobs.logJobEvent(ref, {
    type: 'export.done',
    dir: result.rootDir,
    files: result.copied.length,
  });
  broadcast('export.done', { jobId: ref.jobId, dir: result.rootDir, count: result.copied.length });
  return result;
}

// ── 제품자료 (작업마다 따로) ──────────────────────────────────────

function originalName(file: Express.Multer.File): string {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}

/**
 * 폴더째 올리면 파일명에 상대경로가 들어온다 (`캡처/사양표.png`).
 * 그 구조를 그대로 살려서 저장한다 — 파일이 수십 개일 때 폴더가 곧 분류다.
 */
function relativeDir(file: Express.Multer.File): string {
  const rel = safeEntryPath(originalName(file));
  if (!rel) return '';
  const dir = path.posix.dirname(rel);
  if (dir === '.' || dir === '/') return '';
  return dir.split('/').map((s) => slugify(s)).join(path.sep);
}

const productUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // 여기서는 404를 던질 수 없다 — 없는 작업이면 에러로 넘겨 업로드를 중단시킨다
      const ref = jobs.resolveJob(req.params.jid);
      if (!ref) return cb(new Error('작업 없음'), '');
      const dir = path.join(paths.product(ref.menu, ref.projectId, ref.jobId), relativeDir(file));
      fsp.mkdir(dir, { recursive: true }).then(() => cb(null, dir), (e) => cb(e as Error, ''));
    },
    filename: (_req, file, cb) => {
      const base = path.posix.basename(originalName(file).replace(/\\/g, '/'));
      const ext = path.extname(base);
      cb(null, `${slugify(path.basename(base, ext))}${ext}`);
    },
  }),
  // 상세페이지 캡처를 폴더째 올리는 경우가 있어 장수를 넉넉히 잡는다
  limits: { fileSize: 100 * 1024 * 1024, files: 300 },
});

router.post('/jobs/:jid/product/files', productUpload.array('files'), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const uploaded: string[] = [];
  const errors: string[] = [];

  for (const f of files) {
    // 압축 파일을 그대로 두면 AI가 열지 못한다 (붙여넣기·API 방식에는 해제 수단이 없다).
    // 풀어서 같은 이름의 폴더에 넣고 압축 파일 자체는 지운다
    if (/\.zip$/i.test(f.filename)) {
      const root = path.dirname(f.path);
      const fallback = path.basename(f.filename, path.extname(f.filename));
      try {
        const written = await extractZip(await fsp.readFile(f.path), root, fallback);
        if (!written.length) throw new Error('압축 안에 쓸 만한 파일이 없습니다');
        uploaded.push(...written);
        await fsp.rm(f.path, { force: true });
      } catch (e) {
        // 못 푼 압축은 지우지 않고 남긴다 — 사용자가 다시 올리지 않아도 되게
        errors.push(`${f.filename}: ${e instanceof Error ? e.message : String(e)}`);
        uploaded.push(f.filename);
      }
      continue;
    }
    uploaded.push(f.filename);
  }
  res.json({ uploaded, errors });
});

/** 잘못 올린 자료 정리 — 폴더째 올리면 필요 없는 파일이 섞여 온다 */
router.delete('/jobs/:jid/product/files', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const rel = safeEntryPath(z.string().min(1).parse(req.query.file));
  if (!rel) return res.status(400).json({ error: '잘못된 경로' });
  if (rel === 'product.json') return res.status(400).json({ error: 'product.json은 여기서 지울 수 없습니다' });
  const target = path.join(paths.product(ref.menu, ref.projectId, ref.jobId), rel);
  await fsp.rm(target, { recursive: true, force: true });
  res.json({ ok: true });
});

router.get('/jobs/:jid/product', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const product = await readProduct(ref);
  const files = await listProductFiles(ref);
  const productDir = paths.product(ref.menu, ref.projectId, ref.jobId);
  res.json({
    product,
    files: files.map((f) => ({ name: f, url: toMediaUrl(path.join(productDir, f)) })),
  });
});

router.put('/jobs/:jid/product', async (req, res) => {
  const ref = refOr404(req.params.jid);
  const product = ProductSchema.parse(req.body);
  await writeProduct(ref, product);
  res.json({ ok: true });
});

export default router;

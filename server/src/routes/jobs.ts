import { asyncRouter } from '../util/asyncRouter.js';
import multer from 'multer';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import { MENUS, type JobState } from '@shared/constants';
import { JobStateSchema, ZoneSchema, SegmentSchema } from '@shared/types';
import * as jobs from '../store/jobs.js';
import { loadSettings, paths, toMediaUrl, fromWorkspaceRel, toWorkspaceRel } from '../store/workspace.js';
import { probeVideo, extractFrames } from '../pipeline/probe.js';
import { progressOf, statesFor } from '../pipeline/stateMachine.js';
import {
  downloadAll, retrySource, isDownloading, attachSourceFile, removeSource, reconcileDownloadState,
} from '../pipeline/downloadQueue.js';
import { runTier1Clean } from '../pipeline/cleaner.js';
import { getAvailableInpaintProvider } from '../pipeline/inpaint.js';
import { synthesizeNarration, saveSceneVoiceFile, type SceneTiming } from '../pipeline/tts.js';
import {
  listVoices as listTypecastVoices, synthesize as typecastSynthesize, AUDIO_MIME,
} from '../pipeline/voice/typecast.js';
import { assembleFinal } from '../pipeline/assemble.js';
import { exportJob, productDir } from '../pipeline/exporter.js';
import { hasKey } from '../store/secrets.js';
import { readJson } from '../util/fsx.js';
import { nextSeqId } from '../util/ids.js';
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
  const job = await jobs.createJob(menu, req.params.pid, body.title);
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
    for (const url of body.urls) {
      if (existing.has(url)) continue;
      const id = nextSeqId('s', j.sources.map((s) => s.id));
      j.sources.push({ id, url, origin: 'url', status: 'queued', attempts: 0, progress: 0 });
      existing.add(url);
    }
  });
  if (job.state === 'draft') await jobs.transition(ref, 'collecting', 'server');
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
  if (job?.state === 'draft') await jobs.transition(ref, 'collecting', 'server');
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
    const frames = await extractFrames(settings, input, framesDir, probe.duration);

    // 그 사이 사용자가 존을 편집했을 수 있다 — 다시 읽어 프레임만 갈아끼운다
    const latest = (await jobs.readClip(ref, clip.id)) ?? clip;
    latest.probe = probe;
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
  const duration = clip.probe?.duration ?? 0;
  const picked = clip.frames;
  if (!picked.length) return res.status(400).json({ error: '남은 프레임이 없습니다' });

  const ranges: Array<{ in: number; out: number }> = [];
  for (const f of [...picked].sort((a, b) => a.t - b.t)) {
    const start = Math.max(0, f.t - body.padSec);
    const end = duration ? Math.min(duration, f.t + body.padSec) : f.t + body.padSec;
    const last = ranges[ranges.length - 1];
    if (last && start <= last.out) last.out = Math.max(last.out, end);
    else ranges.push({ in: start, out: end });
  }
  clip.segments = ranges.map((r, i) => ({
    id: `g${i + 1}`,
    in: Number(r.in.toFixed(2)),
    out: Number(r.out.toFixed(2)),
    note: '남은 프레임 기준',
    used: true,
  }));
  await jobs.writeClip(ref, clip);
  res.json(clip);
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
      if (!provider) throw new Error('AI 인페인팅 도구가 설치되어 있지 않습니다 (pip install iopaint)');
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
  // 승인 후엔 다음 실제 작업 단계로 보낸다 (menu-a는 컷 선택, menu-b는 씬 이미지)
  await jobs.advanceTo(ref, job.menu === 'menu-a' ? 'trimming' : 'scening', 'user');
  await jobs.logJobEvent(ref, { type: 'script.approved', version: job.script.currentVersion });
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

// ── 음성 (타입캐스트 API 또는 씬별 파일 첨부) ─────────────────────

/** 타입캐스트 사용 가능 여부 + 캐릭터 목록 */
router.get('/tts/engine', async (_req, res) => {
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
  res.json({ typecastReady, typecastVoices: voices, error });
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

  // 모든 씬에 파일이 첨부됐으면 합성 없이 진행할 수 있다
  const allUploaded = script.scenes.every((s) => job.sceneVoiceFiles[s.sceneId]);
  if (!typecastVoiceId && !allUploaded) {
    return res.status(400).json({
      error: '타입캐스트 캐릭터를 선택하거나, 음성이 없는 씬에 파일을 첨부하세요',
    });
  }
  if (!allUploaded && !(await hasKey('typecast'))) {
    return res.status(400).json({
      error: '타입캐스트 API 키가 없습니다. API 키 메뉴에서 등록하거나 씬별 음성 파일을 첨부하세요',
    });
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
    const finalPath = await assembleFinal(settings, {
      script, timings, clips, jobDir,
      resolveWorkspacePath: fromWorkspaceRel,
      burnSubtitles: body.burnSubtitles ?? settings.burnSubtitles,
      burnDisclosure: settings.burnDisclosure,
      version,
    });
    await jobs.mutateJob(ref, (j) => { j.output.currentVersion = version; });
    const j2 = await jobs.readJob(ref);
    if (j2?.state === 'assembling') await jobs.advanceTo(ref, 'review');
    await jobs.logJobEvent(ref, { type: 'assemble.done', version, finalPath });
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

export default router;

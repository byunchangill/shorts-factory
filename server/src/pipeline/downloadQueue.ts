import path from 'node:path';
import fsp from 'node:fs/promises';
import pLimit from 'p-limit';
import type { Settings, SourceUrl, Clip } from '@shared/types';
import { ClipSchema } from '@shared/types';
import { run } from '../util/exec.js';
import { readJson, ensureDir } from '../util/fsx.js';
import { broadcast } from '../sse.js';
import { type JobRef, mutateJob, readJob, logJobEvent, writeClip, readClip } from '../store/jobs.js';
import { paths } from '../store/workspace.js';
import { probeVideo, extractFrames } from './probe.js';
import { toWorkspaceRel } from '../store/workspace.js';

const MAX_ATTEMPTS = 3;

/** 잡별 실행 중 플래그 — 이중 시작 방지 */
const running = new Set<string>();

export function isDownloading(jobId: string): boolean {
  return running.has(jobId);
}

/**
 * 소스 전체 다운로드 → 각 소스마다 probe + 프레임 추출까지.
 * URL 개수 제한 없음. 동시 실행은 settings.parallelDownloads로 제한.
 */
export async function downloadAll(settings: Settings, ref: JobRef): Promise<void> {
  if (running.has(ref.jobId)) return;
  running.add(ref.jobId);
  try {
    const limit = pLimit(settings.parallelDownloads);
    const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
    const sourcesDir = path.join(jobDir, 'sources');
    await ensureDir(sourcesDir);

    const job = await readJob(ref);
    if (!job) return;
    const pending = job.sources.filter(
      (s) => s.status === 'queued' || (s.status === 'failed' && s.attempts < MAX_ATTEMPTS),
    );

    // 한 건이 터져도 나머지 다운로드와 서버는 계속 살아 있어야 한다
    await Promise.all(
      pending.map((source) =>
        limit(async () => {
          try {
            await downloadOne(settings, ref, source.id, sourcesDir);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await logJobEvent(ref, { type: 'source.error', sourceId: source.id, error: msg });
            broadcast('source.error', { jobId: ref.jobId, sourceId: source.id, error: msg });
          }
        }),
      ),
    );
  } finally {
    running.delete(ref.jobId);
    broadcast('download.finished', { jobId: ref.jobId });
  }
}

async function setSource(ref: JobRef, sourceId: string, patch: Partial<SourceUrl>): Promise<SourceUrl> {
  let updated: SourceUrl | undefined;
  await mutateJob(ref, (job) => {
    const s = job.sources.find((x) => x.id === sourceId);
    if (!s) throw new Error(`소스 없음: ${sourceId}`);
    Object.assign(s, patch);
    updated = s;
  });
  broadcast('source', { jobId: ref.jobId, source: updated });
  return updated!;
}

async function downloadOne(
  settings: Settings,
  ref: JobRef,
  sourceId: string,
  sourcesDir: string,
): Promise<void> {
  const job = await readJob(ref);
  const source = job?.sources.find((s) => s.id === sourceId);
  if (!source) return;

  await setSource(ref, sourceId, {
    status: 'downloading',
    attempts: source.attempts + 1,
    progress: 0,
    error: undefined,
  });

  const outTemplate = path.join(sourcesDir, `${sourceId}.%(ext)s`);
  try {
    await run(
      settings.ytdlpPath,
      [
        '--no-playlist',
        '--write-info-json',
        '-f', 'bv*[height<=1080]+ba/b',
        '--merge-output-format', 'mp4',
        '-o', outTemplate,
        source.url,
      ],
      {
        onStdout: (line) => {
          const m = line.match(/\[download\]\s+([\d.]+)%/);
          if (m) {
            const progress = Math.min(100, parseFloat(m[1]));
            broadcast('source.progress', { jobId: ref.jobId, sourceId, progress });
          }
        },
      },
    );

    // 산출 파일 찾기 (mp4 병합 보장했지만 방어적으로 검색)
    const files = await fsp.readdir(sourcesDir);
    const media = files.find((f) => f.startsWith(`${sourceId}.`) && !f.endsWith('.json') && !f.endsWith('.part'));
    if (!media) throw new Error('다운로드 파일을 찾지 못함');
    const filePath = path.join(sourcesDir, media);

    // info.json에서 업로더/라이선스 기록 (저작권 체크리스트용)
    const info = await readJson<{ uploader?: string; license?: string }>(
      path.join(sourcesDir, `${sourceId}.info.json`),
    );

    await setSource(ref, sourceId, {
      status: 'downloaded',
      progress: 100,
      filePath: toWorkspaceRel(filePath),
      uploader: info?.uploader,
      license: info?.license ?? undefined,
    });
    await logJobEvent(ref, { type: 'source.downloaded', sourceId, url: source.url, uploader: info?.uploader });

    await createClipForSource(settings, ref, sourceId, filePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n').slice(0, 3).join(' | ') : String(e);
    await setSource(ref, sourceId, { status: 'failed', error: msg });
    await logJobEvent(ref, { type: 'source.failed', sourceId, error: msg });
  }
}

/** 다운로드 완료된 소스에 클립 생성 + probe + 프레임 추출 */
async function createClipForSource(
  settings: Settings,
  ref: JobRef,
  sourceId: string,
  filePath: string,
): Promise<void> {
  const clipId = sourceId.replace(/^s/, 'c');
  const existing = await readClip(ref, clipId);
  if (existing) return;

  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  const framesDir = path.join(jobDir, 'clips', clipId, 'frames');

  let clip: Clip = ClipSchema.parse({ id: clipId, sourceId });
  try {
    const probe = await probeVideo(settings, filePath);
    const frames = await extractFrames(settings, filePath, framesDir, probe.duration, 5);
    clip = ClipSchema.parse({
      id: clipId,
      sourceId,
      probe,
      frames: frames.map(toWorkspaceRel),
    });
  } catch (e) {
    await logJobEvent(ref, { type: 'clip.probe_failed', clipId, error: String(e) });
  }
  await writeClip(ref, clip);
}

/** 단일 소스 재시도 */
export async function retrySource(settings: Settings, ref: JobRef, sourceId: string): Promise<void> {
  await setSource(ref, sourceId, { status: 'queued', error: undefined });
  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  await downloadOne(settings, ref, sourceId, path.join(jobDir, 'sources'));
}

import path from 'node:path';
import fsp from 'node:fs/promises';
import pLimit from 'p-limit';
import type { Settings, SourceUrl, Clip } from '@shared/types';
import { ClipSchema } from '@shared/types';
import { run } from '../util/exec.js';
import { readJson, ensureDir } from '../util/fsx.js';
import { broadcast } from '../sse.js';
import { type JobRef, mutateJob, readJob, logJobEvent, writeClip, readClip, advanceTo } from '../store/jobs.js';
import { paths } from '../store/workspace.js';
import { probeVideo, extractFrames } from './probe.js';
import { toWorkspaceRel } from '../store/workspace.js';
import { nextSeqId } from '../util/ids.js';

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
    // 첨부 파일 소스는 받을 것이 없으므로 큐에 넣지 않는다
    const pending = job.sources.filter(
      (s) => s.origin !== 'file'
        && (s.status === 'queued' || (s.status === 'failed' && s.attempts < MAX_ATTEMPTS)),
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

/**
 * 다운로드가 끝난 잡을 다음 단계로 전진시킨다.
 *
 * 전진을 다운로드 요청의 일회성 콜백에만 두면, 그 사이 서버가 재시작되거나
 * 프로세스가 죽었을 때 잡이 `downloading`에 영구히 갇힌다 — 소스는 전부 "완료"인데
 * 화면은 다음 단계로 넘어가지 않는 상태가 된다. 그래서 언제 몇 번 불러도 안전한
 * 멱등 함수로 빼두고, 다운로드 직후·부팅 시·다운로드 재시작 시 모두 호출한다.
 * 소스를 첨부하거나 실패한 소스를 지웠을 때도 같은 판단이 필요하므로 그쪽에서도 부른다.
 *
 * `collecting`도 대상이다 — 받을 것 없이 파일만 첨부한 잡은 다운로드를 한 번도 거치지 않는다.
 *
 * @returns 실제로 전진시켰으면 true
 */
export async function reconcileDownloadState(ref: JobRef): Promise<boolean> {
  const job = await readJob(ref);
  if (!job) return false;
  if (job.state !== 'downloading' && job.state !== 'collecting') return false;
  if (job.sources.length === 0) return false;
  const allDone = job.sources.every((s) => s.status === 'downloaded' || s.status === 'skipped');
  if (!allDone) return false;
  // probe/프레임은 다운로드 직후 이미 끝났으므로 정리 단계까지 보낸다
  await advanceTo(ref, 'cleaning');
  return true;
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
    const frames = await extractFrames(settings, filePath, framesDir, probe.duration);
    clip = ClipSchema.parse({
      id: clipId,
      sourceId,
      probe,
      frames: frames.map((f) => ({
        file: toWorkspaceRel(f.filePath),
        t: f.t,
        recommended: f.recommended,
      })),
    });
  } catch (e) {
    await logJobEvent(ref, { type: 'clip.probe_failed', clipId, error: String(e) });
  }
  await writeClip(ref, clip);
}

/**
 * 사용자가 이미 받아둔 영상 파일을 소스로 편입한다.
 * yt-dlp를 거치지 않을 뿐, 이후 단계(probe → 프레임 추출 → 클립 생성)는 다운로드 소스와 같다.
 *
 * @param tmpPath 업로드가 저장된 임시 파일 경로 (sources/ 안에 있어야 rename이 같은 볼륨에서 끝난다)
 * @returns 배정된 소스 id
 */
export async function attachSourceFile(
  settings: Settings,
  ref: JobRef,
  tmpPath: string,
  originalName: string,
): Promise<string> {
  const ext = path.extname(originalName) || path.extname(tmpPath) || '.mp4';
  let sourceId = '';
  await mutateJob(ref, (job) => {
    sourceId = nextSeqId('s', job.sources.map((s) => s.id));
    job.sources.push({
      id: sourceId,
      url: originalName,
      origin: 'file',
      status: 'downloaded',
      attempts: 0,
      progress: 100,
    });
  });

  const filePath = path.join(path.dirname(tmpPath), `${sourceId}${ext}`);
  await fsp.rename(tmpPath, filePath);
  await setSource(ref, sourceId, { filePath: toWorkspaceRel(filePath) });
  await logJobEvent(ref, { type: 'source.attached', sourceId, fileName: originalName });

  await createClipForSource(settings, ref, sourceId, filePath);
  return sourceId;
}

/** 소스 1건 제거 — 파일·클립까지 함께 지운다 */
export async function removeSource(ref: JobRef, sourceId: string): Promise<void> {
  const job = await readJob(ref);
  const source = job?.sources.find((s) => s.id === sourceId);
  if (!source) return;

  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  // 다운로드 산출물(영상·info.json)과 클립 폴더를 함께 정리한다 — 남기면 용량만 먹는다
  const sourcesDir = path.join(jobDir, 'sources');
  for (const f of await fsp.readdir(sourcesDir).catch(() => [] as string[])) {
    if (f === sourceId || f.startsWith(`${sourceId}.`)) {
      await fsp.rm(path.join(sourcesDir, f), { force: true }).catch(() => {});
    }
  }
  const clipId = sourceId.replace(/^s/, 'c');
  await fsp.rm(path.join(jobDir, 'clips', clipId), { recursive: true, force: true }).catch(() => {});

  await mutateJob(ref, (j) => {
    j.sources = j.sources.filter((s) => s.id !== sourceId);
  });
  await logJobEvent(ref, { type: 'source.removed', sourceId, url: source.url });
  broadcast('source.removed', { jobId: ref.jobId, sourceId });
}

/** 단일 소스 재시도 */
export async function retrySource(settings: Settings, ref: JobRef, sourceId: string): Promise<void> {
  await setSource(ref, sourceId, { status: 'queued', error: undefined });
  const jobDir = paths.job(ref.menu, ref.projectId, ref.jobId);
  await downloadOne(settings, ref, sourceId, path.join(jobDir, 'sources'));
}

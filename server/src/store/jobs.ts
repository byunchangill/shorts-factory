import path from 'node:path';
import { JobSchema, type Job, ClipSchema, type Clip, ScriptSchema, type Script } from '@shared/types';
import type { JobState, Menu } from '@shared/constants';
import { paths } from './workspace.js';
import { appendEvent, ensureDir, listDirs, readJson, writeJsonAtomic, slugify, withFileLock } from '../util/fsx.js';
import { canTransition, progressOf, statesFor } from '../pipeline/stateMachine.js';
import { nextJobId } from '../util/ids.js';
import { broadcast } from '../sse.js';

export interface JobRef {
  menu: Menu;
  projectId: string;
  jobId: string;
}

/**
 * 잡 위치 인덱스 — 부팅 시 workspace 스캔으로 재구성.
 * job.json이 유일한 진실이고 이 맵은 조회 가속용.
 */
const jobIndex = new Map<string, JobRef>();

export async function scanJobs(): Promise<void> {
  jobIndex.clear();
  for (const menu of ['menu-a', 'menu-b'] as Menu[]) {
    const projectDirs = await listDirs(paths.menu(menu));
    for (const projectId of projectDirs) {
      if (projectId === 'formats') continue;
      const jobDirs = await listDirs(paths.jobs(menu, projectId));
      for (const jobId of jobDirs) {
        // 이미 만들어진 중복은 여기서 고칠 수 없다 — 조용히 덮어쓰지 말고 알린다.
        // 덮어쓰면 그 잡의 모든 요청이 다른 제품 폴더로 가는데 화면에는 아무 단서도 안 남는다
        const dup = jobIndex.get(jobId);
        if (dup) {
          console.warn(
            `[jobs] 잡 ID 중복: ${jobId} — ${dup.menu}/${dup.projectId} 와 ${menu}/${projectId}. ` +
            '한쪽 폴더 이름을 바꿔야 합니다 (지금은 먼저 찾은 쪽만 열립니다)',
          );
          continue;
        }
        jobIndex.set(jobId, { menu, projectId, jobId });
      }
    }
  }
}

export function resolveJob(jobId: string): JobRef | null {
  return jobIndex.get(jobId) ?? null;
}

/**
 * 잡 ID는 **전역으로 유일해야 한다.**
 *
 * 잡 번호는 프로젝트 안에서 매겨지는데(`20260811-001-1편`) 인덱스는 ID 하나로 찾는다.
 * 그래서 같은 날 다른 제품에 같은 제목("1편")으로 잡을 만들면 ID가 겹치고,
 * 나중 것이 인덱스에서 앞 것을 덮어써서 `/jobs/{id}/...` 요청이 통째로
 * 엉뚱한 제품 폴더로 간다 — 대본도 영상도 남의 제품에 쌓인다.
 * 시리즈로 찍을수록 "1편"이 겹치므로 반드시 막는다.
 *
 * 프로젝트 안에서 비어 있는 번호라도 다른 프로젝트가 쓰고 있으면 다음 번호로 넘긴다.
 */
export function uniqueJobId(existingInProject: string[], title: string): string {
  const slug = slugify(title).slice(0, 20);
  const taken = [...existingInProject];
  for (let i = 0; i < 1000; i++) {
    const id = `${nextJobId(taken)}-${slug}`;
    if (!jobIndex.has(id)) return id;
    // 이 번호는 다른 프로젝트가 쓰고 있다 — 번호를 하나 밀어 다시 시도한다
    taken.push(id);
  }
  throw new Error('잡 ID를 만들지 못했습니다 (같은 날 잡이 너무 많습니다)');
}

/** 인덱싱된 모든 잡 — 부팅 시 일괄 점검용 */
export function listJobRefs(): JobRef[] {
  return [...jobIndex.values()];
}

/**
 * 인덱스에서만 뺀다 (폴더 정리는 `store/remove.ts`).
 *
 * 같은 잡 ID가 다른 프로젝트에도 있을 수 있어(스캔 시 경고만 남기고 넘어간다),
 * 인덱스가 가리키는 곳이 정말 이 잡일 때만 지운다 — 아니면 남의 잡을 화면에서 지운다.
 */
export function forgetJob(ref: JobRef): void {
  const indexed = jobIndex.get(ref.jobId);
  if (indexed && indexed.menu === ref.menu && indexed.projectId === ref.projectId) {
    jobIndex.delete(ref.jobId);
  }
}

/**
 * 흐름에서 빠진 단계에 멈춰 있는 지난 잡을 다음 단계로 읽어준다.
 *
 * `trimming`(컷 선택)을 없앴는데(2026-08-18) 그 상태로 저장된 잡이 남아 있다. 그대로 두면
 * 어느 단계 화면도 안 열려서 잡이 갇힌다 — 컷 구간은 이미 장면 고르기에서 정해졌으므로
 * 음성 단계로 읽는다. 파일은 그대로 두고 **읽을 때만** 바꾼다. 다음 저장에서 자연히 씻긴다.
 */
export function migrateState(job: Job): Job {
  return job.state === 'trimming' ? { ...job, state: 'voicing' } : job;
}

export async function readJob(ref: JobRef): Promise<Job | null> {
  const raw = await readJson<unknown>(paths.jobJson(ref.menu, ref.projectId, ref.jobId));
  const parsed = JobSchema.safeParse(raw);
  return parsed.success ? migrateState(parsed.data) : null;
}

/** job.json은 서버만 쓴다 (Claude Code는 requests/{packetId}/result/ 에만 씀) */
export async function writeJob(ref: JobRef, job: Job): Promise<void> {
  await writeJsonAtomic(paths.jobJson(ref.menu, ref.projectId, ref.jobId), JobSchema.parse(job));
  broadcast('job', { jobId: job.id, state: job.state, progress: progressOf(job.menu, job.state) });
}

export async function logJobEvent(ref: JobRef, event: Record<string, unknown>): Promise<void> {
  await appendEvent(paths.jobEvents(ref.menu, ref.projectId, ref.jobId), event);
}

export async function listJobs(menu: Menu, projectId: string): Promise<Job[]> {
  const jobDirs = await listDirs(paths.jobs(menu, projectId));
  const jobs: Job[] = [];
  for (const jobId of jobDirs) {
    const job = await readJob({ menu, projectId, jobId });
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 모든 활성(미완료) 잡 — 대시보드 "지금 할 일" */
export async function listActiveJobs(): Promise<Array<Job & { projectId: string }>> {
  const out: Array<Job & { projectId: string }> = [];
  for (const ref of jobIndex.values()) {
    const job = await readJob(ref);
    if (job && job.state !== 'done') out.push(job);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createJob(menu: Menu, projectId: string, title: string): Promise<Job> {
  const existing = await listDirs(paths.jobs(menu, projectId));
  const id = uniqueJobId(existing, title);
  const now = new Date().toISOString();
  const job = JobSchema.parse({
    id,
    projectId,
    menu,
    title,
    createdAt: now,
    state: 'draft',
    stateHistory: [{ state: 'draft', at: now, by: 'server' }],
  });
  const ref: JobRef = { menu, projectId, jobId: id };
  const root = paths.job(menu, projectId, id);
  for (const sub of ['sources', 'clips', 'script', 'voice', 'subtitles', 'requests', 'output']) {
    await ensureDir(path.join(root, sub));
  }
  if (menu === 'menu-b') await ensureDir(path.join(root, 'scenes'));
  await writeJob(ref, job);
  await logJobEvent(ref, { type: 'job.created', title });
  jobIndex.set(id, ref);
  return job;
}

export async function transition(
  ref: JobRef,
  to: JobState,
  by: 'server' | 'user' | 'claude' = 'user',
): Promise<Job> {
  const jsonPath = paths.jobJson(ref.menu, ref.projectId, ref.jobId);
  const job = await withFileLock(jsonPath, async () => {
    const current = await readJob(ref);
    if (!current) throw new Error(`잡 없음: ${ref.jobId}`);
    if (current.state === to) return null; // 이미 그 상태 — 조용히 통과
    if (!canTransition(current.menu, current.state, to)) {
      throw new Error(`전이 불가: ${current.state} → ${to}`);
    }
    current.stateHistory.push({ state: to, at: new Date().toISOString(), by });
    current.state = to;
    await writeJob(ref, current);
    return current;
  });
  if (!job) return (await readJob(ref))!;
  await logJobEvent(ref, { type: 'state.transition', to, by });
  return job;
}

/**
 * 목표 단계까지 파이프라인을 한 칸씩 전진시킨다.
 * 전이표가 인접 단계로만 이동을 허용하므로, 중간 단계를 건너뛰는 호출
 * (예: script_approved → voicing)이 막히는 것을 방지한다.
 * 이미 목표를 지났거나 같은 단계면 아무것도 하지 않는다.
 */
export async function advanceTo(
  ref: JobRef,
  target: JobState,
  by: 'server' | 'user' | 'claude' = 'server',
): Promise<Job> {
  const job = await readJob(ref);
  if (!job) throw new Error(`잡 없음: ${ref.jobId}`);
  const pipeline = statesFor(job.menu);
  const targetIdx = pipeline.indexOf(target);
  const currentIdx = pipeline.indexOf(job.state);
  // 파이프라인 밖(failed/paused)이거나 목표가 없으면 그냥 한 번 시도
  if (targetIdx < 0 || currentIdx < 0) return transition(ref, target, by);
  if (currentIdx >= targetIdx) return job;

  let latest = job;
  for (let i = currentIdx + 1; i <= targetIdx; i++) {
    latest = await transition(ref, pipeline[i], by);
  }
  return latest;
}

/**
 * 잡 상태를 조건 없이 기록 (다운로드 완료 등 서버 내부 진행).
 * 읽기-수정-쓰기 전체를 파일 락으로 감싸 동시 호출 시 갱신이 유실되지 않게 한다
 * (예: 동시에 끝난 다운로드 2건이 서로의 소스 상태를 덮어쓰는 문제).
 */
export async function mutateJob(ref: JobRef, fn: (job: Job) => void | Promise<void>): Promise<Job> {
  const jsonPath = paths.jobJson(ref.menu, ref.projectId, ref.jobId);
  return withFileLock(jsonPath, async () => {
    const job = await readJob(ref);
    if (!job) throw new Error(`잡 없음: ${ref.jobId}`);
    await fn(job);
    await writeJob(ref, job);
    return job;
  });
}

// ── 클립 ──────────────────────────────────────────────────────────

export function clipDir(ref: JobRef, clipId: string): string {
  return path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'clips', clipId);
}

export async function readClip(ref: JobRef, clipId: string): Promise<Clip | null> {
  const raw = await readJson<unknown>(path.join(clipDir(ref, clipId), 'clip.json'));
  const parsed = ClipSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeClip(ref: JobRef, clip: Clip): Promise<void> {
  await writeJsonAtomic(path.join(clipDir(ref, clip.id), 'clip.json'), ClipSchema.parse(clip));
  broadcast('clip', { jobId: ref.jobId, clipId: clip.id });
}

export async function listClips(ref: JobRef): Promise<Clip[]> {
  const dirs = await listDirs(path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'clips'));
  const clips: Clip[] = [];
  for (const d of dirs) {
    const clip = await readClip(ref, d);
    if (clip) clips.push(clip);
  }
  return clips.sort((a, b) => a.id.localeCompare(b.id));
}

// ── 대본 ──────────────────────────────────────────────────────────

export function scriptDir(ref: JobRef): string {
  return path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'script');
}

export async function readScript(ref: JobRef, version: number): Promise<Script | null> {
  const raw = await readJson<unknown>(path.join(scriptDir(ref), `script_v${version}.json`));
  const parsed = ScriptSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeScriptVersion(ref: JobRef, script: Omit<Script, 'version'>): Promise<number> {
  const job = await readJob(ref);
  if (!job) throw new Error(`잡 없음: ${ref.jobId}`);
  const version = job.script.currentVersion + 1;
  await writeJsonAtomic(
    path.join(scriptDir(ref), `script_v${version}.json`),
    ScriptSchema.parse({ ...script, version }),
  );
  await mutateJob(ref, (j) => {
    j.script.currentVersion = version;
    j.script.approved = false;
  });
  await logJobEvent(ref, { type: 'script.version', version });
  return version;
}

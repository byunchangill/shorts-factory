import path from 'node:path';
import { JobSchema, type Job, ClipSchema, type Clip, ScriptSchema, type Script } from '@shared/types';
import type { JobState, Menu } from '@shared/constants';
import { paths } from './workspace.js';
import { appendEvent, ensureDir, listDirs, readJson, writeJsonAtomic, slugify } from '../util/fsx.js';
import { canTransition, progressOf } from '../pipeline/stateMachine.js';
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
        jobIndex.set(jobId, { menu, projectId, jobId });
      }
    }
  }
}

export function resolveJob(jobId: string): JobRef | null {
  return jobIndex.get(jobId) ?? null;
}

export async function readJob(ref: JobRef): Promise<Job | null> {
  const raw = await readJson<unknown>(paths.jobJson(ref.menu, ref.projectId, ref.jobId));
  const parsed = JobSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
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
  const id = `${nextJobId(existing)}-${slugify(title).slice(0, 20)}`;
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
  const job = await readJob(ref);
  if (!job) throw new Error(`잡 없음: ${ref.jobId}`);
  if (job.state === to) return job;
  if (!canTransition(job.menu, job.state, to)) {
    throw new Error(`전이 불가: ${job.state} → ${to}`);
  }
  job.stateHistory.push({ state: to, at: new Date().toISOString(), by });
  job.state = to;
  await writeJob(ref, job);
  await logJobEvent(ref, { type: 'state.transition', to, by });
  return job;
}

/** 잡 상태를 조건 없이 기록 (다운로드 완료 등 서버 내부 진행) */
export async function mutateJob(ref: JobRef, fn: (job: Job) => void | Promise<void>): Promise<Job> {
  const job = await readJob(ref);
  if (!job) throw new Error(`잡 없음: ${ref.jobId}`);
  await fn(job);
  await writeJob(ref, job);
  return job;
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

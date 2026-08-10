import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsSchema, type Settings } from '@shared/types';
import type { Menu } from '@shared/constants';
import { ensureDir, readJson, writeJsonAtomic, exists } from '../util/fsx.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(dirname, '../../..');

/**
 * 리포 루트의 workspace/ — AI와 서버가 공유하는 유일한 데이터 저장소.
 * SHORTS_WORKSPACE로 덮어쓸 수 있다 (하네스가 실제 데이터를 건드리지 않고 돌기 위해).
 */
export const WORKSPACE_ROOT = process.env.SHORTS_WORKSPACE
  ? path.resolve(process.env.SHORTS_WORKSPACE)
  : path.resolve(REPO_ROOT, 'workspace');

export const paths = {
  root: () => WORKSPACE_ROOT,
  settings: () => path.join(WORKSPACE_ROOT, 'settings.json'),
  templates: () => path.join(WORKSPACE_ROOT, 'templates'),
  menu: (menu: Menu) => path.join(WORKSPACE_ROOT, menu),
  formats: () => path.join(WORKSPACE_ROOT, 'menu-b', 'formats'),
  format: (formatId: string) => path.join(WORKSPACE_ROOT, 'menu-b', 'formats', formatId),
  project: (menu: Menu, projectId: string) => path.join(WORKSPACE_ROOT, menu, projectId),
  projectJson: (menu: Menu, projectId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'project.json'),
  guidelines: (menu: Menu, projectId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'guidelines'),
  product: (menu: Menu, projectId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'product'),
  jobs: (menu: Menu, projectId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'jobs'),
  job: (menu: Menu, projectId: string, jobId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'jobs', jobId),
  jobJson: (menu: Menu, projectId: string, jobId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'jobs', jobId, 'job.json'),
  jobEvents: (menu: Menu, projectId: string, jobId: string) =>
    path.join(WORKSPACE_ROOT, menu, projectId, 'jobs', jobId, 'events.ndjson'),
};

/** workspace 절대경로 → API 미디어 URL 경로 */
export function toMediaUrl(absPath: string): string {
  const rel = path.relative(WORKSPACE_ROOT, absPath);
  return `/media/${rel.split(path.sep).join('/')}`;
}

/** workspace 기준 상대경로 (job.json 등에 저장할 때) */
export function toWorkspaceRel(absPath: string): string {
  return path.relative(WORKSPACE_ROOT, absPath).split(path.sep).join('/');
}

export function fromWorkspaceRel(rel: string): string {
  const abs = path.resolve(WORKSPACE_ROOT, rel);
  if (!abs.startsWith(WORKSPACE_ROOT)) throw new Error(`workspace 밖 경로: ${rel}`);
  return abs;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await readJson<unknown>(paths.settings());
  const parsed = SettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveSettings(s: Settings): Promise<void> {
  await writeJsonAtomic(paths.settings(), s);
}

/** 부팅 시 workspace 골격 생성 */
export async function initWorkspace(): Promise<void> {
  await ensureDir(path.join(WORKSPACE_ROOT, 'menu-a'));
  await ensureDir(path.join(WORKSPACE_ROOT, 'menu-b', 'formats'));
  await ensureDir(paths.templates());
  if (!(await exists(paths.settings()))) {
    await saveSettings(SettingsSchema.parse({}));
  }
}

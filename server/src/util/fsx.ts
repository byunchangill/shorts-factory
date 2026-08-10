import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** temp 파일에 쓴 뒤 rename — 부분 쓰기로 인한 JSON 파손 방지 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readJsonSync<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** append-only 감사 로그 (events.ndjson) */
export async function appendEvent(
  ndjsonPath: string,
  event: Record<string, unknown>,
): Promise<void> {
  await fsp.mkdir(path.dirname(ndjsonPath), { recursive: true });
  await fsp.appendFile(ndjsonPath, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'utf8');
}

export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** 파일시스템 안전 슬러그 — 한글 유지, 위험 문자만 제거 */
export function slugify(input: string): string {
  return input
    .trim()
    .replace(/[\\/:*?"<>|.\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

let tmpCounter = 0;

/** temp 파일에 쓴 뒤 rename — 부분 쓰기로 인한 JSON 파손 방지 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // 같은 밀리초에 동시 호출돼도 임시 파일이 겹치지 않도록 카운터를 섞는다
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

/**
 * 경로별 직렬화 락.
 * 읽기-수정-쓰기가 겹치면 갱신이 통째로 유실되므로(예: 동시 다운로드 2건이
 * 각자 읽은 job.json을 덮어씀), 같은 파일을 다루는 작업은 순서대로 실행한다.
 */
const locks = new Map<string, Promise<void>>();

export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const prev = locks.get(key) ?? Promise.resolve();
  // 앞 작업이 실패해도 뒤 작업은 그대로 이어져야 하므로 성공/실패 모두 fn으로 흘린다
  const next = prev.then(fn, fn);
  const settled = next.then(() => undefined, () => undefined);
  locks.set(key, settled);
  // 대기열이 비면 맵에서 제거해 메모리 누수를 막는다
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return next;
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

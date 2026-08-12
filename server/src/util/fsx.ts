import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

let tmpCounter = 0;

/** 윈도우에서 rename이 일시적으로 막히는 오류들 (다른 프로세스가 대상 파일을 잡고 있을 때) */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * rename 재시도.
 *
 * 윈도우는 대상 파일이 다른 핸들(백신 실시간 검사, 파일 탐색기, 인덱서, 동시 읽기)에
 * 열려 있으면 rename을 EPERM으로 거절한다. 리눅스·macOS에는 없는 제약이고
 * 대부분 수십 ms 안에 풀리므로, 짧게 물러났다 다시 시도한다.
 * 끝내 실패하면 임시 파일을 치우고 원래 오류를 그대로 올린다.
 */
async function renameWithRetry(tmp: string, dest: string): Promise<void> {
  // 총 약 3.3초 — 여기서 실패하면 파이프라인 한 판이 통째로 날아가므로 넉넉히 기다린다
  const delays = [10, 20, 40, 80, 160, 320, 640, 1000, 1000];
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (i >= delays.length || !TRANSIENT_RENAME_ERRORS.has(code)) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

/** temp 파일에 쓴 뒤 rename — 부분 쓰기로 인한 JSON 파손 방지 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // 같은 밀리초에 동시 호출돼도 임시 파일이 겹치지 않도록 카운터를 섞는다
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await renameWithRetry(tmp, filePath);
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

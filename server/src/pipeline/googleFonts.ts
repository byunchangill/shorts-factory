import path from 'node:path';
import fsp from 'node:fs/promises';
import { paths } from '../store/workspace.js';
import { ensureDir, writeJsonAtomic, readJson } from '../util/fsx.js';

/**
 * 구글 폰트에서 한국어 글꼴을 받아 온다.
 *
 * 눈누 같은 모음 사이트는 글꼴마다 배포처와 이용 범위가 달라 한 번에 받을 수가 없다.
 * 구글 폰트는 **전부 OFL(자유 이용·재배포·영상 삽입 가능)** 이고 파일 주소가 규칙적이라
 * 한 번에 받을 수 있는 유일한 창구다. 여기서 받은 것만 「더 받기」 목록에 오른다.
 *
 * 받은 파일은 **설치하지 않고** `workspace/fonts/`에 둔다 — ffmpeg는 경로로 읽으므로
 * 시스템에 설치할 이유가 없고, PC를 옮겨도 작업공간만 복사하면 따라간다.
 */

const METADATA = 'https://fonts.google.com/metadata/fonts';
const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const TIMEOUT_MS = 60_000;
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface GoogleFamily {
  family: string;
  /** 이미 받아 둔 것 */
  installed: boolean;
}

/** 받아 둔 글꼴 목록 (`workspace/fonts/index.json`) */
export interface InstalledEntry {
  file: string;
  family: string;
  label: string;
  license: string;
}

const indexPath = () => path.join(paths.fonts(), 'index.json');

export async function readFontIndex(): Promise<InstalledEntry[]> {
  return (await readJson<InstalledEntry[]>(indexPath())) ?? [];
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    // 구글이 JSON 앞에 `)]}'`를 붙여 보낸다 (XSSI 방지) — 떼고 파싱한다
    return JSON.parse((await r.text()).replace(/^\)\]\}'\s*/, ''));
  } finally {
    clearTimeout(timer);
  }
}

/** 메타데이터 응답 → 한국어를 지원하는 오픈소스 패밀리 이름 (순수 함수 — 테스트 대상) */
export function koreanFamilies(data: unknown): string[] {
  const list = (data as { familyMetadataList?: unknown })?.familyMetadataList;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => (raw ?? {}) as Record<string, unknown>)
    .filter((f) => Array.isArray(f.subsets) && f.subsets.includes('korean') && f.isOpenSource !== false)
    .map((f) => String(f.family ?? ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

let cache: { at: number; families: string[] } | undefined;

/** 받을 수 있는 한국어 글꼴 목록 */
export async function listAvailable(): Promise<GoogleFamily[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), families: koreanFamilies(await fetchJson(METADATA)) };
  }
  const have = new Set((await readFontIndex()).map((e) => e.family));
  return cache.families.map((family) => ({ family, installed: have.has(family) }));
}

/**
 * 한 패밀리에서 받아 볼 파일 이름들 — 굵은 것부터.
 * 쇼츠 자막은 굵어야 배경에 안 묻히므로 Black → … → Regular 순으로 처음 있는 것을 받는다.
 * 마지막의 `[wght]`는 가변 글꼴(굵기가 파일 하나에 다 든 것)이다.
 * (순수 함수 — 테스트 대상)
 */
export function fileCandidates(family: string): { dir: string; files: string[] } {
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = family.replace(/[^A-Za-z0-9]/g, '');
  const weights = ['Black', 'ExtraBold', 'Bold', 'SemiBold', 'Medium', 'Regular'];
  return { dir, files: [...weights.map((w) => `${name}-${w}.ttf`), `${name}[wght].ttf`] };
}

async function download(url: string, dest: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return false;
    await fsp.writeFile(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface InstallResult {
  installed: string[];
  /** 이미 받아 둔 것 */
  skipped: string[];
  /** 파일 이름 규칙에 안 맞거나 네트워크가 끊긴 것 */
  failed: string[];
}

/** 고른 패밀리를 받는다. 이름을 안 주면 한국어 전부 */
export async function installFamilies(families?: string[]): Promise<InstallResult> {
  const targets = families?.length ? families : (await listAvailable()).map((f) => f.family);
  const dir = paths.fonts();
  await ensureDir(dir);
  const index = await readFontIndex();
  const have = new Set(index.map((e) => e.family));
  const result: InstallResult = { installed: [], skipped: [], failed: [] };

  for (const family of targets) {
    if (have.has(family)) { result.skipped.push(family); continue; }
    const { dir: repoDir, files } = fileCandidates(family);
    let done = false;
    for (const file of files) {
      // 파일명에 대괄호가 들어가는 가변 글꼴이 있다 — 주소로 넣기 전에 인코딩한다
      const url = `${RAW}/${repoDir}/${encodeURIComponent(file)}`;
      if (!(await download(url, path.join(dir, file)))) continue;
      index.push({ file, family, label: family, license: 'OFL (구글 폰트)' });
      result.installed.push(family);
      done = true;
      break;
    }
    if (!done) result.failed.push(family);
  }

  await writeJsonAtomic(indexPath(), index);
  await fsp.writeFile(
    path.join(dir, 'README.md'),
    '# 받아 둔 무료 글꼴\n\n'
      + '화면(설정 → 자막 모양 → 무료 글꼴 더 받기)에서 구글 폰트로부터 받은 파일입니다.\n'
      + '전부 OFL이라 영상에 새겨 배포해도 됩니다. 출처: https://fonts.google.com\n\n'
      + '설치하지 않고 이 폴더에서 바로 씁니다 — 지우면 목록에서도 사라집니다.\n',
    'utf8',
  );
  return result;
}

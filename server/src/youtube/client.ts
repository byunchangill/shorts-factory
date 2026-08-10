import path from 'node:path';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { YOUTUBE_QUOTA_COST } from '@shared/constants';
import { WORKSPACE_ROOT } from '../store/workspace.js';
import { getKey } from '../store/secrets.js';
import { ensureDir, readJson, writeJsonAtomic } from '../util/fsx.js';
import { assertQuota, spendQuota } from './quota.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const CACHE_DIR = path.join(WORKSPACE_ROOT, 'cache', 'youtube');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간 — 같은 검색 반복으로 쿼터를 낭비하지 않는다

export type YouTubeEndpoint = keyof typeof YOUTUBE_QUOTA_COST;

interface CacheEntry {
  at: number;
  data: unknown;
}

function cacheKey(endpoint: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(`${endpoint}?${sorted}`).digest('hex').slice(0, 24);
}

async function readCache(key: string): Promise<unknown | null> {
  const entry = await readJson<CacheEntry>(path.join(CACHE_DIR, `${key}.json`));
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.data;
}

async function writeCache(key: string, data: unknown): Promise<void> {
  await ensureDir(CACHE_DIR);
  await writeJsonAtomic(path.join(CACHE_DIR, `${key}.json`), { at: Date.now(), data });
}

/**
 * YouTube Data API 호출 래퍼.
 * 캐시 → 쿼터 확인 → 호출 → 쿼터 차감 순서로 처리해
 * 무료 한도(10,000유닛/일) 안에서만 동작하도록 강제한다.
 */
export async function ytFetch<T = any>(
  endpoint: YouTubeEndpoint,
  params: Record<string, string>,
): Promise<T> {
  const key = await getKey('youtube');
  if (!key) {
    throw Object.assign(new Error('YouTube API 키가 등록되지 않았습니다 (API 키 메뉴에서 등록)'), { status: 400 });
  }

  const ck = cacheKey(endpoint, params);
  const cached = await readCache(ck);
  if (cached !== null) return cached as T;

  const cost = YOUTUBE_QUOTA_COST[endpoint];
  await assertQuota(cost);

  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let r: Response;
  try {
    r = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // 실패한 호출도 쿼터를 소모하는 경우가 있어 보수적으로 차감한다
    await spendQuota(cost);
    throw Object.assign(
      new Error(`YouTube API 오류 ${r.status}: ${body.slice(0, 300)}`),
      { status: r.status === 403 ? 429 : 502 },
    );
  }

  const data = await r.json();
  await spendQuota(cost);
  await writeCache(ck, data);
  return data as T;
}

/** ISO 8601 duration(PT1M30S) → 초 */
export function parseDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    (d ? parseInt(d, 10) * 86400 : 0) +
    (h ? parseInt(h, 10) * 3600 : 0) +
    (min ? parseInt(min, 10) * 60 : 0) +
    (s ? Math.round(parseFloat(s)) : 0)
  );
}

/** 캐시 비우기 (설정 화면에서 수동 호출) */
export async function clearCache(): Promise<number> {
  try {
    const files = await fsp.readdir(CACHE_DIR);
    for (const f of files) await fsp.unlink(path.join(CACHE_DIR, f));
    return files.length;
  } catch {
    return 0;
  }
}

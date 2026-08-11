import path from 'node:path';
import fsp from 'node:fs/promises';
import { WORKSPACE_ROOT } from '../store/workspace.js';
import { getContext, hasProfile } from './browser.js';
import { PLATFORMS, harvestHits, type SearchHit } from './platforms.js';
import type { SourcePlatform } from './links.js';

export type SearchStatus = 'ok' | 'login_required' | 'blocked' | 'empty';

export interface SearchResult {
  platform: SourcePlatform;
  status: SearchStatus;
  hits: SearchHit[];
  message: string;
  /** 결과가 없을 때 원인을 볼 수 있게 남기는 화면 캡처 (workspace 상대경로) */
  screenshot?: string;
}

/** 로그인 벽·캡차가 떴는지 — 결과 0건을 "그런 영상이 없음"으로 오해하지 않기 위해 */
const WALL_HINTS = [
  '登录', '登入', 'Log in', '로그인',
  '验证', '滑块', 'captcha', 'verify',
  '安全验证', 'Security check',
];

async function saveDebugShot(page: import('playwright').Page, platform: string): Promise<string> {
  const dir = path.join(WORKSPACE_ROOT, 'browser', '_debug');
  await fsp.mkdir(dir, { recursive: true });
  const rel = path.join('browser', '_debug', `${platform}-${Date.now()}.png`);
  await page.screenshot({ path: path.join(WORKSPACE_ROOT, rel) }).catch(() => {});
  return rel;
}

/**
 * 플랫폼에서 키워드로 영상을 찾는다.
 *
 * 결과가 없을 때 그냥 빈 배열을 주지 않는다 — 로그인이 끊겼는지, 막혔는지,
 * 진짜 없는지를 구분해 알려준다. 이걸 뭉뚱그리면 사용자는 세션이 죽은 줄 모르고
 * "이 제품은 중국에 없나 보다"라고 잘못 판단한다.
 */
export async function searchPlatform(
  platform: SourcePlatform,
  keyword: string,
  opts: { waitMs?: number; scrolls?: number } = {},
): Promise<SearchResult> {
  const cfg = PLATFORMS[platform];
  const loggedInProfile = await hasProfile(platform);
  if (!loggedInProfile && !cfg.guestSearch) {
    return {
      platform, status: 'login_required', hits: [],
      message: `${cfg.label}는 로그인해야 검색됩니다. "로그인" 버튼으로 먼저 연결하세요.`,
    };
  }

  const ctx = await getContext(platform, { headless: true });
  const page = await ctx.newPage();
  try {
    await page.goto(cfg.searchUrl(keyword), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // 결과는 JS로 그려지므로 기다린다. 스크롤로 더 불러온다
    await page.waitForTimeout(opts.waitMs ?? 3500);
    for (let i = 0; i < (opts.scrolls ?? 2); i++) {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(1200);
    }

    const hits = await harvestHits(page, platform);
    if (hits.length > 0) {
      return { platform, status: 'ok', hits, message: `${hits.length}건` };
    }

    // 0건이면 이유를 찾는다
    const body = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 4000);
    const hitWall = WALL_HINTS.some((h) => body.includes(h));
    const screenshot = await saveDebugShot(page, platform);
    return {
      platform,
      status: hitWall ? (loggedInProfile ? 'blocked' : 'login_required') : 'empty',
      hits: [],
      message: hitWall
        ? (loggedInProfile
          ? `${cfg.label}: 로그인이 끊겼거나 확인(캡차)이 떴습니다. 다시 로그인하세요.`
          : `${cfg.label}: 로그인이 필요합니다.`)
        : `${cfg.label}: 검색 결과를 찾지 못했습니다. 화면 캡처를 남겼습니다.`,
      screenshot,
    };
  } catch (e) {
    const screenshot = await saveDebugShot(page, platform).catch(() => undefined);
    return {
      platform, status: 'blocked', hits: [],
      message: `${cfg.label} 검색 실패: ${e instanceof Error ? e.message : String(e)}`,
      screenshot,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

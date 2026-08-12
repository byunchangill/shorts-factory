import type { Page } from 'playwright';
import type { SourcePlatform } from './links.js';

/**
 * 플랫폼별 검색 방법.
 *
 * **DOM 선택자에 기대지 않는다.** 클래스 이름은 배포 때마다 바뀌지만 영상 주소 형식은
 * 잘 바뀌지 않는다. 그래서 화면에서 "영상 주소처럼 생긴 링크"를 전부 긁고, 제목·썸네일은
 * 그 링크 주변에서 최선을 다해 주워온다. 부실해도 URL만 확보되면 다운로드는 yt-dlp가 한다.
 */

export interface SearchHit {
  platform: SourcePlatform;
  url: string;
  videoId: string;
  title: string;
  thumbnail: string;
  author: string;
}

export interface PlatformConfig {
  label: string;
  loginUrl: string;
  /** 로그인 없이도 검색이 되는가 (도우인은 게스트로도 일부 보인다) */
  guestSearch: boolean;
  searchUrl: (keyword: string) => string;
  /** 영상 상세 주소 판별 — 여기 걸리는 링크만 결과로 삼는다 */
  videoHref: RegExp;
  /** 주소에서 영상 id 뽑기 */
  idFrom: (href: string) => string;
  /** 로그인 완료 판정 */
  isLoggedIn: (page: Page) => Promise<boolean>;
}

/** 쿠키 이름으로 로그인 여부를 본다 — 화면 문구보다 덜 흔들린다 */
async function hasCookie(page: Page, names: string[]): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some((c) => names.includes(c.name) && !!c.value);
}

export const PLATFORMS: Record<SourcePlatform, PlatformConfig> = {
  douyin: {
    label: '도우인',
    loginUrl: 'https://www.douyin.com/',
    guestSearch: true,
    searchUrl: (kw) => `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=video`,
    videoHref: /douyin\.com\/video\/(\d+)/,
    idFrom: (href) => href.match(/\/video\/(\d+)/)?.[1] ?? '',
    isLoggedIn: (page) => hasCookie(page, ['sessionid', 'sessionid_ss', 'sid_tt']),
  },
  xiaohongshu: {
    label: '샤오홍슈',
    loginUrl: 'https://www.xiaohongshu.com/explore',
    guestSearch: false,
    searchUrl: (kw) =>
      `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}&type=video`,
    videoHref: /xiaohongshu\.com\/(?:explore|search_result|discovery\/item)\/([0-9a-f]{16,})/,
    idFrom: (href) => href.match(/\/([0-9a-f]{16,})/)?.[1] ?? '',
    isLoggedIn: (page) => hasCookie(page, ['web_session', 'websectiga', 'customerClientId']),
  },
  tiktok: {
    label: '틱톡',
    loginUrl: 'https://www.tiktok.com/login',
    guestSearch: true,
    searchUrl: (kw) => `https://www.tiktok.com/search/video?q=${encodeURIComponent(kw)}`,
    videoHref: /tiktok\.com\/@[^/]+\/video\/(\d+)/,
    idFrom: (href) => href.match(/\/video\/(\d+)/)?.[1] ?? '',
    isLoggedIn: (page) => hasCookie(page, ['sessionid', 'sessionid_ss', 'sid_tt']),
  },
  alibaba1688: {
    label: '1688',
    loginUrl: 'https://login.1688.com/member/signin.htm',
    guestSearch: true,
    searchUrl: (kw) => `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}`,
    // 1688은 영상 플랫폼이 아니라 상품 페이지다 — 소재보다 제품 확인용
    videoHref: /detail\.1688\.com\/offer\/(\d+)/,
    idFrom: (href) => href.match(/\/offer\/(\d+)/)?.[1] ?? '',
    isLoggedIn: (page) => hasCookie(page, ['cookie2', '_tb_token_', 'unb']),
  },
};

/**
 * 검색 결과 화면에서 영상 링크를 긁는다.
 *
 * 페이지 안에서 실행되므로 브라우저의 DOM을 그대로 본다.
 * 같은 영상이 여러 번 링크되는 일이 흔해 id로 합친다.
 */
export async function harvestHits(page: Page, platform: SourcePlatform): Promise<SearchHit[]> {
  const cfg = PLATFORMS[platform];
  const raw = await page.evaluate(() => {
    const out: Array<{ href: string; text: string; img: string; alt: string }> = [];
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const el = a as HTMLAnchorElement;
      // 링크 주변에서 제목·썸네일을 최선을 다해 줍는다
      const card = el.closest('li, article, div') ?? el;
      const img = card.querySelector('img');
      out.push({
        href: el.href,
        text: (el.getAttribute('title') || el.textContent || '').trim().slice(0, 200),
        img: img?.getAttribute('src') ?? img?.getAttribute('data-src') ?? '',
        alt: img?.getAttribute('alt') ?? '',
      });
    }
    return out;
  });

  const byId = new Map<string, SearchHit>();
  for (const r of raw) {
    if (!cfg.videoHref.test(r.href)) continue;
    const videoId = cfg.idFrom(r.href);
    if (!videoId) continue;
    const prev = byId.get(videoId);
    const title = r.text || r.alt || '';
    const thumbnail = r.img.startsWith('//') ? `https:${r.img}` : r.img;
    // 여러 링크 중 정보가 더 많은 쪽을 남긴다
    if (!prev || (!prev.title && title) || (!prev.thumbnail && thumbnail)) {
      byId.set(videoId, {
        platform,
        videoId,
        url: r.href.split('?')[0],
        title: title || prev?.title || '',
        thumbnail: thumbnail || prev?.thumbnail || '',
        author: prev?.author ?? '',
      });
    }
  }
  return [...byId.values()];
}

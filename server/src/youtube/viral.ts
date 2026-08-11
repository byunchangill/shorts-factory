import type { YouTubeVideo, ViralItem } from '@shared/types';
import { ytFetch } from './client.js';
import { searchVideos, hydrateVideos, popularVideos, SHORTS_MAX_SEC } from './research.js';

/**
 * 바이럴 제품 발굴.
 *
 * 조회수만 보면 대형 채널이 목록을 독점한다 — 그건 "채널이 센 것"이지
 * "소재가 터진 것"이 아니다. 우리가 찾는 건 후자다:
 * 구독자 수 대비 조회수가 튀는 영상(이상치)이 곧 제품이 먹혔다는 신호다.
 */

/** 구독자 0(비공개)인 채널의 배수 계산이 무한대로 가지 않게 하는 하한 */
const MIN_SUBS = 100;

export interface ViralScore {
  viewsPerDay: number;
  /** 조회수 ÷ 구독자수 — 채널 규모를 걷어낸 순수 소재 성적 */
  outlierRatio: number;
  ageDays: number;
}

/**
 * 점수 계산. API 호출과 분리해 검증할 수 있게 순수 함수로 둔다.
 * @param now 테스트에서 시간을 고정하기 위해 주입받는다
 */
export function scoreVideo(
  video: Pick<YouTubeVideo, 'viewCount' | 'publishedAt'>,
  subscriberCount: number,
  now: Date = new Date(),
): ViralScore {
  const published = Date.parse(video.publishedAt);
  // 게시 당일 영상을 0일로 두면 나눗셈이 폭발한다 — 최소 반나절로 본다
  const ageDays = Number.isFinite(published)
    ? Math.max(0.5, (now.getTime() - published) / 86_400_000)
    : 1;
  return {
    viewsPerDay: Math.round(video.viewCount / ageDays),
    outlierRatio: Number((video.viewCount / Math.max(MIN_SUBS, subscriberCount)).toFixed(2)),
    ageDays: Number(ageDays.toFixed(1)),
  };
}

export type ViralSort = 'outlier' | 'viewsPerDay' | 'views' | 'newest';

export function sortViral(items: ViralItem[], sort: ViralSort): ViralItem[] {
  const by: Record<ViralSort, (a: ViralItem, b: ViralItem) => number> = {
    outlier: (a, b) => b.outlierRatio - a.outlierRatio,
    viewsPerDay: (a, b) => b.viewsPerDay - a.viewsPerDay,
    views: (a, b) => b.video.viewCount - a.video.viewCount,
    newest: (a, b) => b.video.publishedAt.localeCompare(a.video.publishedAt),
  };
  return [...items].sort(by[sort] ?? by.outlier);
}

/** 같은 영상이 여러 키워드에서 걸리므로 videoId로 합친다 (키워드는 모아둔다) */
export function dedupe(items: ViralItem[]): ViralItem[] {
  const map = new Map<string, ViralItem>();
  for (const it of items) {
    const prev = map.get(it.video.videoId);
    if (!prev) {
      map.set(it.video.videoId, it);
      continue;
    }
    prev.keywords = [...new Set([...prev.keywords, ...it.keywords])];
  }
  return [...map.values()];
}

/** 채널 구독자 수 조회 — channels.list는 1유닛이라 50개씩 묶으면 거의 공짜다 */
export async function fetchSubscribers(channelIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(channelIds)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const data = await ytFetch('channels', {
      part: 'statistics',
      id: chunk.join(','),
      maxResults: '50',
    });
    for (const it of data.items ?? []) {
      out.set(it.id, Number(it.statistics?.subscriberCount ?? 0));
    }
  }
  return out;
}

/** 모은 영상에 구독자 수를 채우고 점수를 매긴다 (수집 방식이 달라도 채점은 같다) */
async function scoreAll(
  videos: YouTubeVideo[],
  keywordOf: (v: YouTubeVideo) => string[],
  shortsOnly: boolean,
): Promise<ViralItem[]> {
  const subs = await fetchSubscribers(videos.map((v) => v.channelId));
  const now = new Date();
  const discoveredAt = now.toISOString();
  const items = videos.map((video) => {
    const subscriberCount = subs.get(video.channelId) ?? 0;
    const s = scoreVideo(video, subscriberCount, now);
    return {
      video,
      source: 'youtube' as const,
      keywords: keywordOf(video),
      subscriberCount,
      viewsPerDay: s.viewsPerDay,
      outlierRatio: s.outlierRatio,
      ageDays: s.ageDays,
      discoveredAt,
      note: '',
    };
  });
  return shortsOnly ? items.filter((i) => i.video.durationSec <= SHORTS_MAX_SEC) : items;
}

/**
 * 카테고리 인기 급상승 (videos.list chart=mostPopular — **2유닛**).
 *
 * 검색보다 50배 싸지만 성격이 다르다: 유튜브 전체에서 지금 뜨는 것이라
 * 대형 채널·음악이 많고, 유튜브 카테고리에는 "주방용품" 같은 제품군이 없다.
 * 넓게 훑는 용도이지 제품군을 파는 용도가 아니다.
 */
export async function discoverByCategory(opts: {
  categoryId?: string;
  shortsOnly?: boolean;
  regionCode?: string;
}): Promise<ViralItem[]> {
  const videos = await popularVideos({
    categoryId: opts.categoryId,
    regionCode: opts.regionCode,
    shortsOnly: opts.shortsOnly ?? true,
    maxResults: 50,
  });
  return scoreAll(videos, () => [], opts.shortsOnly ?? true);
}

/**
 * 등록한 채널들의 최신 업로드 (**채널당 2유닛**).
 *
 * 제품군을 파려면 이쪽이 맞다 — 쇼핑 쇼츠 채널만 골라 등록해두면
 * 검색 1회(100유닛) 값으로 채널 50개를 훑는다. 하루 수백 번 돌려도 남는다.
 */
export async function discoverByChannels(opts: {
  channelIds: string[];
  withinDays?: number;
  shortsOnly?: boolean;
  perChannel?: number;
}): Promise<ViralItem[]> {
  const withinDays = opts.withinDays ?? 14;
  const cutoff = Date.now() - withinDays * 86_400_000;
  const uploads = await fetchUploadPlaylists(opts.channelIds);

  const ids: string[] = [];
  for (const playlistId of uploads.values()) {
    const data = await ytFetch('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: String(Math.min(opts.perChannel ?? 20, 50)),
    });
    for (const it of data.items ?? []) {
      const vid = it.contentDetails?.videoId;
      const at = it.contentDetails?.videoPublishedAt;
      // 오래된 영상은 아예 조회하지 않는다 — hydrate 비용과 목록 잡음을 같이 줄인다
      if (vid && (!at || Date.parse(at) >= cutoff)) ids.push(vid);
    }
  }

  const videos = await hydrateVideos([...new Set(ids)]);
  return scoreAll(videos, () => [], opts.shortsOnly ?? true);
}

/** 채널 → 업로드 재생목록 id (channels.list 1유닛, 50개씩 묶음) */
export async function fetchUploadPlaylists(channelIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(channelIds)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 50) {
    const data = await ytFetch('channels', {
      part: 'contentDetails',
      id: unique.slice(i, i + 50).join(','),
      maxResults: '50',
    });
    for (const it of data.items ?? []) {
      const pid = it.contentDetails?.relatedPlaylists?.uploads;
      if (pid) out.set(it.id, pid);
    }
  }
  return out;
}

export interface ResolvedChannel {
  channelId: string;
  title: string;
  thumbnail: string;
  subscriberCount: number;
}

/**
 * 채널 주소·핸들·ID에서 채널을 찾는다 (**1유닛**).
 *
 * 채널명 검색(search.list)은 100유닛이라 등록 몇 개에 하루치를 태운다.
 * 주소를 붙여넣게 하면 id/handle을 뽑아 1유닛으로 끝난다.
 */
export function parseChannelRef(input: string): { id?: string; handle?: string } {
  const s = input.trim();
  if (/^UC[\w-]{20,}$/.test(s)) return { id: s };
  if (s.startsWith('@')) return { handle: s.slice(1) };
  const byId = s.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (byId) return { id: byId[1] };
  const byHandle = s.match(/youtube\.com\/@([^/?#\s]+)/);
  if (byHandle) return { handle: byHandle[1] };
  return {};
}

export async function resolveChannel(input: string): Promise<ResolvedChannel> {
  const ref = parseChannelRef(input);
  if (!ref.id && !ref.handle) {
    throw Object.assign(
      new Error('채널 주소를 붙여넣으세요 (예: https://www.youtube.com/@채널핸들). 채널명 검색은 쿼터를 100배 씁니다'),
      { status: 400 },
    );
  }
  const params: Record<string, string> = { part: 'snippet,statistics' };
  if (ref.id) params.id = ref.id;
  else params.forHandle = `@${ref.handle}`;

  const data = await ytFetch('channels', params);
  const ch = data.items?.[0];
  if (!ch) throw Object.assign(new Error('채널을 찾지 못했습니다'), { status: 404 });
  return {
    channelId: ch.id,
    title: ch.snippet?.title ?? '',
    thumbnail: ch.snippet?.thumbnails?.default?.url ?? '',
    subscriberCount: Number(ch.statistics?.subscriberCount ?? 0),
  };
}

export interface DiscoverOptions {
  keywords: string[];
  /** 며칠 이내 게시된 영상만 — 이미 포화된 소재를 거른다 */
  withinDays?: number;
  shortsOnly?: boolean;
  perKeyword?: number;
}

/**
 * 키워드별로 검색해 점수를 매긴 목록을 만든다.
 *
 * 비용: 키워드당 search.list 100유닛 + videos.list 1유닛,
 * 마지막에 channels.list 1~2유닛. 키워드 10개면 약 1,020유닛
 * (무료 한도 10,000/일 기준 하루 9회 갱신).
 */
export async function discoverViral(opts: DiscoverOptions): Promise<ViralItem[]> {
  const withinDays = opts.withinDays ?? 7;
  const collected: ViralItem[] = [];

  for (const keyword of opts.keywords) {
    const videos = await searchVideos({
      query: keyword,
      shortsOnly: opts.shortsOnly ?? true,
      order: 'viewCount',
      publishedWithinDays: withinDays,
      maxResults: opts.perKeyword ?? 25,
    });
    for (const video of videos) {
      collected.push({
        video,
        keywords: [keyword],
        subscriberCount: 0,
        viewsPerDay: 0,
        outlierRatio: 0,
        ageDays: 0,
        source: 'youtube',
        discoveredAt: new Date().toISOString(),
      });
    }
  }

  const merged = dedupe(collected);
  const subs = await fetchSubscribers(merged.map((m) => m.video.channelId));
  const now = new Date();
  for (const item of merged) {
    const subscriberCount = subs.get(item.video.channelId) ?? 0;
    const s = scoreVideo(item.video, subscriberCount, now);
    item.subscriberCount = subscriberCount;
    item.viewsPerDay = s.viewsPerDay;
    item.outlierRatio = s.outlierRatio;
    item.ageDays = s.ageDays;
  }
  // 쇼츠만 보겠다고 했으면 길이로 한 번 더 거른다 (search의 videoDuration=short는 4분 기준이라 헐겁다)
  return opts.shortsOnly === false
    ? merged
    : merged.filter((m) => m.video.durationSec <= SHORTS_MAX_SEC);
}

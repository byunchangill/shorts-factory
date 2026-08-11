import type { YouTubeVideo, ViralItem } from '@shared/types';
import { ytFetch } from './client.js';
import { searchVideos, SHORTS_MAX_SEC } from './research.js';

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

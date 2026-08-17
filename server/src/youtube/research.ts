import type { YouTubeVideo, ChannelAnalysis } from '@shared/types';
import { ytFetch, parseDuration } from './client.js';

/** 쇼츠 판정 기준 — 유튜브 쇼츠는 3분 이하 */
export const SHORTS_MAX_SEC = 180;

interface RawVideo {
  id: string | { videoId: string };
  snippet?: {
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails?: Record<string, { url: string }>;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

function toVideo(raw: RawVideo): YouTubeVideo {
  const videoId = typeof raw.id === 'string' ? raw.id : raw.id.videoId;
  const sn = raw.snippet;
  const thumbs = sn?.thumbnails ?? {};
  return {
    videoId,
    title: sn?.title ?? '',
    channelId: sn?.channelId ?? '',
    channelTitle: sn?.channelTitle ?? '',
    publishedAt: sn?.publishedAt ?? '',
    thumbnail: thumbs.medium?.url ?? thumbs.default?.url ?? thumbs.high?.url ?? '',
    viewCount: Number(raw.statistics?.viewCount ?? 0),
    likeCount: Number(raw.statistics?.likeCount ?? 0),
    commentCount: Number(raw.statistics?.commentCount ?? 0),
    durationSec: parseDuration(raw.contentDetails?.duration ?? ''),
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/** videoId 목록 → 통계·길이가 채워진 영상 정보 (videos.list는 1유닛으로 저렴) */
export async function hydrateVideos(videoIds: string[]): Promise<YouTubeVideo[]> {
  if (videoIds.length === 0) return [];
  const out: YouTubeVideo[] = [];
  // videos.list는 한 번에 50개까지
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await ytFetch('videos', {
      part: 'snippet,statistics,contentDetails',
      id: chunk.join(','),
      maxResults: '50',
    });
    out.push(...(data.items ?? []).map(toVideo));
  }
  return out;
}

export interface SearchOptions {
  query: string;
  shortsOnly?: boolean;
  order?: 'viewCount' | 'date' | 'relevance';
  publishedWithinDays?: number;
  regionCode?: string;
  maxResults?: number;
}

/** 키워드 검색 (search.list 100유닛 + videos.list 1유닛) */
export async function searchVideos(opts: SearchOptions): Promise<YouTubeVideo[]> {
  const params: Record<string, string> = {
    part: 'id',
    type: 'video',
    q: opts.query,
    order: opts.order ?? 'viewCount',
    maxResults: String(Math.min(opts.maxResults ?? 25, 50)),
    regionCode: opts.regionCode ?? 'KR',
    relevanceLanguage: 'ko',
  };
  if (opts.shortsOnly) params.videoDuration = 'short'; // 4분 미만
  if (opts.publishedWithinDays) {
    const after = new Date(Date.now() - opts.publishedWithinDays * 86400_000);
    params.publishedAfter = after.toISOString();
  }

  const data = await ytFetch('search', params);
  const ids = (data.items ?? [])
    .map((it: { id?: { videoId?: string } }) => it.id?.videoId)
    .filter((v: string | undefined): v is string => !!v);

  const videos = await hydrateVideos(ids);
  const filtered = opts.shortsOnly ? videos.filter((v) => v.durationSec <= SHORTS_MAX_SEC) : videos;
  return sortVideos(filtered, opts.order ?? 'viewCount');
}

function sortVideos(videos: YouTubeVideo[], order: string): YouTubeVideo[] {
  if (order === 'date') {
    return [...videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  if (order === 'viewCount') {
    return [...videos].sort((a, b) => b.viewCount - a.viewCount);
  }
  return videos;
}

/** 인기 급상승 (videos.list chart=mostPopular — 1유닛, 검색보다 100배 저렴) */
export async function popularVideos(opts: {
  regionCode?: string;
  categoryId?: string;
  shortsOnly?: boolean;
  maxResults?: number;
}): Promise<YouTubeVideo[]> {
  const params: Record<string, string> = {
    part: 'snippet,statistics,contentDetails',
    chart: 'mostPopular',
    regionCode: opts.regionCode ?? 'KR',
    maxResults: String(Math.min(opts.maxResults ?? 50, 50)),
  };
  if (opts.categoryId) params.videoCategoryId = opts.categoryId;
  const data = await ytFetch('videos', params);
  const videos = (data.items ?? []).map(toVideo);
  return opts.shortsOnly ? videos.filter((v: YouTubeVideo) => v.durationSec <= SHORTS_MAX_SEC) : videos;
}

export async function videoCategories(regionCode = 'KR'): Promise<Array<{ id: string; title: string }>> {
  const data = await ytFetch('videoCategories', { part: 'snippet', regionCode });
  return (data.items ?? [])
    .filter((it: { snippet?: { assignable?: boolean } }) => it.snippet?.assignable !== false)
    .map((it: { id: string; snippet: { title: string } }) => ({ id: it.id, title: it.snippet.title }));
}

export interface ChannelHit {
  channelId: string; title: string; description: string; thumbnail: string;
  subscriberCount: number; videoCount: number; totalViewCount: number;
}

/** 채널 검색 (search.list 100유닛 + channels.list 1유닛 — 구독자·영상 수를 채운다) */
export async function searchChannels(query: string): Promise<ChannelHit[]> {
  const data = await ytFetch('search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: '10',
    regionCode: 'KR',
  });
  const hits: ChannelHit[] = (data.items ?? []).map((it: {
    id: { channelId: string };
    snippet: { title: string; description: string; thumbnails?: Record<string, { url: string }> };
  }) => ({
    channelId: it.id.channelId,
    title: it.snippet.title,
    description: it.snippet.description,
    thumbnail: it.snippet.thumbnails?.medium?.url ?? it.snippet.thumbnails?.default?.url ?? '',
    subscriberCount: 0,
    videoCount: 0,
    totalViewCount: 0,
  }));
  if (hits.length === 0) return hits;

  // channels.list 한 번(1유닛)이면 10개 통계가 다 온다 — 카드에 보여줄 값
  const stats = await ytFetch('channels', {
    part: 'statistics',
    id: hits.map((h) => h.channelId).join(','),
    maxResults: '50',
  });
  const byId = new Map<string, { subscriberCount?: string; videoCount?: string; viewCount?: string }>(
    (stats.items ?? []).map((it: { id: string; statistics?: Record<string, string> }) => [it.id, it.statistics ?? {}]),
  );
  for (const h of hits) {
    const s = byId.get(h.channelId);
    h.subscriberCount = Number(s?.subscriberCount ?? 0);
    h.videoCount = Number(s?.videoCount ?? 0);
    h.totalViewCount = Number(s?.viewCount ?? 0);
  }
  return hits;
}

/**
 * 채널 분석 — 검색을 쓰지 않고 uploads 재생목록을 타고 들어가
 * 총 3유닛(channels 1 + playlistItems 1 + videos 1)으로 최근 영상 통계를 모은다.
 */
export async function analyzeChannel(channelId: string, sampleSize = 50): Promise<ChannelAnalysis> {
  const chData = await ytFetch('channels', {
    part: 'snippet,statistics,contentDetails',
    id: channelId,
  });
  const ch = chData.items?.[0];
  if (!ch) throw Object.assign(new Error('채널을 찾을 수 없습니다'), { status: 404 });

  const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads;
  let recentVideos: YouTubeVideo[] = [];
  if (uploadsId) {
    const plData = await ytFetch('playlistItems', {
      part: 'contentDetails',
      playlistId: uploadsId,
      maxResults: String(Math.min(sampleSize, 50)),
    });
    const ids = (plData.items ?? [])
      .map((it: { contentDetails?: { videoId?: string } }) => it.contentDetails?.videoId)
      .filter((v: string | undefined): v is string => !!v);
    recentVideos = await hydrateVideos(ids);
  }

  const avgViews = recentVideos.length
    ? Math.round(recentVideos.reduce((s, v) => s + v.viewCount, 0) / recentVideos.length)
    : 0;

  return {
    channelId,
    title: ch.snippet?.title ?? '',
    description: ch.snippet?.description ?? '',
    thumbnail: ch.snippet?.thumbnails?.medium?.url ?? ch.snippet?.thumbnails?.default?.url ?? '',
    subscriberCount: Number(ch.statistics?.subscriberCount ?? 0),
    videoCount: Number(ch.statistics?.videoCount ?? 0),
    totalViewCount: Number(ch.statistics?.viewCount ?? 0),
    avgViews,
    uploadsPerWeek: uploadsPerWeek(recentVideos),
    shortsRatio: recentVideos.length
      ? recentVideos.filter((v) => v.durationSec <= SHORTS_MAX_SEC).length / recentVideos.length
      : 0,
    recentVideos: [...recentVideos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    topVideos: [...recentVideos].sort((a, b) => b.viewCount - a.viewCount).slice(0, 10),
  };
}

/** 최신·최오래 영상 사이 기간으로 주당 업로드 수를 추정한다 (순수 함수 — 테스트 대상) */
export function uploadsPerWeek(videos: Array<{ publishedAt: string }>): number {
  if (videos.length < 2) return 0;
  const times = videos
    .map((v) => new Date(v.publishedAt).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return 0;
  const spanWeeks = (times[times.length - 1] - times[0]) / (7 * 86400_000);
  if (spanWeeks <= 0) return times.length;
  return Math.round((times.length / spanWeeks) * 10) / 10;
}

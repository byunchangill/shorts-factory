import { getAccessToken } from './oauth.js';
import { hydrateVideos } from './research.js';
import type { YouTubeVideo } from '@shared/types';

/**
 * 내 채널 분석 — YouTube Analytics API(무료).
 * Data API 쿼터와 별개이며, 비공개 지표(시청 지속시간·트래픽 소스 등)를 읽는다.
 */

const ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_BASE = 'https://www.googleapis.com/youtube/v3';

async function authedFetch(url: string): Promise<any> {
  const token = await getAccessToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw Object.assign(
      new Error(`YouTube Analytics 오류 ${r.status}: ${body.slice(0, 300)}`),
      { status: r.status },
    );
  }
  return r.json();
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeDates(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  return { start: ymd(start), end: ymd(end) };
}

/** 내 채널 기본 정보 (Data API mine=true — Analytics 호출에 channelId가 필요) */
export async function myChannel(): Promise<{
  channelId: string; title: string; thumbnail: string;
  subscriberCount: number; videoCount: number; totalViewCount: number;
  uploadsPlaylistId: string;
}> {
  const url = new URL(`${DATA_BASE}/channels`);
  url.searchParams.set('part', 'snippet,statistics,contentDetails');
  url.searchParams.set('mine', 'true');
  const data = await authedFetch(url.toString());
  const ch = data.items?.[0];
  if (!ch) throw new Error('연결된 계정에 채널이 없습니다');
  return {
    channelId: ch.id,
    title: ch.snippet?.title ?? '',
    thumbnail: ch.snippet?.thumbnails?.medium?.url ?? '',
    subscriberCount: Number(ch.statistics?.subscriberCount ?? 0),
    videoCount: Number(ch.statistics?.videoCount ?? 0),
    totalViewCount: Number(ch.statistics?.viewCount ?? 0),
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? '',
  };
}

export interface ChannelSummary {
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  subscribersGained: number;
  subscribersLost: number;
}

/** 기간 합계 지표 */
export async function channelSummary(days = 28): Promise<ChannelSummary> {
  const { start, end } = rangeDates(days);
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', start);
  url.searchParams.set('endDate', end);
  url.searchParams.set(
    'metrics',
    'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost',
  );
  const data = await authedFetch(url.toString());
  const row = data.rows?.[0] ?? [];
  return {
    views: row[0] ?? 0,
    estimatedMinutesWatched: row[1] ?? 0,
    averageViewDuration: row[2] ?? 0,
    averageViewPercentage: row[3] ?? 0,
    subscribersGained: row[4] ?? 0,
    subscribersLost: row[5] ?? 0,
  };
}

/** 일자별 조회수 추이 */
export async function dailyViews(days = 28): Promise<Array<{ date: string; views: number; watchMinutes: number }>> {
  const { start, end } = rangeDates(days);
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', start);
  url.searchParams.set('endDate', end);
  url.searchParams.set('metrics', 'views,estimatedMinutesWatched');
  url.searchParams.set('dimensions', 'day');
  url.searchParams.set('sort', 'day');
  const data = await authedFetch(url.toString());
  return (data.rows ?? []).map((r: [string, number, number]) => ({
    date: r[0],
    views: r[1],
    watchMinutes: r[2],
  }));
}

/** 트래픽 소스 — 어디서 유입됐는지 */
export async function trafficSources(days = 28): Promise<Array<{ source: string; views: number }>> {
  const { start, end } = rangeDates(days);
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', start);
  url.searchParams.set('endDate', end);
  url.searchParams.set('metrics', 'views');
  url.searchParams.set('dimensions', 'insightTrafficSourceType');
  url.searchParams.set('sort', '-views');
  const data = await authedFetch(url.toString());
  return (data.rows ?? []).map((r: [string, number]) => ({
    source: TRAFFIC_LABELS[r[0]] ?? r[0],
    views: r[1],
  }));
}

const TRAFFIC_LABELS: Record<string, string> = {
  ADVERTISING: '광고',
  ANNOTATION: '카드/최종화면',
  CAMPAIGN_CARD: '캠페인',
  END_SCREEN: '최종화면',
  EXT_URL: '외부 사이트',
  NO_LINK_EMBEDDED: '외부 임베드',
  NO_LINK_OTHER: '직접 유입',
  NOTIFICATION: '알림',
  PLAYLIST: '재생목록',
  PROMOTED: '프로모션',
  RELATED_VIDEO: '추천 영상',
  SHORTS: '쇼츠 피드',
  SUBSCRIBER: '구독 피드',
  YT_CHANNEL: '채널 페이지',
  YT_OTHER_PAGE: '기타 유튜브',
  YT_SEARCH: '유튜브 검색',
};

/** 영상별 성과 TOP N (비공개 지표 포함) */
export async function topVideos(days = 28, limit = 10): Promise<Array<
  YouTubeVideo & { watchMinutes: number; avgViewDuration: number; avgViewPercentage: number }
>> {
  const { start, end } = rangeDates(days);
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', start);
  url.searchParams.set('endDate', end);
  url.searchParams.set('metrics', 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage');
  url.searchParams.set('dimensions', 'video');
  url.searchParams.set('sort', '-views');
  url.searchParams.set('maxResults', String(limit));
  const data = await authedFetch(url.toString());
  const rows: Array<[string, number, number, number, number]> = data.rows ?? [];
  if (rows.length === 0) return [];

  // 제목·썸네일은 Data API로 보강 (videos.list = 1유닛)
  const videos = await hydrateVideos(rows.map((r) => r[0]));
  const byId = new Map(videos.map((v) => [v.videoId, v]));

  return rows.map((r) => {
    const base = byId.get(r[0]) ?? {
      videoId: r[0], title: r[0], channelId: '', channelTitle: '', publishedAt: '',
      thumbnail: '', viewCount: 0, likeCount: 0, commentCount: 0, durationSec: 0,
      url: `https://www.youtube.com/watch?v=${r[0]}`,
    };
    return {
      ...base,
      viewCount: r[1], // 기간 내 조회수로 대체
      watchMinutes: r[2],
      avgViewDuration: r[3],
      avgViewPercentage: r[4],
    };
  });
}

/**
 * 영상 한 편의 지표 — 성과 대장을 채우는 자리.
 *
 * 🔴 **「계속 시청함」은 여기 없다.** 그건 쇼츠 피드에서 스와이프로 넘기지 않은 비율이고
 * 유튜브 스튜디오 화면에만 있다. API가 주는 것은 평균 조회율(avgViewPercentage)까지라,
 * 대장의 `retained_pct`는 사람이 손으로 적는다. 둘은 스케일이 아예 다르다 —
 * 실제 원장에 계속시청 12.4% / 평균 조회율 80.0%인 편이 있다.
 */
export async function videoMetrics(videoId: string, days = 90): Promise<{
  views: number; avgViewPercentage: number; avgViewDuration: number;
  likes: number; comments: number; shares: number;
}> {
  const { start, end } = rangeDates(days);
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', start);
  url.searchParams.set('endDate', end);
  url.searchParams.set('metrics', 'views,averageViewPercentage,averageViewDuration,likes,comments,shares');
  url.searchParams.set('filters', `video==${videoId}`);
  const data = await authedFetch(url.toString());
  const row = data.rows?.[0] ?? [];
  return {
    views: row[0] ?? 0,
    avgViewPercentage: row[1] ?? 0,
    avgViewDuration: row[2] ?? 0,
    likes: row[3] ?? 0,
    comments: row[4] ?? 0,
    shares: row[5] ?? 0,
  };
}

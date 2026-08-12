import { describe, it, expect } from 'vitest';
import type { ViralItem } from '@shared/types';
import { scoreVideo, sortViral, dedupe, parseChannelRef } from './viral.js';

const NOW = new Date('2026-08-11T00:00:00Z');

function item(over: Partial<ViralItem> & { videoId: string; viewCount: number; publishedAt: string }): ViralItem {
  return {
    video: {
      videoId: over.videoId, title: '', channelId: `c-${over.videoId}`, channelTitle: '',
      publishedAt: over.publishedAt, thumbnail: '', viewCount: over.viewCount,
      likeCount: 0, commentCount: 0, durationSec: 30, url: '',
    },
    source: 'youtube',
    keywords: over.keywords ?? [],
    subscriberCount: over.subscriberCount ?? 0,
    viewsPerDay: over.viewsPerDay ?? 0,
    outlierRatio: over.outlierRatio ?? 0,
    ageDays: 0,
    discoveredAt: '',
    note: '',
  };
}

describe('scoreVideo', () => {
  it('구독자 대비 배수로 "채널이 센 것"과 "소재가 터진 것"을 가른다', () => {
    // 대형 채널의 평범한 영상: 조회수는 크지만 구독자 대비로는 0.1배
    const big = scoreVideo({ viewCount: 100_000, publishedAt: '2026-08-08T00:00:00Z' }, 1_000_000, NOW);
    // 소형 채널의 터진 영상: 조회수는 작아도 구독자 대비 60배
    const small = scoreVideo({ viewCount: 60_000, publishedAt: '2026-08-08T00:00:00Z' }, 1_000, NOW);
    expect(small.outlierRatio).toBeGreaterThan(big.outlierRatio);
    expect(big.outlierRatio).toBeCloseTo(0.1, 2);
    expect(small.outlierRatio).toBe(60);
  });

  it('일일 조회수는 게시 후 경과일로 나눈다', () => {
    const s = scoreVideo({ viewCount: 90_000, publishedAt: '2026-08-08T00:00:00Z' }, 1_000, NOW);
    expect(s.ageDays).toBe(3);
    expect(s.viewsPerDay).toBe(30_000);
  });

  it('오늘 올라온 영상도 0으로 나누지 않는다', () => {
    const s = scoreVideo({ viewCount: 10_000, publishedAt: NOW.toISOString() }, 1_000, NOW);
    expect(Number.isFinite(s.viewsPerDay)).toBe(true);
    expect(s.ageDays).toBe(0.5);
  });

  it('구독자를 감춘 채널도 배수가 무한대가 되지 않는다', () => {
    const s = scoreVideo({ viewCount: 50_000, publishedAt: '2026-08-10T00:00:00Z' }, 0, NOW);
    expect(Number.isFinite(s.outlierRatio)).toBe(true);
    expect(s.outlierRatio).toBe(500); // 하한 100명으로 계산
  });

  it('게시일이 이상해도 죽지 않는다', () => {
    const s = scoreVideo({ viewCount: 100, publishedAt: '' }, 100, NOW);
    expect(Number.isFinite(s.viewsPerDay)).toBe(true);
  });
});

describe('dedupe', () => {
  it('같은 영상이 여러 키워드에서 걸리면 하나로 합치고 키워드를 모은다', () => {
    const merged = dedupe([
      item({ videoId: 'a', viewCount: 10, publishedAt: '2026-08-10T00:00:00Z', keywords: ['주방수납'] }),
      item({ videoId: 'a', viewCount: 10, publishedAt: '2026-08-10T00:00:00Z', keywords: ['틈새장'] }),
      item({ videoId: 'b', viewCount: 10, publishedAt: '2026-08-10T00:00:00Z', keywords: ['주방수납'] }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].keywords.sort()).toEqual(['주방수납', '틈새장']);
  });
});

describe('sortViral', () => {
  const items = [
    item({ videoId: 'big', viewCount: 1_000_000, publishedAt: '2026-08-01T00:00:00Z', outlierRatio: 0.5, viewsPerDay: 100_000 }),
    item({ videoId: 'outlier', viewCount: 50_000, publishedAt: '2026-08-10T00:00:00Z', outlierRatio: 50, viewsPerDay: 50_000 }),
  ];

  it('기본 정렬(이상치)은 소형 채널의 터진 영상을 위로 올린다', () => {
    expect(sortViral(items, 'outlier')[0].video.videoId).toBe('outlier');
  });

  it('조회수 정렬은 대형 채널 영상을 위로 올린다', () => {
    expect(sortViral(items, 'views')[0].video.videoId).toBe('big');
  });

  it('최신순은 게시일 기준', () => {
    expect(sortViral(items, 'newest')[0].video.videoId).toBe('outlier');
  });

  it('원본 배열을 건드리지 않는다', () => {
    const before = items.map((i) => i.video.videoId);
    sortViral(items, 'views');
    expect(items.map((i) => i.video.videoId)).toEqual(before);
  });
});

describe('parseChannelRef', () => {
  it('채널 주소에서 ID를 뽑는다', () => {
    expect(parseChannelRef('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'))
      .toEqual({ id: 'UCabcdefghijklmnopqrstuv' });
  });

  it('핸들 주소에서 핸들을 뽑는다', () => {
    expect(parseChannelRef('https://www.youtube.com/@살림하는유진')).toEqual({ handle: '살림하는유진' });
    expect(parseChannelRef('https://www.youtube.com/@handle/shorts')).toEqual({ handle: 'handle' });
  });

  it('@핸들과 raw ID도 그대로 받는다', () => {
    expect(parseChannelRef('@handle')).toEqual({ handle: 'handle' });
    expect(parseChannelRef('UCabcdefghijklmnopqrstuv')).toEqual({ id: 'UCabcdefghijklmnopqrstuv' });
  });

  it('채널명만 넣으면 비어 있게 돌려준다 (검색은 100유닛이라 대신 돌리지 않는다)', () => {
    expect(parseChannelRef('살림하는유진')).toEqual({});
    expect(parseChannelRef('https://www.youtube.com/watch?v=abc')).toEqual({});
  });
});

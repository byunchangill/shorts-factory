import { describe, it, expect } from 'vitest';
import { todayKey, rollOver, remaining } from './quota.js';
import { YOUTUBE_DAILY_QUOTA } from '@shared/constants';

describe('youtube quota', () => {
  it('오늘 날짜 키 형식', () => {
    expect(todayKey(new Date(2026, 7, 10))).toBe('2026-08-10');
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('같은 날이면 사용량 유지', () => {
    const led = { date: '2026-08-10', used: 500 };
    expect(rollOver(led, '2026-08-10')).toEqual(led);
  });

  it('날짜가 바뀌면 0으로 리셋', () => {
    expect(rollOver({ date: '2026-08-09', used: 9800 }, '2026-08-10')).toEqual({
      date: '2026-08-10',
      used: 0,
    });
  });

  it('잔여 쿼터 계산', () => {
    expect(remaining({ date: 'x', used: 0 })).toBe(YOUTUBE_DAILY_QUOTA);
    expect(remaining({ date: 'x', used: 9900 })).toBe(100);
    expect(remaining({ date: 'x', used: 99999 })).toBe(0);
  });
});

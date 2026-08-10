import { describe, it, expect } from 'vitest';
import { charBudget, estimateSeconds, TARGET_SEC, CHARS_PER_MIN } from '@shared/constants';
import { SettingsSchema } from '@shared/types';

describe('대본 분량 계산', () => {
  it('기본 배속은 1.25배', () => {
    expect(SettingsSchema.parse({}).speechRate).toBe(1.25);
  });

  it('목표는 30초 이내', () => {
    expect(TARGET_SEC.max).toBe(30);
    expect(TARGET_SEC.min).toBe(20);
  });

  it('1.25배속에서 30초는 187자', () => {
    const b = charBudget(1.25);
    expect(b.max).toBe(187);
    expect(b.min).toBe(125);   // 20초
    expect(b.recommended).toBe(169); // 27초
  });

  it('배속이 오르면 같은 시간에 더 많은 글자를 쓸 수 있다', () => {
    expect(charBudget(1.5).max).toBeGreaterThan(charBudget(1.25).max);
    expect(charBudget(1.0).max).toBeLessThan(charBudget(1.25).max);
  });

  it('정속(1.0)에서 30초는 150자', () => {
    expect(charBudget(1.0).max).toBe(150);
  });

  it('글자 수 → 시간 환산이 역함수로 맞아떨어진다', () => {
    for (const rate of [1.0, 1.25, 1.3, 1.5]) {
      const b = charBudget(rate);
      expect(estimateSeconds(b.max, rate)).toBeCloseTo(TARGET_SEC.max, 0);
      expect(estimateSeconds(b.min, rate)).toBeCloseTo(TARGET_SEC.min, 0);
    }
  });

  it('실측 중앙값 287자는 1.25배속에서도 30초를 넘는다 — 반려 대상', () => {
    // 첨부 데이터의 대본 길이를 그대로 쓰면 이 채널 기준으로는 길다는 사실을 고정한다
    expect(estimateSeconds(287, 1.25)).toBeGreaterThan(TARGET_SEC.max);
  });

  it('정속 낭독 속도는 분당 300자', () => {
    expect(CHARS_PER_MIN).toBe(300);
  });
});

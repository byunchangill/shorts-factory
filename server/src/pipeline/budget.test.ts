import { describe, it, expect } from 'vitest';
import {
  charBudget, estimateSeconds, TARGET_SEC, TARGET_SEC_BY_MENU, CHARS_PER_MIN,
} from '@shared/constants';
import { SettingsSchema } from '@shared/types';

describe('대본 분량 계산', () => {
  it('기본 배속은 1.25배', () => {
    expect(SettingsSchema.parse({}).speechRate).toBe(1.25);
  });

  // 기본값(메뉴 미지정)은 해외영상 짜집기 기준이고, 그 기준은 기본 대본 스킬이 정한다
  it('목표는 28초 이내', () => {
    expect(TARGET_SEC.max).toBe(28);
    expect(TARGET_SEC.min).toBe(20);
  });

  it('1.25배속에서 28초는 175자', () => {
    const b = charBudget(1.25);
    expect(b.max).toBe(175);
    expect(b.min).toBe(125);   // 20초
    expect(b.recommended).toBe(138); // 22초
  });

  it('배속이 오르면 같은 시간에 더 많은 글자를 쓸 수 있다', () => {
    expect(charBudget(1.5).max).toBeGreaterThan(charBudget(1.25).max);
    expect(charBudget(1.0).max).toBeLessThan(charBudget(1.25).max);
  });

  it('정속(1.0)에서 28초는 140자', () => {
    expect(charBudget(1.0).max).toBe(140);
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

  describe('메뉴별 목표 길이', () => {
    it('제품정보리뷰는 22초 권장 · 26초 상한으로 더 짧다', () => {
      const b = TARGET_SEC_BY_MENU['menu-b'];
      expect(b.recommended).toBe(22);
      expect(b.max).toBe(26);
      expect(b.min).toBe(18);
    });

    it('두 메뉴 모두 30초를 넘지 않는다', () => {
      for (const t of Object.values(TARGET_SEC_BY_MENU)) {
        expect(t.max).toBeLessThanOrEqual(30);
        expect(t.min).toBeLessThan(t.recommended);
        expect(t.recommended).toBeLessThan(t.max);
      }
    });

    it('제품정보리뷰 분량이 해외영상 짜집기보다 짧게 계산된다', () => {
      expect(charBudget(1.25, 'menu-b').max).toBeLessThan(charBudget(1.25, 'menu-a').max);
      expect(charBudget(1.25, 'menu-b').recommended).toBe(138); // 22초
      expect(charBudget(1.25, 'menu-b').max).toBe(162);         // 26초
    });

    it('메뉴를 안 주면 해외영상 짜집기 기준을 쓴다 (기존 호출부 보호)', () => {
      expect(charBudget(1.25)).toEqual(charBudget(1.25, 'menu-a'));
    });
  });
});

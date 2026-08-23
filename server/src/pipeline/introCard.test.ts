import { describe, it, expect } from 'vitest';
import { skipIntroCard } from './assemble.js';

/*
  틱톡·샤오홍슈 소재는 앞 0.1~0.5초가 제목 카드다. 프레임 추출(1초 간격)이
  이 구간을 한 장도 못 봐서 존이 안 생기고, 완성본의 첫 프레임 —
  유튜브 썸네일이 되는 그 화면 — 에 외국어 큰 글자가 그대로 남았다.
  실측 사례: 书房·6m² 가 0~0.133초 (2026-08-23).
*/
describe('skipIntroCard', () => {
  it('첫 씬 경계가 코앞이면 그 뒤로 컷 시작을 민다', () => {
    expect(skipIntroCard(0, [0.133, 1.6])).toBeCloseTo(0.183, 3);
  });

  it('경계에 딱 붙이지 않는다 — 검출이 한 프레임 어긋나도 카드가 안 샌다', () => {
    expect(skipIntroCard(0, [0.4])).toBeGreaterThan(0.4);
  });

  it('사용자가 이미 카드 뒤를 골랐으면 건드리지 않는다', () => {
    expect(skipIntroCard(3, [0.133, 1.6])).toBe(3);
  });

  it('첫 경계가 늦으면 인트로 카드가 아니다 — 멀쩡한 장면을 자르지 않는다', () => {
    expect(skipIntroCard(0, [1.6, 4.2])).toBe(0);
  });

  it('경계가 0이면(첫 프레임이 곧 장면 시작) 밀 곳이 없다', () => {
    expect(skipIntroCard(0, [0, 2.1])).toBe(0);
  });

  it('씬 경계를 못 쟀으면 그대로 둔다 — 못 쟀다고 컷을 옮기지 않는다', () => {
    expect(skipIntroCard(0.5, [])).toBe(0.5);
    expect(skipIntroCard(0.5, undefined)).toBe(0.5);
  });
});

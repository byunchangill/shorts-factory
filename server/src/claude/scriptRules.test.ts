import { describe, it, expect } from 'vitest';
import { packetMenu, scriptRuleErrors } from './scriptRules.js';

const scene = (id: string, narration: string, isDownside = false) => ({
  sceneId: id, narration, subtitle: '', isDownside,
});

/** menu-b 규칙은 배속·제품명을 보지 않는다 — 교리 검사는 menu-a에서만 돈다 */
const CTX = { speechRate: 1.33 };

describe('패킷 메뉴 판별', () => {
  it('저장된 menu를 먼저 쓴다', () => {
    expect(packetMenu({ menu: 'menu-b', dir: 'menu-a/x/jobs/j01/requests/p01' })).toBe('menu-b');
  });

  it('menu가 없는 예전 패킷은 경로에서 읽는다', () => {
    expect(packetMenu({ menu: undefined, dir: 'menu-b/충전기/jobs/j01/requests/p01' })).toBe('menu-b');
    expect(packetMenu({ menu: undefined, dir: 'menu-a/충전기/jobs/j01/requests/p01' })).toBe('menu-a');
  });

  it('윈도우 경로 구분자도 인정한다', () => {
    expect(packetMenu({ menu: undefined, dir: 'menu-b\\충전기\\jobs\\j01' })).toBe('menu-b');
  });

  it('알 수 없는 경로는 규칙이 덜 걸리는 쪽으로 떨어뜨린다', () => {
    // 잘못 판정해서 menu-b 규칙을 엉뚱한 대본에 걸면 통과할 수 있는 것을 반려하게 된다
    expect(packetMenu({ menu: undefined, dir: 'templates/p01' })).toBe('menu-a');
  });
});

describe('단점 씬 규칙 (제품정보리뷰 전용)', () => {
  const withDownside = {
    scenes: [
      scene('s01', '싱크대 세제통 아직도 그냥 두세요?'),
      scene('s02', '여기 꽂기만 하면 됩니다.'),
      scene('s03', '대신 스테인리스라 지문은 묻습니다.', true),
    ],
  };
  const withoutDownside = {
    scenes: [
      scene('s01', '싱크대 세제통 아직도 그냥 두세요?'),
      scene('s02', '여기 꽂기만 하면 됩니다.'),
    ],
  };

  it('단점 씬이 있으면 통과한다', () => {
    expect(scriptRuleErrors(withDownside, 'menu-b', CTX)).toEqual([]);
  });

  it('단점 씬이 없으면 반려 사유를 낸다', () => {
    const errors = scriptRuleErrors(withoutDownside, 'menu-b', CTX);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('단점 씬');
  });

  it('표시만 달고 내용이 비면 잡는다', () => {
    const errors = scriptRuleErrors({ scenes: [scene('s01', '단점', true)] }, 'menu-b', CTX);
    expect(errors.join()).toContain('s01');
  });

  it('해외영상 짜집기에는 단점 씬 규칙 대신 교리 v3.3이 걸린다', () => {
    // 2026-08-21 이식: menu-a는 「규칙 없음」에서 「실격 전수 검사」로 뒤집혔다
    const errors = scriptRuleErrors(withoutDownside, 'menu-a', CTX);
    expect(errors.join()).not.toContain('단점 씬');
    expect(errors.length).toBeGreaterThan(0); // 2인칭 질문형·음성≠자막 등
  });
});

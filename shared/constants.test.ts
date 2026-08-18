import { describe, it, expect } from 'vitest';
import {
  MENU_A_STATES, MENU_B_STATES, STATE_GUIDE, stateGuide, stateNextAction,
} from './constants.js';

/*
  두 메뉴는 `draft`·`script_approved` 같은 단계 이름을 공유하지만 하는 일이 다르다.
  상태 이름만으로 문구를 고르면 제품정보리뷰 화면에 "해외 영상 주소를 넣으세요"가 떴고,
  사용자가 그대로 따라 영상 14개를 등록한 적이 있다(2026-08-13). 그걸 막는 테스트다.
*/

describe('stateGuide', () => {
  it('제품정보리뷰의 초안에서 영상을 요구하지 않는다', () => {
    const g = stateGuide('menu-b', 'draft')!;
    expect(g.todo).not.toMatch(/영상 주소|영상 파일/);
    expect(g.todo).toMatch(/포맷/);
  });

  it('해외영상 짜집기의 초안은 영상 주소를 요구한다', () => {
    expect(stateGuide('menu-a', 'draft')!.todo).toMatch(/영상 주소/);
  });

  it('대본 승인 뒤 할 일이 메뉴마다 다르다 (컷 선택 vs 씬 이미지)', () => {
    expect(stateGuide('menu-a', 'script_approved')!.todo).not.toMatch(/씬 이미지/);
    expect(stateGuide('menu-b', 'script_approved')!.todo).toMatch(/씬 이미지/);
  });

  it('뜻이 같은 단계는 두 메뉴가 같은 문구를 쓴다', () => {
    expect(stateGuide('menu-a', 'voicing')).toEqual(stateGuide('menu-b', 'voicing'));
  });

  it('모르는 단계는 undefined', () => {
    expect(stateGuide('menu-a', '없는단계')).toBeUndefined();
  });
});

describe('stateNextAction', () => {
  it('제품정보리뷰 초안은 포맷으로 안내한다', () => {
    expect(stateNextAction('menu-b', 'draft')).toMatch(/포맷/);
  });

  it('해외영상 짜집기 초안은 영상 주소로 안내한다', () => {
    expect(stateNextAction('menu-a', 'draft')).toMatch(/영상 주소/);
  });

  it('대본 승인 뒤 안내가 메뉴마다 다르다', () => {
    // menu-a는 곧장 음성이다 — 쓸 구간은 장면 고르기에서 이미 정해졌다
    expect(stateNextAction('menu-a', 'script_approved')).toBe('음성 만들기');
    expect(stateNextAction('menu-b', 'script_approved')).toMatch(/씬 이미지/);
  });

  /** 컷 선택을 없앤 뒤 menu-a 흐름에 그 단계가 남아 있으면 화면에 빈 단계가 뜬다 */
  it('menu-a 흐름에 컷 선택이 없다', () => {
    expect(MENU_A_STATES).not.toContain('trimming');
    expect(MENU_A_STATES.indexOf('voicing')).toBe(MENU_A_STATES.indexOf('script_approved') + 1);
  });

  it('모르는 단계에도 빈 화면을 만들지 않는다', () => {
    expect(stateNextAction('menu-a', '없는단계')).toBe('계속하기');
  });
});

describe('두 메뉴의 모든 단계에 안내가 있다', () => {
  // 안내가 비면 화면에 배너가 통째로 사라져 사용자가 뭘 할지 알 수 없게 된다
  it.each([
    ['menu-a', MENU_A_STATES],
    ['menu-b', MENU_B_STATES],
  ] as const)('%s', (menu, states) => {
    const missing = states.filter((s) => !stateGuide(menu, s));
    expect(missing).toEqual([]);
  });

  it('덮어쓴 단계는 기본 문구와 실제로 다르다 — 덮어쓸 이유가 없으면 지운다', () => {
    for (const state of ['draft', 'script_approved']) {
      expect(stateGuide('menu-b', state)).not.toEqual(STATE_GUIDE[state]);
    }
  });
});

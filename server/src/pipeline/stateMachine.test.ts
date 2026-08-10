import { describe, it, expect } from 'vitest';
import { canTransition, progressOf, statesFor } from './stateMachine.js';

describe('stateMachine', () => {
  it('menu-a 순방향 전이 허용', () => {
    expect(canTransition('menu-a', 'draft', 'collecting')).toBe(true);
    expect(canTransition('menu-a', 'collecting', 'downloading')).toBe(true);
    expect(canTransition('menu-a', 'review', 'done')).toBe(true);
  });

  it('단계 건너뛰기 금지', () => {
    expect(canTransition('menu-a', 'draft', 'assembling')).toBe(false);
    expect(canTransition('menu-a', 'downloading', 'scripting')).toBe(false);
  });

  it('한 단계 되돌리기 허용', () => {
    expect(canTransition('menu-a', 'cleaning', 'analyzing')).toBe(true);
  });

  it('review에서 앞 단계 재작업 허용', () => {
    expect(canTransition('menu-a', 'review', 'cleaning')).toBe(true);
    expect(canTransition('menu-b', 'review', 'scripting')).toBe(true);
  });

  it('어디서든 failed/paused 진입', () => {
    expect(canTransition('menu-a', 'downloading', 'failed')).toBe(true);
    expect(canTransition('menu-b', 'scripting', 'paused')).toBe(true);
  });

  it('menu-b 상태 흐름', () => {
    expect(canTransition('menu-b', 'draft', 'format_selected')).toBe(true);
    expect(canTransition('menu-b', 'format_selected', 'scripting')).toBe(true);
    expect(canTransition('menu-b', 'script_approved', 'scening')).toBe(true);
  });

  it('진행률 계산', () => {
    expect(progressOf('menu-a', 'draft')).toBe(0);
    expect(progressOf('menu-a', 'done')).toBe(100);
    expect(progressOf('menu-a', 'failed')).toBe(0);
    const states = statesFor('menu-a');
    expect(states[0]).toBe('draft');
  });
});

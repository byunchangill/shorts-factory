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

/**
 * 컷 선택(`trimming`)을 흐름에서 뺐다. 그 상태로 저장된 지난 잡이 남아 있는데,
 * 그대로 두면 어느 단계 화면도 안 열려 잡이 갇힌다.
 */
describe('migrateState — 없앤 단계에 멈춘 잡', () => {
  const job = (state: string) => ({ id: 'j1', state } as never);

  it('컷 선택에 멈춰 있으면 음성 단계로 읽는다', async () => {
    const { migrateState } = await import('../store/jobs.js');
    expect(migrateState(job('trimming')).state).toBe('voicing');
  });

  it('나머지 단계는 건드리지 않는다', async () => {
    const { migrateState } = await import('../store/jobs.js');
    for (const s of ['draft', 'cleaning', 'scripting', 'voicing', 'done']) {
      expect(migrateState(job(s)).state).toBe(s);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { MENU_B_STATES } from '@shared/constants';
import { canTransition, progressOf, sourceEntryState, statesFor } from './stateMachine.js';

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
    // 포맷 다음은 대본이 아니라 **영상 소재**다 (2026-08-23) — 소재가 대본의 재료라 앞선다
    expect(canTransition('menu-b', 'format_selected', 'collecting')).toBe(true);
    expect(canTransition('menu-b', 'format_selected', 'scripting')).toBe(false);
    expect(canTransition('menu-b', 'cleaning', 'scripting')).toBe(true);
    expect(canTransition('menu-b', 'script_approved', 'scening')).toBe(true);
  });

  /**
   * 제품정보리뷰도 영상을 쓴다. 소재 구간이 빠지면 영상을 넣을 자리가 없어지고,
   * 화면은 「영상 넣기」 버튼을 띄운 채 전이에서 터진다.
   */
  it('menu-b 흐름에 영상 소재 구간이 있다', () => {
    for (const s of ['collecting', 'downloading', 'analyzing', 'cleaning'] as const) {
      expect(MENU_B_STATES).toContain(s);
    }
    expect(MENU_B_STATES.indexOf('collecting')).toBe(MENU_B_STATES.indexOf('format_selected') + 1);
  });

  it('소재를 넣기 시작하는 단계가 메뉴마다 다르다', () => {
    expect(sourceEntryState('menu-a')).toBe('draft');
    expect(sourceEntryState('menu-b')).toBe('format_selected');
    // 그 단계에서 collecting으로 갈 수 있어야 한다 — 아니면 소재만 들어가고 단계가 멈춘다
    for (const menu of ['menu-a', 'menu-b'] as const) {
      expect(canTransition(menu, sourceEntryState(menu), 'collecting')).toBe(true);
    }
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

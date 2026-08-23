import type { JobState, Menu } from '@shared/constants';
import { MENU_A_STATES, MENU_B_STATES } from '@shared/constants';

/**
 * 상태 전이표.
 * - 순방향: 파이프라인 순서대로
 * - 역방향: 재작업을 위해 일부 허용 (review에서 앞 단계로 등)
 * - paused/failed는 어디서든 진입, 재개는 직전 상태를 stateHistory에서 복원
 */
function buildTransitions(states: readonly JobState[]): Record<string, JobState[]> {
  const t: Record<string, JobState[]> = {};
  for (let i = 0; i < states.length; i++) {
    const cur = states[i];
    const targets: JobState[] = [];
    if (i + 1 < states.length) targets.push(states[i + 1]);
    if (i > 0) targets.push(states[i - 1]); // 한 단계 되돌리기
    targets.push('failed', 'paused');
    t[cur] = targets;
  }
  // review에서는 앞 단계 어디로든 되돌아갈 수 있다 (재수정)
  t['review'] = [...states.filter((s) => s !== 'review'), 'failed', 'paused'];
  t['done'] = ['review']; // 완료 후 재검수만 허용
  t['failed'] = [...states, 'paused'];
  t['paused'] = [...states, 'failed'];
  return t;
}

const TRANSITIONS: Record<Menu, Record<string, JobState[]>> = {
  'menu-a': buildTransitions(MENU_A_STATES),
  'menu-b': buildTransitions(MENU_B_STATES),
};

export function canTransition(menu: Menu, from: JobState, to: JobState): boolean {
  return (TRANSITIONS[menu][from] ?? []).includes(to);
}

export function statesFor(menu: Menu): readonly JobState[] {
  return menu === 'menu-a' ? MENU_A_STATES : MENU_B_STATES;
}

/**
 * 소재를 넣기 시작하는 단계. **메뉴마다 다르다** — 해외영상 짜집기는 잡을 만들자마자
 * `draft`에서 넣지만, 제품정보리뷰는 포맷을 먼저 고르므로 `format_selected`부터다.
 *
 * 소재를 받은 뒤 `collecting`으로 보내는 자리가 두 군데(주소 입력·파일 업로드)라, 여기서
 * 한 번에 정한다. 한쪽만 고치면 **소재는 들어갔는데 단계는 안 넘어간 잡**이 남는다.
 */
export function sourceEntryState(menu: Menu): JobState {
  return menu === 'menu-a' ? 'draft' : 'format_selected';
}

/** 진행률 % (대시보드 표시용) */
export function progressOf(menu: Menu, state: JobState): number {
  const states = statesFor(menu);
  const idx = states.indexOf(state);
  if (idx < 0) return 0; // failed/paused
  return Math.round((idx / (states.length - 1)) * 100);
}

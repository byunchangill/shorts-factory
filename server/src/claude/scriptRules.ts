import { MENUS, type Menu } from '@shared/constants';
import type { Script, Packet } from '@shared/types';

/**
 * 메뉴별 대본 규칙.
 *
 * 제품정보리뷰(menu-b)에만 걸리는 규칙이 여기 모인다.
 * 해외영상 짜집기(menu-a)는 별도 지침을 따로 세우기로 해서 아무 규칙도 걸지 않는다.
 */

/**
 * 패킷이 어느 메뉴 것인지.
 * packet.menu는 나중에 추가된 필드라 예전 패킷에는 없다 — 그럴 땐 저장 경로에서 읽는다
 * (`menu-b/{project}/jobs/{job}/requests/{pid}` 형태라 첫 조각이 곧 메뉴다).
 */
export function packetMenu(packet: Pick<Packet, 'menu' | 'dir'>): Menu {
  if (packet.menu) return packet.menu;
  const head = packet.dir.replace(/\\/g, '/').split('/')[0];
  return (MENUS as readonly string[]).includes(head) ? (head as Menu) : 'menu-a';
}

/**
 * 대본이 메뉴 규칙을 지켰는지. 위반 문구 배열을 돌려준다 (빈 배열 = 통과).
 *
 * 여기서 잡는 건 **빠뜨림**이다. 표시만 해놓고 실제로는 단점을 말하지 않는 대본은
 * 기계가 판정할 수 없으므로 검수자(shorts-qc)가 본다.
 */
export function scriptRuleErrors(script: Pick<Script, 'scenes'>, menu: Menu): string[] {
  if (menu !== 'menu-b') return [];
  const errors: string[] = [];

  const downsides = script.scenes.filter((s) => s.isDownside);
  if (downsides.length === 0) {
    errors.push(
      '단점 씬이 없습니다. 제품정보리뷰는 제품의 단점·주의사항을 말하는 씬이 최소 1개 있어야 하고, '
      + '그 씬에 "isDownside": true를 표시해야 합니다',
    );
  }
  // 빈 나레이션에 표시만 달아두는 것을 막는다
  for (const s of downsides) {
    if (s.narration.trim().length < 8) {
      errors.push(`단점 씬 ${s.sceneId}의 나레이션이 너무 짧습니다 (실제로 단점을 말해야 합니다)`);
    }
  }
  return errors;
}

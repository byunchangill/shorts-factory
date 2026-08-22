import { MENUS, type Menu } from '@shared/constants';
import { doctrineErrors, doctrineWarnings } from '@shared/doctrine';
import type { Script, Packet } from '@shared/types';
import { loadSettings } from '../store/workspace.js';
import { readProduct } from '../store/projects.js';

/**
 * 메뉴별 대본 규칙.
 *
 * - 해외영상 짜집기(menu-a) — 템캐스팅 교리 v3.3의 실격 조건 전수. 규칙 본문은
 *   `shared/doctrine.ts`에 있고 여기서는 재료(배속·제품명)만 챙겨 넘긴다.
 * - 제품정보리뷰(menu-b) — 단점 씬 1개 필수. 채널이 다르므로 교리를 걸지 않는다.
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

/** 교리 검사에 필요한 재료 — 배속은 설정에서, 제품명은 잡의 product.json에서 온다 */
export interface ScriptRuleContext {
  speechRate: number;
  /** 훅에 새어 나오면 안 되는 말. 없으면 그 검사만 건너뛴다 */
  productName?: string;
}

/**
 * 요청서 하나에 대한 검사 재료를 모은다.
 *
 * 제품 정보가 없어도 검사는 돈다 — 「공개 전 제품 확정」 하나만 못 볼 뿐이라
 * 여기서 막으면 제품자료를 아직 안 붙인 잡의 대본이 통째로 반려된다.
 */
export async function scriptRuleContext(
  packet: Pick<Packet, 'menu' | 'dir' | 'jobId' | 'projectId'>,
): Promise<ScriptRuleContext> {
  const { speechRate } = await loadSettings();
  const menu = packetMenu(packet);
  if (!packet.jobId || !packet.projectId) return { speechRate };
  try {
    const product = await readProduct({ menu, projectId: packet.projectId, jobId: packet.jobId });
    return { speechRate, productName: product.name || undefined };
  } catch {
    return { speechRate };
  }
}

/**
 * 대본이 메뉴 규칙을 지켰는지. 위반 문구 배열을 돌려준다 (빈 배열 = 통과).
 *
 * menu-b에서 여기서 잡는 건 **빠뜨림**이다. 표시만 해놓고 실제로는 단점을 말하지 않는
 * 대본은 기계가 판정할 수 없으므로 검수자(shorts-qc)가 본다.
 */
export function scriptRuleErrors(
  script: Pick<Script, 'scenes'>,
  menu: Menu,
  ctx: ScriptRuleContext,
): string[] {
  if (menu === 'menu-a') {
    return doctrineErrors(script.scenes, {
      speechRate: ctx.speechRate,
      menu,
      productName: ctx.productName,
    });
  }

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

/** 실격은 아니지만 사람이 봐야 하는 것 (해외영상 짜집기 전용) */
export function scriptRuleWarnings(script: Pick<Script, 'scenes'>, menu: Menu): string[] {
  return menu === 'menu-a' ? doctrineWarnings(script.scenes) : [];
}

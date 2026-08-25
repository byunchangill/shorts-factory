import { describe, it, expect } from 'vitest';
import { buildLayoutFilter, introTitleFilter, introTitleWindow } from './assemble.js';
import { SettingsSchema } from '@shared/types';

const S = (over: Record<string, unknown> = {}) =>
  SettingsSchema.parse({ layout: 'banded', ...over });
const FONT = 'NotoSansCJK-Bold.ttc';
const AT = (over: Record<string, unknown> = {}) =>
  ({ menu: 'menu-b' as const, sceneIdx: 0, from: 0, ...over });

/*
  벤치마킹 3편이 전부 1.8~2.2초 제목으로 연다. 🔴 정지 카드가 아니라 **움직이는 영상 위에
  얹은 글자**다 — 훅 게이트로 채점하니 10.6·18.4·22.2로 전부 통과했다.
*/
describe('introTitleFilter', () => {
  it('첫 씬 첫 컷에 제목을 얹는다', () => {
    const f = introTitleFilter(S(), FONT, '자취방 필수템', AT());
    expect(f).toContain('drawtext');
    expect(f).toContain('자취방');
  });

  it('카드를 새로 만들지 않는다 — 원래 돌던 컷 위에 글자만 그린다', () => {
    // drawtext만 나오고 정지 화면을 만드는 필터(color·loop)는 없어야 한다
    const f = introTitleFilter(S(), FONT, '자취방 필수템', AT());
    expect(f).not.toMatch(/\bcolor=c=|nullsrc|loop=/);
  });

  it('두 톤으로 나뉜다 — 첫 줄 액센트, 둘째 줄 흰색', () => {
    const f = introTitleFilter(S(), FONT, '이거 하나면 자취방 정리 끝난다', AT());
    expect(f).toContain(`fontcolor=${S().titleAccentColor}`);
    expect(f).toContain('fontcolor=white');
  });

  it('짧은 제목은 흰 줄 하나다 — 노랑만 있는 제목은 없다', () => {
    const f = introTitleFilter(S(), FONT, '자취템', AT());
    expect(f).toContain('fontcolor=white');
    expect(f).not.toContain(`fontcolor=${S().titleAccentColor}`);
  });

  it('설정한 시간만큼만 떠 있는다', () => {
    expect(introTitleFilter(S({ introTitleSec: 2 }), FONT, '자취방 필수템', AT()))
      .toContain("enable='lt(t,2.00)'");
  });

  it('🔴 컷을 쪼개도 안 잘린다 — 다음 컷에 남은 시간만큼 이어 건다', () => {
    // 첫 컷이 1.2초면 남은 0.8초는 두 번째 컷이 이어받아야 한다
    const f = introTitleFilter(S({ introTitleSec: 2 }), FONT, '자취방 필수템', AT({ from: 1.2 }));
    expect(f).toContain("enable='lt(t,0.80)'");
  });

  it('제목이 다 끝난 뒤 컷에는 안 건다', () => {
    expect(introTitleFilter(S({ introTitleSec: 2 }), FONT, '자취방 필수템', AT({ from: 2 }))).toBe('');
  });

  it('첫 씬에만 건다', () => {
    expect(introTitleFilter(S(), FONT, '자취방 필수템', AT({ sceneIdx: 1 }))).toBe('');
  });

  it('🔴 해외영상 짜집기에는 안 넣는다 — 음성=자막이라 안 읽는 글자를 못 띄운다', () => {
    expect(introTitleFilter(S(), FONT, '자취방 필수템', AT({ menu: 'menu-a' }))).toBe('');
  });

  it('0으로 두면 끈다', () => {
    expect(introTitleFilter(S({ introTitleSec: 0 }), FONT, '자취방 필수템', AT())).toBe('');
  });

  it('폰트가 없으면 안 넣는다 — 깨진 제목보다 없는 편이 낫다', () => {
    expect(introTitleFilter(S(), null, '자취방 필수템', AT())).toBe('');
  });

  it('제목이 비면 안 넣는다', () => {
    expect(introTitleFilter(S(), FONT, '   ', AT())).toBe('');
  });

  it('움직이는 영상 위라 외곽선을 준다 — 밝은 장면에서 흰 글자가 사라진다', () => {
    expect(introTitleFilter(S(), FONT, '자취방 필수템', AT())).toContain('bordercolor=black');
  });

  it('띠 제목보다 크다 — 첫 화면을 덮는 것이 목적이다', () => {
    const f = introTitleFilter(S(), FONT, '자취방 필수템', AT());
    const size = Number(/fontsize=(\d+)/.exec(f)![1]);
    expect(size).toBeGreaterThan(100);
  });

  it('긴 제목도 화면 폭 안에 들어온다', () => {
    const f = introTitleFilter(S(), FONT, '이거 하나면 자취방 정리가 통째로 끝나는 이유', AT());
    const size = Number(/fontsize=(\d+)/.exec(f)![1]);
    expect(size * 11).toBeLessThanOrEqual(1080 * 0.88);
  });

  it('자막 자리를 안 침범한다 — 자막은 아래에서 35%다', () => {
    const f = introTitleFilter(S(), FONT, '이거 하나면 자취방 정리 끝난다', AT());
    const ys = [...f.matchAll(/:y=(\d+):/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThan(1920 * 0.65);
  });

  it('작은따옴표가 든 제목이 필터그래프를 깨지 않는다', () => {
    const f = introTitleFilter(S(), FONT, "자취방 '꿀템' 모음", AT());
    expect(f).not.toMatch(/text='[^']*'[^:]/);
  });
});

/*
  🔴 실측에서 드러난 것 — 인트로 제목을 얹었더니 같은 문구가 가운데(크게)와 띠(작게)에
  **두 번** 찍혔다. 띠 제목은 인트로가 떠 있는 동안 물러나야 한다.
*/
describe('인트로 제목과 띠 제목은 겹치지 않는다', () => {
  const HEAD = '이거 하나면 자취방 정리 끝';

  it('인트로가 떠 있는 동안 띠 제목을 안 그린다', () => {
    const f = buildLayoutFilter(S(), FONT, HEAD, 2);
    for (const m of f.matchAll(/drawtext=[^,]*/g)) {
      // 채널명은 제목이 아니라 채널 룩이라 계속 떠 있는다
      if (m[0].includes(S().frameTitle)) continue;
      expect(m[0]).toContain("enable='gte(t,2.00)'");
    }
  });

  it('인트로가 끝나는 순간 띠 제목이 돌아온다 — 두 숫자가 같은 데서 온다', () => {
    const at = AT({ from: 1.2 });
    const remain = introTitleWindow(S({ introTitleSec: 2 }), at);
    expect(introTitleFilter(S({ introTitleSec: 2 }), FONT, HEAD, at))
      .toContain(`lt(t,${remain.toFixed(2)})`);
    expect(buildLayoutFilter(S({ introTitleSec: 2 }), FONT, HEAD, remain))
      .toContain(`gte(t,${remain.toFixed(2)})`);
  });

  it('인트로가 없으면 띠 제목은 처음부터 떠 있는다', () => {
    expect(buildLayoutFilter(S(), FONT, HEAD, 0)).not.toContain('gte(t,');
  });

  it('채널명은 인트로 중에도 계속 떠 있는다 — 채널 룩이다', () => {
    const f = buildLayoutFilter(S({ frameTitle: '테스트채널' }), FONT, HEAD, 2);
    const ch = [...f.matchAll(/drawtext=[^,]*/g)].find((m) => m[0].includes('테스트채널'))!;
    expect(ch[0]).not.toContain('enable=');
  });
});

describe('introTitleWindow', () => {
  it('해외영상 짜집기·첫 씬 밖·꺼짐은 전부 0이다', () => {
    expect(introTitleWindow(S(), AT({ menu: 'menu-a' }))).toBe(0);
    expect(introTitleWindow(S(), AT({ sceneIdx: 3 }))).toBe(0);
    expect(introTitleWindow(S({ introTitleSec: 0 }), AT())).toBe(0);
  });

  it('제목이 끝난 뒤 컷은 0이다 — 음수로 새지 않는다', () => {
    expect(introTitleWindow(S({ introTitleSec: 2 }), AT({ from: 5 }))).toBe(0);
  });
});

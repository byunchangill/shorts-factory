import { describe, it, expect } from 'vitest';
import { textStyleErrors } from './doctrine.js';
import published from './__fixtures__/published.json' with { type: 'json' };

/*
  발행된 편들을 골든 케이스로 둔다.

  `npm run harness`는 **합성 영상**을 쓴다. 파이프라인이 도는지는 보지만
  **결과물이 채널 기준에 맞는지는 못 본다.** 여기서 그걸 본다 —
  검사기가 실제로 성적을 가르는지, 실제로 나간 대본으로 확인한다.

  픽스처는 쇼핑쇼츠 저장소(`out/{slug}/shotsheet.json`)의 나레이션과
  원장(`docs/from-shopping-shorts/_metrics.csv`)의 지표를 붙인 것이다.

  🔴 **구조 검사(블록·자막 길이·러닝타임)는 여기서 돌리지 않는다.** 옛 편들은 v3.3 이전
  포맷이라 씬 쪼개는 방식이 달라서, 돌리면 전부 실격이 나오고 아무것도 못 가른다.
  글자만 보면 판정되는 `textStyleErrors`가 성적과 실제로 갈리는 부분이다.
*/

/** 원장에 실린 발행 제목 — 대본이 아니라 **제목**이 성적을 가른 사례가 여기 있다 */
const PUBLISHED_TITLES: Record<string, string> = {
  'wall-tile-sheet': '싱크대 찌든때, 아직도 힘들게 닦으세요? #꿀템 #살림템 #자취템 #쿠팡꿀템',
  'wall-shelf': '전세집? 드릴 꺼내지도 마세요! #꿀템 #살림템 #자취템 #쿠팡꿀템',
  'kallax-shelf': '티비장 사지 마세요 #꿀템 #살림템 #자취템 #쿠팡꿀템',
  'sofa-gap-table': '소파를 벽에 붙이면 안 되는 이유 #꿀템 #살림템 #생활꿀템',
  'shoe-cabinet': '신발장인 줄 진짜 몰랐던 신발장 #꿀템 #살림템 #생활꿀템',
  'faucet-shelf': '세면대에 물건 두지 마세요  #자취템 #생활꿀템 #살림템',
  'kitchen-cart': '주방이 좁은 게 아닙니다 #틈새선반 #원룸수납 #생활꿀템',
};

const retained = (slug: string) => Number(published.find((e) => e.slug === slug)?.retainedPct);
const scored = published.filter((e) => e.retainedPct).map((e) => ({ ...e, pct: Number(e.retainedPct) }));
const has = (errors: string[], needle: string) => errors.some((e) => e.includes(needle));

describe('발행 편 골든 케이스', () => {
  it('픽스처가 원장과 이어져 있다', () => {
    expect(published.length).toBeGreaterThanOrEqual(15);
    expect(scored.length).toBeGreaterThanOrEqual(13);
    // 최하위작은 시트지 편이다. 이 숫자가 교리를 갈아엎은 근거다
    const worst = scored.reduce((a, b) => (a.pct <= b.pct ? a : b));
    expect(worst.slug).toBe('wall-tile-sheet');
    expect(worst.pct).toBe(12.4);
    expect(worst.views).toBe('563');
  });

  /*
    이 저장소가 2026-08-21까지 「훅 4유형 중 첫째」로 권하던 형태다.
    원장 전체에서 2인칭 질문형 제목은 **한 편뿐**이고, 그 편이 채널 최하위다.
  */
  it('2인칭 질문형 제목은 최하위작 하나뿐이다 — 검사기가 그것만 집어낸다', () => {
    const flagged = Object.entries(PUBLISHED_TITLES)
      .filter(([, title]) => has(textStyleErrors(title), '2인칭 질문형'))
      .map(([slug]) => slug);
    expect(flagged).toEqual(['wall-tile-sheet']);
    expect(retained('wall-tile-sheet')).toBeLessThan(20);

    // 같은 자리에 명령형을 쓴 편들은 통과한다 — 형태가 아니라 **질문**이 문제였다
    for (const slug of ['wall-shelf', 'kallax-shelf', 'faucet-shelf']) {
      expect(has(textStyleErrors(PUBLISHED_TITLES[slug]), '2인칭 질문형')).toBe(false);
    }
  });

  /*
    나레이션 쪽도 같은 방향이다. 표본이 작아 「하위 N편」이라고 못 박지 않는다 —
    말할 수 있는 것은 **전부 채널 중앙값 아래**라는 것까지다.
  */
  it('나레이션에 2인칭 질문형을 쓴 편은 모두 채널 중앙값 아래다', () => {
    const sorted = scored.map((e) => e.pct).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const flagged = scored.filter((e) =>
      e.narration.some((line) => has(textStyleErrors(line), '2인칭 질문형')));

    expect(flagged.length).toBeGreaterThan(0);
    for (const e of flagged) expect(e.pct).toBeLessThan(median);
  });

  /*
    교리를 지킬 수 있다는 증거. 이 둘은 v3.3으로 쓴 편이고,
    글자 단위 금지 어법이 **하나도** 안 걸린다. 게이트가 통과 불가능한 게 아니다.
  */
  it('v3.3으로 쓴 편은 금지 어법이 0건이다', () => {
    for (const slug of ['upper-cabinet-lift', 'vanity-console']) {
      const ep = published.find((e) => e.slug === slug)!;
      const errors = ep.narration.flatMap((line) => textStyleErrors(line, slug));
      expect(errors).toEqual([]);
    }
  });

  /*
    반대로 옛 카탈로그는 대부분 스펙 숫자를 음성으로 읽었다 —
    「폭 32센치」·「500킬로까지」. v3.3이 그걸 설명란으로 빼라고 하는 이유다.
    편수는 이식 시점(2026-08-21)의 기록이라, 픽스처가 늘면 같이 움직인다.
  */
  it('옛 카탈로그는 스펙 숫자를 음성으로 읽었다 — 교리를 바꾼 이유의 기록', () => {
    const withSpec = published.filter((e) =>
      e.narration.some((line) => has(textStyleErrors(line), '스펙 단위')));
    expect(withSpec.length).toBeGreaterThanOrEqual(9);
    expect(withSpec.map((e) => e.slug)).not.toContain('upper-cabinet-lift');
  });
});

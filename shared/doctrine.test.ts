import { describe, it, expect } from 'vitest';
import { doctrineErrors, doctrineWarnings, endingOf, leadWindow } from './doctrine.js';
import { syllableBudget, syllables } from './constants.js';

/*
  교리 v3.3 검사기. 게이트가 **통과시켜야 할 대본을 통과시키는지**가 제일 중요하다 —
  너무 빡빡하면 아무 대본도 못 나가고, 그러면 규칙을 끄게 된다.
  아래 통과 대본은 레퍼런스 구조(집주인 대사 인용 훅 + 금전 손실 + 정보원)를 그대로 밟는다.
*/
const RATE = 1.33;

const GOOD = [
  ['s1', 'hook', '나가실 때 원상 복구해 주세요'],
  ['s2', 'loss', '집주인 한마디에 심장이 철렁했습니다'],
  ['s3', 'loss', '견적을 받아 보니 삼십만 원이더라고요'],
  ['s4', 'source', '인테리어 하는 형한테 물어봤는데'],
  ['s5', 'product', '타공 없이 벽에 딱 붙는 선반이거든요'],
  ['s6', 'product', '뗄 때 자국이 하나도 없더라고요'],
  ['s7', 'product', '무거운 걸 올려도 끄떡없길래'],
  ['s8', 'product', '세탁실이랑 현관에도 하나씩 붙였네요'],
  ['s9', 'closing', '전세 사시는 분들 미리 챙겨 두세요'],
  ['s10', 'closing', '멘탈 지켜 주는 물건이었어요'],
] as const;

const good = () => GOOD.map(([sceneId, block, text]) => ({
  sceneId, block, narration: text, subtitle: text,
}));

describe('교리 v3.3 — 통과 대본', () => {
  it('레퍼런스 구조를 밟은 대본은 실격이 없다', () => {
    expect(doctrineErrors(good(), { speechRate: RATE, productName: '무타공 선반' })).toEqual([]);
  });

  it('예산 안에 든다 — 음절수·발화 속도·선행 구간', () => {
    const total = good().reduce((n, s) => n + syllables(s.narration), 0);
    const budget = syllableBudget(RATE, 'menu-a');
    expect(total).toBeGreaterThanOrEqual(budget.min);
    expect(total).toBeLessThanOrEqual(budget.max);
    // 선행 4씬이 러닝타임 21초 구간의 8~12초 안
    const perSec = (300 * RATE) / 60;
    const lead = good().slice(0, 4).reduce((n, s) => n + syllables(s.narration), 0) / perSec;
    const win = leadWindow(total / perSec);
    expect(lead).toBeGreaterThanOrEqual(win.min);
    expect(lead).toBeLessThanOrEqual(win.max);
  });
});

describe('교리 v3.3 — 실격', () => {
  const withScene = (i: number, patch: Record<string, string>) => {
    const scenes = good() as any[];
    scenes[i] = { ...scenes[i], ...patch };
    return scenes;
  };
  const has = (errors: string[], needle: string) => errors.some((e) => e.includes(needle));

  it('음성과 자막이 다르면 실격 — 발췌·요약 금지', () => {
    const errs = doctrineErrors(withScene(0, { subtitle: '원상 복구' }), { speechRate: RATE });
    expect(has(errs, '음성≠자막')).toBe(true);
  });

  it('2인칭 질문형은 실격 — 최하위작(563회)의 형태다', () => {
    const errs = doctrineErrors(
      withScene(0, { narration: '아직도 힘들게 닦으세요?', subtitle: '아직도 힘들게 닦으세요?' }),
      { speechRate: RATE },
    );
    expect(has(errs, '2인칭 질문형')).toBe(true);
  });

  it('2인칭 명령형은 통과한다 — 143만·1254만이 이 형태다', () => {
    expect(doctrineErrors(good(), { speechRate: RATE })).toEqual([]);
    expect(endingOf('이제 양면테이프 쓰지 마세요')).toBeNull();
  });

  it('스펙 단위는 실격 — 한글로 적어도 스펙은 스펙이다', () => {
    const spec = doctrineErrors(
      withScene(4, { narration: '폭이 삼십이센치라 넉넉하거든요', subtitle: '폭이 삼십이센치라 넉넉하거든요' }),
      { speechRate: RATE },
    );
    expect(has(spec, '스펙 단위')).toBe(true);
  });

  it('아라비아 숫자는 실격 — 손실 금액도 한글로 적는다', () => {
    const errs = doctrineErrors(
      withScene(2, { narration: '견적을 받아 보니 30만 원이더라고요', subtitle: '견적을 받아 보니 30만 원이더라고요' }),
      { speechRate: RATE },
    );
    expect(has(errs, '숫자를 그대로')).toBe(true);
    // 「삼십만 원」으로 적은 통과 대본은 손실 금액이라 그냥 지나간다
    expect(has(doctrineErrors(good(), { speechRate: RATE }), '숫자를 그대로')).toBe(false);
  });

  it('② 손실 블록에 금전·시간·신체가 없으면 실격', () => {
    const errs = doctrineErrors(
      withScene(2, { narration: '기분이 참 묘하고 이상했네요', subtitle: '기분이 참 묘하고 이상했네요' }),
      { speechRate: RATE },
    );
    expect(has(errs, '손실')).toBe(true);
  });

  it('공개 전에 제품을 확정시키면 실격', () => {
    const errs = doctrineErrors(
      withScene(1, { narration: '선반을 달자니 구멍이 걸리더군요', subtitle: '선반을 달자니 구멍이 걸리더군요' }),
      { speechRate: RATE, productName: '무타공 선반' },
    );
    expect(has(errs, '확정시키는')).toBe(true);
  });

  it('여성 화자 호칭은 실격 — 화자는 남자다', () => {
    const errs = doctrineErrors(
      withScene(3, { narration: '남편한테 물어봤는데', subtitle: '남편한테 물어봤는데' }),
      { speechRate: RATE },
    );
    expect(has(errs, '여성 화자 호칭')).toBe(true);
  });

  it('인접 문장이 같은 어미면 실격 — AI 티의 실체다', () => {
    const errs = doctrineErrors(
      withScene(3, { narration: '인테리어 하는 형이 알려줬거든요', subtitle: '인테리어 하는 형이 알려줬거든요' }),
      { speechRate: RATE },
    );
    expect(has(errs, '같은 어미')).toBe(true);
  });

  it('자막 1장이 16음절을 넘으면 실격 — 화면에서 두 줄로 감긴다', () => {
    const long = '평소에는 내려서 안전간 역할을 하다가 필요할 때 펼치거든요';
    const errs = doctrineErrors(withScene(4, { narration: long, subtitle: long }), { speechRate: RATE });
    expect(has(errs, '자막 1장')).toBe(true);
  });

  it('블록 표시가 없으면 선행 구간을 못 재므로 실격', () => {
    const bare = good().map(({ block, ...rest }) => rest);
    expect(has(doctrineErrors(bare, { speechRate: RATE }), '블록 표시')).toBe(true);
  });

  it('~더라고요가 2회 미만이면 실격 (표본 9/10편)', () => {
    const errs = doctrineErrors(
      withScene(5, { narration: '뗄 때 자국이 하나도 없네요', subtitle: '뗄 때 자국이 하나도 없네요' }),
      { speechRate: RATE },
    );
    expect(has(errs, '더라고요')).toBe(true);
  });
});

describe('교리 v3.3 — 경고', () => {
  it('③ 정보원이 없으면 알려준다 (실격은 아니다)', () => {
    const noSource = good().filter((s) => s.block !== 'source');
    expect(doctrineWarnings(noSource).some((w) => w.includes('정보원'))).toBe(true);
    expect(doctrineWarnings(good())).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { placeDisclosure } from './assemble.js';
import { buildAss, wrapKorean, NOTICE_SIZE } from './subtitles.js';
import { COUPANG_PARTNERS_DISCLOSURE, subtitleCharsPerLine } from '@shared/constants';

const TEXT = '이 포스팅은 쿠팡 파트너스 활동의 일환으로…';
const LAST = { start: 19.2, end: 22, text: '저장해뒀다가' };

/*
  「마지막 자막이 끝난 뒤로 민다」로 고쳤더니 공시가 **한 번도** 안 들어갔다 (2026-08-23).
  씬이 영상 끝까지 꽉 차는 것이 정상이라 마지막 자막은 언제나 영상 끝에서 끝난다.
  켜 둔 설정이 조용히 아무 일도 안 하는 것이 겹치는 것보다 나쁘다 — 하네스가 잡았다.
*/
describe('placeDisclosure', () => {
  it('마지막 자막이 영상 끝까지 차 있어도 넣는다 — 이게 정상 상황이다', () => {
    const out = placeDisclosure([LAST], 22, TEXT);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ start: 20, end: 22, text: TEXT, style: 'notice' });
  });

  it('나레이션 자막을 건드리지 않는다 — 잘라서 자리를 만들지 않는다', () => {
    const out = placeDisclosure([LAST], 22, TEXT);
    expect(out[0]).toEqual(LAST);
  });

  it('자막 한 줄이 1초 남짓이어도 들어간다 (하네스 실패 지점)', () => {
    const cues = [{ start: 19.209, end: 20.220, text: '물건이었어요' }];
    const out = placeDisclosure(cues, 20.220, TEXT);
    expect(out.some((c) => c.text === TEXT)).toBe(true);
  });

  it('자막이 아예 없어도 넣는다', () => {
    expect(placeDisclosure([], 22, TEXT)).toEqual([
      { start: 20, end: 22, text: TEXT, style: 'notice' },
    ]);
  });

  it('영상이 눈 깜짝할 만큼 짧으면 넣지 않는다', () => {
    expect(placeDisclosure([], 0.3, TEXT)).toEqual([]);
  });
});

describe('공시 자리', () => {
  /*
    자막은 아래에서 35%, 공시는 위에서 26%다. 같은 자리에 두면 포개져 둘 다 못 읽는다.
    아래로 내리는 것도 안 된다 — 쇼츠 UI가 화면 아래를 덮는다.
  */
  it('공시는 나레이션 자막과 다른 스타일로 나간다', () => {
    const ass = buildAss(placeDisclosure([LAST], 22, TEXT));
    expect(ass).toMatch(/^Style: Notice,/m);
    expect(ass).toContain(`,Notice,,0,0,0,,${TEXT}`);
    expect(ass).toContain(',Default,,0,0,0,,저장해뒀다가');
  });

  it('공시는 화면 위쪽에 앉는다 (Alignment 8 = 위쪽 가운데)', () => {
    const line = buildAss([], { playResY: 1920 })
      .split('\n').find((l) => l.startsWith('Style: Notice'))!;
    const f = line.split(',');
    expect(f[f.length - 5]).toBe('8');          // Alignment
    expect(Number(f[f.length - 2])).toBe(499);  // MarginV = 1920 × 0.26
  });
});

/*
  공시는 자막(118)이 아니라 고지 크기(40)로 접는다. 자막 폭(13자)으로 접으면
  「이 포스팅은 쿠팡 / 파트너스 활동의」처럼 상호가 두 줄로 갈라진다 — 하네스가 잡았다.
*/
describe('공시 줄바꿈', () => {
  it('상호가 두 줄로 갈라지지 않는다', () => {
    const wrapped = wrapKorean(COUPANG_PARTNERS_DISCLOSURE, subtitleCharsPerLine(NOTICE_SIZE));
    expect(wrapped).toContain('쿠팡 파트너스');
  });

  it('자막 폭으로 접으면 갈라진다 — 이 폭을 쓰면 안 되는 이유', () => {
    expect(wrapKorean(COUPANG_PARTNERS_DISCLOSURE, 13)).not.toContain('쿠팡 파트너스');
  });
});

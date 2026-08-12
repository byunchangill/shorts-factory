import { describe, it, expect } from 'vitest';
import { rangesFromScores, type FrameScore } from './detectZone.js';

const f = (t: number, score: number): FrameScore => ({ t, score });

/**
 * 자막 구간 자동 판정.
 *
 * 점수는 실측값 기준이다 — 720×1280 틱톡 영상의 자막 띠에서
 * 글자 있음 6.7~19.0, 글자 없음 0.6~0.9였다.
 *
 * 어림짐작이므로 **틀렸을 때 조용히 틀리지 않는 것**이 제일 중요하다.
 * 엉뚱한 구간을 자신 있게 넣으면 멀쩡한 화면이 뭉개진 채로 넘어간다.
 */
describe('가장자리 점수 → 판정', () => {
  it('앞부분에만 자막이 있으면 그 구간을 잡는다', () => {
    const r = rangesFromScores(
      [f(0, 18), f(1, 19), f(2, 15), f(3, 0.8), f(4, 0.7), f(5, 0.9)],
      1, 6,
    );
    expect(r.verdict).toBe('ranges');
    expect(r.ranges).toEqual([{ t0: 0, t1: 3 }]);
  });

  it('끝 프레임이 통째로 들어가게 다음 프레임 직전까지 잡는다', () => {
    const r = rangesFromScores([f(0, 18), f(1, 17), f(2, 16), f(3, 0.8)], 1, 10);
    expect(r.ranges[0].t1).toBe(3);
  });

  it('마지막 프레임까지 자막이면 클립 길이를 넘지 않는다', () => {
    const r = rangesFromScores([f(0, 0.7), f(1, 15), f(2, 16)], 1, 2.4);
    expect(r.ranges).toEqual([{ t0: 1, t1: 2.4 }]);
  });

  it('구간이 둘이면 긴 것을 앞에 둔다', () => {
    const r = rangesFromScores(
      [f(0, 17), f(1, 0.8), f(2, 16), f(3, 18), f(4, 15), f(5, 0.7)],
      1, 6,
    );
    expect(r.ranges[0]).toEqual({ t0: 2, t1: 5 });
    expect(r.ranges[1]).toEqual({ t0: 0, t1: 1 });
  });

  /**
   * 실제 샘플(c01)이 이 경우다 — 문구는 바뀌지만 자막 띠에는 내내 글자가 있다.
   * 긴 자막과 짧은 자막의 점수 차이를 "있고 없고"로 오해하면
   * 멀쩡히 자막이 있는 구간을 처리에서 빼먹는다.
   */
  it('짧은 자막과 긴 자막이 섞여 있어도 "내내 있음"으로 본다', () => {
    const r = rangesFromScores(
      [f(0, 18.2), f(1, 19.0), f(2, 8.7), f(3, 7.4), f(4, 14.4), f(5, 6.7)],
      1, 6,
    );
    expect(r.verdict).toBe('always');
    expect(r.ranges).toEqual([]);
  });

  it('어디에도 글자가 없으면 없다고 답한다', () => {
    const r = rangesFromScores([f(0, 0.9), f(1, 0.6), f(2, 1.1)], 1, 3);
    expect(r.verdict).toBe('none');
    expect(r.ranges).toEqual([]);
  });

  it('프레임이 한 장뿐이면 판정하지 않는다', () => {
    expect(rangesFromScores([f(0, 20)], 1, 1).verdict).toBe('unclear');
  });

  it('점수는 그대로 돌려준다 — 화면에서 눈으로 확인할 수 있어야 한다', () => {
    const r = rangesFromScores([f(0, 18), f(1, 0.8)], 1, 2);
    expect(r.frames).toHaveLength(2);
    expect(r.threshold).toBeGreaterThan(0.8);
    expect(r.threshold).toBeLessThan(18);
  });
});

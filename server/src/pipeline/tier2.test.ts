import { describe, it, expect } from 'vitest';
import type { Segment, Zone } from '@shared/types';
import { dirtyRanges, splitPlan } from './tier2.js';

const zone = (t0?: number, t1?: number, method: Zone['method'] = 'inpaint'): Zone =>
  ({ id: `z${t0}`, kind: 'subtitle', x: 0, y: 0, w: 10, h: 10, t0, t1, method });
const seg = (i: number, o: number): Segment =>
  ({ id: `g${i}`, in: i, out: o, note: '', used: true });

/*
  인페인팅은 프레임당 초 단위로 든다. 75초 클립을 통째로 넘기면 자막이 4초짜리여도
  한 시간이 넘는다 — 지울 구간을 얼마나 좁히느냐가 곧 쓸 수 있느냐다.
*/
describe('dirtyRanges', () => {
  it('고른 구간과 겹치는 부분만 남긴다', () => {
    expect(dirtyRanges([zone(0, 30)], [seg(10, 14)], 60)).toEqual([{ t0: 10, t1: 14 }]);
  });

  it('고른 구간 밖의 자막은 아예 안 지운다 — 최종 영상에 안 나온다', () => {
    expect(dirtyRanges([zone(0, 5)], [seg(20, 25)], 60)).toEqual([]);
  });

  it('인페인팅이 아닌 존은 여기서 다루지 않는다 (1차가 처리한다)', () => {
    expect(dirtyRanges([zone(0, 30, 'delogo'), zone(0, 30, 'crop')], [seg(10, 14)], 60)).toEqual([]);
  });

  it('시각이 없는 존은 전 구간이라 고른 구간 전체가 대상이다', () => {
    expect(dirtyRanges([zone()], [seg(10, 14)], 60)).toEqual([{ t0: 10, t1: 14 }]);
  });

  it('겹치는 구간은 하나로 합친다 — 조각이 잘게 쪼개질수록 이음매가 는다', () => {
    const zones = [zone(10, 15), zone(14, 20)];
    expect(dirtyRanges(zones, [seg(0, 60)], 60)).toEqual([{ t0: 10, t1: 20 }]);
  });

  it('안 쓰기로 한 구간은 세지 않는다', () => {
    const segs = [{ ...seg(10, 14), used: false }];
    expect(dirtyRanges([zone(0, 30)], segs, 60)).toEqual([]);
  });
});

/*
  잘라낸 조각을 도로 이어붙여 원본과 같은 길이가 나와야 한다.
  어긋나면 조립이 쓰는 컷 시각이 통째로 밀린다.
*/
describe('splitPlan', () => {
  it('지울 구간과 남는 구간이 빈틈없이 이어져 원본 길이가 된다', () => {
    const plan = splitPlan([{ t0: 10, t1: 14 }, { t0: 30, t1: 33 }], 60);
    expect(plan.map((p) => [p.t0, p.t1, p.clean]))
      .toEqual([[0, 10, false], [10, 14, true], [14, 30, false], [30, 33, true], [33, 60, false]]);
    expect(plan.at(-1)!.t1).toBe(60);
    for (let i = 1; i < plan.length; i++) expect(plan[i].t0).toBe(plan[i - 1].t1);
  });

  it('처음부터 끝까지 지워야 하면 조각이 하나다', () => {
    expect(splitPlan([{ t0: 0, t1: 60 }], 60)).toEqual([{ t0: 0, t1: 60, clean: true }]);
  });

  it('맨 앞만 지우면 뒤가 통째로 남는다', () => {
    expect(splitPlan([{ t0: 0, t1: 3 }], 60))
      .toEqual([{ t0: 0, t1: 3, clean: true }, { t0: 3, t1: 60, clean: false }]);
  });
});

/*
  인페인팅은 프레임당 초 단위로 든다. 자동으로 붙여 놨더니 「영상 재생성」이 클립당
  몇 분짜리가 됐다 — 누르는 사람이 예상 못 한 대기를 만들지 않는다.
*/
describe('autoRemovalMethod', () => {
  it('자동 검출에는 즉시 끝나는 방식을 붙인다', async () => {
    const { autoRemovalMethod } = await import('./tier2.js');
    expect(autoRemovalMethod()).toBe('delogo');
  });

  it('그래서 자동 검출만으로는 2차 제거가 안 돈다 — 사용자가 고쳐야 돈다', () => {
    const auto = [zone(0, 30, 'delogo')];
    expect(dirtyRanges(auto, [seg(10, 14)], 60)).toEqual([]);
    const chosen = auto.map((z) => ({ ...z, method: 'inpaint' as const }));
    expect(dirtyRanges(chosen, [seg(10, 14)], 60)).toEqual([{ t0: 10, t1: 14 }]);
  });
});

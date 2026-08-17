import { describe, it, expect } from 'vitest';
import { segmentsFromFrames, scaleZones, zonesInSegments } from './selected.js';
import type { Clip, ClipFrame, Segment, Zone } from '@shared/types';

const frame = (t: number): ClipFrame => ({ file: `f${t}.jpg`, t, recommended: false });

describe('segmentsFromFrames', () => {
  it('붙어 있는 프레임은 끊긴 컷 여러 개가 아니라 이어진 컷 하나가 된다', () => {
    // 1초 간격 프레임 + 앞뒤 1.5초 → 구간이 겹치므로 합쳐져야 한다
    const segs = segmentsFromFrames([frame(3), frame(4), frame(5)], 20);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ in: 1.5, out: 6.5, used: true });
  });

  it('떨어진 프레임은 따로 떨어진 컷이 된다', () => {
    const segs = segmentsFromFrames([frame(2), frame(12)], 20);
    expect(segs.map((s) => [s.in, s.out])).toEqual([[0.5, 3.5], [10.5, 13.5]]);
  });

  it('영상 밖으로 넘어가지 않는다', () => {
    // 앞은 0 아래로, 뒤는 길이 위로 나가면 ffmpeg가 빈 구간을 만든다
    const segs = segmentsFromFrames([frame(0.5), frame(9.5)], 10);
    expect(segs[0].in).toBe(0);
    expect(segs.at(-1)!.out).toBe(10);
  });

  it('프레임 순서가 뒤섞여 있어도 시간 순으로 만든다', () => {
    const segs = segmentsFromFrames([frame(12), frame(2)], 20);
    expect(segs[0].in).toBeLessThan(segs[1].in);
  });

  it('남긴 프레임이 없으면 구간도 없다 (호출한 쪽이 막아야 한다)', () => {
    expect(segmentsFromFrames([], 20)).toEqual([]);
  });

  it('앞뒤로 붙인 폭이 씬 경계를 넘지 않는다 — 안 고른 옆 장면이 딸려 오면 화면이 튄다', () => {
    // 6초에 씬이 바뀐다. 5초 프레임의 뒤쪽 1.5초는 6초에서 잘려야 한다
    const segs = segmentsFromFrames([frame(5)], 20, 1.5, [6]);
    expect(segs[0]).toMatchObject({ in: 3.5, out: 6 });
  });

  it('경계 양쪽을 다 골랐으면 맞닿아 합쳐진다 — 자르는 건 아무도 안 고른 쪽뿐이다', () => {
    const segs = segmentsFromFrames([frame(5), frame(7)], 20, 1.5, [6]);
    expect(segs.map((s) => [s.in, s.out])).toEqual([[3.5, 8.5]]);
  });

  it('씬 경계를 안 주면 예전 그대로 동작한다', () => {
    expect(segmentsFromFrames([frame(5)], 20, 1.5)).toMatchObject([{ in: 3.5, out: 6.5 }]);
  });
});

describe('zonesInSegments', () => {
  const seg = (id: string, i: number, o: number): Segment =>
    ({ id, in: i, out: o, note: '', used: true });
  const zone = (id: string, t0?: number, t1?: number): Zone =>
    ({ id, kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, t0, t1, method: 'delogo' });

  it('고른 구간에 안 걸리는 자막은 지우지 않는다 — 최종 영상에 안 나온다', () => {
    const zones = [zone('opening', 0, 3), zone('mid', 10, 12)];
    expect(zonesInSegments(zones, [seg('g1', 9, 14)]).map((z) => z.id)).toEqual(['mid']);
  });

  it('구간에 걸리는 것이 하나도 없으면 빈 배열 — 제거 자체를 건너뛴다 (사다리 0순위)', () => {
    expect(zonesInSegments([zone('opening', 0, 3)], [seg('g1', 10, 14)])).toEqual([]);
  });

  it('시각이 없는 존은 전 구간이라 항상 남는다', () => {
    expect(zonesInSegments([zone('always')], [seg('g1', 10, 14)])).toHaveLength(1);
  });

  it('걸치기만 해도 남긴다 — 0.1초라도 보이면 지워야 한다', () => {
    expect(zonesInSegments([zone('z', 0, 9.5)], [seg('g1', 9, 14)])).toHaveLength(1);
  });

  it('쓰기로 한 구간이 없으면 좁히지 않는다 — 좁힐 근거가 없다', () => {
    const zones = [zone('a', 0, 3)];
    expect(zonesInSegments(zones, [])).toEqual(zones);
    expect(zonesInSegments(zones, [{ ...seg('g1', 0, 3), used: false }])).toEqual(zones);
  });
});

describe('scaleZones', () => {
  const probe = (width: number, height: number): Clip['probe'] =>
    ({ width, height, fps: 30, duration: 10 });
  const zone: Zone = { id: 'z1', kind: 'subtitle', x: 100, y: 800, w: 400, h: 60, method: 'boxblur', t0: 2, t1: 5 };

  it('해상도가 다른 클립으로 옮기면 비율로 환산한다', () => {
    const [z] = scaleZones([zone], probe(576, 1024), probe(1152, 2048));
    expect(z).toMatchObject({ x: 200, y: 1600, w: 800, h: 120 });
  });

  it('시간 구간은 옮기지 않는다 — 클립마다 자막이 나오는 때가 다르다', () => {
    const [z] = scaleZones([zone], probe(576, 1024), probe(576, 1024));
    expect(z.t0).toBeUndefined();
    expect(z.t1).toBeUndefined();
  });

  it('방식과 종류는 그대로 따라간다', () => {
    const [z] = scaleZones([zone], probe(576, 1024), probe(576, 1024));
    expect(z).toMatchObject({ method: 'boxblur', kind: 'subtitle' });
  });

  it('분석 정보가 없는 클립에는 옮기지 않는다 — 환산할 기준이 없다', () => {
    expect(scaleZones([zone], probe(576, 1024), undefined)).toEqual([]);
    expect(scaleZones([zone], undefined, probe(576, 1024))).toEqual([]);
  });
});

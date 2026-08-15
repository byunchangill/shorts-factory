import { describe, it, expect } from 'vitest';
import { segmentsFromFrames, scaleZones } from './selected.js';
import type { Clip, ClipFrame, Zone } from '@shared/types';

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

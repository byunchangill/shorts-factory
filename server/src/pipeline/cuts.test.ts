import { describe, it, expect } from 'vitest';
import { planCuts, hasVisibleText, type CutSource } from './assemble.js';
import { SettingsSchema, type Clip } from '@shared/types';

const S = (path: string, inPoint = 0, avail = 30): CutSource => ({ path, in: inPoint, avail });

/*
  벤치마킹 쇼츠 3편 실측: 컷 간격 중앙값 1.6·1.7·2.0초. 우리는 12.1초였다 —
  씬 하나를 클립 하나로 통째로 틀었다. 총 길이는 그대로 두고 쪼개기만 한다.
*/
describe('planCuts', () => {
  it('상한보다 짧은 씬은 안 쪼갠다', () => {
    expect(planCuts([S('a')], 1.8, 2)).toEqual([{ path: 'a', in: 0, dur: 1.8 }]);
  });

  it('총 길이가 안 바뀐다 — 달라지면 오디오와 자막이 통째로 밀린다', () => {
    for (const total of [3.84, 4.88, 5.38, 7.5, 11]) {
      const cuts = planCuts([S('a'), S('b'), S('c')], total, 2);
      expect(cuts.reduce((n, c) => n + c.dur, 0)).toBeCloseTo(total, 6);
    }
  });

  it('컷 하나가 상한을 넘지 않는다', () => {
    const cuts = planCuts([S('a'), S('b'), S('c')], 5.38, 2);
    expect(cuts.length).toBe(3);
    for (const c of cuts) expect(c.dur).toBeLessThanOrEqual(2);
  });

  it('대본이 고른 클립이 첫 컷이다 — 그 문장에 맞는 화면이 먼저 나와야 한다', () => {
    const cuts = planCuts([S('own', 1.5), S('other')], 4, 2);
    expect(cuts[0].path).toBe('own');
    expect(cuts[0].in).toBe(1.5);
  });

  it('소재를 돌아가며 쓴다 — 화면이 실제로 바뀌어야 쪼갠 값이 있다', () => {
    const cuts = planCuts([S('a'), S('b'), S('c')], 6, 2);
    expect(cuts.map((c) => c.path)).toEqual(['a', 'b', 'c']);
  });

  it('소재가 모자라면 같은 소재의 뒤 구간을 이어 꺼낸다', () => {
    const cuts = planCuts([S('a')], 6, 2);
    expect(cuts.map((c) => c.in)).toEqual([0, 2, 4]);
  });

  /*
    컷 길이를 못 채우는 소재를 쓰면 그 컷이 짧게 끝나 오디오와 어긋난다.
    ffmpeg은 소재가 모자라면 조용히 짧은 파일을 낸다 — 여기서 걸러야 한다.
  */
  it('컷 길이를 못 채우는 소재는 뺀다', () => {
    const cuts = planCuts([S('long', 0, 30), S('tiny', 0, 0.5)], 6, 2);
    expect(cuts.map((c) => c.path)).toEqual(['long', 'long', 'long']);
  });

  it('쓸 만한 소재가 하나도 없으면 통으로 튼다 — 조립이 멈추는 것보다 낫다', () => {
    const cuts = planCuts([S('tiny', 0, 0.5)], 6, 2);
    expect(cuts).toEqual([{ path: 'tiny', in: 0, dur: 6 }]);
  });

  it('소재 끝을 넘으면 처음으로 되감는다', () => {
    const cuts = planCuts([S('a', 0, 5)], 12, 2);
    expect(cuts.every((c) => c.in + c.dur <= 5.001)).toBe(true);
  });

  it('상한이 0이면 끈다 (해외영상 짜집기 — 사용자가 고른 구간을 덮지 않는다)', () => {
    expect(planCuts([S('a'), S('b')], 12, 0)).toEqual([{ path: 'a', in: 0, dur: 12 }]);
  });

  it('소재가 없으면 빈 배열 — 부르는 쪽이 터지지 않게', () => {
    expect(planCuts([], 5, 2)).toEqual([]);
  });
});

/*
  컷을 쪼개며 다른 클립을 끌어다 채웠더니, 그 클립들의 중국어 자막이 하단 띠 **바로 위**에
  있어 화면에 그대로 나왔다 — 좌우반전까지 걸려 거울 글자로 찍혔다 (2026-08-23 실측).
  우리가 멋대로 더한 소재는 우리가 검사한다.
*/
describe('hasVisibleText', () => {
  const S = (over: Record<string, unknown> = {}) =>
    SettingsSchema.parse({ layout: 'banded', topBandRatio: 0.22, bottomBandRatio: 0.26, ...over });
  const clip = (zones: Array<{ y: number; h: number }>, over: Record<string, unknown> = {}) => ({
    id: 'c1', sourceId: 's1', frames: [], cleanVersions: [], segments: [], sceneTimes: [],
    probe: { width: 720, height: 1280, fps: 30, duration: 20 },
    zones: zones.map((z, i) => ({ id: `z${i}`, kind: 'subtitle', x: 0, w: 100, t0: 0, t1: 9, ...z })),
    ...over,
  } as unknown as Clip);

  it('띠 뒤에 숨는 글자는 괜찮다', () => {
    expect(hasVisibleText(clip([{ y: 1024, h: 56 }]), S())).toBe(false); // y 0.80~0.84
  });

  it('띠 사이에 보이는 글자는 걸러낸다', () => {
    expect(hasVisibleText(clip([{ y: 742, h: 87 }]), S())).toBe(true); // y 0.58~0.65
  });

  it('경계를 1px 스치는 것은 봐준다 — 검출 상자는 글자보다 넓게 잡힌다', () => {
    expect(hasVisibleText(clip([{ y: 946, h: 53 }]), S())).toBe(false); // 하단 띠 시작 947
  });

  it('정리본이 있으면 이미 지운 뒤다', () => {
    const c = clip([{ y: 742, h: 87 }], { currentCleanVersion: 1 });
    expect(hasVisibleText(c, S())).toBe(false);
  });

  it('띠가 없는 레이아웃에서는 화면 전체가 보인다', () => {
    expect(hasVisibleText(clip([{ y: 1024, h: 56 }]), S({ layout: 'fullscreen' }))).toBe(true);
  });

  it('크기를 모르면 안 쓴다 — 없어도 그만인 덤 소재다', () => {
    const c = clip([], { probe: { width: 0, height: 0, fps: 30, duration: 20 } });
    expect(hasVisibleText(c, S())).toBe(true);
  });
});

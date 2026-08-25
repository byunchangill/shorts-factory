import { describe, it, expect } from 'vitest';
import {
  planCuts, hasVisibleText, cutPlanError, type CutSource, type SceneCutPlan,
} from './assemble.js';
import { CUT_SUM_TOLERANCE_SEC } from '@shared/constants';
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

  /*
    🔴 **짧아지면 안 된다.** ffmpeg의 `-t`는 그 시각을 넘지 않는 마지막 프레임에서
    끊으므로, 프레임 경계에 안 걸린 조각은 최대 1프레임을 잃고 그 손실이 조각 수만큼
    쌓인다. 실측(2026-08-25): 3.022초를 둘로 나눈 1.511초가 각각 1.500초로 나와
    씬이 3.000초가 됐고 조립이 「소재가 모자라다」며 멈췄다 (소재는 8초였다).
    그래서 프레임 수를 먼저 나눈다 — 합은 나레이션을 **올림한** 프레임 경계다.
  */
  it('합이 나레이션보다 짧아지지 않는다 — 짧아지면 씬이 잘린다', () => {
    for (const total of [3.022, 3.84, 4.88, 5.38, 7.5, 11]) {
      const sum = planCuts([S('a'), S('b'), S('c')], total, 2)
        .reduce((n, c) => n + c.dur, 0);
      expect(sum).toBeGreaterThanOrEqual(total);
      expect(sum).toBeLessThan(total + 1 / 30); // 한 프레임 위를 못 넘는다
    }
  });

  it('컷 길이가 프레임의 정수 배다 — 그래야 렌더가 계획대로 나온다', () => {
    for (const total of [3.022, 5.38, 11]) {
      for (const c of planCuts([S('a'), S('b')], total, 2)) {
        expect(Math.abs(c.dur * 30 - Math.round(c.dur * 30))).toBeLessThan(1e-9);
      }
    }
  });

  it('컷 길이 차이는 최대 한 프레임 — 남는 프레임만 앞에서 가져간다', () => {
    const durs = planCuts([S('a'), S('b')], 5.38, 2).map((c) => c.dur);
    expect(Math.max(...durs) - Math.min(...durs)).toBeLessThanOrEqual(1 / 30 + 1e-9);
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
  조립이 렌더 전에 거는 불변식. 결과물로는 이걸 못 본다 — 최종 먹싱이 `-shortest`라
  컷 합이 길어진 쪽은 영상 뒤가 조용히 잘려 총 길이만 멀쩡해 보인다 (2026-08-24 실측:
  컷을 15% 늘려도 출력은 0.02초 차). 하네스 E2E로는 이 게이트를 못 흔든다 —
  정상 입력으로는 절대 안 걸리게 만든 값이라서다. 그래서 여기서 양방향을 다 눌러 본다.
*/
describe('cutPlanError', () => {
  const P = (over: Partial<SceneCutPlan> = {}): SceneCutPlan =>
    ({ sceneId: 's01', cuts: 3, sources: 2, sec: 5, ...over });

  it('맞으면 null — 정상 경로에서 사용자를 막지 않는다', () => {
    expect(cutPlanError(P({ sec: 5 }), 5)).toBeNull();
  });

  it('프레임 올림 몫은 봐준다 — planCuts가 프레임 경계로 나눈다', () => {
    // 프레임 경계에 안 걸리는 길이라야 올림 몫이 실제로 남는다
    const total = 25.99;
    const cuts = planCuts([S('a'), S('b')], total, 1.5);
    const sec = cuts.reduce((n, c) => n + c.dur, 0);
    expect(sec).toBeGreaterThan(total); // 올림 몫이 실제로 남는다 — 0으로 걸면 여기서 막힌다
    expect(cutPlanError(P({ cuts: cuts.length, sec }), total)).toBeNull();
  });

  it('컷이 길어진 쪽을 잡는다 — 결과물로는 못 보는 방향이다', () => {
    const msg = cutPlanError(P({ sec: 5.78 }), 5.02);
    expect(msg).toContain('s01');
    expect(msg).toContain('5.78');
    expect(msg).toContain('5.02');
    expect(msg).toContain('+0.76'); // 어느 쪽으로 얼마나 어긋났는지
    expect(msg).toContain('총 길이만 멀쩡해 보입니다');
  });

  it('컷이 짧아진 쪽도 잡는다', () => {
    expect(cutPlanError(P({ sec: 3.52 }), 5.02)).toContain('-1.50');
  });

  /*
    부호와 무관한 일반 설명을 늘 붙이면 원인을 찾는 사람의 시선을 엉뚱한 데로 끈다 —
    짧아진 쪽(-1.51초)에 「먹싱이 뒤를 잘라낸다」가 붙어 있었다 (2026-08-24 검증 지적).
  */
  it('증상 설명이 부호를 따라간다 — 짧아진 쪽에 먹싱 이야기를 안 붙인다', () => {
    const short = cutPlanError(P({ sec: 3.52 }), 5.02)!;
    expect(short).toContain('화면이 먼저 동나');
    expect(short).not.toContain('총 길이만 멀쩡해 보입니다');
    expect(cutPlanError(P({ sec: 5.78 }), 5.02)).not.toContain('화면이 먼저 동나');
  });

  it('오차 경계 — 상수 하나를 조립과 하네스가 같이 쓴다', () => {
    expect(cutPlanError(P({ sec: 5 + CUT_SUM_TOLERANCE_SEC * 0.9 }), 5)).toBeNull();
    expect(cutPlanError(P({ sec: 5 + CUT_SUM_TOLERANCE_SEC * 1.1 }), 5)).not.toBeNull();
  });

  /*
    🔴 이게 이 파일에서 제일 중요한 검사다. 사용자를 막는 예외를 넣었으니
    「정상 경로에서 절대 안 걸린다」가 증명돼야 한다. planCuts가 내놓는 모든 모양 —
    통컷 · 쪼갠 것 · 소재 부족 · 되감기 · 상한 0(해외영상 짜집기) — 을 다 통과시킨다.
  */
  it('planCuts가 내놓은 계획은 언제나 통과한다', () => {
    const cases: Array<[CutSource[], number, number]> = [
      [[S('a')], 1.8, 2],
      [[S('a'), S('b'), S('c')], 3.84, 2],
      [[S('a'), S('b'), S('c')], 5.38, 2],
      [[S('a'), S('b'), S('c')], 11, 2],
      [[S('a')], 6, 2],
      [[S('long', 0, 30), S('tiny', 0, 0.5)], 6, 2],
      [[S('tiny', 0, 0.5)], 6, 2],
      [[S('a', 0, 5)], 12, 2],
      [[S('a'), S('b')], 12, 0], // menu-a: 쪼개지 않는다
      [[S('a')], 1, 3],
      [[S('a'), S('b')], 26, 1.5],
    ];
    for (const [sources, total, maxCut] of cases) {
      const cuts = planCuts(sources, total, maxCut);
      const plan = P({ cuts: cuts.length, sec: cuts.reduce((n, c) => n + c.dur, 0) });
      expect(cutPlanError(plan, total), `${total}초 / 상한 ${maxCut}초`).toBeNull();
    }
  });

  /** 이미지 씬은 `dur`을 통째로 한 장으로 채운다 — 계획도 그 값 그대로다 */
  it('이미지 씬(컷 1개 = 나레이션 전체)도 통과한다', () => {
    expect(cutPlanError(P({ cuts: 1, sources: 1, sec: 4.37 }), 4.37)).toBeNull();
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

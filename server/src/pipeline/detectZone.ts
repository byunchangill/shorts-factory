import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import pLimit from 'p-limit';
import type { Settings, Zone } from '@shared/types';
import { run } from '../util/exec.js';

/**
 * 존이 실제로 나타나는 프레임 구간 자동 찾기.
 *
 * 자막·워터마크는 글자 획이라 **가장자리(edge)가 빽빽하다**. 같은 자리를 프레임마다 잘라
 * 가장자리 밀도를 재면 글자가 있는 프레임에서 값이 확연히 높다.
 * 실측(720×1280 틱톡 영상, 693×134 자막 띠): 글자 있음 6.7~19.0 / 글자 없음 0.6~0.9.
 *
 * 픽셀을 직접 읽지 않는다 — ffmpeg의 signalstats가 평균을 소수점까지 내준다.
 * (1×1로 줄여 한 바이트를 읽는 방법을 먼저 썼는데, 짧은 자막이 0으로 뭉개져 못 쓴다)
 *
 * **어림짐작이라 틀릴 수 있다.** 그래서 결과를 셋으로 나눈다 — 구간을 찾았거나,
 * 전 구간에 있거나, 판정 못 하겠거나. 애매하면 구간을 만들지 않고 사용자에게 넘긴다.
 * 틀린 구간을 자신 있게 넣는 것이 아무것도 안 하는 것보다 나쁘다.
 */

export interface FrameScore {
  t: number;
  /** 존 영역의 평균 가장자리 밀도 (0~255, 실제로는 0~30 언저리) */
  score: number;
}

export type DetectVerdict =
  /** 특정 구간에서만 나타난다 */
  | 'ranges'
  /** 모든 프레임에 있다 — 전체 구간으로 두면 된다 */
  | 'always'
  /** 어느 프레임에서도 글자를 못 찾았다 */
  | 'none'
  /** 값이 애매해 가를 수 없다 */
  | 'unclear';

export interface DetectResult {
  verdict: DetectVerdict;
  frames: FrameScore[];
  threshold: number | null;
  /** 긴 구간부터 */
  ranges: Array<{ t0: number; t1: number }>;
}

/**
 * 이 값을 넘으면 "글자가 있다"고 보는 절대 기준.
 * 글자 없는 영역은 1 안팎이고 짧은 자막도 6을 넘겼다. 그 사이에 둔다.
 */
const TEXT_FLOOR = 3;

/** 최고값이 이보다 낮으면 어느 프레임에도 글자가 없다고 본다 */
const NOTHING_CEILING = 2;

/** 문턱값을 최저~최고 사이 어디에 둘지 */
const THRESHOLD_RATIO = 0.45;

/**
 * 점수 → 판정. 순수 함수라 테스트로 고정할 수 있다.
 *
 * @param step 프레임 간격(초). 끝 프레임도 통째로 포함시키려고 끝에 더한다
 */
export function rangesFromScores(
  frames: FrameScore[],
  step: number,
  duration: number,
): DetectResult {
  const base = { frames, threshold: null, ranges: [] as Array<{ t0: number; t1: number }> };
  if (frames.length < 2) return { ...base, verdict: 'unclear' };

  const scores = frames.map((f) => f.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  // 어느 프레임도 글자라 할 만큼 높지 않다
  if (max < NOTHING_CEILING) return { ...base, verdict: 'none' };
  // 제일 조용한 프레임조차 기준을 넘는다 = 내내 떠 있다
  if (min >= TEXT_FLOOR) return { ...base, verdict: 'always' };

  const threshold = Math.max(min + (max - min) * THRESHOLD_RATIO, TEXT_FLOOR);
  const ranges: Array<{ t0: number; t1: number }> = [];
  let start: number | null = null;
  for (const [i, f] of frames.entries()) {
    const on = f.score >= threshold;
    if (on && start === null) start = f.t;
    if (!on && start !== null) {
      ranges.push({ t0: start, t1: Math.min(duration, frames[i - 1].t + step) });
      start = null;
    }
  }
  if (start !== null) {
    ranges.push({ t0: start, t1: Math.min(duration, frames[frames.length - 1].t + step) });
  }
  if (!ranges.length) return { ...base, threshold, verdict: 'unclear' };

  ranges.sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0));
  return { frames, threshold, ranges, verdict: 'ranges' };
}

/** 존 영역의 평균 가장자리 밀도 */
async function scoreFrame(
  settings: Settings,
  framePath: string,
  zone: Pick<Zone, 'x' | 'y' | 'w' | 'h'>,
): Promise<number> {
  const crop = `crop=${Math.round(zone.w)}:${Math.round(zone.h)}:${Math.round(zone.x)}:${Math.round(zone.y)}`;
  const r = await run(settings.ffmpegPath, [
    '-v', 'error', '-i', framePath,
    '-vf', `${crop},format=gray,edgedetect=low=0.1:high=0.3,signalstats,metadata=print:file=-`,
    '-f', 'null', '-',
  ], { timeoutMs: 20_000 });
  const m = String(r.stdout).match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * 프레임들을 훑어 존이 나타나는 구간을 찾는다.
 * @param frames 프레임 절대경로와 시각 (시각 오름차순)
 */
export async function detectZoneRanges(
  settings: Settings,
  frames: Array<{ t: number; filePath: string }>,
  zone: Pick<Zone, 'x' | 'y' | 'w' | 'h'>,
  duration: number,
): Promise<DetectResult> {
  if (frames.length < 2) return { verdict: 'unclear', frames: [], threshold: null, ranges: [] };

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zone-detect-'));
  try {
    const limit = pLimit(4);
    const scored = await Promise.all(
      frames.map((f) =>
        limit(async () => ({
          t: f.t,
          // 한 장이 깨져도 전체 판정을 포기하지 않는다 — 그 프레임만 0으로 둔다
          score: await scoreFrame(settings, f.filePath, zone).catch(() => 0),
        })),
      ),
    );
    const step = frames.length > 1 ? frames[1].t - frames[0].t : 1;
    return rangesFromScores(scored, step, duration);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Settings } from '@shared/types';
import { run } from '../../util/exec.js';

/**
 * 합성된 나레이션의 **속도와 음정**을 맞춘다.
 *
 * 타입캐스트는 합성 요청에 배속을 실어 보내지만 Voicebox에는 그런 인자가 없다.
 * 말투 지시로 밀어봐야 초당 7.06 → 7.30자(3%)에 그쳐서, 쇼츠 톤은 결국 여기서 만든다.
 * 실측 기준: 레퍼런스 영상이 초당 10.18자였고, 배속 1.395배로 그 값에 닿았다.
 *
 * 음정은 길이를 바꾸지 않는다 — 배속을 먼저 맞춘 뒤 음정만 따로 올린다.
 */

/** 반음 → 주파수 비 (12반음 = 2배) */
const ratio = (semitones: number): number => 2 ** (semitones / 12);

/**
 * atempo는 한 번에 0.5~2.0배만 낸다. 그 밖은 여러 번 이어 붙인다
 * (1.395배는 한 번으로 되지만, 사용자가 2배를 넘겨도 깨지지 않게 한다).
 */
function tempoChain(rate: number): string[] {
  const steps: number[] = [];
  let left = rate;
  while (left > 2) { steps.push(2); left /= 2; }
  while (left < 0.5) { steps.push(0.5); left /= 0.5; }
  steps.push(Number(left.toFixed(4)));
  return steps.map((s) => `atempo=${s}`);
}

/**
 * 음정만 올리는 필터.
 *
 * `rubberband`가 있으면 그걸 쓴다 — 길이를 건드리지 않고 음정만 옮긴다.
 * 없는 빌드도 있어서(리눅스 배포판마다 다르다) 없으면 표본율을 바꿔 음정을 올리고
 * 그만큼 템포를 되돌리는 방식으로 대체한다. 핵심 필터만 쓰므로 어디서든 동작한다.
 */
function pitchFilter(semitones: number, hasRubberband: boolean, sampleRate: number): string[] {
  const p = ratio(semitones);
  if (hasRubberband) return [`rubberband=pitch=${p.toFixed(6)}`];
  return [
    `asetrate=${Math.round(sampleRate * p)}`,
    `aresample=${sampleRate}`,
    ...tempoChain(1 / p),
  ];
}

let rubberbandCache: boolean | null = null;

/** ffmpeg 빌드에 rubberband가 들어 있는가 (한 번만 확인한다) */
export async function hasRubberband(settings: Settings): Promise<boolean> {
  if (rubberbandCache !== null) return rubberbandCache;
  try {
    const r = await run(settings.ffmpegPath, ['-hide_banner', '-filters'], { timeoutMs: 15_000 });
    rubberbandCache = /(^|\s)rubberband(\s|$)/m.test(String(r.stdout));
  } catch {
    rubberbandCache = false;
  }
  return rubberbandCache;
}

export interface ShapeOptions {
  /** 1이면 그대로 둔다 */
  rate: number;
  /** 0이면 그대로 둔다. 양수면 높아진다 */
  semitones: number;
}

/**
 * 파일을 제자리에서 다듬는다. 손댈 것이 없으면 아무 일도 하지 않는다.
 * ffmpeg은 같은 파일을 입출력으로 쓸 수 없어 임시 파일을 거쳐 바꿔치기한다.
 */
export async function shapeAudio(
  settings: Settings,
  file: string,
  opts: ShapeOptions,
): Promise<void> {
  const filters: string[] = [];
  if (Math.abs(opts.rate - 1) > 0.001) filters.push(...tempoChain(opts.rate));
  if (Math.abs(opts.semitones) > 0.01) {
    filters.push(...pitchFilter(opts.semitones, await hasRubberband(settings), 24_000));
  }
  if (!filters.length) return;

  const tmp = path.join(path.dirname(file), `.shape-${path.basename(file)}`);
  await run(settings.ffmpegPath, [
    '-y', '-i', file, '-filter:a', filters.join(','), tmp,
  ]);
  await fsp.rename(tmp, file);
}

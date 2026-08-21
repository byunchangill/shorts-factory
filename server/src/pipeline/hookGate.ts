import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings } from '@shared/types';
import { run } from '../util/exec.js';

/**
 * 훅 화면 변화량 게이트 — 렌더 전에 막는다.
 *
 * 발행 14편 전수 실측(2026-08-20)에서 「계속 시청함」과 상관이 있는 변수는 하나뿐이었다.
 *
 * ```
 * 0→0.5초 화면 변화량   r = +0.57   ← 유일하게 유효
 * 첫 컷 길이            r = +0.18   근거 없음
 * 훅 컷 수              r = -0.15   근거 없음
 * ```
 *
 * 임계 8에서 통과 11편의 계속시청 중앙값이 33.8%, 미달 3편이 19.1%였다(차이 14.7p).
 * 미달 3편이 정확히 계속시청 하위 3편이다.
 *
 * ⚠️ **첫 컷 길이로는 게이트를 걸지 마라.** 7편만 보고 r=+0.82로 판단해 걸었다가
 * 14편 전수로 다시 재니 +0.18이었다. 표본이 작았고 상하위만 골라 본 선택 편향이었다.
 */

/** 비교용 축소 해상도. 작을수록 잡음이 줄고 빨라진다 */
const GRAB_W = 96;
const GRAB_H = 170;
const GRAB_BYTES = GRAB_W * GRAB_H;

/** 두 회색 프레임의 평균 절대차. 순수 함수라 테스트가 여기 붙는다 */
export function motionDelta(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

/** 한 시각의 프레임을 회색 원시 바이트로 뽑는다. 실패하면 null */
async function grabGray(
  settings: Settings,
  clipPath: string,
  at: number,
  outPath: string,
): Promise<Buffer | null> {
  try {
    await run(settings.ffmpegPath, [
      '-y', '-nostdin', '-v', 'error',
      '-ss', at.toFixed(3), '-i', clipPath,
      '-frames:v', '1',
      '-vf', `scale=${GRAB_W}:${GRAB_H}`,
      '-pix_fmt', 'gray', '-f', 'rawvideo',
      outPath,
    ], { timeoutMs: 30_000 });
    const buf = await fsp.readFile(outPath);
    return buf.length === GRAB_BYTES ? buf : null;
  } catch {
    return null;
  }
}

/**
 * 클립 첫 0.5초의 화면 변화량. 잴 수 없으면 null —
 * **못 쟀다고 막지는 않는다.** 검출 실패로 조립이 통째로 멈추는 쪽이 더 나쁘다.
 */
export async function hookMotionDelta(
  settings: Settings,
  clipPath: string,
  tmpDir: string,
  startSec = 0,
): Promise<number | null> {
  const a = await grabGray(settings, clipPath, startSec, path.join(tmpDir, 'hook_a.raw'));
  const b = await grabGray(settings, clipPath, startSec + 0.5, path.join(tmpDir, 'hook_b.raw'));
  if (!a || !b) return null;
  return motionDelta(a, b);
}

/** 미달 안내 — 다음 편에서 뭘 바꿔야 하는지까지 적는다 */
export function hookGateMessage(delta: number, min: number): string {
  return (
    `훅 화면 변화량 ${delta.toFixed(1)} — 임계 ${min} 미달입니다. `
    + '첫 0.5초가 거의 멈춰 있으면 「계속 시청함」이 20% 아래로 떨어집니다(14편 실측). '
    + '훅 컷을 **제품이 크게 움직이는 구간**으로 바꾸거나, 설정에서 임계를 0으로 두면 끕니다.'
  );
}

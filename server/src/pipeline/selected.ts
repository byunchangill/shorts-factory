import path from 'node:path';
import type { Clip, ClipFrame, Segment, Settings, Zone } from '@shared/types';
import { run } from '../util/exec.js';

/**
 * 남긴 프레임 → 쓸 구간.
 *
 * 프레임은 1초 간격의 정지 장면이라 그 자체로는 영상이 되지 않는다. 앞뒤로 `padSec`을
 * 붙여 구간으로 만들고, 겹치면 하나로 합친다 (인접 프레임을 남기면 끊긴 컷 두 개가 아니라
 * 이어진 컷 하나가 나와야 한다).
 *
 * `sceneTimes`를 주면 붙인 폭이 **씬 경계를 넘지 않게 자른다.** 사용자가 고르지 않은
 * 옆 장면이 앞뒤 1.5초에 딸려 들어오면 컷 안에서 화면이 튄다 — 프레임 몇 장짜리
 * 미리보기로는 안 보이고 완성본에서 드러난다. 사용자가 경계 양쪽을 다 골랐으면
 * 두 구간이 맞닿아 그대로 합쳐지므로, 잘려 나가는 것은 **아무도 고르지 않은 쪽**뿐이다.
 */
export function segmentsFromFrames(
  frames: ClipFrame[],
  duration: number,
  padSec = 1.5,
  sceneTimes: number[] = [],
): Segment[] {
  const scenes = [...sceneTimes].sort((a, b) => a - b);
  const ranges: Array<{ in: number; out: number }> = [];
  for (const f of [...frames].sort((a, b) => a.t - b.t)) {
    // 이 프레임이 속한 씬의 경계. 없으면 영상 끝까지가 한 씬이다
    const sceneIn = Math.max(0, ...scenes.filter((s) => s <= f.t));
    const sceneOut = Math.min(duration || Infinity, ...scenes.filter((s) => s > f.t));
    const start = Math.max(0, f.t - padSec, sceneIn);
    const end = Math.min(duration || Infinity, f.t + padSec, sceneOut);
    const last = ranges.at(-1);
    if (last && start <= last.out) last.out = Math.max(last.out, end);
    else ranges.push({ in: start, out: end });
  }
  return ranges.map((r, i) => ({
    id: `g${i + 1}`,
    in: Number(r.in.toFixed(2)),
    out: Number(r.out.toFixed(2)),
    note: '남은 프레임 기준',
    used: true,
  }));
}

/**
 * 고른 구간에 실제로 걸리는 존만 남긴다.
 *
 * **제거 방식 사다리의 0순위는 "글자가 없는 구간을 고르는 것"이다** — 지우는 순간
 * 화질이든 번짐이든 대가가 붙으니, 안 지우고 끝나는 길이 있으면 그 길로 간다.
 * 자막은 대개 오프닝 몇 초에 몰려 있어서, 사용자가 그 구간의 프레임을 지우고 나면
 * 지울 것이 아예 없는 경우가 흔하다.
 *
 * 구간 밖의 글자를 지우는 것은 손해만 남는다 — 최종 영상에 안 나오는 자리를
 * delogo로 문질러 놓고 시간까지 쓴다. 시각이 없는 존(`t0`/`t1` 없음)은 전 구간이라
 * 항상 남는다.
 */
export function zonesInSegments(zones: Zone[], segments: Segment[]): Zone[] {
  const used = segments.filter((s) => s.used && s.out > s.in);
  if (!used.length) return zones; // 고른 구간이 없으면 좁힐 근거도 없다 — 원래대로 둔다
  return zones.filter((z) => {
    const t0 = z.t0 ?? 0;
    const t1 = z.t1 ?? Infinity;
    return used.some((s) => t0 < s.out && s.in < t1);
  });
}

/**
 * 존을 다른 해상도의 클립으로 옮긴다.
 *
 * 존은 원본 픽셀 좌표다. 같은 출처의 영상이라도 해상도가 다르면 그대로 쓸 수 없어
 * 비율로 환산한다. 시간 구간(`t0`/`t1`)은 클립마다 내용이 달라 옮기지 않는다 —
 * 남기면 엉뚱한 구간만 지우고 정작 자막이 있는 구간은 그냥 통과한다.
 */
export function scaleZones(zones: Zone[], from: Clip['probe'], to: Clip['probe']): Zone[] {
  if (!from || !to) return [];
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return zones.map((z) => ({
    ...z,
    x: Math.round(z.x * sx), y: Math.round(z.y * sy),
    w: Math.round(z.w * sx), h: Math.round(z.h * sy),
    t0: undefined, t1: undefined,
  }));
}

/**
 * 고른 구간만 이어붙인 영상 하나를 만든다. 소리는 넣지 않는다.
 *
 * 구간별로 잘라 concat 하지 않고 `select` 필터 한 번으로 끝낸다 — 임시 파일도, concat
 * 목록도 없어서 윈도우 경로 이스케이프 문제가 아예 생기지 않는다 (concat 데먹서는
 * 백슬래시를 이스케이프로 읽는다).
 *
 * 원본 소리는 버린다. 나레이션은 나중에 따로 붙고, 조립도 `-an`으로 영상만 가져간다 —
 * 여기서 남겨두면 이 단계 미리보기에서만 남의 영상 소리가 들린다.
 */
export async function buildSelectedVideo(
  settings: Settings,
  inputPath: string,
  segments: Segment[],
  outPath: string,
  onProgress?: (line: string) => void,
): Promise<string> {
  const used = segments.filter((s) => s.used && s.out > s.in);
  if (!used.length) throw new Error('쓸 구간이 없습니다 — 남긴 프레임을 확인하세요');

  const between = used.map((s) => `between(t,${s.in},${s.out})`).join('+');
  await run(settings.ffmpegPath, [
    '-y', '-i', inputPath,
    // setpts를 빼면 잘라낸 구간의 원래 시각이 그대로 남아 영상이 멈춘 것처럼 보인다
    '-vf', `select='${between}',setpts=N/FRAME_RATE/TB`,
    '-an',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
    outPath,
  ], { onStderr: onProgress });
  return outPath;
}

/** 클립 폴더 안에서의 결과물 이름 — 버전을 붙이지 않고 덮어쓴다 (다시 고르면 다시 만드는 값) */
export const SELECTED_FILE = 'selected.mp4';
export const selectedPath = (clipDir: string) => path.join(clipDir, SELECTED_FILE);

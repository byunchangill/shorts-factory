import path from 'node:path';
import type { Settings } from '@shared/types';
import { run } from '../util/exec.js';
import { ensureDir } from '../util/fsx.js';

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export async function probeVideo(settings: Settings, filePath: string): Promise<ProbeResult> {
  const r = await run(settings.ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams', '-show_format',
    filePath,
  ]);
  const data = JSON.parse(String(r.stdout));
  const v = (data.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!v) throw new Error('비디오 스트림 없음');
  const [num, den] = String(v.r_frame_rate ?? '30/1').split('/').map(Number);
  return {
    width: v.width,
    height: v.height,
    fps: den ? num / den : num,
    duration: parseFloat(data.format?.duration ?? v.duration ?? '0'),
  };
}

/** 오디오 파일 길이 (초) */
export async function probeDuration(settings: Settings, filePath: string): Promise<number> {
  const r = await run(settings.ffprobePath, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
  ]);
  const data = JSON.parse(String(r.stdout));
  return parseFloat(data.format?.duration ?? '0');
}

export interface ExtractedFrame {
  filePath: string;
  t: number;
  recommended: boolean;
}

/** 전체 프레임 수 상한 — 이보다 촘촘히 뽑아도 사람이 다 못 본다 */
const TOTAL_FRAMES = 12;
/** 처음 화면에 보여줄 추천 프레임 수 */
const RECOMMENDED_FRAMES = 5;
/** 장면 전환 판정 임계값 (0~1). 낮추면 카메라 흔들림까지 잡힌다 */
const SCENE_THRESHOLD = 0.3;

/**
 * 영상에서 장면이 바뀌는 시각을 찾는다.
 *
 * showinfo는 stderr로 로그를 뱉으므로 출력(`-f null -`)과 섞이지 않는다.
 * 전체를 디코딩하므로 긴 영상에서는 시간이 걸린다 — 상한을 두고, 실패하면
 * 빈 배열을 돌려 호출부가 균등 간격으로 물러서게 한다.
 */
async function detectSceneTimes(settings: Settings, filePath: string): Promise<number[]> {
  try {
    const r = await run(
      settings.ffmpegPath,
      [
        '-v', 'info', '-i', filePath,
        '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
        '-an', '-f', 'null', '-',
      ],
      { timeoutMs: 120_000 },
    );
    const times: number[] = [];
    for (const m of String(r.stderr).matchAll(/pts_time:([\d.]+)/g)) {
      const t = parseFloat(m[1]);
      if (Number.isFinite(t)) times.push(t);
    }
    return times;
  } catch {
    return []; // 장면 감지는 편의 기능 — 실패해도 프레임 추출은 계속돼야 한다
  }
}

/** 서로 minGap초 이내로 붙은 시각을 걸러낸다 (같은 장면이 여러 장 나오는 것 방지) */
function thinOut(times: number[], minGap: number): number[] {
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    if (!out.length || t - out[out.length - 1] >= minGap) out.push(t);
  }
  return out;
}

/**
 * 존 편집기·요청서용 프레임 추출.
 *
 * 장면 전환 시각을 우선 뽑아 `recommended`로 표시하고(처음 화면에 이것만 보인다),
 * 나머지는 균등 간격으로 채워 "전체 보기"에서 볼 수 있게 한다.
 * 장면 전환이 없는 영상(원컷 촬영)에서는 전부 균등 간격으로 물러선다.
 */
export async function extractFrames(
  settings: Settings,
  filePath: string,
  outDir: string,
  duration: number,
  total = TOTAL_FRAMES,
): Promise<ExtractedFrame[]> {
  await ensureDir(outDir);
  const minGap = Math.max(0.4, duration / (total * 2));

  const scenes = thinOut(await detectSceneTimes(settings, filePath), minGap)
    .filter((t) => t > 0.1 && t < duration - 0.1)
    .slice(0, RECOMMENDED_FRAMES);

  // 균등 간격 후보로 나머지를 채운다. 장면 전환과 겹치는 것은 thinOut이 걸러낸다
  const even = Array.from({ length: total }, (_, i) => (duration * (i + 0.5)) / total);
  const recommended = new Set(scenes);
  const times = thinOut([...scenes, ...even], minGap).slice(0, total);

  // 장면 전환이 하나도 없으면 균등 간격 중 고르게 골라 추천으로 삼는다
  if (recommended.size === 0) {
    const step = Math.max(1, Math.round(times.length / RECOMMENDED_FRAMES));
    for (let i = 0; i < times.length; i += step) recommended.add(times[i]);
  }

  const frames: ExtractedFrame[] = [];
  for (const [i, t] of times.entries()) {
    const out = path.join(outDir, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
    await run(settings.ffmpegPath, [
      '-y', '-ss', t.toFixed(2), '-i', filePath,
      '-frames:v', '1', '-q:v', '3', out,
    ]);
    frames.push({ filePath: out, t: Number(t.toFixed(2)), recommended: recommended.has(t) });
  }
  return frames;
}

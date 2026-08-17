import path from 'node:path';
import fsp from 'node:fs/promises';
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

/** 기본 추출 간격 — 1초에 한 장이면 장면을 놓치지 않으면서 눈으로 훑을 수 있다 */
const INTERVAL_SEC = 1;
/** 장수 상한. 긴 영상은 간격을 넓혀 이 안에 맞춘다 (디스크와 화면 모두 감당 못 한다) */
const MAX_FRAMES = 120;
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

/**
 * 클립 전체를 훑을 수 있는 프레임을 뽑는다.
 *
 * 사용자는 여기서 나온 프레임을 보고 **필요 없는 것을 지워서** 쓸 장면을 남긴다.
 * 그래서 "대표 몇 장"이 아니라 영상 전 구간을 촘촘히 덮는 것이 목적이다.
 *
 * 한 번의 디코딩으로 전부 뽑는다 — 프레임마다 따로 seek하면 장수에 비례해 느려진다.
 * 장면이 바뀌는 지점은 `recommended`로 표시만 해준다 (훑을 때 눈에 띄라고).
 *
 * 씬 경계 시각도 같이 돌려준다. 여기서 이미 재고 있어 공짜인데, 버리면 컷 구간을
 * 씬 안쪽으로 자를 때 전체 디코딩을 한 번 더 해야 한다.
 */
export async function extractFrames(
  settings: Settings,
  filePath: string,
  outDir: string,
  duration: number,
): Promise<{ frames: ExtractedFrame[]; sceneTimes: number[] }> {
  await ensureDir(outDir);
  const interval = Math.max(INTERVAL_SEC, duration / MAX_FRAMES);

  await run(settings.ffmpegPath, [
    '-y', '-i', filePath,
    '-vf', `fps=1/${interval}`,
    '-q:v', '3',
    path.join(outDir, 'frame_%03d.jpg'),
  ]);

  const files = (await fsp.readdir(outDir))
    .filter((f) => /^frame_\d+\.jpg$/.test(f))
    .sort();

  const scenes = await detectSceneTimes(settings, filePath);
  const nearScene = (t: number) => scenes.some((s) => Math.abs(s - t) <= interval / 2);

  // fps 필터는 간격의 배수 시점에서 프레임을 내보낸다
  const frames = files.map((f, i) => {
    const t = i * interval;
    return {
      filePath: path.join(outDir, f),
      t: Number(t.toFixed(2)),
      recommended: nearScene(t),
    };
  });
  return { frames, sceneTimes: scenes };
}

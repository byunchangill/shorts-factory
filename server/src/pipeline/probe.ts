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

/** 존 편집기/요청서용 프레임 추출 — 균등 간격 count장 */
export async function extractFrames(
  settings: Settings,
  filePath: string,
  outDir: string,
  duration: number,
  count = 5,
): Promise<string[]> {
  await ensureDir(outDir);
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = (duration * (i + 0.5)) / count;
    const out = path.join(outDir, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
    await run(settings.ffmpegPath, [
      '-y', '-ss', t.toFixed(2), '-i', filePath,
      '-frames:v', '1', '-q:v', '3', out,
    ]);
    frames.push(out);
  }
  return frames;
}

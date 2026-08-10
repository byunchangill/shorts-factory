import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Clip, Zone } from '@shared/types';
import { run, checkTool } from '../util/exec.js';
import { ensureDir } from '../util/fsx.js';

/**
 * 2차 제거 (AI 인페인팅) — 플러그인 구조.
 * 설치돼 있지 않으면 available()이 false를 반환하고 UI에서 버튼이 비활성화된다.
 * 1차(ffmpeg)는 항상 동작하므로 우아하게 강등된다.
 */
export interface InpaintProvider {
  name: string;
  available(): Promise<boolean>;
  /** 프레임 시퀀스 인페인팅 후 재인코딩된 mp4 경로 반환 */
  run(input: {
    settings: Settings;
    clip: Clip;
    inputVideo: string;
    zones: Zone[];
    workDir: string;
    outPath: string;
    onProgress?: (msg: string) => void;
  }): Promise<string>;
}

/**
 * IOPaint(lama) 프로바이더.
 * 흐름: 영상 → 프레임 추출 → 마스크 생성 → iopaint 배치 실행 → 프레임 재인코딩(+원본 오디오)
 */
export const iopaintProvider: InpaintProvider = {
  name: 'iopaint',

  async available(): Promise<boolean> {
    const r = await checkTool('iopaint', ['--version']);
    return r.available;
  },

  async run({ settings, clip, inputVideo, zones, workDir, outPath, onProgress }): Promise<string> {
    if (!clip.probe) throw new Error('probe 정보 없음');
    const { width, height, fps } = clip.probe;

    const framesDir = path.join(workDir, 'frames');
    const masksDir = path.join(workDir, 'masks');
    const outFramesDir = path.join(workDir, 'out');
    await ensureDir(framesDir);
    await ensureDir(masksDir);
    await ensureDir(outFramesDir);

    onProgress?.('프레임 추출 중…');
    await run(settings.ffmpegPath, [
      '-y', '-i', inputVideo,
      '-qscale:v', '2',
      path.join(framesDir, 'f_%06d.png'),
    ]);

    // 마스크 1장 생성 (정적 존 가정) — 흰 사각형 = 인페인팅 대상
    onProgress?.('마스크 생성 중…');
    const drawboxes = zones
      .map((z) => `drawbox=x=${Math.round(z.x)}:y=${Math.round(z.y)}:w=${Math.round(z.w)}:h=${Math.round(z.h)}:color=white@1:t=fill`)
      .join(',');
    const maskPath = path.join(masksDir, 'mask.png');
    await run(settings.ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}`,
      '-vf', drawboxes, '-frames:v', '1', maskPath,
    ]);

    // 프레임 수만큼 마스크 복제 (iopaint 배치 모드는 이미지:마스크 1:1)
    const frameFiles = (await fsp.readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
    for (const f of frameFiles) {
      await fsp.copyFile(maskPath, path.join(masksDir, f));
    }

    onProgress?.(`IOPaint 실행 중… (${frameFiles.length} 프레임)`);
    await run(settings.iopaintPath, [
      'run',
      '--model=lama',
      '--device=cpu',
      `--image=${framesDir}`,
      `--mask=${masksDir}`,
      `--output=${outFramesDir}`,
    ], { timeoutMs: 3_600_000, onStdout: onProgress });

    onProgress?.('재인코딩 중…');
    await run(settings.ffmpegPath, [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(outFramesDir, 'f_%06d.png'),
      '-i', inputVideo,
      '-map', '0:v', '-map', '1:a?',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
      '-c:a', 'copy',
      '-pix_fmt', 'yuv420p',
      outPath,
    ]);

    await fsp.rm(framesDir, { recursive: true, force: true });
    await fsp.rm(masksDir, { recursive: true, force: true });
    await fsp.rm(outFramesDir, { recursive: true, force: true });
    return outPath;
  },
};

export const inpaintProviders: InpaintProvider[] = [iopaintProvider];

export async function getAvailableInpaintProvider(): Promise<InpaintProvider | null> {
  for (const p of inpaintProviders) {
    if (await p.available()) return p;
  }
  return null;
}

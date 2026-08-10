import path from 'node:path';
import type { Settings, Script } from '@shared/types';
import { run } from '../util/exec.js';
import { ensureDir, writeJsonAtomic } from '../util/fsx.js';
import { probeDuration } from './probe.js';
import { broadcast } from '../sse.js';

/** 자주 쓰는 한국어 보이스 (edge-tts) */
export const KO_VOICES = [
  { id: 'ko-KR-SunHiNeural', label: '선히 (여성, 밝음)' },
  { id: 'ko-KR-InJoonNeural', label: '인준 (남성, 차분)' },
  { id: 'ko-KR-HyunsuMultilingualNeural', label: '현수 (남성, 다국어)' },
];

export interface SceneTiming {
  sceneId: string;
  audioFile: string; // workspace 상대경로 아님 — voice/ 내 파일명
  duration: number;
  start: number; // 누적 시작 시각
}

/**
 * 씬별 나레이션 TTS 생성 → 씬 길이 측정 → 누적 타이밍 계산.
 * voice/timing.json에 기록. 이 타이밍이 자막과 조립의 기준이 된다.
 */
export async function synthesizeNarration(
  settings: Settings,
  script: Script,
  voiceDir: string,
  voice: string,
  jobId: string,
): Promise<SceneTiming[]> {
  await ensureDir(voiceDir);
  const timings: SceneTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const fileName = `scene_${String(i + 1).padStart(2, '0')}.mp3`;
    const outPath = path.join(voiceDir, fileName);
    await run(settings.edgeTtsPath, [
      '--voice', voice,
      '--text', scene.narration,
      '--write-media', outPath,
    ], { timeoutMs: 120_000 });

    const duration = await probeDuration(settings, outPath);
    timings.push({ sceneId: scene.sceneId, audioFile: fileName, duration, start: cursor });
    cursor += duration;
    broadcast('tts.progress', { jobId, done: i + 1, total: script.scenes.length });
  }

  await writeJsonAtomic(path.join(voiceDir, 'timing.json'), timings);
  return timings;
}

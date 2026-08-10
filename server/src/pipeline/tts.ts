import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Script } from '@shared/types';
import { run } from '../util/exec.js';
import { ensureDir, exists, writeJsonAtomic } from '../util/fsx.js';
import { probeDuration } from './probe.js';
import { broadcast } from '../sse.js';
import { synthesizeToFile as typecastSynthesize } from './voice/typecast.js';
import { hasKey } from '../store/secrets.js';

/** edge-tts 무료 폴백 보이스 (타입캐스트 키가 없을 때) */
export const KO_VOICES = [
  { id: 'ko-KR-SunHiNeural', label: '선히 (여성, 밝음)' },
  { id: 'ko-KR-InJoonNeural', label: '인준 (남성, 차분)' },
  { id: 'ko-KR-HyunsuMultilingualNeural', label: '현수 (남성, 다국어)' },
];

export interface SceneTiming {
  sceneId: string;
  audioFile: string; // voice/ 내 파일명
  duration: number;
  start: number; // 누적 시작 시각
  source: 'file' | 'typecast' | 'edge-tts';
}

export type VoiceEngine = 'typecast' | 'edge-tts';

/** 설정과 키 등록 상태로 실제 사용할 엔진을 정한다 */
export async function resolveEngine(settings: Settings): Promise<VoiceEngine> {
  if (settings.ttsEngine === 'typecast') return 'typecast';
  if (settings.ttsEngine === 'edge-tts') return 'edge-tts';
  return (await hasKey('typecast')) ? 'typecast' : 'edge-tts';
}

export interface NarrationOptions {
  settings: Settings;
  script: Script;
  voiceDir: string;
  jobId: string;
  engine: VoiceEngine;
  /** edge-tts 보이스 id 또는 타입캐스트 voice id */
  voiceId: string;
  /** sceneId → voice/ 안의 업로드된 파일명. 있으면 합성 대신 이 파일을 쓴다 */
  sceneVoiceFiles: Record<string, string>;
}

/**
 * 씬별 나레이션 준비 → 길이 측정 → 누적 타이밍 계산.
 * 우선순위: 업로드된 음성 파일 > 선택한 TTS 엔진 합성.
 * voice/timing.json이 자막·조립의 기준이 되며, 이 인터페이스는 엔진과 무관하게 동일하다.
 */
export async function synthesizeNarration(opts: NarrationOptions): Promise<SceneTiming[]> {
  const { settings, script, voiceDir, jobId, engine, voiceId, sceneVoiceFiles } = opts;
  await ensureDir(voiceDir);
  const timings: SceneTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const uploaded = sceneVoiceFiles[scene.sceneId];
    let fileName: string;
    let source: SceneTiming['source'];

    if (uploaded && (await exists(path.join(voiceDir, uploaded)))) {
      fileName = uploaded;
      source = 'file';
    } else {
      fileName = `scene_${String(i + 1).padStart(2, '0')}.mp3`;
      const outPath = path.join(voiceDir, fileName);
      if (engine === 'typecast') {
        if (!voiceId) throw new Error('타입캐스트 캐릭터를 먼저 선택하세요');
        await typecastSynthesize(scene.narration, voiceId, outPath);
      } else {
        await run(settings.edgeTtsPath, [
          '--voice', voiceId || settings.defaultTtsVoice,
          '--text', scene.narration,
          '--write-media', outPath,
        ], { timeoutMs: 120_000 });
      }
      source = engine;
    }

    const duration = await probeDuration(settings, path.join(voiceDir, fileName));
    timings.push({ sceneId: scene.sceneId, audioFile: fileName, duration, start: cursor, source });
    cursor += duration;
    broadcast('tts.progress', { jobId, done: i + 1, total: script.scenes.length, source });
  }

  await writeJsonAtomic(path.join(voiceDir, 'timing.json'), timings);
  return timings;
}

/** 업로드된 씬 음성 파일 저장 — 원본 확장자를 유지한다 */
export async function saveSceneVoiceFile(
  voiceDir: string,
  sceneId: string,
  buffer: Buffer,
  originalName: string,
): Promise<string> {
  await ensureDir(voiceDir);
  const ext = path.extname(originalName).toLowerCase() || '.mp3';
  const fileName = `upload_${sceneId}${ext}`;
  await fsp.writeFile(path.join(voiceDir, fileName), buffer);
  return fileName;
}

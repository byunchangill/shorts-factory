import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Script } from '@shared/types';
import { ensureDir, exists, writeJsonAtomic } from '../util/fsx.js';
import { probeDuration } from './probe.js';
import { broadcast } from '../sse.js';
import { synthesizeToFile as typecastSynthesize } from './voice/typecast.js';

export interface SceneTiming {
  sceneId: string;
  audioFile: string; // voice/ 내 파일명
  duration: number;
  start: number; // 누적 시작 시각
  source: 'file' | 'typecast';
}

export interface NarrationOptions {
  settings: Settings;
  script: Script;
  voiceDir: string;
  jobId: string;
  /** 타입캐스트 캐릭터 id. 모든 씬에 파일이 첨부됐다면 없어도 된다 */
  typecastVoiceId: string;
  /** sceneId → voice/ 안의 업로드된 파일명. 있으면 합성 대신 이 파일을 쓴다 */
  sceneVoiceFiles: Record<string, string>;
}

/**
 * 씬별 나레이션 준비 → 길이 측정 → 누적 타이밍 계산.
 * 우선순위: 업로드된 음성 파일 > 타입캐스트 합성.
 * voice/timing.json이 자막·조립의 기준이 되며, 어느 경로든 이 인터페이스는 같다.
 */
export async function synthesizeNarration(opts: NarrationOptions): Promise<SceneTiming[]> {
  const { settings, script, voiceDir, jobId, typecastVoiceId, sceneVoiceFiles } = opts;
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
      if (!typecastVoiceId) {
        throw new Error(
          `씬 ${scene.sceneId}: 음성 파일이 첨부되지 않았고 타입캐스트 캐릭터도 선택되지 않았습니다`,
        );
      }
      fileName = `scene_${String(i + 1).padStart(2, '0')}.mp3`;
      await typecastSynthesize(scene.narration, typecastVoiceId, path.join(voiceDir, fileName));
      source = 'typecast';
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

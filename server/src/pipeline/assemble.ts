import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Script, Clip } from '@shared/types';
import { COUPANG_PARTNERS_DISCLOSURE } from '@shared/constants';
import { run } from '../util/exec.js';
import { ensureDir, exists } from '../util/fsx.js';
import type { SceneTiming } from './tts.js';
import { buildAss, buildSrt, wrapKorean, type SubCue } from './subtitles.js';

const W = 1080;
const H = 1920;
const FPS = 30;

export interface AssembleInput {
  script: Script;
  timings: SceneTiming[];
  clips: Clip[]; // menu-a: 씬의 clipRef 해석용
  jobDir: string; // 절대경로
  resolveWorkspacePath: (rel: string) => string;
  burnSubtitles: boolean;
  burnDisclosure: boolean;
  version: number;
}

/**
 * 씬별 비주얼 소스 결정:
 * - menu-a: clipRef → 정리본(clean) 우선, 없으면 원본 다운로드 파일
 * - menu-b: imageRef (씬 이미지) → Ken Burns 줌
 * 나레이션 길이에 맞춰 각 씬을 재단하고 concat → 자막 번인 → 최종 mp4.
 */
export async function assembleFinal(settings: Settings, input: AssembleInput): Promise<string> {
  const { script, timings, jobDir, version } = input;
  const outDir = path.join(jobDir, 'output');
  const tmpDir = path.join(outDir, 'tmp');
  await ensureDir(tmpDir);

  // 1) 씬별 세그먼트 렌더 (나레이션 길이에 맞춤)
  const segFiles: string[] = [];
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const timing = timings[i];
    if (!timing) throw new Error(`씬 ${scene.sceneId}의 타이밍 없음 — TTS를 먼저 실행하세요`);
    const dur = Math.max(1, timing.duration);
    const segOut = path.join(tmpDir, `seg_${String(i + 1).padStart(2, '0')}.mp4`);

    const visual = await resolveVisual(scene, input);
    if (visual.type === 'video') {
      const ss = visual.in ?? 0;
      await run(settings.ffmpegPath, [
        '-y',
        '-ss', String(ss), '-i', visual.path,
        '-t', dur.toFixed(3),
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`,
        '-an',
        '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
        segOut,
      ]);
    } else {
      // 이미지 → Ken Burns 줌인
      const frames = Math.ceil(dur * FPS);
      await run(settings.ffmpegPath, [
        '-y', '-loop', '1', '-i', visual.path,
        '-t', dur.toFixed(3),
        '-vf',
        `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
        `zoompan=z='min(zoom+0.0008,1.15)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
        '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
        segOut,
      ]);
    }
    segFiles.push(segOut);
  }

  // 2) 비디오 concat
  const concatList = path.join(tmpDir, 'concat.txt');
  await fsp.writeFile(concatList, segFiles.map((f) => `file '${f}'`).join('\n'), 'utf8');
  const videoOnly = path.join(tmpDir, 'video_concat.mp4');
  await run(settings.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
    '-c', 'copy', videoOnly,
  ]);

  // 3) 나레이션 오디오 concat
  const audioList = path.join(tmpDir, 'audio_concat.txt');
  const voiceDir = path.join(jobDir, 'voice');
  await fsp.writeFile(
    audioList,
    timings.map((t) => `file '${path.join(voiceDir, t.audioFile)}'`).join('\n'),
    'utf8',
  );
  const audioOnly = path.join(tmpDir, 'narration.m4a');
  await run(settings.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', audioList,
    '-c:a', 'aac', '-b:a', '192k', audioOnly,
  ]);

  // 4) 자막 파일 생성 (SRT는 업로드용으로 항상, ASS는 번인용)
  const cues: SubCue[] = script.scenes.map((scene, i) => ({
    start: timings[i].start,
    end: timings[i].start + timings[i].duration,
    text: wrapKorean(scene.subtitle || scene.narration),
  }));
  if (input.burnDisclosure) {
    const total = timings.at(-1)!.start + timings.at(-1)!.duration;
    cues.push({
      start: Math.max(0, total - 3),
      end: total,
      text: COUPANG_PARTNERS_DISCLOSURE,
    });
  }
  const subsDir = path.join(jobDir, 'subtitles');
  await ensureDir(subsDir);
  const srtPath = path.join(subsDir, 'final.srt');
  const assPath = path.join(subsDir, 'final.ass');
  await fsp.writeFile(srtPath, buildSrt(cues), 'utf8');
  await fsp.writeFile(assPath, buildAss(cues), 'utf8');

  // 5) 합치기 (+자막 번인)
  const finalPath = path.join(outDir, `final_v${version}.mp4`);
  const vf = input.burnSubtitles
    ? ['-vf', `ass=${assPath.replace(/([:\\])/g, '\\$1')}`]
    : [];
  await run(settings.ffmpegPath, [
    '-y', '-i', videoOnly, '-i', audioOnly,
    ...vf,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-shortest',
    finalPath,
  ]);

  await fsp.rm(tmpDir, { recursive: true, force: true });
  return finalPath;
}

async function resolveVisual(
  scene: Script['scenes'][number],
  input: AssembleInput,
): Promise<{ type: 'video'; path: string; in?: number } | { type: 'image'; path: string }> {
  if (scene.imageRef) {
    return { type: 'image', path: input.resolveWorkspacePath(scene.imageRef) };
  }
  if (scene.clipRef) {
    const clip = input.clips.find((c) => c.id === scene.clipRef!.clipId);
    if (!clip) throw new Error(`씬 ${scene.sceneId}: 클립 ${scene.clipRef.clipId} 없음`);

    // 정리본 우선
    if (clip.currentCleanVersion) {
      const clean = clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion);
      if (clean && (await exists(clean.filePath))) {
        return { type: 'video', path: clean.filePath, in: scene.clipRef.suggestedSegment?.in };
      }
    }
    // 사용자가 선택한 세그먼트가 있으면 그 in 지점 사용
    const seg = clip.segments.find((s) => s.used);
    const inPoint = seg?.in ?? scene.clipRef.suggestedSegment?.in ?? 0;
    const src = path.join(input.jobDir, 'sources', `${clip.sourceId}.mp4`);
    return { type: 'video', path: src, in: inPoint };
  }
  throw new Error(`씬 ${scene.sceneId}: clipRef도 imageRef도 없음`);
}

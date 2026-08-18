import path from 'node:path';
import type { Job, Script, Clip, Settings } from '@shared/types';
import type { SceneTiming } from './tts.js';
import { buildSrt, wrapKorean, type SubCue } from './subtitles.js';
import { exportFileName } from './exporter.js';

/**
 * 캡컷에 끌어다 넣을 폴더 만들기.
 *
 * 캡컷에는 공식 연동 API가 없다. 초안 폴더의 `draft_content.json`을 직접 만드는 길이
 * 있지만 비공식 포맷이라 캡컷이 올라갈 때마다 깨진다 — 편집기가 안 열리는 것이
 * 파일이 없는 것보다 나쁘다. 그래서 **사람이 끌어다 놓는 재료**를 만든다.
 *
 * 핵심은 **이름이 곧 순서**라는 것이다. 캡컷은 여러 파일을 한 번에 끌어다 놓으면
 * 이름 순으로 트랙에 얹는다. 번호를 앞에 붙여 씬 순서가 그대로 타임라인이 되게 한다.
 */

export interface CapcutInput {
  settings: Settings;
  job: Job;
  productName: string;
  jobDir: string;
  script: Script;
  timings: SceneTiming[];
  clips: Clip[];
}

export interface CapcutItem {
  /** 묶음 안에서의 경로 (`01_영상/01_s01.mp4`) */
  name: string;
  /** 복사할 원본 절대경로. `text`가 있으면 비어 있다 */
  src?: string;
  text?: string;
}

/** 씬 번호를 두 자리로 — 열 개가 넘어가면 1, 10, 11, 2 순서로 섞인다 */
const no = (i: number) => String(i + 1).padStart(2, '0');

/** 씬에 붙는 영상 — 정리본이 있으면 그것, 없으면 원본 */
function sceneVideo(scene: Script['scenes'][number], clips: Clip[], jobDir: string): string | null {
  if (!scene.clipRef) return null;
  const clip = clips.find((c) => c.id === scene.clipRef!.clipId);
  if (!clip) return null;
  const clean = clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion);
  return clean?.filePath ?? path.join(jobDir, 'sources', `${clip.sourceId}.mp4`);
}

/**
 * 캡컷 묶음에 담을 것들.
 *
 * 자막은 SRT로 넣는다 — 캡컷이 자막 트랙으로 바로 읽는다. 시각은 조립과 같은 계산을
 * 써야 편집기에서 밀리지 않으므로 나레이션 길이를 누적해 잡는다.
 */
export function planCapcut(input: CapcutInput): CapcutItem[] {
  const { job, productName, jobDir, script, timings, clips } = input;
  const items: CapcutItem[] = [];
  const cues: SubCue[] = [];
  const lines: string[] = [
    `# ${script.title || job.title} — 캡컷 재료`,
    '',
    '이 폴더를 통째로 캡컷에 끌어다 놓으세요. **파일 이름 순서가 곧 씬 순서입니다.**',
    '',
    '| 씬 | 길이 | 나레이션 | 자막 |',
    '|---|---|---|---|',
  ];

  let cursor = 0;
  for (const [i, scene] of script.scenes.entries()) {
    const timing = timings[i];
    const dur = timing?.duration ?? scene.durationHint ?? 0;

    const video = sceneVideo(scene, clips, jobDir);
    if (video) {
      items.push({ name: `01_영상/${no(i)}_${scene.sceneId}.mp4`, src: video });
    }
    if (timing) {
      items.push({
        name: `02_음성/${no(i)}_${scene.sceneId}${path.extname(timing.audioFile)}`,
        src: path.join(jobDir, 'voice', timing.audioFile),
      });
    }
    const text = scene.subtitle || scene.narration;
    if (text) cues.push({ start: cursor, end: cursor + dur, text: wrapKorean(text) });
    cursor += dur;

    lines.push(`| ${no(i)} | ${dur.toFixed(1)}초 | ${scene.narration} | ${scene.subtitle} |`);
  }

  items.push({ name: '03_자막/자막.srt', text: buildSrt(cues) });

  lines.push('');
  lines.push(`총 길이 약 ${cursor.toFixed(1)}초`);
  lines.push('');
  lines.push('- `01_영상` — 씬 순서대로. 정리본(자막·워터마크 지운 것)이 있으면 그쪽입니다');
  lines.push('- `02_음성` — 씬별 나레이션. 영상과 번호가 짝입니다');
  lines.push('- `03_자막` — SRT. 캡컷에서 자막 트랙으로 바로 읽힙니다');
  lines.push('');
  lines.push('좌우반전·색보정·확대는 캡컷에서 직접 거세요. 웹에서 합치면 설정값이 자동으로 걸립니다.');
  items.push({ name: '읽어보세요.md', text: lines.join('\n') });

  // 업로드킷도 같이 — 편집이 끝나면 바로 올려야 한다
  items.push({
    name: `업로드킷/${exportFileName(productName, job.title, '업로드킷.md')}`,
    src: path.join(jobDir, 'output', 'upload-kit.md'),
  });
  return items;
}

import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Script, Clip } from '@shared/types';
import { COUPANG_PARTNERS_DISCLOSURE } from '@shared/constants';
import { run } from '../util/exec.js';
import { ensureDir, exists } from '../util/fsx.js';
import type { SceneTiming } from './tts.js';
import { assStyleOf, buildAss, buildSrt, wrapKorean, type SubCue } from './subtitles.js';
import { findKoreanFont, fontFamilyOf, filterFileArg, escapeDrawText } from './fonts.js';
import { familyOfInstalled } from './freeFonts.js';
import { renderCard } from './cards.js';

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

  // 카드용 폰트 (없으면 카드를 건너뛴다 — 한글이 깨진 카드보다 없는 게 낫다)
  const font = await findKoreanFont(settings.fontPath);
  // 필터에는 폰트 파일명만 넣고 폰트 폴더에서 실행한다 (필터그래프 경로 이스케이프 회피)
  const fontRef = font ? filterFileArg(font) : null;

  /**
   * 타임라인. 카드가 들어가면 영상만 길어져 오디오·자막이 밀리므로,
   * 비디오·오디오·자막을 모두 이 하나의 타임라인에서 계산한다.
   */
  const timeline: Array<{ kind: 'card' | 'scene'; file: string; dur: number; sceneIdx?: number }> = [];

  // 1) 씬별 세그먼트 렌더 (나레이션 길이에 맞춤)
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const timing = timings[i];
    if (!timing) throw new Error(`씬 ${scene.sceneId}의 타이밍 없음 — TTS를 먼저 실행하세요`);
    const dur = Math.max(1, timing.duration);
    const segOut = path.join(tmpDir, `seg_${String(i + 1).padStart(2, '0')}.mp4`);

    // 하이브리드 믹싱: 씬 앞에 직접 만든 텍스트 카드를 끼운다.
    // 남의 영상 연속 노출을 끊고 정보 밀도를 올린다. 첫 씬 앞에는 넣지 않는다(훅이 먼저).
    const cardText = scene.cardText
      ?? (settings.insertCards && i > 0 && scene.subtitle && scene.subtitle.length <= 20
        ? scene.subtitle
        : undefined);
    if (cardText && font) {
      const cardOut = path.join(tmpDir, `card_${String(i + 1).padStart(2, '0')}.mp4`);
      const made = await renderCard(
        settings,
        { headline: cardText, style: 'dark', durationSec: settings.cardDurationSec },
        cardOut,
      );
      if (made) timeline.push({ kind: 'card', file: made, dur: settings.cardDurationSec });
    }

    const visual = await resolveVisual(scene, input);
    if (visual.type === 'video') {
      const ss = visual.in ?? 0;
      await run(settings.ffmpegPath, [
        '-y',
        '-ss', String(ss), '-i', visual.path,
        '-t', dur.toFixed(3),
        '-vf', buildLayoutFilter(settings, fontRef?.arg ?? null),
        '-an',
        '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
        segOut,
      ], { cwd: fontRef?.cwd });
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
    timeline.push({ kind: 'scene', file: segOut, dur, sceneIdx: i });
  }

  // 2) 비디오 concat — 타임라인 순서 그대로
  const concatList = path.join(tmpDir, 'concat.txt');
  await fsp.writeFile(
    concatList,
    timeline.map((t) => `file '${toConcatPath(t.file)}'`).join('\n'),
    'utf8',
  );
  const videoOnly = path.join(tmpDir, 'video_concat.mp4');
  await run(settings.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
    '-c', 'copy', videoOnly,
  ]);

  // 3) 오디오 concat — 카드 구간에는 같은 길이의 무음을 넣어야 싱크가 유지된다
  const voiceDir = path.join(jobDir, 'voice');
  const audioParts: string[] = [];
  for (const [idx, item] of timeline.entries()) {
    if (item.kind === 'scene') {
      audioParts.push(path.join(voiceDir, timings[item.sceneIdx!].audioFile));
    } else {
      const silence = path.join(tmpDir, `silence_${idx}.m4a`);
      await run(settings.ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-t', item.dur.toFixed(3), '-c:a', 'aac', '-b:a', '192k', silence,
      ]);
      audioParts.push(silence);
    }
  }
  // 첨부 파일과 합성 음성이 섞이면 포맷이 제각각이라 concat 데먹서가 흔들린다.
  // 각 조각을 동일 규격으로 정규화한 뒤 이어 붙인다.
  const normalized: string[] = [];
  for (const [i, src] of audioParts.entries()) {
    const out = path.join(tmpDir, `a_${String(i).padStart(2, '0')}.m4a`);
    await run(settings.ffmpegPath, [
      '-y', '-loglevel', 'error', '-i', src,
      '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', out,
    ]);
    normalized.push(out);
  }
  const audioList = path.join(tmpDir, 'audio_concat.txt');
  await fsp.writeFile(
    audioList,
    normalized.map((f) => `file '${toConcatPath(f)}'`).join('\n'),
    'utf8',
  );
  const audioOnly = path.join(tmpDir, 'narration.m4a');
  await run(settings.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', audioList,
    '-c:a', 'aac', '-b:a', '192k', audioOnly,
  ]);

  // 4) 자막 — 카드 시간을 포함한 실제 타임라인 기준으로 시각을 잡는다
  const cues: SubCue[] = [];
  let cursor = 0;
  for (const item of timeline) {
    if (item.kind === 'scene') {
      const scene = script.scenes[item.sceneIdx!];
      cues.push({
        start: cursor,
        end: cursor + item.dur,
        text: wrapKorean(scene.subtitle || scene.narration, settings.subtitleMaxChars),
      });
    }
    cursor += item.dur;
  }
  const totalDur = cursor;
  if (input.burnDisclosure) {
    cues.push({
      start: Math.max(0, totalDur - 3),
      end: totalDur,
      text: COUPANG_PARTNERS_DISCLOSURE,
    });
  }
  const subsDir = path.join(jobDir, 'subtitles');
  await ensureDir(subsDir);
  const srtPath = path.join(subsDir, 'final.srt');
  const assPath = path.join(subsDir, 'final.ass');
  await fsp.writeFile(srtPath, buildSrt(cues), 'utf8');
  // 자막 폰트도 실제로 설치된 것을 지정해야 한글이 깨지지 않는다
  // 화면에서 받아 둔 글꼴은 표에 없다 — 받을 때 적어 둔 이름을 먼저 본다
  const family = (font && await familyOfInstalled(font)) ?? fontFamilyOf(font);
  await fsp.writeFile(assPath, buildAss(cues, assStyleOf(settings, family)), 'utf8');

  // 5) 합치기 (+자막 번인)
  // 자막 파일도 파일명만 필터에 넣고 자막 폴더에서 실행한다 (입출력은 절대경로 그대로)
  const assRef = filterFileArg(assPath);
  const finalPath = path.join(outDir, `final_v${version}.mp4`);
  const vf = input.burnSubtitles ? ['-vf', `ass=${assRef.arg}`] : [];
  await run(settings.ffmpegPath, [
    '-y', '-i', videoOnly, '-i', audioOnly,
    ...vf,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-shortest',
    finalPath,
  ], { cwd: assRef.cwd });

  await fsp.rm(tmpDir, { recursive: true, force: true });
  return finalPath;
}

/**
 * 화면 구성 필터.
 *
 * fullscreen: 소스를 9:16에 꽉 채운다 (남의 영상이 화면 전체를 덮는다)
 * framed: 자기 프레임 안에 소스를 축소 배치한다. 상단 제목바 + 하단 정보영역이
 *         자기 레이어가 되어, 원본이 화면을 독점하지 않는다.
 *
 * @param fontArg 필터에 넣을 폰트 인자 — 경로가 아니라 `filterFileArg()`가 준 **파일명**이다.
 *                (호출부가 폰트 폴더를 cwd로 잡고 실행한다)
 */
export function buildLayoutFilter(settings: Settings, fontArg: string | null): string {
  // 채널 그레이딩은 맨 끝에 건다 — 합성이 끝난 화면 전체가 한 룩으로 묶여야 한다
  const grade = settings.grade.trim();
  const base = grade ? `fps=${FPS},${grade}` : `fps=${FPS}`;
  /*
    좌우반전은 **맨 앞**에 건다. 소재만 뒤집고 우리가 얹는 층(제목바·테두리·고정 문구)은
    그대로 두기 위해서다. 뒤에 걸면 제목 글자까지 거울상이 된다.
    자막·카드는 여기가 아니라 다음 인코딩 단계에서 붙으므로 애초에 안 걸린다.
  */
  const flip = settings.mirror ? 'hflip,' : '';
  /*
    확대는 반전 **뒤, 레이아웃 앞**이다. 소재만 키우고 우리가 얹는 층은 원래 크기로 둔다 —
    뒤에 걸면 제목바와 테두리까지 같이 커져 화면 밖으로 밀린다.
    키운 뒤 원래 크기로 잘라내므로 결과 해상도는 그대로다.
  */
  const zoom = settings.zoom > 1
    ? `scale=iw*${settings.zoom}:ih*${settings.zoom},crop=iw/${settings.zoom}:ih/${settings.zoom},`
    : '';
  const pre = `${flip}${zoom}`;

  if (settings.layout === 'fullscreen') {
    return `${pre}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${base}`;
  }

  // framed — 소스는 가로폭 92%, 세로 중앙 58% 영역에 넣는다
  const inW = Math.round(W * 0.92);
  const inH = Math.round(H * 0.52);
  const x = Math.round((W - inW) / 2);
  const y = Math.round(H * 0.24);
  const barY = Math.round(H * 0.155);

  const parts = [
    // 1) 배경: 소스를 크게 확대·블러 처리해 여백을 채운다
    `${pre}split=2[bg][fg]`,
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=40:luma_power=2,eq=brightness=-0.18[bgb]`,
    // 2) 전경: 소스를 프레임 크기로 맞춤
    `[fg]scale=${inW}:${inH}:force_original_aspect_ratio=increase,crop=${inW}:${inH}[fgc]`,
    // 3) 합성
    `[bgb][fgc]overlay=${x}:${y}[framed]`,
    // 4) 자기 레이어: 상단 강조 바 + 프레임 테두리
    `[framed]drawbox=x=0:y=${barY}:w=${W}:h=8:color=#2B7DE9@1:t=fill,` +
      `drawbox=x=${x - 4}:y=${y - 4}:w=${inW + 8}:h=${inH + 8}:color=white@0.9:t=4,${base}`,
  ];

  let graph = parts.join(';');

  // 5) 채널명 등 고정 문구 (폰트가 있을 때만)
  if (fontArg && settings.frameTitle.trim()) {
    graph +=
      `,drawtext=fontfile='${fontArg}':text='${escapeDrawText(settings.frameTitle.trim())}':` +
      `fontcolor=white:fontsize=52:x=(w-text_w)/2:y=${Math.round(H * 0.085)}`;
  }
  return graph;
}

/**
 * concat 목록에 넣을 경로.
 * ffmpeg의 concat 데먹서는 백슬래시를 이스케이프 문자로 해석하므로,
 * 윈도우 경로를 그대로 쓰면 `C:\Users\...`의 `\U`가 깨진다.
 * 윈도우 ffmpeg도 슬래시 경로를 받아들이므로 통일한다.
 */
export function toConcatPath(p: string): string {
  return p.replace(/\\/g, '/');
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

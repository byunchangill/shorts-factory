import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Script, Clip } from '@shared/types';
import { COUPANG_PARTNERS_DISCLOSURE, type Menu } from '@shared/constants';
import { run } from '../util/exec.js';
import { ensureDir, exists } from '../util/fsx.js';
import type { SceneTiming } from './tts.js';
import { assStyleOf, buildAss, buildSrt, splitLines, wrapKorean, type SubCue } from './subtitles.js';
import { subtitleCharsPerLine } from '@shared/constants';
import { findKoreanFont, fontFamilyOf, filterFileArg, escapeDrawText } from './fonts.js';
import { familyOfInstalled } from './freeFonts.js';
import { renderCard } from './cards.js';
import { hookMotionDelta, hookGateMessage } from './hookGate.js';

const W = 1080;
const H = 1920;
const FPS = 30;

/** 이 시각 안쪽에서 장면이 바뀌면 그 앞은 인트로 타이틀 카드로 본다 */
const INTRO_CARD_MAX_SEC = 0.6;
/** 경계에 딱 붙이지 않는다 — 검출 시각이 한 프레임 어긋나도 카드가 안 새게 */
const INTRO_CARD_PAD_SEC = 0.05;

/**
 * 인트로 타이틀 카드를 컷 시작에서 **비켜간다**.
 *
 * 틱톡·샤오홍슈 소재는 앞 0.1~0.5초에 제목 카드가 붙어 있고 대개 큰 외국어 글자다.
 * 프레임 추출은 1초 간격이라 **이 구간을 한 장도 못 본다** — ffmpeg `fps` 필터가
 * 첫 출력 프레임으로 카드가 아니라 그 다음 장면을 내놓는다 (2026-08-23 실측).
 * 사용자도 못 보고 자동 존 검출도 못 보므로 존이 안 생기고, 아무도 모르는 채
 * 완성본의 **첫 프레임** — 유튜브가 썸네일로 쓰는 그 화면 — 에 그대로 남는다.
 *
 * 지우지 않고 비켜간다. 텍스트 제거 사다리의 0순위다 — 0.1초를 버리는 값으로
 * 화질 손실도 인페인팅 시간도 없이 사라진다. 넓은 글자라 어차피 못 지운다.
 */
export function skipIntroCard(inPoint: number, sceneTimes?: number[]): number {
  const first = sceneTimes?.[0];
  if (first === undefined || first <= 0 || first > INTRO_CARD_MAX_SEC) return inPoint;
  // 사용자가 이미 카드 뒤를 골랐으면 건드리지 않는다
  return inPoint >= first ? inPoint : first + INTRO_CARD_PAD_SEC;
}

export interface AssembleInput {
  /** 메뉴마다 화면 규칙이 다르다 — 해외영상 짜집기는 음성=자막이라 텍스트 카드를 넣지 않는다 */
  menu: Menu;
  script: Script;
  timings: SceneTiming[];
  clips: Clip[]; // menu-a: 씬의 clipRef 해석용
  jobDir: string; // 절대경로
  resolveWorkspacePath: (rel: string) => string;
  burnSubtitles: boolean;
  burnDisclosure: boolean;
  version: number;
  /**
   * 상단 띠에 넣을 제목 (`layout: 'banded'`). 대본의 `title`이 출처다 —
   * 편마다 달라야 하는 값이라 설정이 아니라 잡에서 온다. 비면 띠만 그린다.
   */
  headline?: string;
  /**
   * 씬이 가리키는 짤·효과음의 실제 파일 경로 (자산 id → 절대경로).
   *
   * 조립은 자료실을 **직접 뒤지지 않는다** — 파일시스템 접근을 부르는 쪽에 모아 두면
   * 하네스가 가짜 자료실 없이도 이 함수를 돌릴 수 있다. 없는 id는 그냥 빠진다.
   */
  assetPaths?: Record<string, string>;
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

    /*
      하이브리드 믹싱: 씬 앞에 직접 만든 텍스트 카드를 끼운다.
      남의 영상 연속 노출을 끊고 정보 밀도를 올린다. 첫 씬 앞에는 넣지 않는다(훅이 먼저).

      🔴 **해외영상 짜집기에는 카드를 넣지 않는다** (2026-08-21 교리 v3.3 이식).
      「말하지 않을 것은 화면에도 없다」가 첫 규칙인데 카드는 무음 구간에 글자만 띄운다.
      재사용 판정 회피는 좌우반전·확대·그레이딩이 이미 맡고 있어 카드가 유일한 장치도 아니다.
    */
    const cardsAllowed = input.menu !== 'menu-a';
    const cardText = cardsAllowed
      ? scene.cardText
        ?? (settings.insertCards && i > 0 && scene.subtitle && scene.subtitle.length <= 20
          ? scene.subtitle
          : undefined)
      : undefined;
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
    /*
      훅 게이트 — 첫 씬이 거의 멈춰 있으면 렌더 전에 막는다.
      몇 분을 인코딩한 뒤 「계속 시청함」이 20% 아래로 나오는 것보다 여기서 끝내는 게 싸다.
      못 쟀을 때(null)는 통과시킨다 — 검출 실패로 조립이 멈추면 안 된다.
    */
    if (i === 0 && visual.type === 'video' && settings.hookMotionMin > 0) {
      const delta = await hookMotionDelta(settings, visual.path, tmpDir, visual.in ?? 0);
      if (delta !== null && delta < settings.hookMotionMin) {
        throw new Error(hookGateMessage(delta, settings.hookMotionMin));
      }
    }
    const meme = memeOverlayFor(scene, dur, settings, input.assetPaths);
    if (visual.type === 'video') {
      const ss = visual.in ?? 0;
      const layout = buildLayoutFilter(settings, fontRef?.arg ?? null, input.headline ?? script.title);
      await run(settings.ffmpegPath, meme
        ? [
          '-y',
          '-ss', String(ss), '-i', visual.path,
          // gif·webp는 한 장이 아니라 여러 장이다 — 안 풀면 첫 프레임에서 멈춘다
          ...(meme.animated ? ['-ignore_loop', '0'] : []),
          '-i', meme.path,
          '-t', dur.toFixed(3),
          '-filter_complex', `[0:v]${layout}[base];${meme.filter}`,
          '-map', '[v]',
          '-an',
          '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
          segOut,
        ]
        : [
          '-y',
          '-ss', String(ss), '-i', visual.path,
          '-t', dur.toFixed(3),
          '-vf', layout,
          '-an',
          '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
          segOut,
        ], { cwd: fontRef?.cwd });
    } else {
      // 이미지 → Ken Burns 줌인
      const frames = Math.ceil(dur * FPS);
      /*
        띠는 영상 씬과 **똑같이** 얹는다. 한 편 안에서 어떤 씬엔 제목 띠가 있고 어떤 씬엔
        없으면 화면이 중간에 튄다 — 이미지로 메운 씬인 게 그대로 드러난다.
      */
      await run(settings.ffmpegPath, [
        '-y', '-loop', '1', '-i', visual.path,
        '-t', dur.toFixed(3),
        '-vf',
        `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
        `zoompan=z='min(zoom+0.0008,1.15)':d=${frames}:s=${W}x${H}:fps=${FPS}` +
        overlayBands(settings, fontRef?.arg ?? null, input.headline ?? script.title),
        '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
        segOut,
      ], { cwd: fontRef?.cwd });
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
  let audioOnly = path.join(tmpDir, 'narration.m4a');
  await run(settings.ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', audioList,
    '-c:a', 'aac', '-b:a', '192k', audioOnly,
  ]);

  /*
    3-1) 효과음 — 나레이션 **위에 섞는다** (이어 붙이지 않는다).

    이어 붙이면 그만큼 영상이 길어지고 그 구간은 말이 없어 완주율이 깎인다.
    섞으면 길이가 그대로다. 음량은 나레이션보다 낮게 깔아야 말을 안 가린다.

    🔴 `amix`에 `normalize=0`을 반드시 준다. 기본값은 입력 수만큼 전체 음량을 나눠서,
    효과음 하나 넣었다고 나레이션이 통째로 작아진다.
  */
  const sfx = sceneSfxCues(script.scenes, timeline, settings, input.assetPaths);
  if (sfx.length) {
    const mixed = path.join(tmpDir, 'narration_sfx.m4a');
    const inputs = sfx.flatMap((s) => ['-i', s.path]);
    const legs = sfx.map((s, i) => {
      const ms = Math.round(s.at * 1000);
      return `[${i + 1}:a]adelay=${ms}|${ms},volume=${settings.sfxVolume}[s${i}]`;
    });
    const mix = `[0:a]${sfx.map((_, i) => `[s${i}]`).join('')}`
      + `amix=inputs=${sfx.length + 1}:duration=first:dropout_transition=0:normalize=0[a]`;
    await run(settings.ffmpegPath, [
      '-y', '-loglevel', 'error', '-i', audioOnly, ...inputs,
      '-filter_complex', `${legs.join(';')};${mix}`,
      '-map', '[a]', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', mixed,
    ]);
    audioOnly = mixed;
  }

  // 4) 자막 — 카드 시간을 포함한 실제 타임라인 기준으로 시각을 잡는다
  const lineChars = Math.min(
    settings.subtitleMaxChars,
    subtitleCharsPerLine(settings.subtitleFontSize),
  );
  const cues: SubCue[] = [];
  let cursor = 0;
  for (const item of timeline) {
    if (item.kind === 'scene') {
      const scene = script.scenes[item.sceneIdx!];
      /*
        두 줄이 되면 한꺼번에 띄우지 않고 음성 길이를 나눠 차례로 보여 준다.
        줄바꿈은 **반드시 우리가** 해야 한다 — 설정값이 화면 폭보다 크면 렌더러가 대신
        접는데, 그렇게 접힌 줄에는 시간을 줄 수 없어 두 줄이 한꺼번에 떠 버린다.
      */
      cues.push(...splitLines(
        wrapKorean(scene.subtitle || scene.narration, lineChars),
        cursor,
        item.dur,
      ));
    }
    cursor += item.dur;
  }
  const totalDur = cursor;
  /*
    쿠팡파트너스 공시 번인.

    🔴 **공시도 줄바꿈을 우리가 한다.** 안 그러면 렌더러가 제멋대로 접는데, 실측에서 다섯 줄로
    접혀 화면 절반을 덮었다 (2026-08-23). 바로 위 자막 규칙과 같은 이유다.

    🔴 **마지막 자막과 시간이 겹치면 안 된다.** 겹치면 두 자막이 한꺼번에 떠서 포개진다 —
    공시 다섯 줄 아래에 「보여주면 됨」이 같이 찍혀 나왔다. 그래서 **마지막 자막이 끝난 뒤**로
    민다. 남는 시간이 없으면 아예 넣지 않는다 (번인은 의무가 아니고, 공시는 설명란이 맡는다).
  */
  if (input.burnDisclosure) {
    const lastEnd = cues.length ? Math.max(...cues.map((c) => c.end)) : 0;
    const start = Math.max(lastEnd, totalDur - 3);
    if (totalDur - start >= 0.8) {
      cues.push({
        start,
        end: totalDur,
        text: wrapKorean(COUPANG_PARTNERS_DISCLOSURE, lineChars),
      });
    }
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
/**
 * 제목을 두 줄로 가른다. 벤치마킹 두 채널 모두 **첫 줄 노랑 · 둘째 줄 흰색**이고,
 * 둘째 줄이 결론을 맡는다 (「1년에 진짜 딱 10분만 / 볼 수 있다는 것」).
 *
 * 그래서 **뒤쪽을 둘째 줄에 몰아준다** — 앞에서 자르면 결론이 첫 줄로 올라와 색이 뒤집힌다.
 * 공백에서만 자르고, 공백이 없으면 한 줄로 둔다.
 */
export function splitHeadline(text: string, perLine = 13): [string, string] {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return ['', ''];
  if (t.length <= perLine) return ['', t]; // 짧으면 흰 줄 하나로 — 노랑만 있는 제목은 없다
  const words = t.split(' ');
  if (words.length === 1) return ['', t];
  let best = 1;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    // 두 줄 다 한 줄 폭 안에 들면서, 첫 줄이 조금 더 긴 배치를 좋게 본다
    const score = Math.abs(a - b) + (a > perLine ? 100 : 0) + (b > perLine ? 100 : 0);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/**
 * 효과음이 울릴 **최종 타임라인 기준 시각**.
 *
 * 씬 시작 시각은 카드가 끼면 밀린다 — 씬 순서만 보고 계산하면 카드를 넣은 편에서
 * 효과음이 한 씬씩 어긋난다. 그래서 실제 타임라인을 훑어 잰다.
 */
export function sceneSfxCues(
  scenes: Script['scenes'],
  timeline: Array<{ kind: 'card' | 'scene'; dur: number; sceneIdx?: number }>,
  settings: Settings,
  paths: Record<string, string> | undefined,
): Array<{ path: string; at: number }> {
  if (settings.sfxVolume <= 0) return [];
  const out: Array<{ path: string; at: number }> = [];
  let t = 0;
  for (const item of timeline) {
    if (item.kind === 'scene' && item.sceneIdx !== undefined) {
      const scene = scenes[item.sceneIdx];
      const file = scene?.sfxId ? paths?.[scene.sfxId] : undefined;
      if (file) {
        const offset = Math.max(0, Math.min(scene.sfxAt ?? 0, Math.max(0, item.dur - 0.1)));
        out.push({ path: file, at: t + offset });
      }
    }
    t += item.dur;
  }
  return out;
}

/** 여러 장짜리 그림인가 — gif·webp는 풀어주지 않으면 첫 프레임에서 멈춘다 */
function isAnimated(file: string): boolean {
  return /\.(gif|webp|apng)$/i.test(file);
}

/**
 * 씬 위에 잠깐 얹을 짤 (2026-08-23).
 *
 * 🔴 **씬 사이에 끼우지 않고 위에 얹는다.** 끼우면 그만큼 영상이 길어져 18~26초 예산을
 * 넘긴다 — 지금도 상한을 넘고 있어 더 늘릴 여유가 없다.
 *
 * 자리는 **띠 사이 영상 구간의 위쪽**이다. 아래는 자막이 앉고, 위아래 띠는 제목·채널명이
 * 쓴다. 남는 곳은 거기뿐이다.
 *
 * 없는 자산 id는 조용히 건너뛴다 — 짤 하나 때문에 조립이 통째로 멈추면 안 된다.
 */
export function memeOverlayFor(
  scene: Script['scenes'][number],
  sceneDur: number,
  settings: Settings,
  paths: Record<string, string> | undefined,
): { path: string; filter: string; animated: boolean } | null {
  const file = scene.memeId ? paths?.[scene.memeId] : undefined;
  if (!file) return null;

  const start = Math.max(0, Math.min(scene.memeAt ?? 0, Math.max(0, sceneDur - 0.4)));
  const end = Math.min(sceneDur, start + settings.memeDurationSec);
  // 의도한 길이의 절반도 못 나오면 넣지 않는다 — 스치듯 지나가는 짤은 못 알아본다
  if (end - start < Math.min(0.4, settings.memeDurationSec)) return null;

  const w = Math.round(W * settings.memeWidthRatio);
  // 영상 구간(띠 사이)의 위쪽 — 아래는 자막 자리다
  const videoTop = Math.round(H * settings.topBandRatio);
  const y = videoTop + Math.round(H * 0.04);
  const x = Math.round(W - w - W * 0.05); // 오른쪽에 붙인다
  const filter = `[1:v]scale=${w}:-1[mm];`
    + `[base][mm]overlay=${x}:${y}:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[v]`;
  return { path: file, filter, animated: isAnimated(file) };
}

/**
 * 제목 글자 크기 — **띠 높이와 화면 폭 중 빡빡한 쪽**에 맞춘다.
 *
 * 🔴 띠 높이에만 맞추면 긴 줄이 화면 밖으로 잘려 나간다. 상단 띠를 0.155에서 0.22로 키웠더니
 * 글자가 143까지 커져 여덟 글자짜리 첫 줄이 좌우로 잘렸다 (2026-08-23 실측).
 * `drawtext`에는 자동 축소가 없어서 **우리가 미리 재야 한다.**
 *
 * 한글은 이송폭이 글자 크기와 거의 같고 공백은 그 3분의 1쯤이다. 실측(143 크기에 여덟 글자
 * + 공백 둘 ≈ 1244px)이 이 모델과 맞았다. 폰트마다 조금씩 다르므로 6% 여백을 둔다.
 */
export function fitTitleSize(lines: string[], cap: number, maxWidth = W * 0.94): number {
  const units = Math.max(
    ...lines.map((l) => {
      const spaces = (l.match(/ /g) ?? []).length;
      return (l.length - spaces) + spaces * 0.35;
    }),
    1,
  );
  return Math.max(24, Math.min(cap, Math.floor(maxWidth / units)));
}

/**
 * 상·하단 띠 레이아웃 (2026-08-23).
 *
 * 벤치마킹 채널(짧은주녑·썰쇼템)의 구성을 옮긴 것이다 — 검정 띠에 굵은 고딕 제목,
 * 그 아래 영상, 맨 아래 얇은 띠에 채널명.
 *
 * **띠는 소스를 덮는다.** 소스는 `fullscreen`과 똑같이 화면을 꽉 채우고, 그 위에 불투명
 * 사각형을 얹는다. 그래서 띠에 가려지는 자리의 원본 자막·워터마크는 지울 필요가 없다.
 */
function bandedFilter(
  settings: Settings,
  fontArg: string | null,
  headline: string,
  pre: string,
  base: string,
): string {
  // 소스는 화면을 꽉 채운다 — 띠가 덮을 뿐 소스를 줄이지 않는다
  const fill = `${pre}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  return `${fill}${overlayBands(settings, fontArg, headline)},${base}`;
}

/**
 * 상·하단 띠와 글자를 **이미 화면 크기인 영상 위에** 얹는 필터 조각 (앞에 `,`가 붙어 나온다).
 *
 * 영상 씬과 이미지 씬이 **같은 함수**를 부른다. 두 벌로 두면 한쪽만 고쳐져서
 * 이미지로 메운 씬만 제목 띠가 없거나 크기가 다른 편이 나온다.
 */
export function overlayBands(settings: Settings, fontArg: string | null, headline: string): string {
  if (settings.layout !== 'banded') return '';
  const topH = Math.round(H * settings.topBandRatio);
  const botH = Math.round(H * settings.bottomBandRatio);
  const color = settings.bandColor;

  let graph = '';
  if (topH > 0) graph += `,drawbox=x=0:y=0:w=${W}:h=${topH}:color=${color}@1:t=fill`;
  if (botH > 0) graph += `,drawbox=x=0:y=${H - botH}:w=${W}:h=${botH}:color=${color}@1:t=fill`;

  // 글자는 폰트가 있을 때만. 한글이 깨진 제목보다 띠만 있는 편이 낫다
  if (!fontArg) return graph;

  const [line1, line2] = splitHeadline(headline);
  const size = fitTitleSize([line1, line2], Math.round(topH * 0.34));
  /*
    세로 위치는 **띠 비율이 아니라 실제 글자 크기**에서 계산한다. 비율로 박아두면
    글자가 폭에 맞춰 작아졌을 때 두 줄 사이가 벌어져 띠 위아래로 치우친다.
  */
  const lineH = Math.round(size * 1.12);
  const rows = (line1 ? 1 : 0) + (line2 ? 1 : 0);
  const blockTop = Math.round((topH - rows * lineH) / 2);
  if (topH > 0 && line1) {
    graph += `,drawtext=fontfile='${fontArg}':text='${escapeDrawText(line1)}':`
      + `fontcolor=${settings.titleAccentColor}:fontsize=${size}:`
      + `x=(w-text_w)/2:y=${blockTop}`;
  }
  if (topH > 0 && line2) {
    graph += `,drawtext=fontfile='${fontArg}':text='${escapeDrawText(line2)}':`
      + `fontcolor=white:fontsize=${size}:`
      + `x=(w-text_w)/2:y=${blockTop + (line1 ? lineH : 0)}`;
  }
  /*
    채널명은 하단 띠의 **위쪽**에 붙인다. 가운데에 놓으면 띠가 커질수록 화면 맨 아래로
    내려가는데, 쇼츠는 그 자리를 UI(계정·설명·버튼)가 덮어 글자가 안 보인다.
  */
  if (botH > 0 && settings.frameTitle.trim()) {
    const chSize = Math.round(Math.min(botH * 0.42, 54));
    graph += `,drawtext=fontfile='${fontArg}':text='${escapeDrawText(settings.frameTitle.trim())}':`
      + `fontcolor=white@0.85:fontsize=${chSize}:`
      + `x=(w-text_w)/2:y=${H - botH + Math.round(chSize * 0.5)}`;
  }
  return graph;
}

export function buildLayoutFilter(
  settings: Settings,
  fontArg: string | null,
  /** 상단 띠에 넣을 제목 — `banded`에서만 쓴다. 비면 띠만 그린다 */
  headline = '',
): string {
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

  if (settings.layout === 'banded') {
    return bandedFilter(settings, fontArg, headline, pre, base);
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
        const cleanIn = skipIntroCard(scene.clipRef.suggestedSegment?.in ?? 0, clip.sceneTimes);
        return { type: 'video', path: clean.filePath, in: cleanIn };
      }
    }
    // 사용자가 선택한 세그먼트가 있으면 그 in 지점 사용
    const seg = clip.segments.find((s) => s.used);
    const inPoint = skipIntroCard(
      seg?.in ?? scene.clipRef.suggestedSegment?.in ?? 0,
      clip.sceneTimes,
    );
    const src = path.join(input.jobDir, 'sources', `${clip.sourceId}.mp4`);
    return { type: 'video', path: src, in: inPoint };
  }
  throw new Error(`씬 ${scene.sceneId}: clipRef도 imageRef도 없음`);
}

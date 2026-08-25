import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Script, Clip } from '@shared/types';
import { COUPANG_PARTNERS_DISCLOSURE, CUT_SUM_TOLERANCE_SEC, type Menu } from '@shared/constants';
import { run } from '../util/exec.js';
import { ensureDir, exists } from '../util/fsx.js';
import type { SceneTiming } from './tts.js';
import {
  assStyleOf, buildAss, buildSrt, splitLines, wrapKorean, NOTICE_SIZE, type SubCue,
} from './subtitles.js';
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

/** 공시 번인 노출 시간 (초) */
const DISCLOSURE_SEC = 2;

/**
 * 쿠팡파트너스 공시를 영상 끝 2초에 얹는다.
 *
 * 🔴 **시간으로 비켜갈 수 없다 — 자리로 비켜간다.** 원래 문제는 공시가 마지막 자막 위에
 * 포개져 찍힌 것이었다(공시 다섯 줄 아래에 「보여주면 됨」). 그래서 「마지막 자막이 끝난
 * 뒤로 민다」로 고쳤는데, **씬이 영상 끝까지 꽉 차는 것이 정상**이라 마지막 자막은 언제나
 * 영상 끝에서 끝난다 — 그 규칙은 공시를 **한 번도 안 넣었다.** 켜 둔 설정이 아무 일도
 * 안 하고 아무 말도 안 하는 것이 겹치는 것보다 나쁘다 (하네스가 이걸 잡았다).
 *
 * 자막을 잘라 자리를 만드는 것도 안 된다. 한 줄이 1초 남짓이라 2초를 만들려면 자막을
 * 통째로 지워야 한다.
 *
 * 그래서 **`notice` 스타일로 화면 위쪽에 따로 앉힌다.** 시간이 겹쳐도 자리가 다르니
 * 안 포개지고, 나레이션 자막은 손대지 않는다.
 */
export function placeDisclosure(cues: SubCue[], totalDur: number, text: string): SubCue[] {
  const start = Math.max(0, totalDur - DISCLOSURE_SEC);
  if (totalDur - start < 0.5) return cues;
  return [...cues, { start, end: totalDur, text, style: 'notice' as const }];
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
 * 씬 하나를 **몇 컷으로 쪼갰고, 그 컷들이 소재를 몇 개 썼는가** (2026-08-24).
 *
 * 컷 조각(`tmp/seg_XX_K.mp4`)은 렌더가 끝나면 지워진다 — 나간 편이 몇 컷이었는지
 * 되짚을 길이 없었다. 성과 대장에서 성적이 갈릴 때 대조할 값이 없다는 뜻이다.
 *
 * 🔴 **컷 수보다 `sources`가 중요하다.** 소재가 하나면 컷은 늘어도 같은 영상의 뒤 구간을
 * 이어 튼 것이라 **화면이 안 바뀐다** — 소재를 더 넣으라는 신호다. 쪼개기를 넣은 이유가
 * 「컷 간격 중앙값 1.6~2.0초」였으니, 그게 지켜졌는지도 컷 수와 씬 길이로 여기서 나온다.
 */
export interface SceneCutPlan {
  sceneId: string;
  /** 이 씬을 이룬 컷 수 (이미지 씬은 1) */
  cuts: number;
  /** 그 컷들이 실제로 꺼내 쓴 서로 다른 소재 수 */
  sources: number;
  /**
   * 컷 길이의 합 — **나레이션 길이와 같아야 한다.**
   *
   * 🔴 **결과물로는 이게 어긋난 걸 못 본다.** 최종 먹싱이 `-shortest`라, 컷 합이 길어지면
   * 영상 뒤가 조용히 잘려 출력 길이가 **정확히** 나레이션 길이가 된다 — 화면은 누적으로
   * 밀리고 마지막 씬 뒤는 사라지는데 총 길이만 보면 완벽해 보인다 (2026-08-24 실측:
   * 컷을 15% 늘려도 출력은 0.02초 차였다). 짧아지는 쪽만 결과에 드러난다.
   *
   * 그래서 **계획을 적어 둔다.** 어긋나면 오디오·자막이 통째로 밀린 편이라는 뜻이다.
   */
  sec: number;
}

/**
 * 컷 계획이 나레이션 길이를 벗어났으면 안내 문구, 맞으면 `null`.
 *
 * 🔴 **렌더 전에 막는 값이 여기 있다** (2026-08-24). 씬 안에서 어긋나면 그 뒤 씬이
 * 통째로 밀려 음성·자막과 화면이 따로 논다. 그런데 **결과물로는 안 보인다** —
 * 최종 먹싱이 `-shortest`라 컷 합이 길어진 쪽은 영상 뒤가 조용히 잘려 출력 길이가
 * 정확히 나레이션 길이가 된다. 총 길이만 보면 완벽해 보이는 편이 그대로 발행된다.
 *
 * 훅 게이트와 같은 논리다 — 몇 분 인코딩한 뒤 밀린 결과를 받는 것보다 여기서 끝내는 게 싸다.
 *
 * **정상 경로에서는 절대 안 걸린다.** `planCuts`가 `total / n`으로 정확히 나누고
 * 이미지 씬은 `dur`을 그대로 쓴다 — 걸린다면 그건 앱 결함이지 사용자 데이터 문제가 아니다.
 * 그래서 안내도 「고쳐서 다시 하세요」가 아니라 「다시 눌러도 같다」로 적는다.
 *
 * 그리고 같은 이유로 **첫 씬에서 바로 끝낸다.** 어긋난 씬을 모아 한 번에 보여주는 편이
 * 나은 것은 씬마다 원인이 다를 때인데(대본 규칙 검사가 그렇다), 이건 컷 나누기 하나가
 * 틀린 것이라 모든 씬이 같은 말을 한다. 그걸 보자고 씬 전체를 렌더할 이유가 없다.
 */
export function cutPlanError(plan: SceneCutPlan, narrationSec: number): string | null {
  const gap = plan.sec - narrationSec;
  if (Math.abs(gap) < CUT_SUM_TOLERANCE_SEC) return null;
  /*
    어긋난 방향마다 결과물에 나타나는 모양이 다르다. 부호와 무관한 일반 설명을 늘 붙이면
    원인을 찾는 사람의 시선을 엉뚱한 데로 끈다 — 짧아진 쪽에 「먹싱이 뒤를 잘라낸다」가
    붙어 있었다 (2026-08-24 검증 지적).
  */
  const symptom = gap > 0
    ? '컷이 길어진 쪽은 최종 먹싱이 영상 뒤를 잘라내 총 길이만 멀쩡해 보입니다.'
    : '컷이 짧아진 쪽은 화면이 먼저 동나 나레이션 뒤가 통째로 잘려 나갑니다.';
  return (
    `씬 ${plan.sceneId}의 컷 ${plan.cuts}개를 합치면 ${plan.sec.toFixed(2)}초인데 `
    + `나레이션은 ${narrationSec.toFixed(2)}초입니다 (${gap > 0 ? '+' : ''}${gap.toFixed(2)}초). `
    + `이대로 렌더하면 이 씬부터 화면이 밀려 음성·자막과 어긋나므로 조립을 멈췄습니다 — ${symptom} `
    + '컷 나누기가 어긋난 것이라 다시 눌러도 같습니다. 앱 결함이니 이 문구를 그대로 알려 주세요.'
  );
}

/**
 * 씬별 비주얼 소스 결정:
 * - menu-a: clipRef → 정리본(clean) 우선, 없으면 원본 다운로드 파일
 * - menu-b: imageRef (씬 이미지) → Ken Burns 줌
 * 나레이션 길이에 맞춰 각 씬을 재단하고 concat → 자막 번인 → 최종 mp4.
 */
export async function assembleFinal(
  settings: Settings,
  input: AssembleInput,
): Promise<{ path: string; cuts: SceneCutPlan[] }> {
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
  /** 씬별 컷 계획 — 감사 로그에 남긴다 (렌더가 끝나면 컷 조각은 지워진다) */
  const cutPlan: SceneCutPlan[] = [];

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

    const visual = await resolveVisual(scene, input, i, dur, settings);
    const plan: SceneCutPlan = {
      sceneId: scene.sceneId,
      cuts: visual.type === 'video' ? visual.cuts.length : 1,
      // 같은 파일을 여러 컷이 나눠 쓸 수 있다 — 「화면이 바뀌었나」는 파일 수로만 답이 된다
      sources: visual.type === 'video' ? new Set(visual.cuts.map((c) => c.path)).size : 1,
      // 이미지 씬은 `dur`을 통째로 한 장으로 채운다
      sec: visual.type === 'video' ? visual.cuts.reduce((a, c) => a + c.dur, 0) : dur,
    };
    cutPlan.push(plan);
    /*
      컷 합 = 나레이션 — 어긋나면 **한 프레임도 인코딩하기 전에** 끝낸다.
      훅 게이트보다 앞에 둔다: 계산만 하는 검사라 공짜고, 틀어진 계획으로 훅을 재 봐야
      의미가 없다. 씬을 모아 한 번에 보여주지 않는 이유는 `cutPlanError` 주석에 있다.
    */
    const planError = cutPlanError(plan, dur);
    if (planError) throw new Error(planError);
    /*
      훅 게이트 — 첫 씬이 거의 멈춰 있으면 렌더 전에 막는다.
      몇 분을 인코딩한 뒤 「계속 시청함」이 20% 아래로 나오는 것보다 여기서 끝내는 게 싸다.
      못 쟀을 때(null)는 통과시킨다 — 검출 실패로 조립이 멈추면 안 된다.
    */
    if (i === 0 && visual.type === 'video' && settings.hookMotionMin > 0) {
      // 훅은 **첫 컷**이다 — 쪼갠 뒤에도 화면에 처음 나오는 그 조각을 잰다
      const head = visual.cuts[0];
      const delta = await hookMotionDelta(settings, head.path, tmpDir, head.in);
      if (delta !== null && delta < settings.hookMotionMin) {
        throw new Error(hookGateMessage(delta, settings.hookMotionMin));
      }
    }
    if (visual.type === 'video') {
      const layout = buildLayoutFilter(settings, fontRef?.arg ?? null, input.headline ?? script.title);
      const cutFiles: string[] = [];
      let from = 0;
      for (const [k, cut] of visual.cuts.entries()) {
        /*
          짤은 씬 기준 시각에 얹히므로, 그 시각을 품은 컷에만 걸린다.
          컷 경계를 물면 양쪽 컷에 나뉘어 걸려 화면에서는 이어져 보인다.
        */
        const meme = memeOverlayFor(scene, dur, settings, input.assetPaths, { from, dur: cut.dur });
        const cutOut = visual.cuts.length === 1
          ? segOut
          : path.join(tmpDir, `seg_${String(i + 1).padStart(2, '0')}_${k + 1}.mp4`);
        await run(settings.ffmpegPath, meme
          ? [
            '-y',
            '-ss', String(cut.in), '-i', cut.path,
            // gif·webp는 한 장이 아니라 여러 장이다 — 안 풀면 첫 프레임에서 멈춘다
            ...(meme.animated ? ['-ignore_loop', '0'] : []),
            '-i', meme.path,
            '-t', cut.dur.toFixed(3),
            '-filter_complex', `[0:v]${layout}[base];${meme.filter}`,
            '-map', '[v]',
            '-an',
            '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
            cutOut,
          ]
          : [
            '-y',
            '-ss', String(cut.in), '-i', cut.path,
            '-t', cut.dur.toFixed(3),
            '-vf', layout,
            '-an',
            '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast',
            cutOut,
          ], { cwd: fontRef?.cwd });
        cutFiles.push(cutOut);
        from += cut.dur;
      }
      if (cutFiles.length > 1) {
        // 컷을 씬 하나로 이어 붙인다 — 아래 타임라인·오디오·자막은 씬 단위 그대로다
        const cutList = path.join(tmpDir, `cuts_${String(i + 1).padStart(2, '0')}.txt`);
        await fsp.writeFile(
          cutList, cutFiles.map((f) => `file '${toConcatPath(f)}'`).join('\n'), 'utf8',
        );
        await run(settings.ffmpegPath, [
          '-y', '-f', 'concat', '-safe', '0', '-i', cutList, '-c', 'copy', segOut,
        ]);
      }
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
  const cuesWithDisclosure = input.burnDisclosure
    ? placeDisclosure(cues, totalDur, wrapKorean(COUPANG_PARTNERS_DISCLOSURE, subtitleCharsPerLine(NOTICE_SIZE)))
    : cues;
  const subsDir = path.join(jobDir, 'subtitles');
  await ensureDir(subsDir);
  const srtPath = path.join(subsDir, 'final.srt');
  const assPath = path.join(subsDir, 'final.ass');
  await fsp.writeFile(srtPath, buildSrt(cuesWithDisclosure), 'utf8');
  // 자막 폰트도 실제로 설치된 것을 지정해야 한글이 깨지지 않는다
  // 화면에서 받아 둔 글꼴은 표에 없다 — 받을 때 적어 둔 이름을 먼저 본다
  const family = (font && await familyOfInstalled(font)) ?? fontFamilyOf(font);
  await fsp.writeFile(assPath, buildAss(cuesWithDisclosure, assStyleOf(settings, family)), 'utf8');

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
  return { path: finalPath, cuts: cutPlan };
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
  /** 씬을 컷으로 쪼갰을 때 이 컷이 덮는 구간 (씬 시작 기준). 없으면 씬 전체 */
  cut?: { from: number; dur: number },
): { path: string; filter: string; animated: boolean } | null {
  const file = scene.memeId ? paths?.[scene.memeId] : undefined;
  if (!file) return null;

  const start = Math.max(0, Math.min(scene.memeAt ?? 0, Math.max(0, sceneDur - 0.4)));
  const end = Math.min(sceneDur, start + settings.memeDurationSec);
  /*
    스치듯 지나가는 짤은 못 알아본다 — 그 판정은 **씬 전체 기준**으로 한 번만 한다.
    컷마다 다시 재면 경계를 문 짤이 양쪽에서 다 짧다고 떨어져 통째로 사라진다.
  */
  if (end - start < Math.min(0.4, settings.memeDurationSec)) return null;

  // 이 컷이 덮는 구간으로 옮겨 자른다. 안 걸리는 컷에는 아예 안 넣는다
  const from = cut?.from ?? 0;
  const span = cut?.dur ?? sceneDur;
  const a = Math.max(0, start - from);
  const b = Math.min(span, end - from);
  if (b <= a) return null;

  const w = Math.round(W * settings.memeWidthRatio);
  // 영상 구간(띠 사이)의 위쪽 — 아래는 자막 자리다
  const videoTop = Math.round(H * settings.topBandRatio);
  const y = videoTop + Math.round(H * 0.04);
  const x = Math.round(W - w - W * 0.05); // 오른쪽에 붙인다
  const filter = `[1:v]scale=${w}:-1[mm];`
    + `[base][mm]overlay=${x}:${y}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[v]`;
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

/** 컷 하나가 뽑아 쓸 수 있는 소재 구간 */
export interface CutSource {
  path: string;
  /** 이 소재에서 쓰기 시작할 시각 */
  in: number;
  /** `in`부터 쓸 수 있는 길이 (사용자가 고른 구간이 있으면 그 안쪽까지) */
  avail: number;
}

/** 실제로 렌더할 컷 하나 */
export interface Cut {
  path: string;
  in: number;
  dur: number;
}

/**
 * 씬 하나를 **여러 컷으로 쪼갠다** (2026-08-23).
 *
 * 벤치마킹 쇼츠 3편 실측: 컷 간격 중앙값이 **1.6·1.7·2.0초**다. 우리는 12.1초였다 —
 * 씬 하나를 클립 하나로 통째로 틀었다.
 *
 * 🔴 **앱이 이미 알고 경고하던 것을 조립이 무시하고 있었다.** `maxClipExposureSec`은
 * 「한 소스가 오래 연속 노출되면 재사용 콘텐츠로 분류될 위험」을 경고하는데, 정작
 * 조립은 그 상한을 안 봤다. 그래서 상한을 두 곳이 같이 쓴다 — 규칙을 두 벌 두면
 * 반드시 어긋난다.
 *
 * **총 길이는 안 바뀐다.** 컷을 균등하게 나눠 나레이션 길이를 정확히 채운다 —
 * 길이가 달라지면 오디오·자막이 통째로 밀린다.
 *
 * 소재가 모자라면 같은 소재에서 **뒤 구간을 이어 꺼낸다.** 그건 결국 이어 트는 것과
 * 같아 화면이 안 바뀌지만, 지금 동작보다 나빠지지는 않는다.
 */
export function planCuts(sources: CutSource[], total: number, maxCutSec: number): Cut[] {
  const first = sources[0];
  if (!first) return [];
  const single = [{ path: first.path, in: first.in, dur: total }];
  if (maxCutSec <= 0 || total <= maxCutSec) return single;

  const n = Math.ceil(total / maxCutSec);
  const cutDur = total / n;
  // 컷 길이를 못 채우는 소재는 뺀다 — 짧게 끝나면 그만큼 오디오와 어긋난다
  const usable = sources.filter((s) => s.avail >= cutDur);
  if (usable.length === 0) return single;

  const taken = new Map<string, number>();
  const cuts: Cut[] = [];
  for (let k = 0; k < n; k++) {
    const s = usable[k % usable.length];
    const nth = taken.get(s.path) ?? 0;
    taken.set(s.path, nth + 1);
    const offset = nth * cutDur;
    // 소재 끝을 넘으면 처음으로 되감는다
    const inPoint = offset + cutDur <= s.avail ? s.in + offset : s.in;
    cuts.push({ path: s.path, in: inPoint, dur: cutDur });
  }
  return cuts;
}

/**
 * 존 상자가 띠 경계를 스치는 정도는 봐준다 (프레임 높이 비율).
 * 검출 상자는 글자보다 조금 넓게 잡히고, 실측에서 하단 자막 존이 띠 경계를 1px 물었다.
 */
const ZONE_TOLERANCE = 0.02;

/**
 * 띠가 안 가리는 자리에 글자가 남아 있는 클립인가.
 *
 * 🔴 **덤으로 끼워 넣는 소재에만 묻는다.** 컷을 쪼개면서 다른 클립을 끌어다 채웠더니,
 * 그 클립들의 중국어 자막이 **하단 띠 바로 위**에 있어 화면에 그대로 나왔다 —
 * 좌우반전까지 걸려 거울 글자로 찍혔다 (2026-08-23 실측). 대본이 고른 클립은 사람이
 * 판단한 것이라 여기서 안 막는다. 우리가 멋대로 더한 것만 우리가 책임진다.
 *
 * 정리본이 있으면 이미 지운 뒤다. 크기를 모르면 못 재므로 안 쓴다 — 없어도 그만인 소재다.
 */
export function hasVisibleText(clip: Clip, settings: Settings): boolean {
  if (clip.currentCleanVersion) return false;
  const h = clip.probe?.height ?? 0;
  if (!h) return true;
  // 띠가 없는 레이아웃에서는 화면 전체가 보인다
  const banded = settings.layout === 'banded';
  const top = banded ? settings.topBandRatio : 0;
  const bottom = banded ? 1 - settings.bottomBandRatio : 1;
  return clip.zones.some((z) => {
    const a = z.y / h;
    const b = (z.y + z.h) / h;
    return Math.min(b, bottom) - Math.max(a, top) > ZONE_TOLERANCE;
  });
}

/** 클립 하나를 컷 소재로 푼다. 정리본이 있으면 그쪽을 쓴다 */
async function clipToSource(
  clip: Clip,
  jobDir: string,
  preferIn?: number,
): Promise<CutSource> {
  let file = path.join(jobDir, 'sources', `${clip.sourceId}.mp4`);
  if (clip.currentCleanVersion) {
    const clean = clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion);
    if (clean && (await exists(clean.filePath))) file = clean.filePath;
  }
  /*
    「쓸 장면 고르기」로 정한 구간이 대본의 제안보다 우선한다 — 사람이 프레임을 보고
    고른 것이라서다. 정리본 경로도 같은 규칙을 쓴다 (예전엔 여기만 제안을 봤다).
  */
  const seg = clip.segments.find((s) => s.used);
  const inPoint = skipIntroCard(seg?.in ?? preferIn ?? 0, clip.sceneTimes);
  const total = clip.probe?.duration ?? 0;
  const end = seg && seg.out > inPoint ? seg.out : total;
  return { path: file, in: inPoint, avail: Math.max(0, end - inPoint) };
}

/**
 * 씬을 채울 소재 목록 — **대본이 고른 클립이 언제나 앞**이다.
 *
 * 뒤에 붙는 것은 그 잡의 다른 클립이고, **프레임이 남아 있는 것만** 쓴다.
 * 프레임을 지우는 것이 「이 소재는 안 쓴다」는 뜻이라서다.
 * 씬마다 시작 자리를 돌려 같은 클립이 매 씬 두 번째로 나오지 않게 한다.
 */
async function sceneCutSources(
  scene: Script['scenes'][number],
  input: AssembleInput,
  sceneIdx: number,
  settings: Settings,
): Promise<CutSource[]> {
  const own = input.clips.find((c) => c.id === scene.clipRef!.clipId);
  if (!own) throw new Error(`씬 ${scene.sceneId}: 클립 ${scene.clipRef!.clipId} 없음`);
  const sources = [await clipToSource(own, input.jobDir, scene.clipRef!.suggestedSegment?.in)];

  const others = input.clips.filter(
    (c) => c.id !== own.id && c.frames.length > 0 && !hasVisibleText(c, settings),
  );
  for (let k = 0; k < others.length; k++) {
    sources.push(await clipToSource(others[(sceneIdx + k) % others.length], input.jobDir));
  }
  return sources;
}

async function resolveVisual(
  scene: Script['scenes'][number],
  input: AssembleInput,
  sceneIdx: number,
  dur: number,
  settings: Settings,
): Promise<{ type: 'video'; cuts: Cut[] } | { type: 'image'; path: string }> {
  if (scene.imageRef) {
    return { type: 'image', path: input.resolveWorkspacePath(scene.imageRef) };
  }
  if (scene.clipRef) {
    const sources = await sceneCutSources(scene, input, sceneIdx, settings);
    /*
      컷 쪼개기는 제품정보리뷰에서만 한다. 해외영상 짜집기는 사용자가 화면에서
      쓸 구간을 직접 골라 두는 메뉴라, 자동으로 다시 쪼개면 그 선택을 덮어쓴다.
    */
    const maxCut = input.menu === 'menu-b' ? settings.maxClipExposureSec : 0;
    return { type: 'video', cuts: planCuts(sources, dur, maxCut) };
  }
  throw new Error(`씬 ${scene.sceneId}: clipRef도 imageRef도 없음`);
}

import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Clip, Zone } from '@shared/types';
import { run, PYTHON_CLI_ENV } from '../util/exec.js';
import { checkIopaint } from '../util/toolCheck.js';
import { loadSettings } from '../store/workspace.js';
import { ensureDir } from '../util/fsx.js';
// vsr.ts는 InpaintProvider를 `import type`으로만 가져간다 — 실행 시 순환이 생기지 않는다
import { vsrProvider } from './vsr.js';

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

/** 그 시각에 실제로 걸려 있는 존. t0·t1이 없는 존은 전체 구간이다 */
export function zonesAtTime(zones: Zone[], t: number): Zone[] {
  return zones.filter((z) => (z.t0 ?? 0) <= t && t <= (z.t1 ?? Infinity));
}

/**
 * 프레임을 "인페인팅할 것"과 "그대로 둘 것"으로 가른다.
 *
 * 존은 대개 몇 초짜리인데 예전에는 클립 전체를 돌렸다 — 75초 클립이면 2,256장,
 * CPU로 20시간이다(실측). 4초짜리 자막이면 120장, 6분이면 끝난다.
 *
 * 같은 존 조합이 걸린 프레임끼리 묶는다 — 마스크는 조합마다 한 장만 만들면 된다.
 * @param files 프레임 파일명 (추출 순서대로 정렬돼 있어야 한다)
 */
export function planFrames(
  files: string[],
  fps: number,
  zones: Zone[],
): { skip: string[]; groups: Array<{ zones: Zone[]; files: string[] }> } {
  const skip: string[] = [];
  const groups = new Map<string, { zones: Zone[]; files: string[] }>();
  files.forEach((file, i) => {
    const active = zonesAtTime(zones, i / fps);
    if (!active.length) {
      skip.push(file);
      return;
    }
    const key = active.map((z) => z.id).join('|');
    const g = groups.get(key) ?? { zones: active, files: [] };
    g.files.push(file);
    groups.set(key, g);
  });
  return { skip, groups: [...groups.values()] };
}

/**
 * 한 번에 지울 수 있는 넓이 상한 (프레임 넓이 대비).
 *
 * 인페인팅은 **주변 배경을 보고 채우는** 것이라 지울 자리가 넓으면 참조할 배경이
 * 모자라 뭉갠다. 큰 자막 블록을 통째로 넣었다가 그 자리가 회색으로 문드러져 반려된
 * 적이 있다. 넓으면 지우려 들지 말고 그 구간을 컷에서 빼는 것이 답이다.
 */
const MAX_MASK_RATIO = 0.35;

/** 한 시점에 겹쳐 걸린 존이 가장 넓을 때의 넓이 비율. 겹침은 무시한다(넉넉히 잡는 쪽) */
export function maxMaskRatio(zones: Zone[], width: number, height: number): number {
  const frame = width * height;
  if (!frame) return 0;
  const edges = [...new Set(zones.flatMap((z) => [z.t0 ?? 0, z.t1 ?? 0]))];
  return Math.max(0, ...edges.map((t) =>
    zonesAtTime(zones, t).reduce((sum, z) => sum + z.w * z.h, 0) / frame));
}

/**
 * IOPaint(lama) 프로바이더.
 * 흐름: 영상 → 프레임 추출 → 존이 걸린 프레임만 골라 마스크 생성 →
 *       iopaint 배치 실행 → 나머지 프레임과 합쳐 재인코딩(+원본 오디오)
 */
export const iopaintProvider: InpaintProvider = {
  name: 'iopaint',

  /**
   * 설정에 적어둔 경로로 확인한다.
   *
   * 예전엔 맨 `iopaint`를 찾았는데, 가상환경에 설치하면(권장 방식이다) PATH에 없어서
   * 경로를 제대로 넣어둬도 항상 "없음"이 되고 2차 제거가 막혔다.
   */
  async available(): Promise<boolean> {
    const { iopaintPath } = await loadSettings();
    return (await checkIopaint(iopaintPath)).available;
  },

  async run({ settings, clip, inputVideo, zones, workDir, outPath, onProgress }): Promise<string> {
    if (!clip.probe) throw new Error('probe 정보 없음');
    const { width, height, fps } = clip.probe;

    // 프레임을 수천 장 뽑기 전에 막는다 — 몇 시간을 쓰고 뭉개진 결과를 받는 것이 최악이다
    const ratio = maxMaskRatio(zones, width, height);
    if (ratio > MAX_MASK_RATIO) {
      throw new Error(
        `지울 영역이 화면의 ${Math.round(ratio * 100)}%입니다 (상한 ${Math.round(MAX_MASK_RATIO * 100)}%). `
        + '이만큼 넓으면 채울 배경이 모자라 그 자리가 뭉개집니다 — '
        + '존을 글자에 맞게 좁히거나, 그 구간을 쓸 장면에서 빼세요.',
      );
    }

    const framesDir = path.join(workDir, 'frames');
    const masksDir = path.join(workDir, 'masks');
    const outFramesDir = path.join(workDir, 'out');
    /*
      먼저 비운다. 중간에 죽은 실행이 남긴 것을 물려받으면 조용히 틀린 영상이 나온다 —
      실제로 겪었다: 죽은 실행의 마스크 2,256장이 남아 있어, 손대지 않기로 한 프레임까지
      마스크 짝이 생겨 통째로 인페인팅될 뻔했다. 지난 결과 프레임도 재인코딩에 섞인다.
    */
    await fsp.rm(workDir, { recursive: true, force: true });
    await ensureDir(framesDir);
    await ensureDir(masksDir);
    await ensureDir(outFramesDir);

    onProgress?.('프레임 추출 중…');
    await run(settings.ffmpegPath, [
      '-y', '-i', inputVideo,
      '-qscale:v', '2',
      path.join(framesDir, 'f_%06d.png'),
    ]);

    const frameFiles = (await fsp.readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
    const { skip, groups } = planFrames(frameFiles, fps, zones);
    const targets = groups.reduce((n, g) => n + g.files.length, 0);
    // 손대기 전에 막는다 — 프레임을 다 옮겨놓고 실패하면 치울 것만 남는다
    if (targets === 0) {
      throw new Error('인페인팅할 프레임이 없습니다 — 존의 구간이 영상 길이를 벗어났는지 확인하세요');
    }

    // 존이 안 걸린 프레임은 손대지 않는다 — 결과 폴더로 옮겨두면 그대로 재인코딩된다.
    // 복사가 아니라 이동이다 (같은 볼륨이라 공짜다. 1,000장이면 복사는 0.5GB를 더 쓴다)
    for (const f of skip) {
      await fsp.rename(path.join(framesDir, f), path.join(outFramesDir, f));
    }

    // 마스크는 존 조합마다 한 장만 만들어 그 조합이 걸린 프레임에 복제한다
    // (iopaint 배치 모드는 이미지:마스크가 1:1이라 파일명이 짝이어야 한다).
    // 원본 마스크는 masks/ 밖에 둔다 — 안에 두면 짝 없는 파일이 하나 섞인다
    onProgress?.('마스크 생성 중…');
    for (const [gi, g] of groups.entries()) {
      const drawboxes = g.zones
        .map((z) => `drawbox=x=${Math.round(z.x)}:y=${Math.round(z.y)}:w=${Math.round(z.w)}:h=${Math.round(z.h)}:color=white@1:t=fill`)
        .join(',');
      const maskPath = path.join(workDir, `mask_${gi}.png`);
      await run(settings.ffmpegPath, [
        '-y', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}`,
        '-vf', drawboxes, '-frames:v', '1', maskPath,
      ]);
      for (const f of g.files) {
        await fsp.copyFile(maskPath, path.join(masksDir, f));
      }
    }

    onProgress?.(`IOPaint 실행 중… (${targets}/${frameFiles.length} 프레임 · 나머지는 원본 유지)`);
    // iopaint가 실패하면 종료 코드만으로는 아무것도 알 수 없다. 표준 오류를 모아
    // 실패 메시지에 붙인다 — 모델 내려받기 실패인지, 인자가 안 맞는지가 여기 있다
    const stderr: string[] = [];
    try {
      await run(settings.iopaintPath, [
        'run',
        '--model=lama',
        '--device=cpu',
        `--image=${framesDir}`,
        `--mask=${masksDir}`,
        `--output=${outFramesDir}`,
      ], {
        // CPU에서 576×1024 한 장에 약 2.8초다 (2026-08-16 실측). 2시간이면 약 2,500프레임 —
        // 30fps 기준 80초 클립까지 들어온다. 1시간이면 40초에서 잘렸다
        timeoutMs: 7_200_000,
        // iopaint는 파이썬 CLI라 한국어 윈도우(cp949)에서 진행률 스피너를 찍다 죽는다
        env: PYTHON_CLI_ENV,
        onStdout: onProgress,
        onStderr: (line) => {
          stderr.push(line);
          if (stderr.length > 40) stderr.shift(); // 마지막 몇 줄이면 충분하다
          // 화면에는 요약만 가므로 전체는 서버 로그에 남긴다 (npm run logs)
          console.error(`[iopaint] ${line}`);
        },
      });
    } catch (e) {
      throw new Error(iopaintFailureMessage(stderr, e));
    }

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

/**
 * 앞에 있는 것부터 쓴다.
 *
 * VSR이 먼저다 — 좌표를 후보 영역으로만 쓰고 그 안에서 제 OCR이 글자를 찾은 자리만
 * 지운다. iopaint에는 존 사각형을 통째로 칠해 넘기므로, 상자가 글자보다 넓으면
 * 그만큼 배경까지 지운다. 둘 다 없으면 1차(ffmpeg) 제거만으로 강등된다.
 */
export const inpaintProviders: InpaintProvider[] = [vsrProvider, iopaintProvider];

/**
 * iopaint 실패 메시지. 종료 코드만으로는 아무것도 알 수 없어 표준 오류의 마지막 줄을 붙이고,
 * 알아볼 수 있는 원인은 짚어준다.
 *
 * 예전에는 무조건 "모델을 내려받는 중일 수 있습니다"라고 안내했는데, 실제로는 모델을 다 읽고
 * 진행률 스피너를 찍다 죽은 경우에도 같은 문구가 떠서 엉뚱한 곳을 뒤지게 만들었다.
 */
export function iopaintFailureMessage(stderr: string[], cause?: unknown): string {
  const tail = stderr.slice(-8).join('\n');
  const all = stderr.join('\n');
  const head = `IOPaint 실행 실패${
    tail
      ? `:\n${tail}`
      : ` (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)})`
  }`;

  // cp949 콘솔에 유니코드 스피너를 찍다 터진 경우 — 도구도 모델도 멀쩡하다
  if (/UnicodeEncodeError|codec can't encode character/i.test(all)) {
    return `${head}\n`
      + '윈도우 콘솔 인코딩(cp949) 때문에 진행률 표시를 찍다 멈춘 것으로 보입니다. '
      + '도구나 모델 문제가 아닙니다 — 서버를 다시 시작하면 UTF-8로 실행합니다. '
      + '그래도 같은 오류가 나면 workspace/logs/server.log (npm run logs)를 확인하세요.';
  }

  if (/big-lama|download|urlopen|ConnectionError|SSLError|timed? ?out/i.test(all)) {
    return `${head}\n`
      + '모델(LaMa)을 내려받다 막힌 것으로 보입니다 — 사내망이면 여기서 걸립니다. '
      + '전체 로그는 workspace/logs/server.log (npm run logs)에 있습니다.';
  }

  return `${head}\n`
    + '처음 실행이면 모델(LaMa)을 내려받는 중일 수 있습니다. '
    + '전체 로그는 workspace/logs/server.log (npm run logs)에 있습니다.';
}

export async function getAvailableInpaintProvider(): Promise<InpaintProvider | null> {
  for (const p of inpaintProviders) {
    if (await p.available()) return p;
  }
  return null;
}

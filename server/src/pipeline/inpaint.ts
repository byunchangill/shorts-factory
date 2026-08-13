import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Clip, Zone } from '@shared/types';
import { run, PYTHON_CLI_ENV } from '../util/exec.js';
import { checkToolAny, IOPAINT_VERSION_ARGS } from '../util/toolCheck.js';
import { loadSettings } from '../store/workspace.js';
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

  /**
   * 설정에 적어둔 경로로 확인한다.
   *
   * 예전엔 맨 `iopaint`를 찾았는데, 가상환경에 설치하면(권장 방식이다) PATH에 없어서
   * 경로를 제대로 넣어둬도 항상 "없음"이 되고 2차 제거가 막혔다.
   */
  async available(): Promise<boolean> {
    const { iopaintPath } = await loadSettings();
    const r = await checkToolAny(iopaintPath, IOPAINT_VERSION_ARGS);
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
    // 원본 마스크는 masks/ 밖에 둔다 — 안에 두면 프레임과 짝이 없는 파일이 하나 섞여
    // iopaint가 이미지:마스크를 1:1로 맞출 때 걸린다
    const maskPath = path.join(workDir, 'mask.png');
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
        timeoutMs: 3_600_000,
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

export const inpaintProviders: InpaintProvider[] = [iopaintProvider];

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

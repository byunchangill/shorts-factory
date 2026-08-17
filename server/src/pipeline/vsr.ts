import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Zone } from '@shared/types';
import { run, PYTHON_CLI_ENV } from '../util/exec.js';
import { loadSettings } from '../store/workspace.js';
import { findVsrRepo } from '../util/toolPath.js';
import type { InpaintProvider } from './inpaint.js';

/**
 * VSR(video-subtitle-remover) 프로바이더 — 2차 제거의 1순위.
 *
 * iopaint와 갈리는 지점은 **마스크를 누가 만드느냐**다. iopaint에는 존 사각형을 통째로
 * 흰색으로 칠해 넘긴다. 글자보다 상자가 크면 그 여백까지 지우게 되고, 상자가 넓을수록
 * 채울 배경이 모자라 그 자리가 뭉갠다. VSR은 넘긴 좌표를 **후보 영역**으로만 쓰고
 * 그 안에서 제 OCR이 글자를 찾은 자리만 지운다 — 영역을 넉넉히 줘도 배경이 안 상한다.
 *
 * 그래서 영역을 좁히려 애쓸 필요가 없고, 글자가 없는 프레임은 VSR이 알아서 건너뛴다.
 */

/**
 * 기본 인페인팅 모드.
 *
 * 이 PC(Intel Iris Xe · NVIDIA 없음)에서 실측했다 — 576×1024 3초 기준
 * STTN 9분 18초에 얼룩 띠가 남았고, LaMa는 3분 53초에 자국이 거의 안 보였다.
 * GPU가 생기면 propainter를 다시 재보되, 기본값은 재본 뒤에 바꾼다.
 */
const DEFAULT_MODE = 'lama';

/**
 * 파이썬 경로를 안 적었으면 저장소 안의 가상환경을 본다 (설치 문서가 안내하는 자리다).
 * 가상환경의 실행 파일 자리는 OS마다 다르다 — 윈도우만 `Scripts\python.exe`다.
 */
export function defaultVsrPython(vsrPath: string): string {
  return process.platform === 'win32'
    ? path.join(vsrPath, '.venv', 'Scripts', 'python.exe')
    : path.join(vsrPath, '.venv', 'bin', 'python');
}

/**
 * 이 PC에서 쓸 VSR 저장소와 파이썬.
 * 설정이 비어 있어도 홈 아래 표준 자리를 찾아본다 — PC를 옮길 때마다 설정 화면을
 * 다시 채우게 만들 이유가 없다.
 */
export async function vsrPaths(): Promise<{ repo: string; python: string }> {
  const s = await loadSettings();
  const repo = await findVsrRepo(s.vsrPath ?? '');
  const python = (s.vsrPython ?? '').trim() || (repo ? defaultVsrPython(repo) : '');
  return { repo, python };
}

/**
 * 존 → VSR 좌표 인자.
 *
 * **VSR은 `-c YMIN YMAX XMIN XMAX` 순서다.** 우리 존은 x/y/w/h라 그대로 넘기면
 * 엉뚱한 자리를 지운다 — 세로가 먼저고, 폭이 아니라 끝 좌표다.
 * 화면 밖으로 나간 좌표는 잘라낸다.
 */
export function vsrAreaArgs(zones: Zone[], width: number, height: number): string[] {
  return zones.flatMap((z) => {
    const ymin = Math.max(0, Math.round(z.y));
    const xmin = Math.max(0, Math.round(z.x));
    const ymax = Math.min(height, Math.round(z.y + z.h));
    const xmax = Math.min(width, Math.round(z.x + z.w));
    if (ymax <= ymin || xmax <= xmin) return [];
    return ['-c', String(ymin), String(ymax), String(xmin), String(xmax)];
  });
}

/**
 * VSR 실패 메시지.
 *
 * 제일 흔한 실패는 고장이 아니라 **영역 안에서 글자를 못 찾은 것**이다. VSR은 그때
 * 예외로 끝나는데, 종료 코드만 보면 설치가 잘못된 것처럼 보인다. 우리 검출기와 VSR의
 * 검출기가 서로 다르므로 실제로 갈릴 수 있다 — 특히 반투명 자막을 VSR이 놓친다.
 */
export function vsrFailureMessage(stderr: string[], cause?: unknown): string {
  const all = stderr.join('\n');
  const tail = stderr.slice(-8).join('\n');
  const head = `VSR 실행 실패${
    tail ? `:\n${tail}` : ` (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)})`
  }`;

  if (/NoSubtitleDetected|not detect|no subtitle/i.test(all)) {
    return `${head}\n`
      + 'VSR이 지정한 영역 안에서 글자를 찾지 못했습니다 — 도구 문제가 아닙니다. '
      + '반투명하거나 흐린 자막은 VSR 검출기가 놓칩니다. '
      + '영역을 넓혀 다시 시도하거나, 가장자리 자막이면 크롭으로 잘라내세요.';
  }
  if (/CUDA|DirectML|out of memory|OutOfMemory/i.test(all)) {
    return `${head}\n`
      + '그래픽 가속에서 막힌 것으로 보입니다. 설정에서 모드를 lama로 두면 CPU로 돕니다. '
      + '전체 로그는 workspace/logs/server.log (npm run logs)에 있습니다.';
  }
  if (/big-lama|download|urlopen|ConnectionError|SSLError/i.test(all)) {
    return `${head}\n`
      + '모델을 내려받다 막힌 것으로 보입니다 — 사내망이면 여기서 걸립니다.';
  }
  return `${head}\n전체 로그는 workspace/logs/server.log (npm run logs)에 있습니다.`;
}

export const vsrProvider: InpaintProvider = {
  name: 'vsr',

  /**
   * 저장소와 파이썬이 자리에 있는지 파일로만 본다.
   * 실행해 물으면 torch를 통째로 올려 수십 초가 걸리고, 그 사이 시간 상한에 걸리면
   * 멀쩡히 깔린 도구가 "없음"이 되어 2차 제거가 막힌다 (iopaint에서 겪은 그 문제다).
   */
  async available(): Promise<boolean> {
    // 예전 설정 파일에는 이 항목이 아예 없다 — 없다고 도구 점검 전체가 죽으면 안 된다
    const { repo, python } = await vsrPaths();
    if (!repo) return false;
    const has = (p: string) => fsp.access(p).then(() => true, () => false);
    return (await has(path.join(repo, 'backend', 'main.py'))) && (await has(python));
  },

  async run({ settings, clip, inputVideo, zones, outPath, onProgress }): Promise<string> {
    if (!clip.probe) throw new Error('probe 정보 없음');
    const areas = vsrAreaArgs(zones, clip.probe.width, clip.probe.height);
    if (!areas.length) throw new Error('지울 영역이 없습니다');

    const { repo, python } = await vsrPaths();
    if (!repo) throw new Error('VSR 저장소를 찾지 못했습니다 — 설정에서 폴더를 지정하세요');
    await fsp.mkdir(path.dirname(outPath), { recursive: true });

    onProgress?.(`VSR 실행 중… (${zones.length}곳 · ${settings.vsrMode || DEFAULT_MODE})`);
    const stderr: string[] = [];
    try {
      await run(python, [
        path.join('backend', 'main.py'),
        '-i', inputVideo,
        '-o', outPath,
        ...areas,
        '--inpaint-mode', settings.vsrMode || DEFAULT_MODE,
      ], {
        // 저장소 루트에서 돌려야 한다 — `backend.*` 를 패키지로 임포트한다
        cwd: repo,
        // 클립 전체를 훑는다(글자 없는 프레임은 VSR이 건너뛴다). CPU로 3초에 4분이라
        // 30초 클립이면 넉넉히 잡아야 한다
        timeoutMs: 7_200_000,
        // 한국어 윈도우(cp949)에서 진행률을 찍다 죽는 것을 막는다
        env: PYTHON_CLI_ENV,
        onStdout: onProgress,
        /*
          🔴 소리 없는 입력이면 VSR이 오디오를 뽑다 실패하고 **트레이스백을 통째로 찍는다.**
          영상은 멀쩡히 나오고 종료 코드도 0이다 (실측 2026-08-17). 1차 제거본은 `-an`이라
          이 경로를 늘 탄다 — 로그에 보이는 `Audio extraction failed`는 고장이 아니다.
        */
        onStderr: (line) => {
          stderr.push(line);
          if (stderr.length > 40) stderr.shift();
          console.error(`[vsr] ${line}`);
        },
      });
    } catch (e) {
      throw new Error(vsrFailureMessage(stderr, e));
    }

    // VSR은 실패해도 종료 코드가 0인 경로가 있다 — 파일이 실제로 생겼는지 본다
    if (!(await fsp.access(outPath).then(() => true, () => false))) {
      throw new Error(vsrFailureMessage(stderr, new Error('출력 파일이 생기지 않았습니다')));
    }
    return outPath;
  },
};

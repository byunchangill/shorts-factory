import { execa, type Options, type ResultPromise } from 'execa';

export interface RunOptions {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  cwd?: string;
  timeoutMs?: number;
  /** 부모 환경에 얹을 환경변수 (덮어쓰기만, 나머지는 그대로 상속) */
  env?: NodeJS.ProcessEnv;
}

/**
 * 파이썬 CLI를 부를 때 얹는 환경변수.
 *
 * 한국어 윈도우의 콘솔 코드페이지는 cp949다. 파이썬은 표준출력 인코딩을 여기에 맞추므로,
 * 진행률 스피너 같은 유니코드 문자(`⠋` U+280B)를 찍는 순간 UnicodeEncodeError로 죽는다.
 * 도구가 멀쩡한데 출력 한 글자 때문에 실패하는 것이라 원인을 찾기가 매우 어렵다.
 *
 * - `PYTHONIOENCODING`/`PYTHONUTF8` — 출력 인코딩을 UTF-8로 고정한다
 * - `TERM=dumb`/`NO_COLOR` — rich 같은 라이브러리가 커서를 옮기는 화면 갱신을 아예 끄게 한다.
 *   파이프로 받는 출력에 스피너는 필요 없고, 윈도우 레거시 콘솔 렌더 경로도 함께 피한다
 */
export const PYTHON_CLI_ENV: NodeJS.ProcessEnv = {
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  TERM: 'dumb',
  NO_COLOR: '1',
};

/** 서브프로세스 실행 — 인자는 배열로만 전달 (셸 미사용, 인젝션 원천 차단) */
export function run(
  bin: string,
  args: string[],
  opts: RunOptions = {},
): ResultPromise<Options> {
  const child = execa(bin, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    buffer: true,
    stripFinalNewline: true,
    reject: true,
    // execa는 기본으로 부모 환경을 상속한다 — 여기 준 값만 덮어쓴다
    env: opts.env,
  });
  if (opts.onStdout && child.stdout) {
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      // yt-dlp는 \r 로 진행률을 갱신한다
      const lines = buf.split(/[\r\n]+/);
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) opts.onStdout!(line);
    });
  }
  if (opts.onStderr && child.stderr) {
    let buf = '';
    child.stderr.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/[\r\n]+/);
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) opts.onStderr!(line);
    });
  }
  return child;
}

/**
 * 서브프로세스 실패에서 사람이 볼 부분만 남긴다.
 *
 * execa의 `message`는 첫 줄이 "Command failed ...: <명령 전체>"라 다운로드 URL이
 * 그대로 들어가 수백 자가 된다. 앞에서 몇 줄을 잘라 쓰면 **정작 원인인 `ERROR:` 줄이
 * 잘려나가고** 화면에는 명령 에코만 남는다 (틱톡 다운로드 실패가 전부 이렇게 보였다).
 * 그래서 에코를 버리고 도구가 남긴 `ERROR:` 줄을 고른다.
 */
export function toolFailureMessage(e: unknown, max = 300): string {
  if (!(e instanceof Error)) return String(e);
  const [echo, ...rest] = e.message.split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = rest.filter((l) => /^ERROR\b/i.test(l));
  // ERROR 줄이 없으면 마지막 출력이 그나마 단서다. 출력 자체가 없으면 종료 코드라도 남긴다
  const picked = errors.length ? errors : rest.slice(-2);
  return (picked.join(' | ') || echo || String(e)).slice(0, max);
}

/** 도구 버전 확인에 허용하는 최대 시간 — 넘으면 "없음"으로 처리하고 부팅을 계속한다 */
const TOOL_CHECK_TIMEOUT_MS = 8_000;

/** 자식과 그 손자까지 정리 — POSIX에서는 프로세스 그룹째 죽인다 */
function killTree(child: ResultPromise<Options>): void {
  const pid = child.pid;
  try {
    if (pid && process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    // 이미 죽었으면 무시
  }
}

/**
 * 도구 존재 여부 + 버전 확인.
 *
 * execa의 `timeout`만으로는 부족하다: 자식은 죽어도 손자가 stdout 파이프를 물고 있으면
 * 스트림이 닫히지 않아 프로미스가 영원히 안 끝난다 (iopaint처럼 파이썬 런처가 실제 프로세스를
 * 따로 띄우는 도구에서 발생). 부팅이 여기서 멈추면 API가 포트를 못 열어 웹 UI 전체가
 * ECONNREFUSED로 죽으므로, 시간 초과는 우리가 직접 끊고 자식을 버린다.
 */
export async function checkTool(
  bin: string,
  versionArgs: string[] = ['--version'],
  timeoutMs: number = TOOL_CHECK_TIMEOUT_MS,
): Promise<{ available: boolean; version?: string; error?: string }> {
  const child = execa(bin, versionArgs, {
    timeout: timeoutMs,
    stdin: 'ignore',
    killSignal: 'SIGKILL',
    // Windows에서 detached는 콘솔 창을 띄우므로 POSIX에서만 그룹 리더로 만든다
    detached: process.platform !== 'win32',
    reject: true,
  });
  // race가 이미 끝난 뒤 늦게 도착하는 거부를 삼킨다 (unhandledRejection 방지)
  void child.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  const bail = new Promise<'timeout'>((resolve) => {
    // execa 자체 timeout이 정상 동작하면 그쪽이 먼저 끝나도록 여유를 조금 준다
    timer = setTimeout(() => resolve('timeout'), timeoutMs + 1_000);
    timer.unref?.();
  });

  try {
    const r = await Promise.race([child, bail]);
    if (r === 'timeout') {
      killTree(child);
      return { available: false, error: `${timeoutMs}ms 내에 버전을 응답하지 않음` };
    }
    const version = (r.stdout || r.stderr || '').toString().split('\n')[0].trim();
    return { available: true, version };
  } catch (e: unknown) {
    return { available: false, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

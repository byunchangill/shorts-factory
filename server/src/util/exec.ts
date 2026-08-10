import { execa, type Options, type ResultPromise } from 'execa';

export interface RunOptions {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  cwd?: string;
  timeoutMs?: number;
}

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

/** 도구 존재 여부 + 버전 확인 */
export async function checkTool(
  bin: string,
  versionArgs: string[] = ['--version'],
): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const r = await execa(bin, versionArgs, { timeout: 10_000, reject: true });
    const version = (r.stdout || r.stderr || '').toString().split('\n')[0].trim();
    return { available: true, version };
  } catch (e: unknown) {
    return { available: false, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
}

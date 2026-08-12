import { checkTool } from './exec.js';

/**
 * 버전 확인 인자를 순서대로 시도해 하나라도 통하면 "설치됨"으로 본다.
 *
 * 도구마다 버전 인자가 제각각이다 — ffmpeg은 `-version`, yt-dlp는 `--version`,
 * iopaint는 버전에 따라 아예 없다. 하나만 보고 판정하면 멀쩡히 깔린 도구를
 * 없다고 표시하게 된다 (실제로 ffmpeg과 iopaint 둘 다 이 함정을 밟았다).
 */
export async function checkToolAny(
  bin: string,
  candidates: string[][],
): Promise<{ available: boolean; version?: string }> {
  let last: { available: boolean; version?: string } = { available: false };
  for (const args of candidates) {
    const r = await checkTool(bin, args);
    if (r.available) return r;
    last = r;
  }
  return last;
}

/**
 * iopaint 버전 확인 인자.
 * `--version`이 없는 빌드가 있어서, 어느 버전에서든 0으로 끝나는 `--help`를 뒤에 둔다.
 */
export const IOPAINT_VERSION_ARGS = [['--version'], ['--help']];

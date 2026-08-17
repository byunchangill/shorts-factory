import path from 'node:path';
import fsp from 'node:fs/promises';
import { checkTool } from './exec.js';
import { resolveBin } from './toolPath.js';

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

/**
 * iopaint 설치 확인.
 *
 * **절대경로로 지정했으면 실행하지 않고 파일만 본다.** iopaint는 `--help` 한 번에도
 * 파이썬과 torch를 통째로 올려 2.5초(예열)~8초 이상(냉시작)이 걸린다. 확인 인자를
 * 두 개 시도하므로 상한(8초)을 넘기기 쉽고, 그러면 멀쩡히 깔린 도구가 "없음"이 되어
 * 2차 제거가 막힌다 (실측: 서버 재시작 직후 실제로 막혔다).
 * 있느냐는 물음에 20초를 쓸 이유가 없다 — 그 자리에 파일이 있으면 있는 것이다.
 */
export async function checkIopaint(bin: string): Promise<{ available: boolean; version?: string }> {
  // 이름만 적혀 있어도 대개 실제 파일을 찾아낸다 — 그러면 실행할 필요가 없어진다
  const resolved = await resolveBin(bin);
  if (path.isAbsolute(resolved)) {
    const ok = await fsp.access(resolved).then(() => true, () => false);
    return { available: ok };
  }
  // 끝내 못 찾았으면 실행해보는 수밖에 없다
  return checkToolAny(resolved, IOPAINT_VERSION_ARGS);
}

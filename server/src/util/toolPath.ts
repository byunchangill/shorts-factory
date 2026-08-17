import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exists } from './fsx.js';

/**
 * 외부 도구 실행 파일 찾기.
 *
 * **PC마다 설치 자리가 다르다.** 설정에 절대경로를 적어두면 그 PC에서만 도는 앱이 되고,
 * 이름만 적어두면 PATH에 없는 PC에서 통째로 막힌다. 그래서 이름을 받아 그 자리에서 찾는다 —
 * 설정에 저장되는 값은 `ffmpeg` 같은 **이름**으로 남고, 실제 경로는 실행할 때 정해진다.
 *
 * 찾는 순서에 뜻이 있다:
 *  1. **동봉한 것**(`tools/bin`, Electron `resources/bin`) — 배포판이 들고 다니는 것이 최우선
 *  2. **PATH** — 사용자가 직접 깐 것
 *  3. **저장소 안 가상환경** — 설치 문서가 안내하는 자리. 상대 경로라 PC가 바뀌어도 맞는다
 *  4. **표준 설치 자리** — winget·scoop·choco·homebrew가 놓는 자리. PATH에 안 잡혀도 찾아낸다
 *
 * 못 찾으면 받은 이름을 그대로 돌려준다. 우리가 오류를 지어내는 것보다
 * execa가 내는 평소 메시지가 낫다.
 *
 * 폰트 탐색(`pipeline/fonts.ts`)과 같은 방식이다 — 후보를 훑고, 찾은 것을 캐시한다.
 */

/** 이름 → 찾아낸 절대경로. 도구를 새로 깔기 전까지 안 바뀌므로 계속 들고 있는다 */
const cache = new Map<string, string>();

/** 실행 파일 이름 후보 — 윈도우는 확장자가 붙는다 (`yt-dlp.exe`, `iopaint.cmd`) */
function exeNames(bin: string): string[] {
  if (process.platform !== 'win32') return [bin];
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [bin, ...exts.map((e) => bin + e)];
}

/**
 * 앱이 동봉한 실행 파일 폴더.
 *
 * Electron으로 포장하면 `resourcesPath/bin`에 들어간다 — ffmpeg·yt-dlp를 같이 싸서
 * 친구 PC에서 아무것도 안 깔고 돌게 만드는 자리가 여기다. 소스로 돌 때는 `tools/bin`.
 * 지금은 둘 다 비어 있어도 되고, 채우면 그때부터 자동으로 우선한다.
 */
function vendorDirs(): string[] {
  const dirs: string[] = [];
  const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (typeof res === 'string' && res) dirs.push(path.join(res, 'bin'));
  dirs.push(fileURLToPath(new URL('../../../tools/bin', import.meta.url)));
  return dirs;
}

function pathDirs(): string[] {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
}

/**
 * 저장소 안의 가상환경 — 설치 문서가 안내하는 자리다 (`tools/install-inpaint.md`).
 *
 * 저장소 기준 상대 경로라 **PC가 바뀌어도 그대로 맞는다.** 문서대로 깔았으면
 * 설정에 아무것도 안 적어도 잡힌다. PATH 뒤에 두는 이유는, 셸에서 켜둔 가상환경이
 * 있으면 그쪽이 사용자의 현재 의도이기 때문이다.
 */
function repoVenvDirs(): string[] {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const sub = process.platform === 'win32' ? 'Scripts' : 'bin';
  return ['.venv-inpaint', '.venv'].map((v) => path.join(root, v, sub));
}

/** 패키지 관리자들이 실행 파일을 놓는 표준 자리 — PATH에 안 잡혀 있어도 여기 있으면 쓸 수 있다 */
function wellKnownDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    return [
      path.join(local, 'Microsoft', 'WinGet', 'Links'), // winget
      path.join(home, 'scoop', 'shims'), // scoop
      'C:\\ProgramData\\chocolatey\\bin', // chocolatey
      'C:\\ffmpeg\\bin', // 압축만 풀어 쓰는 가장 흔한 자리
      path.join(programFiles, 'ffmpeg', 'bin'),
    ];
  }
  return [
    '/opt/homebrew/bin', // apple silicon homebrew
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin'), // pip install --user
  ];
}

async function search(bin: string): Promise<string | null> {
  for (const dir of [...vendorDirs(), ...pathDirs(), ...repoVenvDirs(), ...wellKnownDirs()]) {
    for (const name of exeNames(bin)) {
      const p = path.join(dir, name);
      if (await isFile(p)) return p;
    }
  }
  return null;
}

/**
 * 파일이 그 자리에 있는지.
 *
 * **크기로는 거르지 않는다.** 윈도우 스토어판 파이썬의 실행 파일은 0바이트짜리
 * 앱 실행 별칭인데 멀쩡히 돌아간다 — 크기를 보고 껍데기라고 떨궜다가 검출기가 깔린
 * 유일한 파이썬을 놓쳤다 (2026-08-17 실측). 진짜 껍데기(스토어 안내창만 띄우는 것)는
 * 어차피 `import`를 시켜보는 단계에서 걸러진다.
 */
async function isFile(p: string): Promise<boolean> {
  const st = await fsp.stat(p).catch(() => null);
  return !!st && st.isFile();
}

/**
 * 도구 이름 → 실행 경로.
 *
 * 경로를 적어준 값(`/`나 `\`가 들어 있거나 절대경로)은 **손대지 않는다.**
 * 사용자가 특정 설치본을 지목한 것인데 우리가 다른 것을 고르면, 고쳤다고 생각한 설정이
 * 계속 안 먹는 것처럼 보인다 (iopaint에서 겪은 그 문제다).
 */
export async function resolveBin(bin: string): Promise<string> {
  const raw = (bin ?? '').trim();
  if (!raw) return bin;
  if (path.isAbsolute(raw) || raw.includes('/') || raw.includes('\\')) return raw;

  const hit = cache.get(raw);
  if (hit) return hit;
  const found = await search(raw);
  if (found) cache.set(raw, found);
  return found ?? raw;
}

/**
 * 파이썬 후보 목록 — 앞에 있는 것부터 써본다.
 *
 * PATH만 보면 안 된다. **가상환경이 켜진 셸에서 서버를 띄우면 `py`·`python`·`python3`가
 * 셋 다 그 가상환경을 가리킨다** — 거기에 검출기가 없으면 멀쩡히 깔린 파이썬을 두고
 * "없음"이 된다 (2026-08-17 실측: 같은 PC에서 셸만 바꿔 ✅→⚠️로 뒤집혔다).
 * 그래서 설치 폴더도 직접 훑어 후보에 넣는다.
 */
export async function pythonCandidates(): Promise<string[]> {
  const names = process.platform === 'win32'
    ? ['py', 'python', 'python3']
    : ['python3', 'python'];

  const out: string[] = [];
  for (const n of names) out.push(await resolveBin(n));
  for (const exe of await pythonInstalls()) out.push(exe);
  return [...new Set(out.filter(Boolean))];
}

/**
 * 이름이 정규식에 맞는 하위 폴더 — **최신 버전이 앞**에 오게 정렬한다.
 * 글자 순으로 세우면 `Python38`이 `Python312`보다 앞에 서므로 숫자로 비교한다.
 */
async function subdirs(parent: string, re: RegExp): Promise<string[]> {
  const names = await fsp.readdir(parent).catch(() => [] as string[]);
  const ver = (n: string) => (n.match(/\d+/g) ?? []).map(Number);
  return names
    .filter((n) => re.test(n))
    .sort((a, b) => {
      const [x, y] = [ver(a), ver(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      }
      return 0;
    })
    .map((n) => path.join(parent, n));
}

/** 윈도우의 파이썬 설치 폴더들 — PATH에 안 걸려도 여기 있으면 쓴다 */
async function pythonInstalls(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';

  const dirs = [
    ...await subdirs(path.join(local, 'Programs', 'Python'), /^Python3/i),
    // 스토어판은 여기에 진짜 실행 파일이 있다 (PATH의 껍데기와 다른 파일이다)
    ...await subdirs(path.join(local, 'Microsoft', 'WindowsApps'), /^PythonSoftwareFoundation\.Python\.3/i),
    ...await subdirs('C:\\', /^Python3/i),
    ...await subdirs(programFiles, /^Python3/i),
  ];

  const found: string[] = [];
  for (const d of dirs) {
    const exe = path.join(d, 'python.exe');
    if (await isFile(exe)) found.push(exe);
  }
  return found;
}

/**
 * VSR(video-subtitle-remover) 저장소 자리.
 *
 * 설정에 안 적었으면 홈 아래 표준 이름을 본다 — 설치 문서가 안내하는 자리다.
 * PC를 옮길 때마다 설정 화면을 다시 채우게 만들 이유가 없다.
 */
export async function findVsrRepo(configured: string): Promise<string> {
  const wanted = (configured ?? '').trim();
  if (wanted) return wanted;

  const hit = cache.get(VSR_CACHE_KEY);
  if (hit !== undefined) return hit;
  for (const name of ['vsr', 'video-subtitle-remover']) {
    const dir = path.join(os.homedir(), name);
    if (await exists(path.join(dir, 'backend', 'main.py'))) {
      cache.set(VSR_CACHE_KEY, dir);
      return dir;
    }
  }
  return '';
}

const VSR_CACHE_KEY = '\0vsr-repo';

/** 테스트용 — 탐색 캐시를 비운다 */
export function resetBinCache(): void {
  cache.clear();
}

import path from 'node:path';
import fsp from 'node:fs/promises';
import { exists } from '../util/fsx.js';

/**
 * 한글 폰트 탐색.
 * ffmpeg의 drawtext(텍스트 카드)와 ASS 자막 번인이 모두 실제 폰트 파일을 요구한다.
 * 폰트가 없으면 한글이 네모(두부)로 깨지므로, OS별 표준 경로를 훑어 찾아둔다.
 */

const CANDIDATES: string[] = [
  // Linux — 나눔/본고딕
  '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
  '/usr/share/fonts/truetype/nanum/NanumBarunGothicBold.ttf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
  // macOS
  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
  '/Library/Fonts/AppleGothic.ttf',
  // Windows
  'C:/Windows/Fonts/malgunbd.ttf',
  'C:/Windows/Fonts/malgun.ttf',
  'C:/Windows/Fonts/NanumGothicBold.ttf',
];

let cached: string | null | undefined;

/**
 * 사용 가능한 한글 폰트 파일 경로.
 * settings.fontPath가 있으면 그것을 우선하고, 없으면 표준 경로를 탐색한다.
 * 하나도 없으면 null — 호출부는 텍스트 기능을 건너뛰거나 안내해야 한다.
 */
export async function findKoreanFont(override?: string): Promise<string | null> {
  if (override?.trim()) {
    return (await exists(override.trim())) ? override.trim() : null;
  }
  if (cached !== undefined) return cached;

  for (const c of CANDIDATES) {
    if (await exists(c)) {
      cached = c;
      return c;
    }
  }
  // 나눔 폴더 안의 아무 볼드체나 (배포판마다 파일명이 다르다)
  for (const dir of ['/usr/share/fonts/truetype/nanum', '/usr/share/fonts/opentype/noto']) {
    const files = await fsp.readdir(dir).catch(() => [] as string[]);
    const hit = files.find((f) => /\.(ttf|otf|ttc)$/i.test(f) && /bold/i.test(f))
      ?? files.find((f) => /\.(ttf|otf|ttc)$/i.test(f));
    if (hit) {
      cached = path.join(dir, hit);
      return cached;
    }
  }
  cached = null;
  return null;
}

/** ASS 자막에 넣을 폰트 패밀리명 — 파일명에서 유추한다 */
export function fontFamilyOf(fontPath: string | null): string {
  if (!fontPath) return 'Sans';
  const base = path.basename(fontPath).toLowerCase();
  if (base.includes('nanumbarun')) return 'NanumBarunGothic';
  if (base.includes('nanumsquare')) return 'NanumSquare';
  if (base.includes('nanum')) return 'NanumGothic';
  if (base.includes('notosanscjk') || base.includes('noto')) return 'Noto Sans CJK KR';
  if (base.includes('applesdgothic')) return 'Apple SD Gothic Neo';
  if (base.includes('malgun')) return 'Malgun Gothic';
  return 'Sans';
}

/**
 * 필터에 넣을 파일 인자 + ffmpeg를 실행할 cwd.
 *
 * **필터그래프 안에 절대경로를 넣지 않는다.** 콜론은 필터 옵션 구분자라
 * 윈도우 드라이브 문자(`C:`)와 정면으로 부딪히는데, 이스케이프를 몇 단계로
 * 풀어야 하는지가 ffmpeg 빌드마다 다르다 — `C\:/…`도 `C\\:/…`도 어떤 빌드에서는
 * 통하고 어떤 빌드에서는 "No option name near …"로 죽는다. 실제로 두 형태 모두
 * 한쪽 환경에서만 통과했다.
 *
 * 그래서 이스케이프로 버티지 않고, 파일이 있는 폴더를 cwd로 잡아 **파일명만** 넘긴다.
 * 콜론도 백슬래시도 없는 문자열이라 어떤 버전에서도 해석이 갈리지 않는다.
 * 필터 밖의 인자(`-i`, 출력 경로)는 이 문제가 없으므로 절대경로 그대로 쓴다.
 */
export function filterFileArg(filePath: string): { arg: string; cwd: string } {
  // 구분자는 / 와 \ 둘 다 인정한다 — 윈도우 경로를 다른 OS에서도 검사할 수 있어야 한다
  const sep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return {
    arg: sep < 0 ? filePath : filePath.slice(sep + 1),
    cwd: path.dirname(filePath),
  };
}

/** drawtext의 text= 값 이스케이프 */
export function escapeDrawText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019") // 작은따옴표는 필터 인용을 깨므로 유사 문자로 치환
    .replace(/%/g, '\\%');
}

/** 테스트 편의를 위한 캐시 초기화 */
export function resetFontCache(): void {
  cached = undefined;
}

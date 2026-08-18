import path from 'node:path';
import fsp from 'node:fs/promises';
import { paths } from '../store/workspace.js';
import { readFontIndex } from './googleFonts.js';

/**
 * 화면에서 고를 수 있는 **무료 글꼴**만 모아 둔 표.
 *
 * 설치된 글꼴을 전부 보여주면 안 된다 — 윈도우에 딸려 오는 글꼴(맑은 고딕 등)은
 * 영상에 새겨 배포해도 되는지가 라이선스마다 다르다. 그래서 **자유 이용이 명시된 것만**
 * 이름으로 골라낸다. 여기 없는 글꼴은 설치돼 있어도 목록에 안 뜬다.
 *
 * `match`는 **파일명 소문자**에 대한 검사다 (확장자 포함). 굵은 것부터 적어야
 * 같은 가족 안에서 굵은 쪽이 먼저 걸린다 — 쇼츠 자막은 굵을수록 배경에 안 묻힌다.
 */
export interface FreeFont {
  /** 파일명(소문자)에 이 문자열이 들어가면 이 글꼴이다 */
  match: string;
  /** ASS·drawtext에 넣을 패밀리명 */
  family: string;
  /** 화면에 보일 이름 */
  label: string;
  /** 라이선스 한 줄 (화면에 같이 보여 준다) */
  license: string;
}

export const FREE_FONTS: FreeFont[] = [
  { match: 'notosanskr-black', family: 'Noto Sans KR Black', label: '본고딕 Black', license: 'OFL' },
  { match: 'notosanskr-bold', family: 'Noto Sans KR', label: '본고딕 Bold', license: 'OFL' },
  { match: 'notosanskr-medium', family: 'Noto Sans KR Medium', label: '본고딕 Medium', license: 'OFL' },
  { match: 'notosanskr-regular', family: 'Noto Sans KR', label: '본고딕 Regular', license: 'OFL' },
  { match: 'notosanscjk', family: 'Noto Sans CJK KR', label: '본고딕 CJK', license: 'OFL' },
  { match: 'notoserifkr', family: 'Noto Serif KR', label: '본명조', license: 'OFL' },
  { match: 'pretendard-black', family: 'Pretendard Black', label: '프리텐다드 Black', license: 'OFL' },
  { match: 'pretendard-bold', family: 'Pretendard', label: '프리텐다드 Bold', license: 'OFL' },
  { match: 'pretendard', family: 'Pretendard', label: '프리텐다드', license: 'OFL' },
  { match: 'gmarketsansbold', family: 'GmarketSans Bold', label: '지마켓 산스 Bold', license: '지마켓 무료 배포' },
  { match: 'gmarketsansmedium', family: 'GmarketSans Medium', label: '지마켓 산스 Medium', license: '지마켓 무료 배포' },
  { match: 'gmarketsanslight', family: 'GmarketSans Light', label: '지마켓 산스 Light', license: '지마켓 무료 배포' },
  { match: 'jalnan', family: 'Jalnan', label: '여기어때 잘난체', license: '여기어때 무료 배포' },
  { match: 'bmjua', family: 'BM JUA', label: '배민 주아체', license: '배달의민족 무료 배포' },
  { match: 'bmdohyeon', family: 'BM DoHyeon', label: '배민 도현체', license: '배달의민족 무료 배포' },
  { match: 'bmhanna', family: 'BM HANNA', label: '배민 한나체', license: '배달의민족 무료 배포' },
  { match: 'blackhansans', family: 'Black Han Sans', label: '검은고딕', license: 'OFL' },
  { match: 'dohyeon', family: 'Do Hyeon', label: '도현', license: 'OFL' },
  { match: 'jua', family: 'Jua', label: '주아', license: 'OFL' },
  { match: 'gothica1', family: 'Gothic A1', label: '고딕 A1', license: 'OFL' },
  { match: 'scdream', family: 'S-Core Dream', label: '에스코어드림', license: '에스코어 무료 배포' },
  { match: 'spoqahansansneo', family: 'Spoqa Han Sans Neo', label: '스포카 한 산스 네오', license: 'OFL' },
  { match: 'ibmplexsanskr', family: 'IBM Plex Sans KR', label: 'IBM 플렉스 산스 KR', license: 'OFL' },
  { match: 'nanumsquare', family: 'NanumSquare', label: '나눔스퀘어', license: '네이버 무료 배포' },
  { match: 'nanumbarungothic', family: 'NanumBarunGothic', label: '나눔바른고딕', license: '네이버 무료 배포' },
  { match: 'nanumgothicbold', family: 'NanumGothic', label: '나눔고딕 Bold', license: '네이버 무료 배포' },
  { match: 'nanumgothic', family: 'NanumGothic', label: '나눔고딕', license: '네이버 무료 배포' },
  { match: 'nanummyeongjo', family: 'NanumMyeongjo', label: '나눔명조', license: '네이버 무료 배포' },
];

/**
 * 글꼴 파일 → ASS·drawtext에 넣을 패밀리명.
 * 받아 둔 글꼴은 index.json에 적힌 이름을, 시스템 글꼴은 표의 이름을 쓴다.
 */
export async function familyOfInstalled(fontPath: string): Promise<string | null> {
  const base = path.basename(fontPath);
  const hit = (await readFontIndex()).find((e) => e.file === base);
  return hit?.family ?? null;
}

/** 파일 하나가 무료 글꼴 표의 어디에 해당하는지 (순수 함수 — 테스트 대상) */
export function matchFreeFont(fileName: string): FreeFont | null {
  const base = path.basename(fileName).toLowerCase();
  if (!/\.(ttf|otf|ttc)$/.test(base)) return null;
  return FREE_FONTS.find((f) => base.includes(f.match)) ?? null;
}

/** 글꼴이 깔려 있는 자리 — OS마다 다르고, 사용자 계정에만 깔린 것도 있다 */
function fontDirs(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const local = process.env.LOCALAPPDATA ?? '';
  return [
    'C:/Windows/Fonts',
    local && path.join(local, 'Microsoft/Windows/Fonts'),
    '/Library/Fonts',
    '/System/Library/Fonts',
    home && path.join(home, 'Library/Fonts'),
    '/usr/share/fonts/truetype',
    '/usr/share/fonts/opentype',
    home && path.join(home, '.local/share/fonts'),
  ].filter(Boolean) as string[];
}

export interface InstalledFont extends FreeFont {
  /** 실제 파일 경로 — 설정의 fontPath에 그대로 들어간다 */
  filePath: string;
}

/**
 * 화면에서 받아 둔 글꼴(`workspace/fonts/`)도 목록에 넣는다.
 * 표에 이름이 없어도 된다 — 구글 폰트에서 받은 것이라 OFL임이 이미 확인된 파일이다.
 */
async function downloadedFonts(): Promise<InstalledFont[]> {
  const dir = paths.fonts();
  return (await readFontIndex()).map((e) => ({
    match: e.file.toLowerCase(),
    family: e.family,
    label: e.label,
    license: e.license,
    filePath: path.join(dir, e.file).replace(/\\/g, '/'),
  }));
}

/**
 * 이 PC에 깔린 무료 글꼴 목록.
 * 같은 글꼴이 여러 자리에 있으면 먼저 찾은 것 하나만 남긴다.
 */
export async function listFreeFonts(): Promise<InstalledFont[]> {
  const found = new Map<string, InstalledFont>();
  for (const f of await downloadedFonts()) found.set(f.match, f);
  for (const dir of fontDirs()) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile()) continue;
      const hit = matchFreeFont(e.name);
      if (!hit || found.has(hit.match)) continue;
      found.set(hit.match, { ...hit, filePath: path.join(dir, e.name).replace(/\\/g, '/') });
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

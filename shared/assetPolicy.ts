import type { Menu } from './constants.js';

/**
 * 에셋 소싱 정책 — 짤방·효과음의 출처 대장 (2026-08-26).
 *
 * **여기가 단일 출처다.** 조립 게이트(`assetLogError`)·요청서 문구(`MENU_B_RULES`)·
 * 스킬 문서·내보내기 CSV가 전부 이 파일을 읽는다. `shared/doctrine.ts`가 대본 규칙에서
 * 같은 이유로 통합돼 있다 — 규칙을 두 벌 두면 반드시 어긋난다.
 *
 * 왜 필요한가. 썰형 쇼핑 쇼츠(menu-b)는 제품 연출컷 대신 짤방·스톡 소재를 쓰는데,
 * 그 자리에 두 위험이 있다.
 *
 * 1. **식별 가능한 인물 사진을 제품의 실패 사례와 엮는 것.** "두 달 만에 버린 사람"이라는
 *    나레이션 밑에 스톡 인물 사진을 깔면 그 모델은 자기가 산 적도 없는 제품의 실패 사례
 *    주인공이 된다 — 라이선스와 별개로 초상권 분쟁 소지다
 * 2. **인기 스톡 클립의 중복.** 이미 수만 개 쇼츠에 들어가 있어 재사용 신호가 될 수 있다
 *
 * ⚠️ **각 사이트 라이선스 조항의 정확한 문구는 확인하지 않았다.** 정책으로서는 조항 유무와
 * 무관하게 타당하다(초상권은 라이선스와 별개다). 아래 `licenseHint`는 **사이트가 내건
 * 라이선스의 이름일 뿐 조항을 읽고 검증한 값이 아니다** — 기본값으로 채워 넣되 사람이 고친다.
 *
 * 🔴 **얼굴을 자동으로 찾지 않는다.** 자막 존 검출에서 이미 배웠다 — 어림짐작은
 * "검사했다"는 잘못된 안심만 준다. 사람이 표시하고, **표시가 없으면 막는다.**
 */

// ── 자료 하나에 붙는 출처 5필드 ───────────────────────────────────

/**
 * 자료의 출처 기록. **전부 optional이다** — 이 기능 전에 올린 자료에는 하나도 없고,
 * 그래도 목록에서 그대로 보여야 한다. 요구하는 자리는 업로드(`POST /assets`)와
 * menu-b 조립 게이트 둘뿐이다.
 */
export interface AssetSource {
  /** 받아온 페이지 주소. 직접 만든 것이면 `SELF_MADE` */
  sourceUrl?: string;
  /** 라이선스 이름. 화이트리스트 사이트면 기본값이 채워진다 */
  license?: string;
  /** 받은 날짜 (ISO). 사이트가 라이선스를 바꾸면 "언제 받은 것인가"가 유일한 근거다 */
  downloadedAt?: string;
  /**
   * 식별 가능한 인물이 있는가. **`undefined`는 "없음"이 아니라 "안 봤음"이다** —
   * 기본값을 false로 두면 아무도 안 본 자료가 통과한다.
   */
  hasFace?: boolean;
  /**
   * 사람이 적는 메모. **화면에 실제로 걸리는 변형은 여기가 아니라 설정에서 계산한다**
   * (`transformSummary`) — 손으로 적은 변형 기록은 반드시 실제와 어긋난다.
   * 검색 정렬(`최신순`·`상위 20개 제외`) 같은 **앱이 확인할 수 없는 주장**도 여기 적는다.
   */
  transformNote?: string;
}

/**
 * 정책이 판정하는 대상 — 소재 하나.
 *
 * `where`는 **고치는 자리가 다르기 때문에** 있다. 자료실 자료는 「편집 재료」 화면에서
 * 칸을 채우면 되지만 씬 이미지는 그 화면에 아예 없다 — 요청서를 다시 받아야 한다.
 * 사유만 같고 고칠 곳이 다른데 한 문장으로 안내하면 없는 입력칸을 찾아 헤맨다.
 *
 * (이름이 `origin`이 아닌 이유: `Asset.origin`은 이미 `shared`/`local`을 뜻한다.
 * 같은 이름에 다른 뜻을 겹치면 `Asset`을 그대로 넘기는 자리가 조용히 깨진다.)
 */
export interface AssetSubject extends AssetSource {
  id: string;
  title: string;
  /** 기본값은 자료실(`library`) — 이 필드 전에 만들어진 호출부가 전부 그쪽이다 */
  where?: 'library' | 'scene';
}

/** 직접 만든 자료의 출처 값. URL이 없다고 기록을 건너뛰면 대장에 구멍이 난다 */
export const SELF_MADE = '직접제작';

/**
 * AI로 만든 그림의 출처 값.
 *
 * 🔴 **이게 없으면 정책이 권하는 방법이 게이트를 통과할 길이 없다.** 인물이 필요한 자리에
 * 「AI로 만든 그림을 쓰라」고 해 놓고 출처를 URL로만 받으면, 그 그림에는 받아온 페이지가
 * 없어서 `missing`으로 막힌다 — 시키는 대로 한 사람이 막히는 규칙이다.
 *
 * `SELF_MADE`와 갈라 두는 이유는 대장에서 갈려 보여야 하기 때문이다. 직접 촬영·제작한 것과
 * 생성 모델이 만든 것은 나중에 되짚을 때 뜻이 다르다 (모델·서비스 약관이 걸리는 쪽은 후자다).
 * 어느 모델로 만들었는지는 `license` 칸에 적는다 — 앱이 확인할 수 없는 값이라 강제하지 않는다.
 */
export const AI_GENERATED = 'AI생성';

// ── 화이트리스트 · 블랙리스트 ─────────────────────────────────────

export interface SourceHost {
  /** 호스트 (하위 도메인은 자동으로 딸려온다 — `cdn.pixabay.com`도 픽사베이다) */
  host: string;
  label: string;
}

export interface AllowedHost extends SourceHost {
  /** ⚠️ 사이트가 내건 라이선스의 **이름**이다. 조항을 읽고 검증한 값이 아니다 */
  licenseHint: string;
}

/**
 * 무료 소재 사이트. 여기서 받은 것은 라이선스를 안 적어도 통과한다(이름이 자동으로 붙는다).
 *
 * 늘리기 전에 **그 사이트가 상업적 이용과 재배포를 실제로 허용하는지** 확인할 것.
 * 목록을 늘리는 것이 게이트를 무르게 만드는 가장 쉬운 길이다.
 */
export const ASSET_SOURCE_WHITELIST: readonly AllowedHost[] = [
  { host: 'pixabay.com', label: '픽사베이', licenseHint: 'Pixabay Content License' },
  { host: 'pexels.com', label: 'Pexels', licenseHint: 'Pexels License' },
  { host: 'unsplash.com', label: 'Unsplash', licenseHint: 'Unsplash License' },
  { host: 'mixkit.co', label: 'Mixkit', licenseHint: 'Mixkit Free License' },
  { host: 'coverr.co', label: 'Coverr', licenseHint: 'Coverr License' },
  { host: 'freesound.org', label: 'Freesound', licenseHint: 'Creative Commons (개별 확인)' },
];

const REASON_REDIST =
  '원저작자를 지운 재배포 이미지가 섞여 있어 라이선스를 확인할 길이 없습니다';
const REASON_CAPTURE =
  '남의 영상·게시물을 캡처한 것이라 저작권과 재사용 판정에 동시에 걸립니다';

export interface BlockedHost extends SourceHost {
  reason: string;
}

/**
 * 쓸 수 없는 출처. 짤방을 모으다 보면 제일 먼저 손이 가는 자리라 **이름을 박아 둔다** —
 * 「알아서 판단하세요」로 두면 반드시 여기서 가져온다.
 */
export const ASSET_SOURCE_BLACKLIST: readonly BlockedHost[] = [
  { host: 'pinterest.com', label: '핀터레스트', reason: REASON_REDIST },
  { host: 'instagram.com', label: '인스타그램', reason: REASON_CAPTURE },
  { host: 'facebook.com', label: '페이스북', reason: REASON_CAPTURE },
  { host: 'twitter.com', label: '트위터', reason: REASON_CAPTURE },
  { host: 'x.com', label: 'X', reason: REASON_CAPTURE },
  { host: 'tiktok.com', label: '틱톡', reason: REASON_CAPTURE },
  { host: 'youtube.com', label: '유튜브', reason: REASON_CAPTURE },
  { host: 'blog.naver.com', label: '네이버 블로그', reason: REASON_REDIST },
  { host: 'cafe.naver.com', label: '네이버 카페', reason: REASON_REDIST },
  { host: 'tistory.com', label: '티스토리', reason: REASON_REDIST },
  { host: 'dcinside.com', label: '디시인사이드', reason: REASON_REDIST },
  { host: 'fmkorea.com', label: '에펨코리아', reason: REASON_REDIST },
  { host: 'ruliweb.com', label: '루리웹', reason: REASON_REDIST },
  { host: 'namu.wiki', label: '나무위키', reason: REASON_REDIST },
];

// ── 출처 URL 판정 ─────────────────────────────────────────────────

export type SourceVerdict =
  | { kind: 'missing' }
  /** 사람이 적은 원문을 들고 다닌다 — 사유 문구가 그 값을 그대로 되비쳐야 고칠 수 있다 */
  | { kind: 'invalid'; raw: string }
  | { kind: 'self' }
  | { kind: 'ai' }
  | { kind: 'allowed'; host: string; entry: AllowedHost }
  | { kind: 'blocked'; host: string; entry: BlockedHost }
  | { kind: 'unknown'; host: string };

/** `www.` 를 떼고 소문자로. 주소가 아니면 null */
function hostOf(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    // 점이 없으면 호스트가 아니다 — 「메모」 같은 글자가 도메인으로 통과하는 것을 막는다
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** 하위 도메인까지 같은 사이트로 본다 — `cdn.pixabay.com`도 픽사베이다 */
function matches(host: string, entry: SourceHost): boolean {
  return host === entry.host || host.endsWith(`.${entry.host}`);
}

/**
 * 출처 URL 하나를 판정한다.
 *
 * **블랙리스트를 화이트리스트보다 먼저 본다.** 겹치는 일은 없지만, 목록이 늘어 겹치는
 * 날이 오면 「막는 쪽」이 이겨야 한다.
 */
export function classifySource(url: string | null | undefined): SourceVerdict {
  const text = (url ?? '').trim();
  if (!text) return { kind: 'missing' };
  if (text === SELF_MADE) return { kind: 'self' };
  if (text === AI_GENERATED) return { kind: 'ai' };
  const host = hostOf(text);
  if (!host) return { kind: 'invalid', raw: text };
  const blocked = ASSET_SOURCE_BLACKLIST.find((e) => matches(host, e));
  if (blocked) return { kind: 'blocked', host, entry: blocked };
  const allowed = ASSET_SOURCE_WHITELIST.find((e) => matches(host, e));
  if (allowed) return { kind: 'allowed', host, entry: allowed };
  return { kind: 'unknown', host };
}

/** 화이트리스트면 라이선스 이름을 채워 준다 — 사람이 적은 값이 언제나 우선이다 */
export function defaultLicense(url: string | null | undefined): string {
  const v = classifySource(url);
  if (v.kind === 'allowed') return v.entry.licenseHint;
  if (v.kind === 'self') return '자체 제작';
  // 어느 모델로 만들었는지는 사람이 적는다 — 기본값은 「생성했다」는 사실까지만 말한다
  if (v.kind === 'ai') return 'AI 생성 (모델은 비고에)';
  return '';
}

/** 화면·안내에 쓰는 짧은 출처 이름 (`픽사베이`, `example.com`, `직접 제작`) */
export function sourceLabel(url: string | null | undefined): string {
  const v = classifySource(url);
  switch (v.kind) {
    case 'self': return '직접 제작';
    case 'ai': return 'AI 생성';
    case 'allowed': return v.entry.label;
    case 'blocked': return v.entry.label;
    case 'unknown': return v.host;
    case 'invalid': return '주소 아님';
    default: return '출처 없음';
  }
}

const ALLOWED_NAMES = ASSET_SOURCE_WHITELIST.map((e) => e.host).join(' · ');

/**
 * 판정 하나의 사유 문구. 통과(`allowed`·`self`)면 `null`.
 *
 * 🔴 **문장 틀도 한 곳이다.** 판정만 상수로 모으고 문장을 자리마다 손으로 적었더니
 * 곧바로 어긋났다 — 같은 블랙리스트 사유가 「받은 것은」과 「받은 자료는」으로 갈렸다
 * (2026-08-26 리뷰). 업로드 400·자료실 경고·화면의 실시간 판정이 전부 이 함수를 부른다.
 *
 * `unknown`은 **라이선스를 적었으면 통과**다. 그 판단은 이 함수가 못 한다(라이선스를
 * 안 받는다) — 부르는 쪽이 `assetPolicyProblems`처럼 걸러 쓴다.
 */
export function sourceVerdictMessage(v: SourceVerdict): string | null {
  switch (v.kind) {
    case 'missing':
      return '출처 URL이 없습니다';
    case 'invalid':
      return `출처가 주소 형태가 아닙니다: "${v.raw}" `
        + `(직접 만든 것이면 ${SELF_MADE}, AI로 만든 것이면 ${AI_GENERATED}이라고 적습니다)`;
    case 'blocked':
      return `${v.entry.label}(${v.host})에서 받은 자료는 쓸 수 없습니다 — ${v.entry.reason}`;
    case 'unknown':
      return `${v.host}는 확인된 무료 소재 사이트가 아닙니다 — 라이선스를 직접 적어 주세요 `
        + `(자동으로 채워지는 곳: ${ALLOWED_NAMES}). `
        + '목록에 없다고 써도 되는 것은 아닙니다 — 그 사이트의 이용 조건을 보고 적으세요';
    default:
      return null;
  }
}

// ── 자료 하나의 정책 위반 ─────────────────────────────────────────

/**
 * 이 자료가 나가도 되는가. 빈 배열 = 통과.
 *
 * 업로드가 아니라 **조립**이 이걸 본다. 업로드에서 전부 요구하면 자료를 모으는 일 자체가
 * 막히는데, 실제로 위험해지는 자리는 그 자료가 영상에 실려 나갈 때다.
 */
export function assetPolicyProblems(a: AssetSubject): string[] {
  const out: string[] = [];
  const v = classifySource(a.sourceUrl);
  // 화이트리스트 밖(`unknown`)은 라이선스를 적었으면 통과다 — 그 판단만 여기서 한다
  const skipUnknown = v.kind === 'unknown' && Boolean(a.license?.trim());
  const why = skipUnknown ? null : sourceVerdictMessage(v);
  if (why) out.push(why);
  /*
    🔴 **묻는 것은 「얼굴이 있는가」가 아니라 「식별 가능한 실존 인물이 있는가」다.**
    AI가 만든 얼굴은 실존 인물이 아니라서 보통 `false`다 — 그래서 「인물이 필요하면
    AI 그림을 쓰라」는 정책이 성립한다. 실존 인물을 닮게 만들었다면 그건 `true`이고,
    닮게 만들었다는 사실이 오히려 위험을 키운다.
    자리마다 고칠 곳이 다르므로 **어디서 고치라는 말은 여기 적지 않는다** (`assetLogError`).
  */
  if (a.hasFace === undefined) {
    out.push('인물 포함 여부가 표시돼 있지 않습니다 — 「인물 없음/있음」을 표시해 주세요');
  } else if (a.hasFace) {
    out.push(
      '식별 가능한 인물이 있습니다 — 썰형은 이 그림을 제품의 실패 사례와 엮으므로 '
      + '초상권 분쟁 소지가 있습니다. AI로 만든 그림이나 인물 없는 자료로 바꾸세요',
    );
  }
  return out;
}

// ── 조립 게이트 ───────────────────────────────────────────────────

/**
 * 출처가 모자란 자료가 있으면 안내 문구, 없으면 `null`.
 *
 * 🔴 **`hookGate`와 반대로 「못 쟀으면 막는다」.** 훅 변화량은 측정 실패라 통과시키지만
 * 출처 누락은 **사용자 데이터 문제**다. 통과시키면 게이트가 있으나 마나다. 그래서 안내도
 * `cutPlanError`의 「다시 눌러도 같다」가 아니라 **「채우고 다시 하세요」**로 적는다.
 *
 * **제품정보리뷰(menu-b)에만 건다.** 해외영상 짜집기의 소재는 `job.sources[]`에 이미
 * `license`·`uploader`가 붙고 rights-confirm 게이트가 따로 막는다 — 두 벌을 겹치면
 * 같은 뜻의 게이트가 둘이 된다.
 *
 * 🔴 **씬 이미지도 본다** (2026-08-26). 스톡 인물 사진이 들어올 자리가 정확히 거기라,
 * 짤방만 보는 게이트는 제일 위험한 문을 열어 둔 채 옆문을 잠근 꼴이었다.
 * 고치는 자리가 자료실과 다르므로 안내를 갈라 낸다 (`AssetSubject.where`).
 */
export function assetLogError(menu: Menu, assets: AssetSubject[]): string | null {
  if (menu !== 'menu-b') return null;
  const bad = assets
    .map((a) => ({ a, why: assetPolicyProblems(a) }))
    .filter((x) => x.why.length > 0);
  if (bad.length === 0) return null;

  const lines = bad.map(({ a, why }) => `  · ${a.title}: ${why.join(' / ')}`);
  const how: string[] = [];
  if (bad.some(({ a }) => (a.where ?? 'library') === 'library')) {
    how.push(
      '편집 재료(짤방·효과음)는 「편집 재료」 화면에서 출처를 채우고 다시 조립하세요 '
      + '(인물이 있는 자료는 채우는 것이 아니라 바꿔야 합니다).',
    );
  }
  if (bad.some(({ a }) => a.where === 'scene')) {
    /*
      🔴 씬 이미지에는 출처를 적는 **화면이 없다.** 요청서가 받아 오는 값이라, 고치는 길은
      요청서를 다시 받는 것 하나뿐이다. 그걸 안 적으면 없는 입력칸을 찾아 헤맨다.
      옛 대본의 경로 문자열(`legacyImageRef`)이 여기로 떨어지는 것도 같은 길로 푼다.
    */
    how.push(
      `씬 이미지는 「씬 이미지」 요청서를 다시 발행해 출처를 채운 scenes.json을 받고 `
      + `다시 조립하세요 (AI로 만든 그림이면 출처에 ${AI_GENERATED}이라고 적습니다). `
      + '옛 대본의 이미지는 경로만 있고 출처가 없어 여기서 걸립니다.',
    );
  }
  return (
    `이 편이 쓰는 소재 ${bad.length}개의 출처 기록이 모자라 조립을 멈췄습니다.\n`
    + `${lines.join('\n')}\n`
    + how.join(' ')
  );
}

/**
 * 대본 씬이 들고 있는 이미지를 정책 판정 대상으로 옮긴다.
 *
 * **자료실 자료와 한 목록에 섞어서 넘긴다** — 게이트도 대장(CSV)도 목록 하나만 본다.
 * 목록을 갈라 두면 「대장에는 있는데 게이트는 안 본 소재」가 생긴다 (`usedAssetIds` 주석).
 *
 * `id`를 `scene:{sceneId}`로 두는 이유는 대장에서 자료실 id(`local:memes/…`)와 한눈에
 * 갈려야 하기 때문이다. 씬 번호가 곧 그 소재를 되짚는 열쇠다.
 */
export function sceneImageSubjects(
  scenes: ReadonlyArray<{ sceneId: string; imageRef?: AssetSource & { file: string } }>,
): AssetSubject[] {
  return scenes
    .filter((s): s is typeof s & { imageRef: AssetSource & { file: string } } => Boolean(s.imageRef))
    .map((s) => ({
      id: `scene:${s.sceneId}`,
      title: `씬 ${s.sceneId} 이미지`,
      where: 'scene' as const,
      sourceUrl: s.imageRef.sourceUrl,
      license: s.imageRef.license,
      downloadedAt: s.imageRef.downloadedAt,
      hasFace: s.imageRef.hasFace,
      transformNote: s.imageRef.transformNote,
    }));
}

/**
 * 이 편이 실제로 쓰는 자료 id. **두 갈래를 합친다** —
 * 잡에 담은 것(캡컷 재료 묶음)과 대본 씬이 가리키는 짤·효과음(웹 자동 조립)이다.
 *
 * 어느 쪽이든 완성된 영상에 실려 나가므로 대장도 게이트도 같은 목록을 봐야 한다.
 */
export function usedAssetIds(
  jobAssets: readonly string[],
  scenes: ReadonlyArray<{ memeId?: string; sfxId?: string }>,
): string[] {
  const ids = [
    ...jobAssets,
    ...scenes.flatMap((s) => [s.memeId, s.sfxId]),
  ].filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

// ── 출처 대장 (감사 이벤트 · 내보내기 CSV) ────────────────────────

/**
 * 화면에 실제로 걸린 변형. 🔴 **사람이 적는 값이 아니라 설정에서 계산한다** —
 * 손으로 적은 변형 기록은 반드시 실제와 어긋난다 (편마다 설정이 바뀌는데 메모는 안 바뀐다).
 */
export function transformSummary(
  s: { mirror: boolean; zoom: number; grade: string },
): string {
  const parts: string[] = [];
  if (s.mirror) parts.push('좌우반전');
  if (s.zoom > 1) parts.push(`확대 ${s.zoom.toFixed(2)}배`);
  if (s.grade.trim()) parts.push(`그레이딩(${s.grade.trim()})`);
  return parts.length ? parts.join(' · ') : '없음';
}

export interface AssetLedgerRow {
  id: string;
  title: string;
  sourceUrl: string;
  license: string;
  downloadedAt: string;
  /** 「없음」 · 「있음」 · 「미표시」 */
  hasFace: string;
  /** 설정에서 계산한 값 */
  transform: string;
  /** 사람이 적은 메모 — 검증된 값이 아니다 */
  note: string;
}

const FACE_LABEL = { yes: '있음', no: '없음', unknown: '미표시' } as const;

/**
 * 안 적힌 칸. **빈 칸으로 두지 않는다** — 캡컷 갈래는 출처 없는 자료도 그대로 나가므로
 * (게이트는 웹 자동 조립 한 곳뿐이다) 대장이 「신고할 것이 없음」과 「안 적었음」을
 * 갈라 말해야 한다. 빈 칸은 앞의 뜻으로 읽힌다.
 */
const UNRECORDED = '미기록';

export function assetLedgerRows(
  assets: AssetSubject[],
  transform: string,
): AssetLedgerRow[] {
  return assets.map((a) => ({
    id: a.id,
    title: a.title,
    sourceUrl: a.sourceUrl?.trim() || UNRECORDED,
    license: a.license?.trim() || defaultLicense(a.sourceUrl) || UNRECORDED,
    downloadedAt: a.downloadedAt ?? '',
    hasFace: a.hasFace === undefined
      ? FACE_LABEL.unknown
      : (a.hasFace ? FACE_LABEL.yes : FACE_LABEL.no),
    transform,
    note: a.transformNote ?? '',
  }));
}

const CSV_HEADER = [
  '자산id', '제목', '출처URL', '라이선스', '받은날짜', '인물', '변형(설정에서 계산)', '비고(사람이 적은 메모)',
];

/**
 * 한 칸. 쉼표·따옴표·줄바꿈이 들어가면 감싼다 — 제목에 쉼표가 흔하다.
 *
 * 🔴 **`= + - @`로 시작하면 앞에 홑따옴표를 붙인다.** 엑셀이 그런 칸을 **수식으로 읽는다** —
 * 메모 칸 플레이스홀더가 「예: 최신순 정렬 · 인기 상위 20개 제외」인데 사용자가 습관대로
 * 「- 최신순 정렬」이라고 적으면 그 칸이 `#NAME?`이 된다. BOM까지 붙여 엑셀에서 읽히게
 * 만든 파일이라 여기서 깨지면 대장을 만든 값이 없다 (주입 방어는 덤이다).
 */
function csvCell(v: string): string {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 업로드킷에 같이 나가는 출처 대장.
 *
 * **BOM을 붙인다** — 엑셀은 BOM이 없으면 UTF-8 CSV의 한글을 깨뜨린다. 이 파일을 실제로
 * 여는 도구가 엑셀이라 여기서 안 붙이면 대장이 통째로 안 읽힌다.
 */
export function assetLedgerCsv(rows: AssetLedgerRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push([
      r.id, r.title, r.sourceUrl, r.license, r.downloadedAt, r.hasFace, r.transform, r.note,
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ── 요청서·스킬에 실리는 문구 ─────────────────────────────────────

/**
 * 소싱 규칙 산문. 요청서(`MENU_B_RULES`)가 이걸 그대로 싣고, 스킬 문서는 같은 내용을
 * 사람 말로 옮겨 적는다 — **호스트 목록이 어긋나면 테스트가 잡는다**
 * (`assetPolicy.test.ts`가 `SKILL.md`를 대조한다).
 *
 * 🔴 **`sort=latest`·상위 20개 제외는 앱이 강제하지 못한다.** 검색은 브라우저에서
 * 일어나고 우리는 결과 파일만 받는다. 그래서 지시로만 남기고 **로그에는 사람이 적은
 * 주장으로** 기록한다 — 검증된 값인 척 스키마에 넣지 않는다.
 */
export function assetSourcingRules(): string {
  const allow = ASSET_SOURCE_WHITELIST.map((e) => `${e.label}(${e.host})`).join(' · ');
  const block = ASSET_SOURCE_BLACKLIST.map((e) => `${e.label}(${e.host})`).join(' · ');
  return [
    `- **짤방·스톡 소재는 무료 소재 사이트에서만 받는다**: ${allow}`,
    `- 🔴 **여기서는 받지 않는다**: ${block} — ${REASON_REDIST}`,
    '- 🔴 **식별 가능한 인물이 나오는 소재를 제품의 실패 사례·단점 씬에 쓰지 않는다.**',
    '  그 모델은 자기가 산 적도 없는 제품의 실패 사례 주인공이 된다 (초상권 분쟁 소지).',
    `  사람이 필요하면 얼굴이 안 나오는 컷이나 **AI로 만든 그림**을 쓰고, 그때는 출처에`,
    `  \`${AI_GENERATED}\`이라고 적는다 (받아온 페이지가 없다고 기록을 건너뛰면 거부된다)`,
    '- 소재를 고를 때는 **최신순으로 정렬하고 인기 상위 20개는 건너뛴다** — 상위 클립은 이미',
    '  수만 개 쇼츠에 들어가 있어 재사용 신호가 된다 (앱이 확인할 수 없으니 메모로 남긴다)',
    `- 고른 소재마다 **받은 페이지 주소를 그대로 적는다.** 직접 만든 것은 \`${SELF_MADE}\`,`,
    `  AI로 만든 것은 \`${AI_GENERATED}\`이다. 출처가 없으면 앱이 거부한다`,
    '- **식별 가능한 인물이 있는지(`hasFace`)를 반드시 표시한다.** 앱은 얼굴을 찾아주지 않는다 —',
    '  표시가 없으면 「안 봤음」으로 보고 막는다 (`false`는 「보고 없다고 판단했다」는 뜻이다)',
  ].join('\n');
}

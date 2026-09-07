import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import type { Product, ProductReviews } from '@shared/types';
import { loadSettings } from '../store/workspace.js';
import { findCrawlerRepo } from '../util/toolPath.js';

/**
 * 상품 페이지 수집 — 제품 정보와 구매자 리뷰.
 *
 * **규칙을 산문이 아니라 코드에 둔다.** 스킬 문서에 「robots를 확인하라」고 적어두면
 * 지키는 AI와 안 지키는 AI가 갈리고, 안 지킨 것을 아무도 모른다. robots 검사·요청 간격·
 * 공개 접근 사다리는 `tools/crawl/collect_product.py`가 강제하고, 주소 검사는 여기서 한다.
 *
 * ClipFlow(`C:\YouTube_Channels\clipflow`)의 `crawler.rs`에서 옮겨 왔다.
 */

const SCRIPT = fileURLToPath(new URL('../../../tools/crawl/collect_product.py', import.meta.url));

/** 수집 한 건의 상한. 브라우저 단계까지 올라가면 페이지 하나에 1분 넘게 걸린다 */
const TIMEOUT_MS = 180_000;

/** 결과 파일 크기 상한 — 이보다 크면 상품 페이지가 아니라 뭔가 잘못 받은 것이다 */
const MAX_RESULT_BYTES = 1_000_000;

/** `product.json`에 남길 리뷰 표본. 요청서 본문에 실리므로 무한정 넣을 수 없다 */
const MAX_QUOTES = 20;
const MAX_QUOTE_CHARS = 300;

export class CrawlError extends Error {}

/**
 * 공개 상품 주소인지 본다.
 *
 * 🔴 **주소는 사용자가 넣는다 — 서버가 그 주소로 요청을 보낸다.** 검사를 안 하면
 * `http://localhost:4310/...`이나 사설 IP를 넣어 **서버를 시켜 내부망을 두드리게** 할 수 있다.
 * 이 앱은 로컬에서 돌지만 같은 랜에 다른 기기가 있고, 어차피 상품 페이지는 공개 주소다.
 *
 * 조각(`#reviews`)은 떼어낸다 — 서버로 안 가는 부분이라 같은 페이지를 다른 주소로 만든다.
 */
export function validatePublicUrl(input: string): string {
  const raw = (input ?? '').trim();
  if (!raw || raw.length > 4096) {
    throw new CrawlError('상품 상세페이지 주소를 확인해 주세요.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CrawlError('상품 상세페이지 주소가 올바르지 않습니다.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new CrawlError('공개 http 또는 https 상품 주소를 입력해 주세요.');
  }
  if (isInternalHost(url.hostname)) {
    throw new CrawlError('내부 네트워크 주소에서는 상품 정보를 가져올 수 없습니다.');
  }
  url.hash = '';
  return url.toString();
}

/**
 * 내부망·루프백인가.
 *
 * IPv6는 대괄호를 벗기고 본다 (`URL.hostname`이 `[::1]`로 준다). 이름으로 오는 사설
 * 주소(`.local`·`.internal`)도 같이 막는다 — 숫자만 막으면 DNS 이름으로 그대로 뚫린다.
 */
function isInternalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (v4.slice(1).some((n) => Number(n) > 255)) return true; // 형식이 깨진 것도 안 보낸다
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||           // 링크로컬
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // 통신사 NAT
      a >= 224                              // 멀티캐스트·예약
    );
  }
  if (host.includes(':')) {
    // IPv6: 루프백·미지정·유니크로컬(fc00::/7)·링크로컬(fe80::/10)
    return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return false;
}

/** 이 PC에서 쓸 web-crawler 저장소와 파이썬 */
export async function crawlerPaths(): Promise<{ repo: string; python: string }> {
  const s = await loadSettings();
  const repo = await findCrawlerRepo(s.crawlerPath ?? '');
  const python = (s.crawlerPython ?? '').trim() || (repo ? defaultCrawlerPython(repo) : '');
  return { repo, python };
}

/** 가상환경 실행 파일 자리는 OS마다 다르다 — 윈도우만 `Scripts\python.exe`다 */
export function defaultCrawlerPython(repo: string): string {
  return process.platform === 'win32'
    ? path.join(repo, '.venv', 'Scripts', 'python.exe')
    : path.join(repo, '.venv', 'bin', 'python');
}

export interface CrawlResult {
  name: string;
  url: string;
  category: string;
  description: string;
  features: string[];
  reviews: string[];
  avgRating: string;
  reviewCount: string;
  price: string;
  fetcher: string;
  warnings: string[];
}

/**
 * 파이썬이 낸 실패를 사용자가 할 일로 바꾼다.
 *
 * 세 가지를 뭉뚱그리면 안 된다 — robots가 막은 것과 사이트가 봇을 막은 것은 사용자가
 * 취할 행동이 다르고, 앞의 것은 **기다린다고 풀리지 않는다.**
 */
export function crawlFailureMessage(stderr: string): string {
  if (stderr.includes('ROBOTS_BLOCKED')) {
    return '이 사이트의 robots.txt가 해당 상품 페이지 수집을 허용하지 않습니다. ' +
      '브라우저에서 페이지를 저장한 뒤 그 HTML 파일을 제품자료로 첨부해 주세요.';
  }
  /*
    🔴 robots.txt 자체가 403이면 「잠시 후 다시」가 아니다 — 규칙을 읽을 기회조차 안 주는
    자동 접근 차단이고, 기다린다고 안 풀린다 (2026-09-07 실측: 쿠팡). 이걸 일시적 오류와
    같은 문장으로 안내하면 사용자가 영원히 다시 누른다.
  */
  if (stderr.includes('ROBOTS_FORBIDDEN')) {
    return '이 사이트는 자동 접근을 막고 있습니다 (robots.txt조차 열어주지 않습니다). ' +
      '다시 시도해도 같습니다 — 브라우저에서 상품 페이지를 저장한 뒤 ' +
      '그 HTML 파일을 제품자료로 첨부해 주세요.';
  }
  if (stderr.includes('ROBOTS_UNKNOWN')) {
    return '사이트의 robots.txt를 확인하지 못해 수집을 시작하지 않았습니다. ' +
      '잠시 후 다시 시도하거나, 저장한 HTML 파일을 제품자료로 첨부해 주세요.';
  }
  if (stderr.includes('PUBLIC_FETCH_FAILED')) {
    return '공개 접근 방식으로는 상품이나 리뷰를 찾지 못했습니다. ' +
      '로그인·CAPTCHA·자동 접근 차단이 있는 사이트는 저장한 HTML 파일을 첨부해 주세요.';
  }
  if (/ModuleNotFoundError|No module named/.test(stderr)) {
    return '수집 런타임이 준비되지 않았습니다. web-crawler 저장소에서 ' +
      'scripts/setup.ps1(또는 bootstrap.py)을 먼저 실행해 주세요.';
  }
  const last = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  return `상품 정보를 가져오지 못했습니다. ${last}`.trim();
}

/**
 * 수집 실행. 원본 결과를 `outDir`에 남기고 파싱한 값을 돌려준다.
 *
 * 원본을 남기는 이유는 요약이 근거를 잃지 않게 하기 위해서다 — 잡의 `product/` 아래에
 * 두면 요청서가 첨부파일 목록에 자동으로 싣는다.
 */
export async function crawlProduct(rawUrl: string, outDir: string): Promise<CrawlResult> {
  const url = validatePublicUrl(rawUrl);
  const { repo, python } = await crawlerPaths();
  if (!repo || !python) {
    throw new CrawlError(
      '상품 수집 도구가 없습니다. web-crawler 저장소를 받아 셋업한 뒤 ' +
      '설정에서 그 폴더를 지정하거나, 이 저장소의 형제 폴더에 두세요.',
    );
  }
  if (!(await exists(python))) {
    throw new CrawlError(`수집에 쓸 파이썬을 찾지 못했습니다: ${python}`);
  }

  await fsp.mkdir(outDir, { recursive: true });
  const output = path.join(outDir, 'raw_data.json');

  try {
    /*
      execa를 직접 쓴다 — `run()`은 PATH에서 이름을 찾지만 여기 파이썬은 특정 가상환경의
      실행 파일이라 그대로 써야 한다. 표준입력은 닫는다(아무도 입력을 안 준다).
      cwd를 저장소로 잡아 그쪽 모듈이 import 경로에 들어오게 한다.
    */
    await execa(python, [SCRIPT, url, output], {
      cwd: repo,
      timeout: TIMEOUT_MS,
      stdin: 'ignore',
      // 한국어 윈도우 콘솔(cp949)은 중국어·이모지를 찍다 죽는다
      env: { PYTHONIOENCODING: 'utf-8' },
      reject: true,
    });
  } catch (e) {
    const err = e as { stderr?: string; shortMessage?: string; timedOut?: boolean };
    if (err.timedOut) {
      throw new CrawlError('상품 수집이 시간 안에 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.');
    }
    throw new CrawlError(crawlFailureMessage(err.stderr || err.shortMessage || String(e)));
  }

  const bytes = await fsp.readFile(output).catch(() => null);
  if (!bytes || !bytes.length || bytes.length > MAX_RESULT_BYTES) {
    throw new CrawlError('상품 수집 결과 크기가 올바르지 않습니다.');
  }
  let parsed: CrawlResult;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as CrawlResult;
  } catch {
    throw new CrawlError('상품 수집 결과 형식이 올바르지 않습니다.');
  }
  return parsed;
}

/**
 * 수집 결과 → `product.json`.
 *
 * 🔴 **사람이 적은 칸을 덮지 않는다.** 비어 있는 칸만 채운다 — 사용자가 손으로 고친
 * 제품명을 크롤러가 페이지 제목으로 되돌리면, 고쳐놓고 계속 옛 값으로 나간다.
 * 리뷰는 예외다: 그 칸은 수집이 소유하고, 다시 모으면 갈아 끼우는 것이 맞다.
 *
 * 🔴 **`praises`·`complaints`는 채우지 않는다.** 칭찬과 불만을 가르는 것은 판단이고,
 * 우리는 그 판단을 안 한다 — 「검사했다」는 잘못된 안심만 준다 (얼굴 검출과 같은 자리).
 * 원문을 `quotes`에 실어 보내고, 가르는 일은 대본·제품정보 추출 요청서가 한다.
 */
export function applyCrawl(prev: Product, crawled: CrawlResult, now = new Date()): Product {
  const reviews: ProductReviews = {
    count: crawled.reviews.length,
    avgRating: crawled.avgRating ?? '',
    praises: [],
    complaints: [],
    quotes: crawled.reviews.slice(0, MAX_QUOTES).map((r) => r.slice(0, MAX_QUOTE_CHARS)),
    source: crawlSource(crawled),
    collectedAt: now.toISOString().slice(0, 10),
  };
  return {
    ...prev,
    name: prev.name || crawled.name || '',
    price: prev.price || crawled.price || '',
    url: prev.url || crawled.url || '',
    category: prev.category || crawled.category || '',
    features: prev.features.length ? prev.features : crawled.features.slice(0, 20),
    reviews,
    extractedFrom: unique([...prev.extractedFrom, 'crawl/raw_data.json']),
  };
}

/**
 * 어디서 몇 개를 모았는지 한 줄.
 *
 * 이 칸이 비면 리뷰 0개가 **「불만이 없는 제품」으로 읽힌다.** 0개일 때도 어디를 봤는지는
 * 적는다 — 안 모은 것과 없는 것이 갈려야 한다.
 */
export function crawlSource(crawled: CrawlResult): string {
  const host = safeHost(crawled.url);
  const total = crawled.reviewCount ? ` (페이지 표기 ${crawled.reviewCount}개)` : '';
  return `${host} 상품페이지 ${crawled.reviews.length}개${total}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '알 수 없는 사이트';
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function exists(p: string): Promise<boolean> {
  return fsp.access(p).then(() => true, () => false);
}

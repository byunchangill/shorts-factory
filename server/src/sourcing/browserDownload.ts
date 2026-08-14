import fsp from 'node:fs/promises';
import pLimit from 'p-limit';
import { getContext } from './browser.js';
import { PLATFORMS } from './platforms.js';
import { VIDEO_PLATFORMS, type SourcePlatform } from './links.js';

/**
 * yt-dlp가 차단당하는 플랫폼은 브라우저로 받는다.
 *
 * 틱톡은 요청 주체를 지문으로 식별해 yt-dlp에게만 다른 응답을 준다 — 같은 PC·같은 IP에서
 * **브라우저의 쿠키를 그대로 넘겨도** 막힌다(2026-08-13 확인). 쿠키 문제가 아니라
 * 요청 주체 문제라 `--cookies`로는 풀리지 않는다.
 *
 * 반면 앱이 이미 검색에 쓰는 진짜 브라우저는 같은 페이지를 정상으로 받는다. 그래서
 * 그 컨텍스트로 페이지를 열어 재생 주소를 뽑고, 같은 컨텍스트의 요청기로 바이트를 받는다.
 * 지문·쿠키·Referer가 전부 브라우저 것이라 CDN이 거절할 이유가 없다.
 *
 * 여기 없는 플랫폼(유튜브 등)은 yt-dlp가 잘 받으므로 그대로 둔다.
 */
export const BROWSER_DOWNLOAD_PLATFORMS: readonly SourcePlatform[] = ['tiktok'];

/** 영상 주소가 어느 플랫폼 것인지 — 판별식은 platforms.ts 한 곳에만 둔다 */
export function platformOfUrl(url: string): SourcePlatform | null {
  return VIDEO_PLATFORMS.find((p) => PLATFORMS[p].videoHref.test(url)) ?? null;
}

export function needsBrowserDownload(url: string): boolean {
  const p = platformOfUrl(url);
  return !!p && BROWSER_DOWNLOAD_PLATFORMS.includes(p);
}

/**
 * 페이지에 심긴 JSON에서 실제 재생 주소를 뽑는다.
 *
 * 주소는 JSON 문자열 안에 있어 `/`가 `/`로, `&`가 `&`로 이스케이프돼 있다.
 * `playAddr`가 워터마크 없는 쪽이라 먼저 찾고, 없으면 `downloadAddr`로 물러선다.
 */
export function extractPlayAddr(html: string): string | null {
  const m = html.match(/"playAddr":"([^"]{20,})"/) ?? html.match(/"downloadAddr":"([^"]{20,})"/);
  if (!m) return null;
  const url = m[1]
    .replace(/\\u002f/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
  return url.startsWith('http') ? url : null;
}

/** 업로더 표기 — 저작권 체크리스트에 남는다. 주소의 @핸들이 가장 덜 흔들린다 */
export function uploaderFromUrl(url: string): string | undefined {
  return url.match(/\/@([^/?#]+)/)?.[1];
}

export interface BrowserDownloadResult {
  uploader?: string;
  bytes: number;
}

/**
 * 브라우저 다운로드는 **한 번에 하나씩**.
 *
 * 틱톡은 IP 단위로 속도를 제한한다 — 짧은 사이에 여러 번 열면 알맹이 없는 페이지를 준다
 * (2026-08-13 실측: 새 프로필을 매번 써도 연달아 3번째부터 막히고, 20초쯤 쉬면 풀린다).
 * 동시에 받으면 서로의 몫을 깎아먹어 전부 실패하므로 직렬로 세운다.
 * `getContext`의 캐시에 in-flight 잠금이 없어 동시 호출이 같은 프로필을 두 번 여는 문제도 함께 막는다.
 */
const oneAtATime = pLimit(1);

/*
  실측(2026-08-13, 같은 IP):
    - 쉰 상태에서는 첫 요청이 바로 성공한다
    - 연달아 두 건까지는 통과하고 세 건째부터 껍데기를 받는다
    - 가볍게 막히면 20초, 30분쯤 두드려 무겁게 막히면 5분을 쉬어야 풀렸다

  그래서 재시도보다 **간격을 두는 쪽**이 본질이다 — 애초에 제한을 건드리지 않으면
  기다릴 일도 없다. 재시도 간격은 무거운 차단까지 감안해 늘려 잡는다.
*/
const MIN_GAP_MS = 20_000;
const RETRY_WAITS_MS = [20_000, 60_000, 180_000];

/** 마지막 요청 시각 — 다음 요청은 여기서 MIN_GAP_MS 이상 떨어뜨린다 */
let lastRequestAt = 0;

async function paceRequests(): Promise<void> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** 페이지를 열어 재생 주소를 찾는다. 껍데기 페이지를 받으면 null */
async function findPlayAddr(platform: SourcePlatform, pageUrl: string): Promise<string | null> {
  const ctx = await getContext(platform);
  const page = await ctx.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // 재생 주소는 초기 HTML이 아니라 JS가 심는다 — 나타날 때까지 잠깐 기다린다
    await page
      .waitForFunction(
        () => /"(playAddr|downloadAddr)":"[^"]{20,}"/.test(document.documentElement.innerHTML),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {});
    return extractPlayAddr(await page.content());
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 브라우저로 영상 한 편을 받아 `destPath`에 저장한다.
 *
 * ponytail: 응답을 통째로 메모리에 담는다. 쇼츠 한 편은 수 MB라 문제없지만,
 * 긴 영상까지 받게 되면 스트리밍으로 바꿔야 한다 (Playwright 요청기는 스트리밍이 없어
 * 그때는 받은 주소를 yt-dlp에 넘기는 편이 낫다).
 */
export async function downloadViaBrowser(
  pageUrl: string,
  destPath: string,
): Promise<BrowserDownloadResult> {
  const platform = platformOfUrl(pageUrl);
  if (!platform) throw new Error(`브라우저로 받을 수 없는 주소입니다: ${pageUrl}`);

  return oneAtATime(async () => {
    for (let attempt = 0; ; attempt++) {
      await paceRequests();
      const playAddr = await findPlayAddr(platform, pageUrl);

      if (!playAddr) {
        const wait = RETRY_WAITS_MS[attempt];
        if (wait === undefined) {
          throw new Error(
            `영상 주소를 찾지 못했습니다 (${RETRY_WAITS_MS.length + 1}번 시도). 틱톡이 요청을 막고 `
            + '있습니다 — 몇 분 뒤 재시도하면 대개 받아집니다. 급하면 영상을 직접 받아 첨부하세요',
          );
        }
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      // 같은 컨텍스트의 요청기 — 쿠키와 지문을 브라우저와 공유한다. Referer가 없으면 CDN이 막는다
      const ctx = await getContext(platform);
      const resp = await ctx.request.get(playAddr, {
        headers: { referer: pageUrl },
        timeout: 180_000,
      });
      if (!resp.ok()) throw new Error(`영상 내려받기 실패: HTTP ${resp.status()}`);

      const body = await resp.body();
      if (body.length < 1024) throw new Error(`받은 파일이 너무 작습니다 (${body.length}바이트)`);
      await fsp.writeFile(destPath, body);

      return { uploader: uploaderFromUrl(pageUrl), bytes: body.length };
    }
  });
}

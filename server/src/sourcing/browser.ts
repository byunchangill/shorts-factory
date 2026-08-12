import path from 'node:path';
import fsp from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { WORKSPACE_ROOT } from '../store/workspace.js';
import type { SourcePlatform } from './links.js';

/**
 * 플랫폼별 브라우저 세션.
 *
 * 도우인·샤오홍슈·틱톡은 검색 결과를 JS로 그리고, 요청에 난독화된 JS로 만든 서명을
 * 붙인다. 그 서명을 우리가 재현할 방법은 없다 — 대신 **진짜 브라우저**를 띄우면
 * 브라우저가 알아서 만들어준다.
 *
 * 로그인은 사용자가 창에서 직접 한다(QR·SMS). 그 세션은 persistent context로
 * 디스크에 남아 다음 실행에도 이어진다.
 *
 * **세션 쿠키는 계정 접근권 그 자체다.** workspace/는 gitignore돼 있지만,
 * 리포를 클라우드 동기화 폴더에 두면 쿠키가 그대로 올라간다.
 */

/** 플랫폼별 사용자 데이터 폴더 — 쿠키·로컬스토리지가 여기 남는다 */
function profileDir(platform: SourcePlatform): string {
  return path.join(WORKSPACE_ROOT, 'browser', platform);
}

/**
 * 크롬 실행 파일 지정.
 * 비워두면 playwright가 받아둔 것을 쓴다. 이미 크롬이 깔려 있거나
 * playwright 버전과 브라우저가 어긋날 때 이 값으로 우회한다.
 */
function executablePath(): string | undefined {
  return process.env.SHORTS_CHROMIUM_PATH || undefined;
}

/** 사람이 쓰는 크롬처럼 보이게 — 기본값은 자동화 티가 크게 난다 */
const CONTEXT_OPTIONS = {
  viewport: { width: 1280, height: 900 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/**
 * 열려 있는 컨텍스트를 재사용한다.
 * persistent context는 같은 프로필 폴더를 두 번 열 수 없다 — 두 번째가 잠금 오류로 죽는다.
 */
const open = new Map<SourcePlatform, BrowserContext>();

export async function getContext(
  platform: SourcePlatform,
  opts: { headless?: boolean } = {},
): Promise<BrowserContext> {
  const existing = open.get(platform);
  if (existing) return existing;

  const dir = profileDir(platform);
  await fsp.mkdir(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: opts.headless ?? true,
    executablePath: executablePath(),
    args: ['--disable-blink-features=AutomationControlled'],
    ...CONTEXT_OPTIONS,
  });
  // navigator.webdriver를 지운다 — 가장 초보적인 자동화 탐지 신호다
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  ctx.on('close', () => open.delete(platform));
  open.set(platform, ctx);
  return ctx;
}

export async function closeContext(platform: SourcePlatform): Promise<void> {
  const ctx = open.get(platform);
  if (!ctx) return;
  open.delete(platform);
  await ctx.close().catch(() => {});
}

export async function closeAll(): Promise<void> {
  await Promise.all([...open.keys()].map(closeContext));
}

/** 저장된 세션 폐기 — 계정을 바꾸거나 이상해졌을 때 */
export async function clearSession(platform: SourcePlatform): Promise<void> {
  await closeContext(platform);
  await fsp.rm(profileDir(platform), { recursive: true, force: true });
}

export async function hasProfile(platform: SourcePlatform): Promise<boolean> {
  try {
    const entries = await fsp.readdir(profileDir(platform));
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** 브라우저(Chromium)가 설치돼 있는지 — 없으면 안내 문구가 필요하다 */
export async function browserInstalled(): Promise<boolean> {
  try {
    const b = await chromium.launch({ headless: true, executablePath: executablePath() });
    await b.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * 로그인 창을 띄우고 사용자가 끝낼 때까지 기다린다.
 *
 * QR 스캔·SMS 인증은 사람만 할 수 있다. 자동화하려 들지 않고 창을 넘긴다.
 * @param isLoggedIn 로그인 완료를 판정하는 함수 (플랫폼마다 다르다)
 */
export async function loginFlow(
  platform: SourcePlatform,
  loginUrl: string,
  isLoggedIn: (page: Page) => Promise<boolean>,
  timeoutMs = 5 * 60_000,
): Promise<boolean> {
  // 로그인은 눈으로 보면서 해야 하므로 창을 띄운다 (headless 아님)
  await closeContext(platform);
  const ctx = await getContext(platform, { headless: false });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) break;
    if (await isLoggedIn(page).catch(() => false)) {
      // 세션이 디스크에 flush되도록 컨텍스트를 닫는다
      await closeContext(platform);
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await closeContext(platform);
  return false;
}

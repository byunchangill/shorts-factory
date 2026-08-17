import path from 'node:path';
import { checkToolAny, checkIopaint } from './util/toolCheck.js';
import { loadSettings } from './store/workspace.js';
import { hasKey } from './store/secrets.js';
import { findKoreanFont } from './pipeline/fonts.js';
import { resolvePython, OCR_MODULE } from './pipeline/ocrDetect.js';
import { vsrProvider, vsrPaths } from './pipeline/vsr.js';
import { resolveBin } from './util/toolPath.js';
import { chromiumAvailable } from './sourcing/browser.js';

export interface DoctorReport {
  tools: Array<{
    name: string;
    required: boolean;
    available: boolean;
    version?: string;
    /** 이 PC에서 실제로 뽑힌 경로 — 도구가 여럿일 때 어느 것이 쓰이는지 여기서 본다 */
    path?: string;
    installHint: string;
  }>;
  ok: boolean; // 필수 도구 모두 사용 가능 여부
}

type ToolEntry = DoctorReport['tools'][number];

/**
 * 도구 점검은 외부 프로세스를 4개 띄우므로 요청마다 돌리면 느리다.
 * 캐시해두고 화면에서 명시적으로 새로고침할 때만 다시 돈다.
 *
 * 캐시 대상은 **외부 프로세스 점검 결과뿐**이다. API 키로 판정하는 항목은
 * 파일 한 번 읽으면 끝이고 사용자가 언제든 바꾸므로 매번 새로 본다
 * (타입캐스트 키를 등록했는데 도구 상태가 계속 "없음"으로 남던 문제).
 */
let cached: ToolEntry[] | null = null;
let cachedAt = 0;
let inFlight: Promise<ToolEntry[]> | null = null;
let generation = 0;

/**
 * 실패한 점검 결과의 수명.
 *
 * 부팅 직후처럼 시스템이 붐빌 때 프로세스 실행이 한 번 실패하면, 그 "미설치" 결과가
 * 영원히 캐시돼 설치돼 있는 도구를 계속 없다고 표시한다 (실제로 부팅 로그에
 * ❌ ffmpeg가 찍히고 새로고침하면 ✅로 바뀌는 것을 확인했다).
 * 성공한 결과는 도구를 새로 설치하기 전까지 바뀌지 않으므로 계속 들고 있는다.
 */
const FAILED_CACHE_MS = 30_000;

function cacheUsable(): boolean {
  if (!cached) return false;
  const allFound = cached.filter((t) => t.required).every((t) => t.available);
  return allFound || Date.now() - cachedAt < FAILED_CACHE_MS;
}

/**
 * 점검을 새로 시작한다.
 *
 * 늦게 끝난 점검이 그 뒤에 시작된 점검의 결과를 덮어쓰지 않도록 세대 번호로 거른다 —
 * 부팅 때 실패한 점검이 뒤늦게 도착해 방금 성공한 결과를 "없음"으로 되돌리면
 * 고치려던 증상이 그대로 재현된다.
 */
function startProbe(): Promise<ToolEntry[]> {
  const gen = ++generation;
  const p = probeTools().then(
    (r) => {
      if (gen === generation) {
        cached = r;
        cachedAt = Date.now();
        inFlight = null;
      }
      return r;
    },
    (e) => {
      if (gen === generation) inFlight = null;
      throw e;
    },
  );
  inFlight = p;
  return p;
}

export async function runDoctor(opts: { force?: boolean } = {}): Promise<DoctorReport> {
  let entries: ToolEntry[];
  if (opts.force) {
    // force는 "지금 다시 봐달라"는 뜻이다. 진행 중인 점검에 편승하면 그 점검이
    // 시작된 시점의 상태를 돌려주게 된다 — 부팅 직후 한 번 실패한 결과를 받고
    // 도구가 없는 줄 알던 문제가 여기서 나왔다 (npm run seed)
    entries = await startProbe();
  } else if (cacheUsable()) {
    entries = cached!;
  } else {
    // 동시에 여러 요청이 들어와도 실제 점검은 한 번만
    entries = await (inFlight ?? startProbe());
  }
  const tools = [...entries, ...(await keyTools())];
  return { tools, ok: tools.filter((t) => t.required).every((t) => t.available) };
}

/** 실행파일이 아니라 API 키로 판정하는 항목 — 캐시하지 않는다 */
async function keyTools(): Promise<ToolEntry[]> {
  return [{
    name: 'Typecast (음성)',
    required: false,
    available: await hasKey('typecast'),
    version: undefined,
    installHint: 'API 키 메뉴에서 등록 — 미등록 시 씬별 음성 파일을 직접 첨부해야 합니다',
  }];
}

/** 테스트용 — 모듈 캐시를 비운다 */
export function resetDoctorCache(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
  generation++;
}

/**
 * 버전 자리에 사용법 안내가 들어가는 것을 막는다.
 * `--help`로 확인한 도구는 첫 줄이 "Usage: ..."라 화면에 그대로 나가면 지저분하다.
 */
function cleanVersion(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t || t.length > 80 || /^usage[: ]/i.test(t)) return undefined;
  return t;
}

async function probeTools(): Promise<ToolEntry[]> {
  const s = await loadSettings();
  const checks = [
    {
      // ffmpeg 계열은 대시 하나짜리 -version 이다. --version 은 알 수 없는 옵션으로 실패하므로
      // 설치돼 있어도 "없음"으로 잘못 표시된다.
      name: 'ffmpeg', bin: s.ffmpegPath, versionArgs: [['-version']], required: true,
      installHint: 'https://ffmpeg.org/download.html 또는 winget install ffmpeg / brew install ffmpeg',
    },
    {
      name: 'ffprobe', bin: s.ffprobePath, versionArgs: [['-version']], required: true,
      installHint: 'ffmpeg에 포함되어 함께 설치됩니다',
    },
    {
      name: 'yt-dlp', bin: s.ytdlpPath, required: true, versionArgs: [['--version']],
      installHint: 'winget install yt-dlp.yt-dlp 또는 pip install yt-dlp (자주 깨지므로 주기적으로 yt-dlp -U)',
    },
    {
      // iopaint는 실행해 묻는 것 자체가 비싸다 (파이썬+torch). checkIopaint가
      // 절대경로면 파일만 보고 판정한다 — 2차 제거 쪽과 같은 판정을 써야 한다
      name: 'iopaint', bin: s.iopaintPath, required: false, check: checkIopaint,
      installHint: 'pip install iopaint (2차 AI 인페인팅용 — 선택. tools/install-inpaint.md 참조)',
    },
  ];

  // 어느 파이썬이 뽑혔는지도 같이 보여준다 — 파이썬이 여럿인 PC에서 "왜 없다고 나오지"의 답이 여기다
  const ocrPython = resolvePython(s, OCR_MODULE).catch(() => null);

  const tools = await Promise.all(
    checks.map(async (c) => {
      const r = c.check
        ? await c.check(c.bin)
        : await checkToolAny(c.bin, c.versionArgs ?? [['--version']]);
      return {
        name: c.name,
        required: c.required,
        available: r.available,
        version: cleanVersion(r.version),
        // 이름만 적어둬도 실제로는 PC마다 다른 파일이 뽑힌다. 그 자리를 감추지 않는다
        path: r.available ? await resolveBin(c.bin) : undefined,
        installHint: c.installHint,
      };
    }),
  );

  // 한글 폰트가 없으면 자막과 텍스트 카드의 한글이 네모로 깨진다
  const font = await findKoreanFont(s.fontPath);
  tools.push({
    name: '한글 폰트',
    required: true,
    available: !!font,
    version: font ? path.basename(font) : undefined,
    path: font ?? undefined,
    installHint:
      'Windows·macOS는 기본 탑재. Linux는 `apt install fonts-nanum` 또는 ' +
      '설정에서 폰트 파일 경로를 직접 지정하세요 (없으면 자막·카드의 한글이 깨집니다)',
  });

  // VSR은 실행해 물으면 torch를 통째로 올린다 — 자리에 있는지만 파일로 본다
  const vsr = await vsrPaths();
  tools.push({
    name: 'VSR (자막 제거)',
    required: false,
    available: await vsrProvider.available(),
    version: vsr.repo ? (s.vsrMode || undefined) : undefined,
    path: vsr.repo || undefined,
    installHint:
      '홈 폴더에 vsr(또는 video-subtitle-remover)로 받으면 자동으로 잡습니다. '
      + '다른 자리면 설정에서 폴더를 지정하세요 (선택 — 2차 제거의 1순위. '
      + '없으면 iopaint로, 그것도 없으면 1차 제거만으로 내려갑니다)',
  });

  // 틱톡은 yt-dlp로 못 받는다 — 이 브라우저가 없으면 그 플랫폼만 조용히 막힌다
  const browser = await chromiumAvailable();
  tools.push({
    name: '브라우저 (틱톡 소재 받기)',
    required: false,
    available: browser.available,
    version: undefined,
    path: browser.available ? browser.path : undefined,
    installHint:
      'npx playwright install chromium 을 한 번 실행하세요 '
      + '(선택 — 없으면 틱톡 소재만 못 받습니다. 다른 플랫폼은 yt-dlp가 받습니다)',
  });

  const python = await ocrPython;
  tools.push({
    name: '글자 검출 (자막 자리 자동 찾기)',
    required: false,
    available: !!python,
    version: undefined, // 파이썬 모듈이라 버전을 따로 보여주지 않는다
    path: python ?? undefined,
    installHint:
      `pip install rapidocr-onnxruntime (선택 — 없으면 자막 자리를 직접 드래그해야 합니다). `
      + '파이썬이 여러 개면 검출기가 깔린 것을 자동으로 고릅니다',
  });

  return tools;
}

import path from 'node:path';
import { checkToolAny, IOPAINT_VERSION_ARGS } from './util/toolCheck.js';
import { loadSettings } from './store/workspace.js';
import { hasKey } from './store/secrets.js';
import { findKoreanFont } from './pipeline/fonts.js';

export interface DoctorReport {
  tools: Array<{
    name: string;
    required: boolean;
    available: boolean;
    version?: string;
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

export async function runDoctor(opts: { force?: boolean } = {}): Promise<DoctorReport> {
  if (opts.force || !cacheUsable()) {
    // 동시에 여러 요청이 들어와도 실제 점검은 한 번만
    inFlight ??= probeTools().then(
      (r) => {
        cached = r;
        cachedAt = Date.now();
        inFlight = null;
        return r;
      },
      (e) => {
        inFlight = null;
        throw e;
      },
    );
    await inFlight;
  }
  const tools = [...cached!, ...(await keyTools())];
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
      // iopaint는 버전마다 CLI가 다르다 — --version이 없는 빌드가 있어서
      // 그것만 보고 판정하면 설치돼 있어도 "없음"이 된다 (실제로 그랬다).
      // --help는 어느 버전이든 0으로 끝나므로 마지막 확인 수단으로 쓴다.
      name: 'iopaint', bin: s.iopaintPath, required: false, versionArgs: IOPAINT_VERSION_ARGS,
      installHint: 'pip install iopaint (2차 AI 인페인팅용 — 선택. tools/install-inpaint.md 참조)',
    },
  ];

  const tools = await Promise.all(
    checks.map(async (c) => {
      const r = await checkToolAny(c.bin, c.versionArgs ?? [['--version']]);
      return {
        name: c.name,
        required: c.required,
        available: r.available,
        version: cleanVersion(r.version),
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
    installHint:
      'Windows·macOS는 기본 탑재. Linux는 `apt install fonts-nanum` 또는 ' +
      '설정에서 폰트 파일 경로를 직접 지정하세요 (없으면 자막·카드의 한글이 깨집니다)',
  });

  return tools;
}

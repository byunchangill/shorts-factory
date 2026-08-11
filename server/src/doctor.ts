import path from 'node:path';
import { checkTool } from './util/exec.js';
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

/**
 * 도구 점검은 외부 프로세스를 4개 띄우므로 요청마다 돌리면 느리다.
 * 캐시해두고 화면에서 명시적으로 새로고침할 때만 다시 돈다.
 */
let cached: DoctorReport | null = null;
let cachedAt = 0;
let inFlight: Promise<DoctorReport> | null = null;

/**
 * 실패한 점검 결과의 수명.
 *
 * 부팅 직후처럼 시스템이 붐빌 때 프로세스 실행이 한 번 실패하면, 그 "미설치" 결과가
 * 영원히 캐시돼 설치돼 있는 도구를 계속 없다고 표시한다 (실제로 부팅 로그에
 * ❌ ffmpeg가 찍히고 새로고침하면 ✅로 바뀌는 것을 확인했다).
 * 성공한 결과는 도구를 새로 설치하기 전까지 바뀌지 않으므로 계속 들고 있는다.
 */
const FAILED_CACHE_MS = 30_000;

export function cachedDoctor(): DoctorReport | null {
  return cached;
}

function cacheUsable(): boolean {
  if (!cached) return false;
  return cached.ok || Date.now() - cachedAt < FAILED_CACHE_MS;
}

export function runDoctor(opts: { force?: boolean } = {}): Promise<DoctorReport> {
  if (!opts.force && cacheUsable()) return Promise.resolve(cached!);
  // 동시에 여러 요청이 들어와도 실제 점검은 한 번만
  inFlight ??= probeAll().then(
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
  return inFlight;
}

/** 테스트용 — 모듈 캐시를 비운다 */
export function resetDoctorCache(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}

async function probeAll(): Promise<DoctorReport> {
  const s = await loadSettings();
  const checks = [
    {
      // ffmpeg 계열은 대시 하나짜리 -version 이다. --version 은 알 수 없는 옵션으로 실패하므로
      // 설치돼 있어도 "없음"으로 잘못 표시된다.
      name: 'ffmpeg', bin: s.ffmpegPath, versionArgs: ['-version'], required: true,
      installHint: 'https://ffmpeg.org/download.html 또는 winget install ffmpeg / brew install ffmpeg',
    },
    {
      name: 'ffprobe', bin: s.ffprobePath, versionArgs: ['-version'], required: true,
      installHint: 'ffmpeg에 포함되어 함께 설치됩니다',
    },
    {
      name: 'yt-dlp', bin: s.ytdlpPath, required: true, versionArgs: ['--version'],
      installHint: 'pip install yt-dlp 또는 winget install yt-dlp (자주 깨지므로 주기적으로 yt-dlp -U)',
    },
    {
      name: 'iopaint', bin: s.iopaintPath, required: false, versionArgs: ['--version'],
      installHint: 'pip install iopaint (2차 AI 인페인팅용 — 선택. tools/install-inpaint.md 참조)',
    },
  ];

  const tools = await Promise.all(
    checks.map(async (c) => {
      const r = await checkTool(c.bin, c.versionArgs ?? ['--version']);
      return {
        name: c.name,
        required: c.required,
        available: r.available,
        version: r.version,
        installHint: c.installHint,
      };
    }),
  );

  // 음성은 외부 실행파일이 아니라 API 키로 동작하므로 키 등록 여부로 표시한다
  tools.push({
    name: 'Typecast (음성)',
    required: false,
    available: await hasKey('typecast'),
    version: undefined,
    installHint: 'API 키 메뉴에서 등록 — 미등록 시 씬별 음성 파일을 직접 첨부해야 합니다',
  });

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

  return { tools, ok: tools.filter((t) => t.required).every((t) => t.available) };
}

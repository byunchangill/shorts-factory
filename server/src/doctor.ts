import { checkTool } from './util/exec.js';
import { loadSettings } from './store/workspace.js';
import { hasKey } from './store/secrets.js';

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

export async function runDoctor(): Promise<DoctorReport> {
  const s = await loadSettings();
  const checks = [
    {
      name: 'ffmpeg', bin: s.ffmpegPath, required: true,
      installHint: 'https://ffmpeg.org/download.html 또는 winget install ffmpeg / brew install ffmpeg',
    },
    {
      name: 'ffprobe', bin: s.ffprobePath, required: true,
      installHint: 'ffmpeg에 포함되어 함께 설치됩니다',
    },
    {
      name: 'yt-dlp', bin: s.ytdlpPath, required: true,
      installHint: 'pip install yt-dlp 또는 winget install yt-dlp (자주 깨지므로 주기적으로 yt-dlp -U)',
    },
    {
      name: 'iopaint', bin: s.iopaintPath, required: false,
      installHint: 'pip install iopaint (2차 AI 인페인팅용 — 선택. tools/install-inpaint.md 참조)',
    },
  ];

  const tools = await Promise.all(
    checks.map(async (c) => {
      const r = await checkTool(c.bin);
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

  return { tools, ok: tools.filter((t) => t.required).every((t) => t.available) };
}

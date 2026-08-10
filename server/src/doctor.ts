import { checkTool } from './util/exec.js';
import { loadSettings } from './store/workspace.js';

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
      name: 'edge-tts', bin: s.edgeTtsPath, required: true,
      installHint: 'pip install edge-tts',
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

  return { tools, ok: tools.filter((t) => t.required).every((t) => t.available) };
}

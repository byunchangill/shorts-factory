import path from 'node:path';
import type { Settings } from '@shared/types';
import { run } from '../util/exec.js';
import { ensureDir } from '../util/fsx.js';
import { findKoreanFont, filterFileArg, escapeDrawText } from './fonts.js';

/**
 * 텍스트 카드 생성 — 하이브리드 믹싱용.
 *
 * 남의 영상만 이어 붙이면 재사용 콘텐츠로 분류된다. 씬 사이에 직접 만든
 * 정보 카드를 끼워 넣으면 (1) 원본 소스의 연속 노출이 끊기고
 * (2) 정보 밀도가 올라가 시청 지속률에도 유리하다.
 */

const W = 1080;
const H = 1920;
const FPS = 30;

export type CardStyle = 'dark' | 'light' | 'accent';

const PALETTE: Record<CardStyle, { bg: string; fg: string; sub: string; bar: string }> = {
  dark: { bg: '#111827', fg: '#FFFFFF', sub: '#94A3B8', bar: '#2B7DE9' },
  light: { bg: '#F8FAFC', fg: '#0F172A', sub: '#475569', bar: '#2B7DE9' },
  accent: { bg: '#2B7DE9', fg: '#FFFFFF', sub: '#DBEAFE', bar: '#FACC15' },
};

export interface CardSpec {
  /** 큰 글씨 — 한 줄에 8~12자 권장 */
  headline: string;
  /** 작은 글씨 (선택) */
  sub?: string;
  style?: CardStyle;
  durationSec?: number;
}

/** 긴 문장을 카드 폭에 맞게 줄바꿈한다 (순수 함수 — 테스트 대상) */
export function wrapCardText(text: string, maxPerLine = 11, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  // 넘치면 마지막 줄에 말줄임
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxPerLine - 1)}…`;
  return kept;
}

/**
 * 카드 1장을 mp4로 렌더링한다.
 * 폰트가 없으면 한글이 깨지므로 null을 반환하고, 호출부가 카드를 건너뛴다.
 */
export async function renderCard(
  settings: Settings,
  spec: CardSpec,
  outPath: string,
): Promise<string | null> {
  const font = await findKoreanFont(settings.fontPath);
  if (!font) return null;

  const style = PALETTE[spec.style ?? 'dark'];
  const dur = spec.durationSec ?? 1.5;
  // 폰트는 파일명만 필터에 넣고, 폰트 폴더를 cwd로 잡는다 (윈도우 드라이브 콜론 회피)
  const fontRef = filterFileArg(font);
  const fontArg = fontRef.arg;

  const headLines = wrapCardText(spec.headline);
  const headSize = headLines.length >= 3 ? 92 : headLines.length === 2 ? 104 : 120;
  const lineGap = Math.round(headSize * 1.28);
  const blockTop = H / 2 - ((headLines.length - 1) * lineGap) / 2 - (spec.sub ? 60 : 0);

  const filters: string[] = [
    // 상단 강조 바 — 자기 브랜딩 레이어
    `drawbox=x=0:y=${Math.round(H * 0.22)}:w=${W}:h=10:color=${style.bar}@1:t=fill`,
  ];

  headLines.forEach((line, i) => {
    filters.push(
      `drawtext=fontfile='${fontArg}':text='${escapeDrawText(line)}':` +
      `fontcolor=${style.fg}:fontsize=${headSize}:x=(w-text_w)/2:y=${Math.round(blockTop + i * lineGap)}`,
    );
  });

  if (spec.sub) {
    const subLines = wrapCardText(spec.sub, 20, 2);
    subLines.forEach((line, i) => {
      filters.push(
        `drawtext=fontfile='${fontArg}':text='${escapeDrawText(line)}':` +
        `fontcolor=${style.sub}:fontsize=48:x=(w-text_w)/2:y=${Math.round(blockTop + headLines.length * lineGap + 40 + i * 62)}`,
      );
    });
  }

  await run(settings.ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${style.bg}:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(2)}`,
    '-vf', filters.join(','),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    outPath,
  ], { cwd: fontRef.cwd });
  return outPath;
}

/** 대본에서 카드로 쓸 만한 문구를 뽑는다 — 자막이 짧고 강한 씬을 고른다 */
export function suggestCards(scenes: Array<{ sceneId: string; subtitle: string }>): CardSpec[] {
  return scenes
    .filter((s) => s.subtitle && s.subtitle.length <= 20)
    .map((s) => ({ headline: s.subtitle, style: 'dark' as CardStyle, durationSec: 1.5 }));
}

export async function cardsDir(jobDir: string): Promise<string> {
  const dir = path.join(jobDir, 'cards');
  await ensureDir(dir);
  return dir;
}

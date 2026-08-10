/** SRT/ASS 자막 빌더 (순수 함수) */

export interface SubCue {
  start: number; // 초
  end: number;
  text: string;
}

export function formatSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(cues: SubCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

/**
 * 9:16 쇼츠용 스타일 ASS.
 * 하단 20% 안전영역(MarginV로 확보), 외곽선 굵게 — 밝은 배경에서도 가독성 유지.
 */
export function buildAss(
  cues: SubCue[],
  opts: { fontName?: string; fontSize?: number; playResX?: number; playResY?: number } = {},
): string {
  const { fontName = 'Noto Sans KR', fontSize = 64, playResX = 1080, playResY = 1920 } = opts;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H88000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,${Math.round(playResY * 0.2)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = cues
    .map((c) => {
      const text = c.text.replace(/\n/g, '\\N');
      return `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},Default,,0,0,0,,${text}`;
    })
    .join('\n');
  return header + events + '\n';
}

/** 자막 한 줄이 길면 18자 기준으로 줄바꿈 (한국어 가독성) */
export function wrapKorean(text: string, maxLen = 18): string {
  if (text.length <= maxLen) return text;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxLen && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

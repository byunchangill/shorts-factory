/** SRT/ASS 자막 빌더 (순수 함수) */
import type { Settings } from '@shared/types';

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
    .map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${plainText(c.text)}\n`)
    .join('\n');
}

/**
 * 줄바꿈된 자막을 **줄 단위 큐**로 쪼갠다 — 두 줄이 한꺼번에 뜨지 않고 차례로 지나간다.
 *
 * 씬 안의 낱말 단위 타이밍은 없다(합성 API가 씬 하나의 길이만 준다). 그래서 그 길이를
 * **글자 수 비례**로 나눠 갖는다 — 낭독 속도가 일정하다는 가정이라 실제와 거의 맞는다.
 * 마지막 줄은 계산 오차를 흡수해 씬 끝에 정확히 닿게 한다.
 */
export function splitLines(text: string, start: number, dur: number): SubCue[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [{ start, end: start + dur, text }];

  // 공백은 빼고 센다 — 낭독 시간은 음절 수를 따라가지 띄어쓰기를 따라가지 않는다
  const weights = lines.map((l) => Math.max(1, plainText(l).replace(/\s/g, '').length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return lines.map((line, i) => {
    const end = i === lines.length - 1 ? start + dur : t + (dur * weights[i]) / total;
    const cue = { start: t, end, text: line };
    t = end;
    return cue;
  });
}

/** 강조 표시(`*키워드*`)를 뗀 맨 글자 — SRT처럼 색을 못 싣는 곳에 쓴다 (캡컷 재료도 이걸 받는다) */
export function plainText(text: string): string {
  return text.replace(/\*(.+?)\*/g, '$1');
}

function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

/**
 * `#RRGGBB` → ASS 색. **ASS는 BGR 순서다** — 그대로 넣으면 빨강과 파랑이 뒤바뀐다.
 * 못 읽을 값이면 흰색으로 떨어뜨린다 (설정 화면에서 직접 칠 수 있는 칸이라 빈 값이 온다).
 */
export function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '&H00FFFFFF&';
  const [r, g, b] = [0, 2, 4].map((i) => m[1].slice(i, i + 2).toUpperCase());
  return `&H00${b}${g}${r}&`;
}

/**
 * 글자 크기는 폰트마다 다르다 — 같은 숫자라도 이송폭이 달라 한 줄이 넘치거나 남는다.
 * 기준은 레퍼런스 실측값(1080 기준 글자당 이송폭 ≈ 75px — 13자면 한 줄이 거의 꽉 찬다).
 */
const FONT_SIZE: Record<string, number> = { 'Noto Sans KR Black': 118 };
const FONT_SIZE_FALLBACK = 104;

/**
 * `*키워드*` → 그 부분만 강조색으로 (ASS 인라인 태그).
 * 줄바꿈을 건너뛰는 것(`[\s\S]`)이 중요하다 — 강조 구간이 줄바꿈에 걸리면 `.`으로는
 * 안 잡혀서 별표가 화면에 그대로 찍힌다 (실측으로 잡은 버그).
 */
export function assHighlight(text: string, highlight: string, body: string): string {
  return text.replace(/\*([\s\S]+?)\*/g, `{\\c${highlight}}$1{\\c${body}}`);
}

/**
 * 9:16 쇼츠용 스타일 ASS.
 *
 * 화면 **아래에서 35% 지점**에 굵은 흰 글씨 + 두꺼운 검정 외곽선, 그림자 없음.
 *
 * `WrapStyle: 1`은 **첫 줄부터 채우고 넘기기**다. 기본값 0은 두 줄 길이를 「균형 맞춰」
 * 나눠서 「여기 두지 / 마세요」처럼 구를 쪼갠다 — 한국어 자막에서는 문장이 끊겨 읽힌다.
 * 바닥이 아니라 중간 아래인 것은 쇼츠 UI(계정명·설명·버튼)가 하단을 덮기 때문이다.
 * 값은 잘 도는 쇼핑쇼츠 한 편을 프레임 단위로 재서 맞췄다 (2026-08-18).
 */
export interface AssStyle {
  fontName?: string;
  fontSize?: number;
  /** 화면 아래에서 띄우는 비율 (0~1) */
  bottomRatio?: number;
  outline?: number;
  color?: string;
  highlightColor?: string;
  playResX?: number;
  playResY?: number;
}

/** 설정 화면의 값 → 자막 스타일. 조립도 미리보기도 이 한 곳을 지난다 */
export function assStyleOf(
  s: Pick<Settings,
    'subtitleFontSize' | 'subtitleBottomRatio' | 'subtitleOutline' | 'subtitleColor' | 'subtitleHighlightColor'>,
  fontName: string,
): AssStyle {
  return {
    fontName,
    fontSize: s.subtitleFontSize,
    bottomRatio: s.subtitleBottomRatio,
    outline: s.subtitleOutline,
    color: s.subtitleColor,
    highlightColor: s.subtitleHighlightColor,
  };
}

export function buildAss(cues: SubCue[], opts: AssStyle = {}): string {
  const {
    fontName = 'Noto Sans KR',
    bottomRatio = 0.35,
    outline = 7,
    color = '#FFFFFF',
    highlightColor = '#FFD800',
    playResX = 1080,
    playResY = 1920,
  } = opts;
  const fontSize = opts.fontSize ?? FONT_SIZE[fontName] ?? FONT_SIZE_FALLBACK;
  const body = assColor(color);
  const highlight = assColor(highlightColor);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${body},${body},&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,30,30,${Math.round(playResY * bottomRatio)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = cues
    .map((c) => {
      const text = assHighlight(c.text, highlight, body).replace(/\n/g, '\\N');
      return `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},Default,,0,0,0,,${text}`;
    })
    .join('\n');
  return header + events + '\n';
}

/**
 * 자막 한 줄이 길면 줄바꿈.
 * 14자는 글자 크기에서 나온 값이다 — 118 크기로 14자면 1080 화면 폭을 거의 꽉 채운다.
 * 이보다 길게 두면 한 줄이 화면 밖으로 나간다.
 */
export function wrapKorean(text: string, maxLen = 14): string {
  // 길이는 **화면에 보이는 글자**로 센다 — 강조 표시(`*`)는 안 보이는데 세면 한 줄이 일찍 접힌다
  const len = (s: string) => plainText(s).length;
  if (len(text) <= maxLen) return text;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (len((cur + ' ' + w).trim()) > maxLen && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

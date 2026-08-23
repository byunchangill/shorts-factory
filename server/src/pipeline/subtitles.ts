/** SRT/ASS 자막 빌더 (순수 함수) */
import type { Settings } from '@shared/types';

export interface SubCue {
  start: number; // 초
  end: number;
  text: string;
  /**
   * `notice`는 나레이션 자막이 아니라 **화면 위쪽에 따로 앉는 고지**다 (쿠팡파트너스 공시).
   * 자리를 나누면 시간이 겹쳐도 안 포개지므로 나레이션 자막을 잘라낼 필요가 없다.
   */
  style?: 'default' | 'notice';
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
 * 고지(`notice`) 글자 크기와 자리.
 *
 * 🔴 **화면 아래로 내리지 않는다.** 쇼츠 UI(계정·설명·버튼)가 아래를 덮어 안 보이고,
 * `banded` 레이아웃에서는 하단 띠가 채널명을 쓰고 있다. 자막은 아래에서 35%에 앉으므로
 * **위에서 26%** 자리는 어느 레이아웃에서도 비어 있다 (상단 띠는 22%까지다).
 *
 * 크기가 자막(118)과 다르므로 **줄바꿈 폭도 이 크기로 잡아야 한다** — 자막 폭(13자)으로
 * 접으면 「쿠팡 / 파트너스」처럼 상호가 두 줄로 갈라진다 (하네스가 이걸 잡았다).
 */
export const NOTICE_SIZE = 40;
const NOTICE_TOP_RATIO = 0.26;

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

/**
 * 9:16 쇼츠용 스타일 ASS.
 *
 * 화면 **아래에서 35% 지점**에 굵은 흰 글씨 + 두꺼운 검정 외곽선, 그림자 없음.
 *
 * `WrapStyle: 1`은 **첫 줄부터 채우고 넘기기**다. 기본값 0은 두 줄 길이를 「균형 맞춰」
 * 나눠서 「여기 두지 / 마세요」처럼 구를 쪼갠다 — 한국어 자막에서는 문장이 끊겨 읽힌다.
 * 바닥이 아니라 중간 아래인 것은 쇼츠 UI(계정명·설명·버튼)가 하단을 덮기 때문이다.
 * 값은 잘 도는 쇼핑쇼츠 한 편을 프레임 단위로 재서 맞췄다 (2026-08-18).
 *
 * 스타일이 둘이다 — 나레이션 자막(`Default`)과 고지(`Notice`). 자리가 달라야 시간이
 * 겹쳐도 안 포개진다 (`NOTICE_TOP_RATIO` 참고).
 */
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
Style: Notice,${fontName},${NOTICE_SIZE},${body},${body},&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,8,40,40,${Math.round(playResY * NOTICE_TOP_RATIO)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = cues
    .map((c) => {
      const text = assHighlight(c.text, highlight, body).replace(/\n/g, '\\N');
      const style = c.style === 'notice' ? 'Notice' : 'Default';
      return `Dialogue: 0,${formatAssTime(c.start)},${formatAssTime(c.end)},${style},,0,0,0,,${text}`;
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
  /*
    🔴 **대본이 직접 넣은 줄바꿈이 우선이다** (2026-08-23).

    어디서 끊어야 자연스러운지는 문맥이 정한다 — 「낮에는 소파로 앉고 / 밤에는 침대로 쓰는 건데」
    처럼 연결어미에서 끊어야 읽힌다. 글자 수만 보는 기계는 그걸 못 가른다. 그래서 대본에
    `\n`이 있으면 그 자리를 그대로 지키고, **그 안에서 너무 긴 조각만** 폭에 맞춰 접는다.
  */
  if (text.includes('\n')) {
    /*
      대본이 고른 자리는 한 글자쯤 넘쳐도 그대로 둔다. 폭 추정에는 원래 여유가 있고,
      「두고 가는 경우도 있다고 함」을 억지로 쪼개면 대본이 잡은 뜻 단위가 깨진다.
      그보다 더 길면 화면 밖으로 나가므로 그때는 접는다.
    */
    return text
      .split('\n')
      .map((line) => {
        const t = line.trim();
        return plainText(t).length <= maxLen + 1 ? t : wrapKorean(t, maxLen);
      })
      .filter(Boolean)
      .join('\n');
  }

  // 길이는 **화면에 보이는 글자**로 센다 — 강조 표시(`*`)는 안 보이는데 세면 한 줄이 일찍 접힌다
  const len = (s: string) => plainText(s).length;
  if (len(text) <= maxLen) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return text;

  /*
    🔴 **앞줄부터 꽉 채우지 않는다** (2026-08-23).

    채워 넣기(greedy)는 마지막 줄에 한 어절만 남긴다 — 실측 자막에서 「의외였음」·「많더라」·
    「한다고 함」이 홀로 한 줄을 차지했다. 그 줄은 화면에 잠깐 뜨고 사라지는데 글자가 적어
    허전하고, 앞줄은 꽉 차 있어 균형이 깨진다.

    그래서 **줄 길이가 고르게** 되도록 나눈다. 줄 수는 채워 넣기로 구한 최소값을 그대로 쓰고
    (줄이 늘면 그만큼 자막이 빨리 넘어간다), 그 줄 수 안에서 「남는 칸의 제곱합」이 가장 작은
    배치를 고른다. 어절 중간은 자르지 않는다.
  */
  const w = words.map(len);
  const minLines = (() => {
    let lines = 1;
    let cur = 0;
    for (const n of w) {
      if (cur === 0) cur = n;
      else if (cur + 1 + n <= maxLen) cur += 1 + n;
      else { lines++; cur = n; }
    }
    return lines;
  })();

  // best[i][k] = 어절 i부터 k줄로 담을 때의 최소 벌점
  const INF = Infinity;
  const memo = new Map<string, { cost: number; cut: number }>();
  const solve = (i: number, k: number): { cost: number; cut: number } => {
    if (i >= words.length) return { cost: k === 0 ? 0 : INF, cut: i };
    if (k === 0) return { cost: INF, cut: i };
    const key = `${i}:${k}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let best = { cost: INF, cut: i + 1 };
    let lineLen = 0;
    for (let j = i; j < words.length; j++) {
      lineLen = j === i ? w[j] : lineLen + 1 + w[j];
      // 한 어절이 통째로 상한을 넘으면 자를 수 없다 — 그 줄만 넘치게 두고 계속한다
      if (lineLen > maxLen && j > i) break;
      /*
        **마지막 줄도 똑같이 벌한다.** 글 조판에서는 마지막 줄이 짧아도 자연스럽지만
        자막은 다르다 — 한 줄씩 차례로 뜨고 사라지므로 마지막 줄이 「함」 한 글자면
        그 순간 화면이 비어 보인다 (실측에서 그렇게 나왔다).
      */
      const slack = maxLen - lineLen;
      const penalty = slack * slack;
      const rest = solve(j + 1, k - 1);
      if (rest.cost === INF) continue;
      const cost = penalty + rest.cost;
      if (cost < best.cost) best = { cost, cut: j + 1 };
    }
    memo.set(key, best);
    return best;
  };

  const lines: string[] = [];
  let i = 0;
  for (let k = minLines; k > 0; k--) {
    const { cut } = solve(i, k);
    lines.push(words.slice(i, cut).join(' '));
    i = cut;
    if (i >= words.length) break;
  }
  // 안전망 — 위에서 다 못 담았으면 남은 어절을 마지막 줄에 붙인다
  if (i < words.length) lines.push(words.slice(i).join(' '));
  return lines.filter(Boolean).join('\n');
}

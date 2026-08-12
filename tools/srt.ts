/**
 * SRT 자막 파서.
 *
 * 샘플 심기가 자막을 대본 씬으로 옮길 때 쓴다.
 * 부수효과가 없어야 테스트에서 그냥 불러 쓸 수 있으므로 별도 파일로 둔다.
 */

export interface Cue {
  index: number;
  /** 초 */
  start: number;
  end: number;
  text: string;
}

/** `00:00:01,400` → 1.4 */
function parseTimestamp(s: string): number {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) throw new Error(`시간 형식 오류: ${s}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

export function parseSrt(raw: string): Cue[] {
  const cues: Cue[] = [];
  // 빈 줄로 나뉜 블록. 윈도우 줄바꿈(\r\n)도 같은 규칙으로 잘리도록 먼저 정규화한다
  for (const block of raw.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue; // 번호만 있고 잘린 블록
    const [from, to] = lines[timeIdx].split('-->');
    cues.push({
      index: cues.length + 1,
      start: parseTimestamp(from),
      end: parseTimestamp(to),
      // 두 줄로 나뉜 자막은 한 문장이다 — 나레이션으로는 이어 붙여야 한다
      text: lines.slice(timeIdx + 1).join(' ').trim(),
    });
  }
  return cues;
}

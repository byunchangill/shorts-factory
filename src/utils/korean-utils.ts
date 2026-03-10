/**
 * 한국어 유틸리티
 * - 단어 경계 매칭 (exact_keyword)
 * - 어간 추출
 * - 자막 분할
 * data-models-v6.md Fix #3, Fix #4 기반
 */

// ── 한국어 조사/어미/서술 패턴 (긴 것부터 매칭) ──
const ALLOWED_SUFFIXES = [
  // 3음절+
  '입니다', '이었다', '이니까', '이라도', '이지만', '됩니다',
  '에서는', '까지는', '부터는', '처럼은', '보다는',
  // 2음절
  '까지', '부터', '에서', '처럼', '보다', '마저', '조차', '밖에',
  '라고', '라서', '라면', '이라', '인데', '이고', '이며',
  '된다', '되는', '하는', '한다', '하고', '하며', '해서', '하면',
  // 1음절
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와',
  '과', '도', '만', '께', '랑', '님', '씨',
];

/**
 * 한국어 단어 경계 매칭 (exact_keyword)
 * 키워드 뒤에 허용된 조사/어미가 오면 매칭, 다른 한글이 이어지면 비매칭
 */
export function matchExactKeyword(sentence: string, keyword: string): boolean {
  let startIndex = 0;
  while (true) {
    const idx = sentence.indexOf(keyword, startIndex);
    if (idx === -1) return false;

    const afterIdx = idx + keyword.length;
    const rest = sentence.substring(afterIdx);

    // 키워드 뒤에 아무것도 없으면 → 매칭
    if (rest.length === 0) return true;

    // 키워드 뒤가 비한글 (공백, 문장부호, 숫자 등) → 매칭
    if (!/[가-힣]/.test(rest[0])) return true;

    // 키워드 뒤가 허용된 조사/어미로 시작 → 매칭
    let suffixMatched = false;
    for (const suffix of ALLOWED_SUFFIXES) {
      if (rest.startsWith(suffix)) {
        suffixMatched = true;
        break;
      }
    }
    if (suffixMatched) return true;

    // 한글이 이어지지만 허용 패턴이 아님 → 다른 단어 (비매칭)
    // 다음 위치에서 재검색
    startIndex = idx + 1;
  }
}

/**
 * 한국어 간이 어간 추출
 * "먹으" → "먹", "운동" → "운동", "드시" → "드시"
 */
export function extractKoreanVerbStem(captured: string): string | null {
  if (!captured || captured.length === 0) return null;

  // "~으"로 끝나면 제거 (받침 뒤 매개모음)
  if (captured.endsWith('으')) return captured.slice(0, -1);

  // 그 외는 그대로 반환 (명사형 동사 등)
  return captured;
}

/**
 * 한국어 자막 분할 (max_chars 기준)
 * 자연스러운 분할점: 조사/어미 뒤, 쉼표/마침표 뒤
 */
export function splitKorean(text: string, maxChars: number = 18): string[] {
  if (text.length <= maxChars) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    // maxChars 근처에서 자연스러운 분할점 찾기
    let splitPos = maxChars;

    // 쉼표, 마침표, 공백 우선
    for (let i = maxChars; i >= maxChars - 5 && i > 0; i--) {
      if (',. '.includes(remaining[i])) {
        splitPos = i + 1;
        break;
      }
    }

    // 그래도 못 찾으면 maxChars에서 자르기
    const line = remaining.substring(0, splitPos).trim();
    lines.push(line);
    remaining = remaining.substring(splitPos).trim();
  }

  if (remaining.length > 0) {
    lines.push(remaining);
  }

  return lines;
}

/**
 * SRT 타임코드 포맷
 */
export function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

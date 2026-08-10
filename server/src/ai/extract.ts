/**
 * LLM 응답 텍스트에서 산출물을 뽑아내는 순수 함수들.
 * 어떤 AI(Claude/GPT/Gemini/웹챗 복붙)든 응답 형태가 제각각이므로
 * 마크다운 펜스·설명문·여러 파일 블록을 모두 견디도록 만든다.
 */

/** ```json ... ``` 같은 코드펜스를 벗겨낸다 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * 텍스트에서 첫 번째 완전한 JSON 객체/배열을 찾아 파싱한다.
 * 문자열 리터럴 안의 괄호·이스케이프를 무시하며 깊이를 센다.
 */
export function extractJson(text: string): unknown {
  const source = stripFences(text);

  // 통째로 JSON인 경우 우선 시도
  try {
    return JSON.parse(source);
  } catch { /* 설명문이 섞인 경우 아래에서 스캔 */ }

  const startIdx = findFirstJsonStart(source);
  if (startIdx < 0) throw new Error('응답에서 JSON을 찾지 못했습니다');

  const open = source[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = source.slice(startIdx, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error('JSON이 완결되지 않았습니다 (응답이 잘렸을 수 있습니다)');
}

function findFirstJsonStart(text: string): number {
  const brace = text.indexOf('{');
  const bracket = text.indexOf('[');
  if (brace < 0) return bracket;
  if (bracket < 0) return brace;
  return Math.min(brace, bracket);
}

/**
 * 여러 산출물 파일을 한 응답에 담아온 경우, 파일명 헤더로 구간을 나눈다.
 * 인식하는 형태: `### script.json`, `## result/script.json`, `--- script.json ---`,
 * ```json title="script.json" 등. 매칭이 없으면 전체를 단일 파일로 본다.
 */
export function splitByFileHeaders(text: string, fileNames: string[]): Record<string, string> {
  if (fileNames.length <= 1) {
    return fileNames.length === 1 ? { [fileNames[0]]: text } : {};
  }

  const positions: Array<{ file: string; index: number }> = [];
  for (const file of fileNames) {
    // 파일명이 등장하는 첫 위치 (경로 접두사 result/ 허용)
    const pattern = new RegExp(`(?:result/)?${escapeRegex(file)}`, 'i');
    const m = text.match(pattern);
    if (m && m.index !== undefined) positions.push({ file, index: m.index });
  }
  positions.sort((a, b) => a.index - b.index);

  const out: Record<string, string> = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    out[positions[i].file] = text.slice(start, end);
  }
  // 못 찾은 파일은 전체 텍스트를 후보로 넘긴다 (파싱 단계에서 걸러짐)
  for (const file of fileNames) {
    if (!(file in out)) out[file] = text;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 산출물 명세에 따라 응답 텍스트를 파일별 최종 내용으로 변환한다.
 * markdown 스펙은 텍스트 그대로, 나머지는 JSON을 추출해 정규화한다.
 */
export function parseResultFiles(
  responseText: string,
  resultSpec: Array<{ file: string; schema: string }>,
): { files: Record<string, string>; errors: string[] } {
  const errors: string[] = [];
  const files: Record<string, string> = {};
  const chunks = splitByFileHeaders(responseText, resultSpec.map((s) => s.file));

  for (const spec of resultSpec) {
    const chunk = chunks[spec.file] ?? responseText;
    if (spec.schema === 'markdown') {
      files[spec.file] = stripMarkdownHeader(chunk, spec.file);
      continue;
    }
    try {
      files[spec.file] = JSON.stringify(extractJson(chunk), null, 2);
    } catch (e) {
      errors.push(`${spec.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { files, errors };
}

/** 마크다운 산출물에서 "### upload-kit.md" 같은 파일명 헤더 줄을 제거 */
function stripMarkdownHeader(text: string, fileName: string): string {
  const stripped = stripFences(text.trim());
  const lines = stripped.split('\n');
  if (lines[0] && lines[0].includes(fileName)) return lines.slice(1).join('\n').trim();
  return stripped;
}

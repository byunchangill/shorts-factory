import path from 'node:path';
import fsp from 'node:fs/promises';
import { RESULT_SCHEMAS, type Script } from '@shared/types';
import { charBudget, TARGET_SEC_BY_MENU, type AiProvider, type Menu } from '@shared/constants';
import { packetMenu, scriptRuleErrors } from '../claude/scriptRules.js';
import { REPO_ROOT, loadSettings } from '../store/workspace.js';
import { readPacket, writePacket, resolvePacketDir } from '../claude/packets.js';
import { runProvider } from './providers.js';
import { parseResultFiles, extractJson } from './extract.js';
import { broadcast } from '../sse.js';
import { ingestPacketResult } from '../claude/resultWatcher.js';
import { searchVideos } from '../youtube/research.js';
import { hasKey } from '../store/secrets.js';

/**
 * 고품질 모드 — 웹 화면에서 버튼 하나로 실행되는 다단계 파이프라인.
 *
 * Claude Code 에이전트 팀과 같은 흐름(리서치 → 대본 → 검수 → 재작성)을
 * 서버가 LLM API를 여러 번 호출해 재현한다. 터미널에 명령을 붙여넣지 않아도
 * 같은 품질 향상을 얻는 것이 목적이다.
 */

const QC_PASS_SCORE = 85;
const MAX_REWRITES = 2;

/** 바이럴 구조 지식은 스킬 참조 문서 하나만 두고 서버가 읽어 쓴다 (중복 방지) */
async function loadStructureKnowledge(): Promise<string> {
  const base = path.join(REPO_ROOT, '.claude', 'skills', 'shorts-viral-script', 'references');
  const parts: string[] = [];
  for (const file of ['structure-library.md', 'tone-guide.md']) {
    const text = await fsp.readFile(path.join(base, file), 'utf8').catch(() => '');
    if (text) parts.push(text);
  }
  return parts.join('\n\n---\n\n');
}

export interface QualityProgress {
  step: string;
  detail?: string;
}

function report(packetId: string, step: string, detail?: string): void {
  broadcast('packet.progress', { packetId, step, detail });
}

/** 1단계: 리서치 — 유튜브 키가 있으면 실제 경쟁 쇼츠를 조사한다 */
async function research(productHint: string, packetId: string): Promise<string> {
  if (!productHint || !(await hasKey('youtube'))) {
    return '(유튜브 리서치 생략 — API 키 미등록 또는 제품명 불명)';
  }
  report(packetId, 'research', `"${productHint}" 경쟁 쇼츠 조사 중`);
  try {
    const videos = await searchVideos({
      query: `${productHint} 리뷰`,
      shortsOnly: true,
      order: 'viewCount',
      publishedWithinDays: 180,
      maxResults: 20,
    });
    if (videos.length === 0) return '(검색 결과 없음)';
    const lines = videos.slice(0, 15).map(
      (v) => `- ${v.title} (${(v.viewCount / 10000).toFixed(1)}만회, ${v.durationSec}초)`,
    );
    return `실제 경쟁 쇼츠 상위 ${lines.length}편:\n${lines.join('\n')}`;
  } catch (e) {
    return `(리서치 실패: ${e instanceof Error ? e.message : String(e)})`;
  }
}

/** 요청서에서 제품명을 추정한다 — 리서치 검색어로 쓴다 */
function guessProduct(requestMd: string): string {
  const nameMatch = requestMd.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) return nameMatch[1];
  const titleMatch = requestMd.match(/^#\s*요청서.*\((.+?)\)/m);
  return titleMatch ? '' : '';
}

interface QcVerdict {
  score: number;
  pass: boolean;
  issues: string[];
}

/** 3단계: 검수 — 별도 호출로 채점시킨다. 같은 호출에서 쓰고 채점하면 후하게 준다 */
async function runQc(
  provider: AiProvider,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  requestMd: string,
  scriptJson: string,
  knowledge: string,
  budget: { min: number; recommended: number; max: number },
): Promise<QcVerdict> {
  const prompt = `너는 쇼핑쇼츠 대본 검수자다. 아래 대본을 냉정하게 채점하라.

[요청서 — 지침·제품정보·소재현황]
${requestMd}

[바이럴 구조 기준]
${knowledge.slice(0, 6000)}

[검수 대상 대본]
${scriptJson}

[배점 100점]
- 낭독 시간 20점: 나레이션 총 글자수가 ${budget.min}~${budget.max}자 범위 (${settings.speechRate}배속 기준 20~30초). 범위 밖이면 0점
- 훅 강도 20점: 첫 씬이 가격충격/질문/반전/문제상황/시연 중 하나. 설명형이면 0점
- 소재 정합성 20점: clipRef의 clipId가 요청서 소재현황 표에 실제로 있는가. 없으면 0점
- 나레이션/자막 분리 10점: 같은 문장이면 0점
- 지침 준수 15점: 요청서 지침 위반 항목당 -5
- CTA 10점: 마지막 씬에 구매 유도
- 구성 완결성 5점

[차단 항목 — 하나라도 걸리면 점수와 무관하게 pass=false]
- 허위·효능 과장: 무조건/100%/기적/완치/부작용 없음/반드시 효과
- 근거 없는 사양·수치 (요청서 제품정보에 없는 숫자)
- 원본 영상 문장 복제
※ "미친/환장하는/개쩌는/레전드" 같은 감정 표현은 차단 대상이 아니다. 말투의 온도는 허용된다.

JSON만 출력하라. 설명 금지.
{"score": 정수, "pass": true/false, "issues": ["씬ID: 무엇을 어떻게 고쳐야 하는지 구체적으로", ...]}`;

  const raw = await runProvider(provider, { prompt, settings, maxTokens: 2000 });
  try {
    const v = extractJson(raw) as QcVerdict;
    return {
      score: Number(v.score) || 0,
      pass: !!v.pass && Number(v.score) >= QC_PASS_SCORE,
      issues: Array.isArray(v.issues) ? v.issues.map(String) : [],
    };
  } catch {
    // 검수 응답을 못 읽으면 통과시키지 않는다 — 검증 없이 나가는 것보다 낫다
    return { score: 0, pass: false, issues: ['검수 응답을 해석하지 못했습니다'] };
  }
}

/** 산출물 스키마 검증 — 반영 전에 미리 잡는다 */
function validate(
  files: Record<string, string>,
  resultSpec: Array<{ file: string; schema: string }>,
  menu: Menu,
): string[] {
  const errors: string[] = [];
  for (const spec of resultSpec) {
    if (spec.schema === 'markdown') continue;
    const raw = files[spec.file];
    if (raw === undefined) { errors.push(`${spec.file} 누락`); continue; }
    const schema = RESULT_SCHEMAS[spec.schema];
    if (!schema) continue;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      errors.push(`${spec.file}: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')} — ${i.message}`).join('; ')}`);
    } else if (spec.schema === 'script') {
      errors.push(...scriptRuleErrors(parsed.data as Script, menu));
    }
  }
  return errors;
}

export async function runPacketQuality(packetId: string, provider: AiProvider): Promise<void> {
  const packet = await readPacket(packetId);
  if (!packet) throw new Error(`요청서 없음: ${packetId}`);
  if (packet.status !== 'waiting') throw new Error('대기 상태의 요청서만 실행할 수 있습니다');

  const dir = resolvePacketDir(packetId)!;
  const settings = await loadSettings();
  const requestMd = await fsp.readFile(path.join(dir, 'request.md'), 'utf8');
  const knowledge = await loadStructureKnowledge();
  const menu = packetMenu(packet);
  const budget = charBudget(settings.speechRate, menu);
  const target = TARGET_SEC_BY_MENU[menu];

  const outputSpec = packet.resultSpec
    .map((s) => `- \`${s.file}\`: ${s.schema === 'markdown' ? '마크다운 본문' : '유효한 JSON'}`)
    .join('\n');

  // 1단계 — 리서치
  const researchNote = await research(guessProduct(requestMd), packetId);

  // 2단계 — 대본 작성
  report(packetId, 'draft', '대본 작성 중');
  const basePrompt = `너는 대한민국 최고 수준의 쇼핑쇼츠 기획자다.
제품을 설명하지 말고 조회수 구조를 설계하라. 기능보다 감정, 정보보다 궁금증, 설명보다 반응이 먼저다.

${requestMd}

[경쟁 쇼츠 리서치]
${researchNote}

[조회수 구조 지식 — 실측 데이터 기반]
${knowledge}

[작성 원칙]
- 제목·첫 씬은 위 구조 라이브러리의 공식을 활용하되 문장은 새로 쓴다 (복제 금지)
- 첫 씬은 3초 훅. 인사·설명형으로 시작하지 않는다
- 짧은 문장 → 감탄 → 반전 → 리액션 → 추가 정보 리듬
- 광고처럼 느껴지면 실패다. "해당 제품은/장점은/추천드립니다/결론적으로" 사용 금지
- 감정 표현(미친, 환장하는, 레전드)은 허용. 단 효능·성능 허위 과장(무조건, 100%, 기적, 완치)은 금지
- **${target.max}초 이내로 끝낸다.** 나레이션 총 ${budget.min}~${budget.max}자 (권장 ${budget.recommended}자, ${settings.speechRate}배속 기준)
- 씬 4~5개, 씬당 35~45자. 반전은 1개에 집중하고 배경 설명은 넣지 않는다 — 훅 → 핵심 → 반전 → CTA
- 저장·댓글·공유·구매욕 포인트를 각각 넣는다${menu === 'menu-b' ? `
- **단점 씬 1개 필수.** 제품의 단점·주의사항을 말하는 씬을 넣고 \`"isDownside": true\`를 표시한다.
  지어내지 말고 제품 정보에서 근거를 찾는다. 단점 뒤에 그걸 덮는 마무리를 붙이지 않는다 —
  이 한 줄이 광고와 리뷰를 가르고, 없으면 반려된다` : ''}

[출력 형식]
파일을 만들 수 없는 환경이므로 산출물 내용을 응답 본문에 그대로 출력하라.
${outputSpec}
${packet.resultSpec.length > 1 ? '각 산출물 앞에 `### 파일명` 헤더를 붙여 구분하라.' : ''}
JSON은 파싱 가능한 형태여야 하며 설명 문장은 붙이지 마라.`;

  let prompt = basePrompt;
  let files: Record<string, string> = {};
  let lastVerdict: QcVerdict | null = null;

  for (let attempt = 0; attempt <= MAX_REWRITES; attempt++) {
    const response = await runProvider(provider, { prompt, settings });
    const parsed = parseResultFiles(response, packet.resultSpec);
    const schemaErrors = parsed.errors.length
      ? parsed.errors
      : validate(parsed.files, packet.resultSpec, menu);

    if (schemaErrors.length) {
      report(packetId, 'retry', `형식 오류 ${schemaErrors.length}건 — 재작성`);
      prompt = `${basePrompt}\n\n[이전 응답의 형식 오류 — 고쳐서 다시 출력]\n${schemaErrors.map((e) => `- ${e}`).join('\n')}`;
      files = parsed.files;
      continue;
    }

    files = parsed.files;

    // 3단계 — 검수
    const scriptFile = packet.resultSpec.find((s) => s.schema === 'script')?.file;
    if (!scriptFile || !files[scriptFile]) break; // 대본이 아닌 패킷은 검수 없이 통과

    report(packetId, 'qc', `검수 중 (${attempt + 1}회차)`);
    const verdict = await runQc(provider, settings, requestMd, files[scriptFile], knowledge, budget);
    lastVerdict = verdict;
    report(packetId, 'qc-result', `${verdict.score}점 ${verdict.pass ? '통과' : '반려'}`);

    if (verdict.pass) break;
    if (attempt === MAX_REWRITES) break;

    // 4단계 — 반려 반영 재작성
    prompt = `${basePrompt}

[검수 반려 — ${verdict.score}점. 아래를 반영해 다시 작성하라]
${verdict.issues.map((i) => `- ${i}`).join('\n')}

지적된 부분만 고치고, 지적되지 않은 부분은 유지하라.`;
  }

  if (Object.keys(files).length === 0) {
    throw new Error('AI 응답에서 산출물을 얻지 못했습니다');
  }

  // 산출물 기록 + 검수 이력 남기기
  const resultDir = path.join(dir, 'result');
  await fsp.mkdir(resultDir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(resultDir, file), content, 'utf8');
  }
  if (lastVerdict) {
    const note = [
      `# 검수 결과`,
      ``,
      `- 점수: ${lastVerdict.score}점 (통과 기준 ${QC_PASS_SCORE}점)`,
      `- 판정: ${lastVerdict.pass ? '통과' : '기준 미달 — 남은 지적사항 있음'}`,
      ``,
      ...(lastVerdict.issues.length ? ['## 지적 사항', ...lastVerdict.issues.map((i) => `- ${i}`)] : []),
      ``,
      `## 리서치`,
      researchNote,
    ].join('\n');
    await fsp.writeFile(path.join(resultDir, 'notes.md'), note, 'utf8');
  }

  const fresh = await readPacket(packetId);
  if (fresh) {
    fresh.executionMode = 'api';
    fresh.provider = provider;
    fresh.attempts = MAX_REWRITES + 1;
    await writePacket(fresh);
  }

  await fsp.writeFile(path.join(resultDir, '.done'), '', 'utf8');
  await ingestPacketResult(packetId);
}

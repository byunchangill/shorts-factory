#!/usr/bin/env node
/**
 * 쇼핑쇼츠 대본 기계 검사.
 * 손으로 세면 틀리는 항목(글자 수, 낭독 시간, 금칙어, 중복)을 계산한다.
 *
 * 사용: node check-script.mjs <script.json 경로>
 *
 * 훅 강도·소재 정합성·구성 흐름은 판단이 필요하므로 여기서 다루지 않는다.
 */
import { readFileSync } from 'node:fs';

/**
 * 한국어 TTS 정속 낭독 속도 — 분당 약 300자.
 * 실제 낭독 시간은 배속 설정에 따라 달라지므로 speechRate를 곱해 계산한다.
 * 배속은 workspace/settings.json에서 읽고, --rate 로 덮어쓸 수 있다.
 */
const CHARS_PER_MIN = 300;

/**
 * 메뉴별 목표 길이 — shared/constants.ts의 TARGET_SEC_BY_MENU와 같은 값을 유지한다.
 * 제품정보리뷰는 완주율 우선이라 더 짧게 끊는다.
 */
const TARGETS = {
  'menu-a': { min: 20, max: 30 },
  'menu-b': { min: 18, max: 26 },
};

/** 과장·단정 표현. 적발 시 점수와 무관하게 반려 */
const BANNED = [
  '무조건', '100%', '완벽', '기적', '완치', '즉시 해결', '부작용 없음',
  '최저가 보장', '유일한', '세계 최초', '반드시 효과', '영구', '평생',
];

/** 효능 단정 패턴 — "~에 좋다" 단정형은 완화 표현으로 바꿔야 한다 */
const STRONG_CLAIM = /(치료|완화)(된다|됩니다|해준다|해줍니다)|효과가 (있습니다|확실)/;

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
if (!path) {
  console.error('사용: node check-script.mjs <script.json 경로> [--rate 1.25]');
  process.exit(2);
}

/** 배속 결정: --rate > settings.json > 기본 1.25 */
function resolveRate() {
  const flagIdx = args.indexOf('--rate');
  if (flagIdx >= 0 && args[flagIdx + 1]) {
    const v = parseFloat(args[flagIdx + 1]);
    if (v > 0) return v;
  }
  for (const p of ['workspace/settings.json', '../workspace/settings.json']) {
    try {
      const s = JSON.parse(readFileSync(p, 'utf8'));
      if (typeof s.speechRate === 'number' && s.speechRate > 0) return s.speechRate;
    } catch { /* 다음 후보 */ }
  }
  return 1.25;
}
const RATE = resolveRate();
const charsPerSec = (CHARS_PER_MIN * RATE) / 60;

/** 메뉴 결정: --menu > 경로에서 유추 (workspace/menu-b/... 형태) > menu-a */
function resolveMenu() {
  const flagIdx = args.indexOf('--menu');
  if (flagIdx >= 0 && TARGETS[args[flagIdx + 1]]) return args[flagIdx + 1];
  const norm = path.replace(/\\/g, '/');
  if (/(^|\/)menu-b(\/|$)/.test(norm)) return 'menu-b';
  if (/(^|\/)menu-a(\/|$)/.test(norm)) return 'menu-a';
  return 'menu-a';
}
const MENU = resolveMenu();
const { min: MIN_SEC, max: MAX_SEC } = TARGETS[MENU];

let script;
try {
  script = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`❌ JSON 파싱 실패: ${e.message}`);
  process.exit(1);
}

const scenes = script.scenes ?? [];
if (scenes.length === 0) {
  console.error('❌ scenes가 비어 있습니다');
  process.exit(1);
}

const narrationTotal = scenes.reduce((s, sc) => s + (sc.narration ?? '').length, 0);
const estSec = narrationTotal / charsPerSec;

const problems = [];
const warnings = [];

// 1. 낭독 시간 (배속 반영)
const timeOk = estSec >= MIN_SEC && estSec <= MAX_SEC;
if (!timeOk) {
  const target = estSec > MAX_SEC ? MAX_SEC : MIN_SEC;
  const diffChars = Math.round((estSec - target) * charsPerSec);
  problems.push(
    `낭독 시간 ${estSec.toFixed(1)}초 (허용 ${MIN_SEC}~${MAX_SEC}초, ${RATE}배속 기준) — ` +
    `${diffChars > 0 ? `${diffChars}자 줄여야` : `${-diffChars}자 늘려야`} 합니다`,
  );
}

// 2. 금칙어
for (const scene of scenes) {
  const text = `${scene.narration ?? ''} ${scene.subtitle ?? ''}`;
  for (const word of BANNED) {
    if (text.includes(word)) problems.push(`${scene.sceneId}: 금칙어 "${word}"`);
  }
  if (STRONG_CLAIM.test(text)) {
    problems.push(`${scene.sceneId}: 효능 단정 표현 — "~에 도움이 될 수 있다"로 완화 필요`);
  }
}

// 3. 나레이션/자막 중복
for (const scene of scenes) {
  const n = (scene.narration ?? '').trim();
  const s = (scene.subtitle ?? '').trim();
  if (n && s && n === s) warnings.push(`${scene.sceneId}: 나레이션과 자막이 동일`);
  if (s.length > 25) warnings.push(`${scene.sceneId}: 자막 ${s.length}자 — 화면에서 잘릴 수 있음 (18자 내외 권장)`);
}

// 4. 씬 수와 분포
if (scenes.length < 4) warnings.push(`씬 ${scenes.length}개 — 4~7개 권장`);
if (scenes.length > 8) warnings.push(`씬 ${scenes.length}개 — 너무 잘게 나뉘어 산만할 수 있음`);

// 5. CTA (마지막 씬)
const last = `${scenes.at(-1).narration ?? ''} ${scenes.at(-1).subtitle ?? ''}`;
const hasCta = /링크|구매|고정댓글|더보기|확인해|프로필/.test(last);
if (!hasCta) problems.push('마지막 씬에 구매 유도(CTA)가 없습니다');

// 6. 단점 씬 (제품정보리뷰 전용)
// 여기서 볼 수 있는 건 "표시가 있느냐"까지다. 그 씬이 진짜 단점을 말하는지는 검수자가 읽고 판정한다.
if (MENU === 'menu-b') {
  const downsides = scenes.filter((s) => s.isDownside);
  if (downsides.length === 0) {
    problems.push('단점 씬이 없습니다 — 제품의 단점·주의사항 씬 1개에 "isDownside": true를 붙여야 합니다');
  } else {
    for (const s of downsides) {
      if ((s.narration ?? '').trim().length < 8) {
        problems.push(`${s.sceneId}: 단점 씬으로 표시됐지만 나레이션이 비어 있다시피 합니다`);
      }
    }
    warnings.push(
      `단점 씬 ${downsides.map((s) => s.sceneId).join(', ')} — 내용이 실제 단점인지 직접 읽고 판정하세요 ` +
      '(장점을 단점처럼 쓴 것·지어낸 단점·뒤에 덮는 문장은 반려)',
    );
  }
}

// 7. 소재 참조 형식 (존재 여부는 요청서와 대조 필요 — 여기선 형식만)
for (const scene of scenes) {
  const seg = scene.clipRef?.suggestedSegment;
  if (seg && seg.in >= seg.out) {
    problems.push(`${scene.sceneId}: 구간이 뒤집힘 (in ${seg.in} >= out ${seg.out})`);
  }
  if (!scene.clipRef && !scene.imagePrompt && !scene.imageRef) {
    warnings.push(`${scene.sceneId}: clipRef도 imagePrompt도 없음 — 조립 시 소재를 찾지 못함`);
  }
}

// ── 출력 ──
const line = '─'.repeat(52);
console.log(`\n${line}`);
console.log(`대본 기계 검사: ${script.title || '(제목 없음)'}`);
console.log(line);
console.log(`메뉴           ${MENU}${MENU === 'menu-b' ? ' (제품정보리뷰)' : ' (해외영상 짜집기)'}`);
console.log(`씬 수          ${scenes.length}개`);
console.log(`나레이션 총량  ${narrationTotal}자`);
// 상한은 내림·하한은 올림 — 반올림하면 경계에서 목표 시간을 넘긴다 (shared/constants.ts와 동일 규칙)
console.log(
  `낭독 배속      ${RATE}배 (${MIN_SEC}~${MAX_SEC}초 = ` +
  `${Math.ceil(MIN_SEC * charsPerSec)}~${Math.floor(MAX_SEC * charsPerSec)}자)`,
);
console.log(`예상 낭독      ${estSec.toFixed(1)}초  ${timeOk ? '적정' : '범위 밖'}`);
console.log(`\n씬별 분포`);
for (const sc of scenes) {
  const len = (sc.narration ?? '').length;
  const sec = (len / charsPerSec).toFixed(1);
  const ref = sc.clipRef?.clipId ?? (sc.imagePrompt ? '이미지' : '—');
  console.log(`  ${sc.sceneId}  ${String(len).padStart(3)}자 / ${String(sec).padStart(4)}초  ${ref}`);
}

if (problems.length) {
  console.log(`\n❌ 반려 사유 ${problems.length}건`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
}
if (warnings.length) {
  console.log(`\n⚠️  확인 필요 ${warnings.length}건`);
  warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
}
if (!problems.length && !warnings.length) {
  console.log('\n✅ 기계 검사 항목 모두 통과');
}

console.log(`\n${line}`);
console.log('※ 훅 강도·소재 정합성(실제 클립 존재 여부)·구성 흐름은 직접 판단하세요.');
console.log(line + '\n');

process.exit(problems.length ? 1 : 0);

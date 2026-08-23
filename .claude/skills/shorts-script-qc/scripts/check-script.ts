#!/usr/bin/env -S npx tsx
/**
 * 쇼핑쇼츠 대본 기계 검사.
 *
 * 🔴 **규칙을 여기 적지 않는다.** 교리 실격은 `shared/doctrine.ts`, 목표 길이·예산은
 * `shared/constants.ts`가 정한다 — 이 파일은 읽어서 보여줄 뿐이다. 규칙을 두 벌 두면
 * 반드시 어긋나는데, 앞선 판(`check-script.mjs`)이 목표 길이를 20~30초로 들고 있는 동안
 * 앱은 20~28초를 썼고 아무도 몰랐다.
 *
 * 사용: npx tsx check-script.ts <script.json 경로> [--rate 1.6] [--menu menu-b]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const load = async (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { syllableBudget, syllables, estimateSeconds, TARGET_SEC_BY_MENU } = await load('shared/constants.ts');
const { doctrineErrors, doctrineWarnings } = await load('shared/doctrine.ts');

/** 과장·단정 표현. 두 메뉴 공통이라 여기 남는다 (교리와 무관한 법적 요건) */
const BANNED = [
  '무조건', '100%', '완벽', '기적', '완치', '즉시 해결', '부작용 없음',
  '최저가 보장', '유일한', '세계 최초', '반드시 효과', '영구', '평생',
];
const STRONG_CLAIM = /(치료|완화)(된다|됩니다|해준다|해줍니다)|효과가 (있습니다|확실)/;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('사용: npx tsx check-script.ts <script.json 경로> [--rate 1.6] [--menu menu-b]');
  process.exit(2);
}

/** 배속: --rate > settings.json > 스키마 기본값 */
function resolveRate(): number {
  const i = args.indexOf('--rate');
  if (i >= 0 && args[i + 1]) {
    const v = parseFloat(args[i + 1]);
    if (v > 0) return v;
  }
  for (const p of ['workspace/settings.json', '../workspace/settings.json']) {
    try {
      const s = JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
      if (typeof s.speechRate === 'number' && s.speechRate > 0) return s.speechRate;
    } catch { /* 다음 후보 */ }
  }
  return 1.6;
}

function resolveMenu(): 'menu-a' | 'menu-b' {
  const i = args.indexOf('--menu');
  if (i >= 0 && (args[i + 1] === 'menu-a' || args[i + 1] === 'menu-b')) return args[i + 1];
  const norm = file!.replace(/\\/g, '/');
  return /(^|\/)menu-b(\/|$)/.test(norm) ? 'menu-b' : 'menu-a';
}

const RATE = resolveRate();
const MENU = resolveMenu();

let script: any;
try {
  script = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`❌ JSON 파싱 실패: ${(e as Error).message}`);
  process.exit(1);
}
const scenes: any[] = script.scenes ?? [];
if (scenes.length === 0) {
  console.error('❌ scenes가 비어 있습니다');
  process.exit(1);
}

const problems: string[] = [];
const warnings: string[] = [];

// 1. 교리 실격 — menu-a 전용. 서버가 반영을 거부하는 것과 같은 검사다
if (MENU === 'menu-a') {
  problems.push(...doctrineErrors(scenes, { speechRate: RATE, menu: MENU }));
  warnings.push(...doctrineWarnings(scenes));
}

const totalSyl = scenes.reduce((n, s) => n + syllables(s.narration ?? ''), 0);
const estSec = estimateSeconds(totalSyl, RATE);
const budget = syllableBudget(RATE, MENU);
const target = TARGET_SEC_BY_MENU[MENU];

// 2. menu-b는 교리를 안 쓰므로 길이를 여기서 본다 (menu-a는 doctrineErrors가 이미 봤다)
if (MENU === 'menu-b' && (estSec < target.min || estSec > target.max)) {
  const to = estSec > target.max ? target.max : target.min;
  const diff = Math.round((estSec - to) * (totalSyl / Math.max(estSec, 0.1)));
  problems.push(
    `낭독 시간 ${estSec.toFixed(1)}초 (허용 ${target.min}~${target.max}초, ${RATE}배속) — `
    + `${diff > 0 ? `${diff}음절 줄여야` : `${-diff}음절 늘려야`} 합니다`,
  );
}

// 3. 과장·단정 (두 메뉴 공통)
for (const scene of scenes) {
  const text = `${scene.narration ?? ''} ${scene.subtitle ?? ''}`;
  for (const word of BANNED) {
    if (text.includes(word)) problems.push(`${scene.sceneId}: 금칙어 "${word}"`);
  }
  if (STRONG_CLAIM.test(text)) {
    problems.push(`${scene.sceneId}: 효능 단정 표현 — "~에 도움이 될 수 있다"로 완화 필요`);
  }
}

// 4. 단점 씬 (제품정보리뷰 전용)
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
      `단점 씬 ${downsides.map((s) => s.sceneId).join(', ')} — 내용이 실제 단점인지 직접 읽고 판정하세요 `
      + '(장점을 단점처럼 쓴 것·지어낸 단점·뒤에 덮는 문장은 반려)',
    );
  }
}

// 5. 소재 참조 형식 (존재 여부는 요청서와 대조 필요 — 여기선 형식만)
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
console.log(`메뉴           ${MENU}${MENU === 'menu-b' ? ' (제품정보리뷰)' : ' (해외영상 짜집기 · 교리 v3.3)'}`);
console.log(`씬 수          ${scenes.length}개`);
console.log(`나레이션 총량  ${totalSyl}음절`);
console.log(`낭독 배속      ${RATE}배 (${target.min}~${target.max}초 = ${budget.min}~${budget.max}음절)`);
console.log(`예상 낭독      ${estSec.toFixed(1)}초  ${estSec >= target.min && estSec <= target.max ? '적정' : '범위 밖'}`);
console.log('\n씬별 분포');
for (const sc of scenes) {
  const n = syllables(sc.narration ?? '');
  const sec = estimateSeconds(n, RATE).toFixed(1);
  const ref = sc.clipRef?.clipId ?? (sc.imagePrompt ? '이미지' : '—');
  const block = sc.block ? `[${sc.block}]`.padEnd(10) : '[?]'.padEnd(10);
  console.log(`  ${sc.sceneId}  ${block} ${String(n).padStart(3)}음절 / ${String(sec).padStart(4)}초  ${ref}`);
}

if (problems.length) {
  console.log(`\n❌ 반려 사유 ${problems.length}건`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
}
if (warnings.length) {
  console.log(`\n⚠️  확인 필요 ${warnings.length}건`);
  warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
}
if (!problems.length && !warnings.length) console.log('\n✅ 기계 검사 항목 모두 통과');

console.log(`\n${line}`);
console.log('※ 훅 강도·② 손실의 무게·소재 정합성(실제 클립 존재 여부)은 직접 판단하세요.');
console.log(`${line}\n`);

process.exit(problems.length ? 1 : 0);

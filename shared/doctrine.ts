import {
  BLOCKS, BLOCK_LABELS, SYLLABLES_PER_MIN, TARGET_SEC_BY_MENU, syllableBudget, syllables,
  type Block, type Menu,
} from './constants.js';

export { BLOCKS, BLOCK_LABELS, type Block };

/**
 * 템캐스팅 대본 교리 v3.3 — 기계로 판정할 수 있는 실격 조건.
 *
 * 출처는 `docs/from-shopping-shorts/SCRIPT_FORMULA.md`(레퍼런스 10편 실측)이고,
 * 원본 검사기는 같은 폴더의 `check_script.py`다. **여기가 이 저장소의 단일 출처다** —
 * 서버(`scriptRuleErrors`)·QC 스크립트·하네스가 전부 이 파일을 부른다. 규칙을 두 벌 두면
 * 반드시 어긋난다 (실제로 `check-script.mjs`가 목표 길이를 20~30초로 오래 들고 있었다).
 *
 * 판정할 수 없는 것은 여기서 다루지 않는다 — 타인 감탄 클로징의 구매 여부, 사건 진실성,
 * 훅의 실제 강도는 사람(`shorts-qc`)이 읽고 본다.
 */

/** 발화 속도 밴드 (음절/초). 레퍼런스 6편 실측 6.64~8.00 */
export const SYL_PER_SEC = { min: 6.5, max: 8.0 } as const;

/** 자막 1장 상한 (음절). 넘으면 화면에서 두 줄로 감긴다 */
export const CAP_MAX_SYL = 16;

/**
 * 선행 구간(①②③) 절대 초수 — **비율이 아니다.**
 * 상위 4편(1,254만·197만·183만·143만)이 전부 선행 10~16초다.
 * 「선행을 잘라 제품을 빨리 꺼내는 게 유리하다」는 통념은 표본에서 지지되지 않는다.
 */
export function leadWindow(runSec: number): { min: number; max: number } {
  if (runSec < 20) return { min: 5, max: 8 };
  if (runSec < 24) return { min: 8, max: 12 };
  return { min: 12, max: 16 };
}

const BAD_QUESTION = /(하시나요|이신가요|하셨죠|고민이세요|세요\?|나요\?|가요\?|시죠\?)/;
const BAD_ADJ = ['꿀템', '역대급', '미친', '신박', '강추', '괴물', '끝판왕'];
const BAD_AD = ['지금 바로', '놓치지', '이런 분들께 추천', '필수템'];
/** 화자는 남자다 — 표본 10편 중 9편이 여성 화자라 그대로 베끼면 화자가 흔들린다 */
const FEMALE_TERMS = ['시어머니', '시누이', '시댁', '언니', '오빠', '남편'];
/**
 * 스펙 단위. 치수·하중·용량은 음성으로 읽지 않는다 — 설명란으로 뺀다.
 * 한글로 적어도 스펙은 스펙이라 「센치」·「킬로」도 같이 막는다.
 */
const SPEC_UNIT = /(cm|mm|kg|ml|리터|인치|센치|센티|밀리|킬로|와트)/i;
/**
 * 아라비아 숫자 자체를 막는다. 음성=자막이라 화면 글자가 곧 낭독인데
 * 「32」를 TTS가 어떻게 읽을지는 보장되지 않는다 — 허용된 손실 금액도 「삼십만 원」으로 적는다.
 */
const ARABIC_NUM = /\d/;
/** ② 손실 — 금전·시간·신체 중 하나는 반드시 있어야 한다 */
const LOSS_WORDS: Record<string, string[]> = {
  금전: ['견적', '보증금', '원상복구', '수리비', '업자', '만 원', '만원', '비용', '차감', '물어'],
  시간: ['대기', '몇 달', '두 달', '기다', '매번', '몇 분', '한참'],
  신체: ['허리', '손목', '무릎', '어깨', '삐끗'],
};

/** 종결어미 — 여기 안 걸리면 연결어미로 본다(문장이 이어져 낭독 리듬을 끊지 않는다) */
const ENDINGS = [
  '더라고요', '거든요', '습니다', 'ㅂ니다', '니다', '려고요', '고요', '는데요',
  '어요', '아요', '여요', '예요', '에요', '죠', '네요', '군요', '잖아요',
];

/** 문장의 종결어미. 연결어미로 끝나면 null */
export function endingOf(text: string): string | null {
  const t = text.trim().replace(/[^가-힣]+$/, '');
  return ENDINGS.find((e) => t.endsWith(e)) ?? null;
}

export interface DoctrineScene {
  sceneId: string;
  narration: string;
  subtitle: string;
  block?: Block;
  durationHint?: number;
}

export interface DoctrineOptions {
  speechRate: number;
  menu?: Menu;
  /** 훅에 새어 나오면 안 되는 말 — 제품명·브랜드. 없으면 그 검사만 건너뛴다 */
  productName?: string;
}

/** 씬 하나의 예상 길이 (초). durationHint가 있으면 그것이 진실이다 */
function sceneSec(scene: DoctrineScene, perSec: number): number {
  return scene.durationHint ?? syllables(scene.narration) / perSec;
}

/** 제품을 확정시키는 명사 — 제품명에서 뽑는다 (「무선 청소기」→ 「무선」·「청소기」) */
function spoilerWords(productName: string): string[] {
  return productName
    .split(/[\s()[\]/,·]+/)
    .map((w) => w.replace(/[^가-힣a-zA-Z]/g, ''))
    .filter((w) => w.length >= 2);
}

/**
 * 문장 하나에 걸리는 금지 어법 — 2인칭 질문형·평가 형용사·광고 어법·여성 호칭·스펙·숫자.
 *
 * 씬 구조와 무관하게 **글자만 보면 판정되는 것들**이라 따로 뽑아 뒀다.
 * 대본뿐 아니라 **제목에도 그대로 걸 수 있다** — 실제로 최하위작(563회·계속시청 12.4%)을
 * 가른 것은 나레이션이 아니라 제목의 2인칭 질문형이었다 (`golden.test.ts`).
 */
export function textStyleErrors(text: string, label = ''): string[] {
  const at = label ? `${label}: ` : '';
  const errors: string[] = [];
  if (BAD_QUESTION.test(text)) {
    errors.push(`${at}2인칭 질문형 — 최하위작(563회·계속시청 12.4%)의 형태입니다. 명령형은 허용됩니다`);
  }
  for (const w of BAD_ADJ) if (text.includes(w)) errors.push(`${at}평가 형용사 "${w}"`);
  for (const w of BAD_AD) if (text.includes(w)) errors.push(`${at}광고 어법 "${w}"`);
  for (const w of FEMALE_TERMS) {
    if (text.includes(w)) errors.push(`${at}여성 화자 호칭 "${w}" — 화자는 남자입니다`);
  }
  const spec = text.match(SPEC_UNIT);
  if (spec) {
    errors.push(`${at}스펙 단위 "${spec[0]}" — 치수·하중은 음성으로 읽지 않습니다 (설명란으로 빼세요)`);
  }
  if (ARABIC_NUM.test(text)) {
    errors.push(`${at}숫자를 그대로 적었습니다 — 한글로 풀어 쓰세요 (30만 원 → 삼십만 원)`);
  }
  return errors;
}

/**
 * 실격 조건을 전수 검사한다. 빈 배열 = 통과.
 *
 * 하나라도 걸리면 요청서 반영이 거부된다 — 교리가 「3회 재작성 후에도 미달이면
 * 제품 부적합」이라고 말하는 그 게이트다.
 */
export function doctrineErrors(scenes: DoctrineScene[], opts: DoctrineOptions): string[] {
  const errors: string[] = [];
  if (scenes.length === 0) return ['씬이 없습니다'];

  const menu = opts.menu ?? 'menu-a';
  const perSec = (SYLLABLES_PER_MIN * opts.speechRate) / 60;
  const budget = syllableBudget(opts.speechRate, menu);
  const target = TARGET_SEC_BY_MENU[menu];
  const all = scenes.map((s) => s.narration).join(' ');

  // 1. 음성 = 자막. 자막을 이어 붙이면 원문이 남김없이 복원돼야 한다
  for (const s of scenes) {
    const said = s.narration.replace(/[^가-힣0-9a-zA-Z]/g, '');
    const shown = s.subtitle.replace(/[^가-힣0-9a-zA-Z]/g, '');
    if (!shown) {
      errors.push(`${s.sceneId}: 자막이 비었습니다 — 음성=자막이라 전 문장이 자막으로 나갑니다`);
    } else if (said !== shown) {
      errors.push(`${s.sceneId}: 음성≠자막\n      말: ${s.narration}\n      글: ${s.subtitle}`);
    }
  }

  // 2. 자막 1장 16음절
  for (const s of scenes) {
    for (const line of s.subtitle.split('\n')) {
      const n = syllables(line);
      if (n > CAP_MAX_SYL) {
        errors.push(`${s.sceneId}: 자막 1장 ${n}음절(상한 ${CAP_MAX_SYL}): ${line.trim()}`);
      }
    }
  }

  // 3. 러닝타임·총 음절·발화 속도
  const totalSyl = scenes.reduce((n, s) => n + syllables(s.narration), 0);
  const runSec = scenes.reduce((t, s) => t + sceneSec(s, perSec), 0);
  if (runSec < target.min || runSec > target.max) {
    errors.push(`러닝타임 ${runSec.toFixed(1)}초 — ${target.min}~${target.max}초여야 합니다`);
  }
  if (totalSyl < budget.min || totalSyl > budget.max) {
    errors.push(`총 ${totalSyl}음절 — ${opts.speechRate}배속 예산은 ${budget.min}~${budget.max}음절입니다`);
  }
  const spb = totalSyl / Math.max(runSec, 0.1);
  if (spb < SYL_PER_SEC.min || spb > SYL_PER_SEC.max) {
    errors.push(
      `발화 속도 ${spb.toFixed(2)}음절/초 — ${SYL_PER_SEC.min}~${SYL_PER_SEC.max} 밖입니다 `
      + '(배속을 바꾸거나 분량을 조절하세요)',
    );
  }

  // 4. 5블록 — 표시가 없으면 선행 구간을 잴 수 없다
  if (!scenes.some((s) => s.block)) {
    errors.push('블록 표시가 없습니다 — 씬마다 "block"에 hook/loss/source/product/closing 중 하나를 넣습니다');
  } else {
    for (const need of ['hook', 'loss', 'product', 'closing'] as Block[]) {
      if (!scenes.some((s) => s.block === need)) errors.push(`${BLOCK_LABELS[need]} 블록이 없습니다`);
    }
    // 선행 구간(①②③)은 절대 초수다
    const lead = scenes
      .filter((s) => s.block === 'hook' || s.block === 'loss' || s.block === 'source')
      .reduce((t, s) => t + sceneSec(s, perSec), 0);
    const win = leadWindow(runSec);
    if (lead < win.min || lead > win.max) {
      errors.push(
        `선행 구간(①②③) ${lead.toFixed(1)}초 — 러닝타임 ${runSec.toFixed(0)}초면 `
        + `${win.min}~${win.max}초여야 합니다`,
      );
    }
    // ② 손실 — 금전·시간·신체 중 하나
    const lossText = scenes.filter((s) => s.block === 'loss').map((s) => s.narration).join(' ');
    const found = Object.values(LOSS_WORDS).some((words) => words.some((w) => lossText.includes(w)));
    if (lossText && !found) {
      errors.push('② 손실 블록에 금전·시간·신체 손실이 없습니다 — 100만 이상 상위 4편이 전부 금전 손실입니다');
    }
    // ①②③에는 제품을 확정시키는 말을 넣지 않는다
    if (opts.productName) {
      const before = scenes.filter((s) => s.block && s.block !== 'product' && s.block !== 'closing');
      for (const w of spoilerWords(opts.productName)) {
        const hit = before.find((s) => s.narration.includes(w));
        if (hit) errors.push(`${hit.sceneId}: 공개(④) 전에 제품을 확정시키는 말이 있습니다: "${w}"`);
      }
    }
  }

  // 5. 금지 어법
  for (const s of scenes) errors.push(...textStyleErrors(s.narration, s.sceneId));

  // 6. 문체 — 어미를 번갈아 놓는다. AI 티의 실체다
  const drCount = (all.match(/더라고요/g) ?? []).length;
  if (drCount < 2) errors.push(`~더라고요 ${drCount}회 — 편당 2회 이상입니다 (표본 9/10편)`);
  const endings = scenes.map((s) => endingOf(s.narration));
  for (let i = 1; i < endings.length; i++) {
    if (endings[i] && endings[i] === endings[i - 1]) {
      errors.push(`${scenes[i].sceneId}: 앞 씬과 같은 어미로 끝납니다 ("${endings[i]}") — 낭독체가 됩니다`);
    }
  }
  let streak = 0;
  for (const e of endings) {
    streak = e ? streak + 1 : 0;
    if (streak >= 3) {
      errors.push('종결어미가 3문장 연속입니다 — 사이에 연결어미를 넣어 말이 흐르게 하세요');
      break;
    }
  }
  const kinds = new Set(endings.filter(Boolean));
  if (scenes.length >= 4 && kinds.size < 4) {
    errors.push(`어미 종류가 ${kinds.size}가지뿐입니다 — 4가지 이상이어야 사람 말이 됩니다`);
  }

  return errors;
}

/** 실격은 아니지만 사람이 봐야 하는 것 */
export function doctrineWarnings(scenes: DoctrineScene[]): string[] {
  const warnings: string[] = [];
  const all = scenes.map((s) => s.narration).join(' ');
  const drCount = (all.match(/더라고요/g) ?? []).length;
  if (drCount > 3) warnings.push(`~더라고요 ${drCount}회 — 3회를 넘으면 그 어미 자체가 티가 납니다`);
  if (!scenes.some((s) => s.block === 'source')) {
    warnings.push('③ 정보원이 없습니다 — 선택 블록이지만 표본 5편이 이 구조입니다');
  }
  return warnings;
}

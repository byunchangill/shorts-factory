/**
 * health-compliance.ts 단위 테스트
 * checkSentence, rewriteSentence, checkScript
 * config/health_compliance.json 실제 파일 로드
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadComplianceConfig,
  checkSentence,
  checkScript,
} from '../utils/health-compliance.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_DIR = join(__dirname, '..', '..'); // src/__tests__ → project root

let config: ReturnType<typeof loadComplianceConfig>;

beforeAll(() => {
  config = loadComplianceConfig(PROJECT_DIR);
});

// ─────────────────────────────────────────────
// checkSentence — contains_keyword 규칙
// ─────────────────────────────────────────────
describe('checkSentence — contains_keyword (absolute_cure)', () => {
  it('"완치" 포함 문장 → violation 발생', () => {
    const result = checkSentence('이 방법으로 완치가 가능합니다', 'scene_01', config);
    expect(result.isClean).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].ruleId).toBe('absolute_cure');
  });

  it('"100% 효과" 포함 문장 → violation 발생', () => {
    const result = checkSentence('100% 효과가 보장됩니다', 'scene_01', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('absolute_cure');
  });

  it('"기적의 치료" 포함 → violation 발생', () => {
    const result = checkSentence('기적의 치료법을 소개합니다', 'scene_01', config);
    expect(result.isClean).toBe(false);
  });

  it('안전한 문장 → violation 없음', () => {
    const result = checkSentence('비타민C는 면역력에 도움이 될 수 있습니다', 'scene_01', config);
    expect(result.isClean).toBe(true);
    expect(result.violations.length).toBe(0);
  });
});

describe('checkSentence — contains_keyword (conspiracy)', () => {
  it('"의사가 숨기는" → violation', () => {
    const result = checkSentence('의사가 숨기는 건강 비법을 공개합니다', 'scene_02', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('conspiracy');
  });

  it('"제약회사가 감추는" → violation', () => {
    const result = checkSentence('제약회사가 감추는 사실이 있습니다', 'scene_02', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('conspiracy');
  });
});

// ─────────────────────────────────────────────
// checkSentence — template 규칙
// ─────────────────────────────────────────────
describe('checkSentence — template (diagnosis_pattern)', () => {
  it('"당신은 당뇨입니다" → violation + 자동 재작성', () => {
    const result = checkSentence('당신은 당뇨입니다', 'scene_03', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('diagnosis_pattern');
    // 자동 재작성 생성 여부
    expect(result.autoFixes.length).toBeGreaterThan(0);
    const fix = result.autoFixes[0];
    expect(fix.rewritten).toContain('전문의 상담');
  });

  it('"이 증상이면 고혈압입니다" → violation', () => {
    const result = checkSentence('이 증상이면 고혈압입니다', 'scene_03', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('diagnosis_pattern');
  });
});

describe('checkSentence — template (treatment_directive)', () => {
  it('"반드시 복용하세요" → violation + verb_stem_rewrite', () => {
    // 템플릿: "반드시 ${action}하세요" → action=복용 캡처
    const result = checkSentence('반드시 복용하세요', 'scene_04', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('treatment_directive');
  });

  it('"지금 당장 운동하세요" → violation', () => {
    const result = checkSentence('지금 당장 운동하세요', 'scene_04', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('treatment_directive');
  });
});

// ─────────────────────────────────────────────
// checkSentence — exact_keyword 규칙
// ─────────────────────────────────────────────
describe('checkSentence — exact_keyword (exaggeration)', () => {
  it('"기적입니다" → violation (조사 뒤 → 매칭)', () => {
    const result = checkSentence('이것은 기적입니다', 'scene_05', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('exaggeration');
  });

  it('"마법처럼" → violation (조사 처럼 → 매칭)', () => {
    const result = checkSentence('마법처럼 효과가 좋습니다', 'scene_05', config);
    expect(result.isClean).toBe(false);
    expect(result.violations[0].ruleId).toBe('exaggeration');
  });

  it('"기적적인" → violation 없음 (다른 단어 → 비매칭)', () => {
    const result = checkSentence('기적적인 회복이 있었습니다', 'scene_05', config);
    // "기적적인"은 "기적" + "적인" → 비매칭
    const exaggerationViolations = result.violations.filter(v => v.ruleId === 'exaggeration');
    expect(exaggerationViolations.length).toBe(0);
  });

  it('"마법사" → violation 없음 (다른 단어)', () => {
    const result = checkSentence('마법사처럼 멋진', 'scene_05', config);
    // "마법사"는 "마법" + "사" → 비매칭
    const exaggerationViolations = result.violations.filter(v => v.ruleId === 'exaggeration');
    expect(exaggerationViolations.length).toBe(0);
  });

  it('keyword_swap 재작성 — "기적" → "주목할 만한"', () => {
    const result = checkSentence('이것은 기적입니다', 'scene_05', config);
    const fix = result.autoFixes.find(f => f.ruleId === 'exaggeration');
    expect(fix).toBeDefined();
    expect(fix!.rewritten).toContain('주목할 만한');
  });

  it('keyword_swap — "만병통치" → "다양한 건강 이점이 알려진"', () => {
    const result = checkSentence('만병통치 효과가 있습니다', 'scene_05', config);
    const fix = result.autoFixes.find(f => f.ruleId === 'exaggeration');
    expect(fix).toBeDefined();
    expect(fix!.rewritten).toContain('다양한 건강 이점이 알려진');
  });
});

// ─────────────────────────────────────────────
// checkSentence — 깨끗한 문장들
// ─────────────────────────────────────────────
describe('checkSentence — 안전한 표현 (violations 없음)', () => {
  const safeSentences = [
    '비타민C는 면역력에 도움이 될 수 있습니다',
    '일반적으로 알려진 바로는 운동이 건강에 좋습니다',
    '개인차가 있으므로 전문의와 상담을 권장합니다',
    '연구 결과에 따르면 수면이 중요합니다',
    '건강한 식습관이 중요하다는 연구 결과가 있습니다',
  ];

  for (const sentence of safeSentences) {
    it(`"${sentence.slice(0, 20)}..." → 위반 없음`, () => {
      const result = checkSentence(sentence, 'scene_safe', config);
      expect(result.isClean).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────
// checkScript — 전체 대본 검사
// ─────────────────────────────────────────────
describe('checkScript', () => {
  it('위반 없는 씬들 → isClean true', () => {
    const scenes = [
      { sceneId: 'scene_01', narration: '비타민C는 면역력에 도움이 될 수 있습니다.' },
      { sceneId: 'scene_02', narration: '일반적으로 알려진 바로는 수면이 건강에 중요합니다.' },
    ];
    const result = checkScript(scenes, PROJECT_DIR);
    expect(result.isClean).toBe(true);
  });

  it('위반 있는 씬이 1개라도 → isClean false', () => {
    const scenes = [
      { sceneId: 'scene_01', narration: '비타민C는 면역력에 도움이 됩니다.' },
      { sceneId: 'scene_02', narration: '의사가 숨기는 건강 비법을 알려드립니다.' },
    ];
    const result = checkScript(scenes, PROJECT_DIR);
    expect(result.isClean).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('여러 씬 위반 → violations에 sceneId 정보 포함', () => {
    const scenes = [
      { sceneId: 'scene_01', narration: '완치됩니다.' },
      { sceneId: 'scene_02', narration: '기적입니다.' },
    ];
    const result = checkScript(scenes, PROJECT_DIR);
    const sceneIds = result.violations.map(v => v.sceneId);
    expect(sceneIds).toContain('scene_01');
    expect(sceneIds).toContain('scene_02');
  });

  it('빈 씬 배열 → isClean true', () => {
    const result = checkScript([], PROJECT_DIR);
    expect(result.isClean).toBe(true);
  });
});

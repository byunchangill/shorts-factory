/**
 * similarity-check.ts 단위 테스트
 * phraseOverlapScore, structureOverlapScore, titleSimilarityScore, checkSimilarity
 */

import { describe, it, expect } from 'vitest';
import {
  phraseOverlapScore,
  structureOverlapScore,
  titleSimilarityScore,
  checkSimilarity,
} from '../utils/similarity-check.js';

// ─────────────────────────────────────────────
// phraseOverlapScore
// ─────────────────────────────────────────────
describe('phraseOverlapScore', () => {
  it('완전 동일 텍스트 → 높은 점수 (>= 0.8)', () => {
    const text = '강아지가 병원에 가서 치료를 받았습니다';
    expect(phraseOverlapScore(text, text)).toBeGreaterThanOrEqual(0.8);
  });

  it('완전히 다른 텍스트 → 낮은 점수 (< 0.2)', () => {
    const original = '강아지가 병원에 갔다';
    const newText = '비타민C는 면역력에 좋다';
    expect(phraseOverlapScore(original, newText)).toBeLessThan(0.2);
  });

  it('한 단어만 겹치는 경우 → 낮은 점수', () => {
    const original = '강아지가 병원에 가서 치료를 받았습니다';
    const newText = '강아지가 공원에서 뛰어놀았습니다';
    const score = phraseOverlapScore(original, newText);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.5);
  });

  it('빈 텍스트 → 0 반환', () => {
    expect(phraseOverlapScore('', '강아지')).toBe(0);
    expect(phraseOverlapScore('강아지', '')).toBe(0);
    expect(phraseOverlapScore('', '')).toBe(0);
  });

  it('반환값은 0~1 범위', () => {
    const score = phraseOverlapScore('테스트 문장입니다', '다른 테스트 문장');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────
// structureOverlapScore
// ─────────────────────────────────────────────
describe('structureOverlapScore', () => {
  it('완전 동일 구조 → 1.0', () => {
    const struct = ['훅', '사건발단', '위기', '해결', 'CTA'];
    expect(structureOverlapScore(struct, struct)).toBe(1.0);
  });

  it('완전 다른 구조 → 0.0', () => {
    const original = ['훅', '사건발단', '위기'];
    const newStruct = ['소개', '증거', '결론'];
    expect(structureOverlapScore(original, newStruct)).toBe(0);
  });

  it('일부 겹치는 구조 → 0~1 사이', () => {
    const original = ['훅', '사건발단', '위기', '해결', 'CTA'];
    const newStruct = ['훅', '다른내용', '해결', 'CTA'];
    const score = structureOverlapScore(original, newStruct);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('빈 배열 → 0 반환', () => {
    expect(structureOverlapScore([], ['훅', 'CTA'])).toBe(0);
    expect(structureOverlapScore(['훅', 'CTA'], [])).toBe(0);
  });

  it('순서를 뒤바꾸면 점수 낮아짐', () => {
    const original = ['A', 'B', 'C', 'D'];
    const reversed = ['D', 'C', 'B', 'A'];
    const score = structureOverlapScore(original, reversed);
    // 역순 → 순서 보존 매칭 안됨 → 낮은 점수
    expect(score).toBeLessThan(0.5);
  });
});

// ─────────────────────────────────────────────
// titleSimilarityScore
// ─────────────────────────────────────────────
describe('titleSimilarityScore', () => {
  it('완전 동일 제목 → 높은 점수 (>= 0.8)', () => {
    const title = '강아지가 병원에서 보여준 감동적인 순간';
    expect(titleSimilarityScore(title, title)).toBeGreaterThanOrEqual(0.8);
  });

  it('완전 다른 제목 → 0', () => {
    expect(titleSimilarityScore('강아지 감동 영상', '비타민 건강 정보')).toBe(0);
  });

  it('조사 제거 후 키워드 겹침 감지', () => {
    const original = '강아지가 병원에서 보여준 감동';
    const newTitle = '강아지와 병원의 감동 이야기';
    const score = titleSimilarityScore(original, newTitle);
    expect(score).toBeGreaterThan(0);
  });

  it('반환값 0~1 범위', () => {
    const score = titleSimilarityScore('제목 테스트', '다른 제목');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('빈 제목 쌍 → 0', () => {
    expect(titleSimilarityScore('', '')).toBe(0);
  });
});

// ─────────────────────────────────────────────
// checkSimilarity (종합)
// ─────────────────────────────────────────────
describe('checkSimilarity', () => {
  const baseParams = {
    originalText: '강아지가 병원에 가서 할머니를 기다렸습니다',
    originalStructure: ['훅', '사건발단', '위기', '해결', 'CTA'],
    originalTitle: '강아지의 감동 병원 이야기',
  };

  it('완전 다른 대본 → low 리스크', () => {
    const result = checkSimilarity({
      ...baseParams,
      newText: '건강에 좋은 비타민C 섭취 방법을 알아봅니다',
      newStructure: ['소개', '효능설명', '섭취법', '주의사항', '마무리'],
      newTitle: '비타민C의 놀라운 효능',
    });
    expect(result.overallRisk).toBe('low');
    expect(result.phraseOverlapScore).toBeLessThan(0.3);
  });

  it('문구 겹침 임계치(0.3) 초과 → high 리스크', () => {
    const sameText = baseParams.originalText;
    const result = checkSimilarity({
      ...baseParams,
      newText: sameText,
      newStructure: ['다른', '구조'],
      newTitle: '완전히 다른 제목',
    });
    expect(result.overallRisk).toBe('high');
    expect(result.phraseOverlapScore).toBeGreaterThanOrEqual(0.3);
  });

  it('구조 겹침 임계치(0.7) 초과 → medium 이상 리스크', () => {
    const sameStructure = [...baseParams.originalStructure];
    const result = checkSimilarity({
      ...baseParams,
      newText: '완전히 다른 내용의 새 대본입니다',
      newStructure: sameStructure,
      newTitle: '완전히 다른 제목',
    });
    expect(['medium', 'high']).toContain(result.overallRisk);
  });

  it('반환값에 3개 점수 모두 포함', () => {
    const result = checkSimilarity({
      ...baseParams,
      newText: '새로운 콘텐츠',
      newStructure: ['새구조'],
      newTitle: '새제목',
    });
    expect(result).toHaveProperty('phraseOverlapScore');
    expect(result).toHaveProperty('structureOverlapScore');
    expect(result).toHaveProperty('titleSimilarityScore');
    expect(result).toHaveProperty('overallRisk');
  });

  it('점수값은 소수점 2자리로 반올림', () => {
    const result = checkSimilarity({
      ...baseParams,
      newText: '강아지가 병원에',
      newStructure: ['훅'],
      newTitle: '강아지',
    });
    // 소수점 2자리 이하인지 확인
    const decimalPlaces = (n: number) => (n.toString().split('.')[1] ?? '').length;
    expect(decimalPlaces(result.phraseOverlapScore)).toBeLessThanOrEqual(2);
    expect(decimalPlaces(result.structureOverlapScore)).toBeLessThanOrEqual(2);
    expect(decimalPlaces(result.titleSimilarityScore)).toBeLessThanOrEqual(2);
  });
});

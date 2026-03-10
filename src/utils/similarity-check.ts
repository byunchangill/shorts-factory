/**
 * 유사도 검증
 * 대본과 원본 영상 간 유사도를 측정하여 저작권 리스크 평가
 */

import type { SimilarityCheck } from '../types/job.js';

/**
 * 문구 겹침 점수 (bi-gram 기반)
 * 두 텍스트에서 연속 2단어 구문이 얼마나 겹치는지 계산
 */
export function phraseOverlapScore(originalText: string, newText: string): number {
  const getBigrams = (text: string): Set<string> => {
    const words = text.replace(/[^\w가-힣\s]/g, '').split(/\s+/).filter(w => w);
    const bigrams = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.add(`${words[i]} ${words[i + 1]}`);
    }
    return bigrams;
  };

  const originalBigrams = getBigrams(originalText);
  const newBigrams = getBigrams(newText);

  if (originalBigrams.size === 0 || newBigrams.size === 0) return 0;

  let overlap = 0;
  for (const bg of newBigrams) {
    if (originalBigrams.has(bg)) overlap++;
  }

  return overlap / Math.max(newBigrams.size, 1);
}

/**
 * 구조 겹침 점수
 * 사건 순서를 시퀀스로 비교 (간이 Levenshtein)
 */
export function structureOverlapScore(
  originalStructure: string[],
  newStructure: string[],
): number {
  if (originalStructure.length === 0 || newStructure.length === 0) return 0;

  // 구조 요소가 동일한 순서로 나타나는 비율
  let matches = 0;
  let lastFoundIdx = -1;

  for (const element of newStructure) {
    const idx = originalStructure.indexOf(element, lastFoundIdx + 1);
    if (idx !== -1) {
      matches++;
      lastFoundIdx = idx;
    }
  }

  return matches / Math.max(newStructure.length, 1);
}

/**
 * 제목 유사도 점수
 * 핵심 키워드 기반 Jaccard 유사도
 */
export function titleSimilarityScore(originalTitle: string, newTitle: string): number {
  const extractKeywords = (title: string): Set<string> => {
    // 조사, 감탄사, 이모지 제거 후 키워드 추출
    const cleaned = title
      .replace(/[^\w가-힣\s]/g, '')
      .replace(/\b(이|가|은|는|을|를|의|에|에서|으로|와|과|도|만|한|할|하는|하고|그|저|이런|그런)\b/g, '')
      .trim();
    return new Set(cleaned.split(/\s+/).filter(w => w.length >= 2));
  };

  const origKw = extractKeywords(originalTitle);
  const newKw = extractKeywords(newTitle);

  if (origKw.size === 0 && newKw.size === 0) return 0;

  const union = new Set([...origKw, ...newKw]);
  let intersection = 0;
  for (const kw of origKw) {
    if (newKw.has(kw)) intersection++;
  }

  return intersection / Math.max(union.size, 1);
}

/**
 * 종합 유사도 검증
 */
export function checkSimilarity(params: {
  originalText: string;
  newText: string;
  originalStructure: string[];
  newStructure: string[];
  originalTitle: string;
  newTitle: string;
}): SimilarityCheck {
  const phrase = phraseOverlapScore(params.originalText, params.newText);
  const structure = structureOverlapScore(params.originalStructure, params.newStructure);
  const title = titleSimilarityScore(params.originalTitle, params.newTitle);

  const details: string[] = [];
  let overallRisk: 'low' | 'medium' | 'high' = 'low';

  if (phrase >= 0.3) {
    details.push(`문구 겹침 ${phrase.toFixed(2)} >= 0.3 — 문장 수준 유사도 높음`);
    overallRisk = 'high';
  }
  if (structure >= 0.7) {
    details.push(`구조 겹침 ${structure.toFixed(2)} >= 0.7 — 사건 순서 유사도 높음`);
    overallRisk = overallRisk === 'high' ? 'high' : 'medium';
  }
  if (title >= 0.5) {
    details.push(`제목 유사 ${title.toFixed(2)} >= 0.5 — 제목 패턴 유사`);
    overallRisk = overallRisk === 'low' ? 'medium' : overallRisk;
  }

  return {
    phraseOverlapScore: Math.round(phrase * 100) / 100,
    structureOverlapScore: Math.round(structure * 100) / 100,
    titleSimilarityScore: Math.round(title * 100) / 100,
    overallRisk,
    details: details.length > 0 ? details : undefined,
  };
}

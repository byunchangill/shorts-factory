/**
 * korean-utils.ts 단위 테스트
 * matchExactKeyword, extractKoreanVerbStem, splitKorean, formatSrtTime
 */

import { describe, it, expect } from 'vitest';
import {
  matchExactKeyword,
  extractKoreanVerbStem,
  splitKorean,
  formatSrtTime,
} from '../utils/korean-utils.js';

// ─────────────────────────────────────────────
// matchExactKeyword
// ─────────────────────────────────────────────
describe('matchExactKeyword', () => {
  describe('매칭 케이스 (허용 조사/어미 뒤)', () => {
    it('키워드 + 조사 "은"', () => {
      expect(matchExactKeyword('기적은 없다', '기적')).toBe(true);
    });
    it('키워드 + 조사 "이"', () => {
      expect(matchExactKeyword('기적이 일어났다', '기적')).toBe(true);
    });
    it('키워드 + 조사 "처럼"', () => {
      expect(matchExactKeyword('마법처럼 효과적인', '마법')).toBe(true);
    });
    it('키워드 + 어미 "입니다"', () => {
      expect(matchExactKeyword('기적입니다', '기적')).toBe(true);
    });
    it('키워드 + 어미 "이었다"', () => {
      expect(matchExactKeyword('기적이었다', '기적')).toBe(true);
    });
    it('키워드가 문장 끝에 위치', () => {
      expect(matchExactKeyword('이것은 기적', '기적')).toBe(true);
    });
    it('키워드 뒤가 공백', () => {
      expect(matchExactKeyword('기적 같은 일이', '기적')).toBe(true);
    });
    it('키워드 뒤가 마침표', () => {
      expect(matchExactKeyword('기적.', '기적')).toBe(true);
    });
    it('만병통치 + 약', () => {
      expect(matchExactKeyword('만병통치는 없다', '만병통치')).toBe(true);
    });
  });

  describe('비매칭 케이스 (다른 한글 이어짐)', () => {
    it('"기적" vs "기적적인" — 비매칭', () => {
      expect(matchExactKeyword('기적적인 효과', '기적')).toBe(false);
    });
    it('"완치" vs "완치율" — 비매칭', () => {
      expect(matchExactKeyword('완치율이 높다', '완치')).toBe(false);
    });
    it('"마법" vs "마법사" — 비매칭', () => {
      expect(matchExactKeyword('마법사가 등장했다', '마법')).toBe(false);
    });
    it('키워드가 아예 없는 문장', () => {
      expect(matchExactKeyword('건강에 좋은 음식', '기적')).toBe(false);
    });
  });

  describe('복합 케이스', () => {
    it('같은 문장에 매칭·비매칭 동시 — 매칭 인스턴스 있으면 true', () => {
      // "기적적인 ... 기적은" → 기적적인(비매칭), 기적은(매칭) → true
      expect(matchExactKeyword('기적적인 결과와 기적은 다르다', '기적')).toBe(true);
    });
    it('조사 "까지"', () => {
      expect(matchExactKeyword('기적까지 바랄 수는 없다', '기적')).toBe(true);
    });
    it('조사 "도"', () => {
      expect(matchExactKeyword('기적도 없고', '기적')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────
// extractKoreanVerbStem
// ─────────────────────────────────────────────
describe('extractKoreanVerbStem', () => {
  it('"먹으" → "먹" (매개모음 제거)', () => {
    expect(extractKoreanVerbStem('먹으')).toBe('먹');
  });
  it('"운동" → "운동" (그대로)', () => {
    expect(extractKoreanVerbStem('운동')).toBe('운동');
  });
  it('"드시" → "드시" (그대로)', () => {
    expect(extractKoreanVerbStem('드시')).toBe('드시');
  });
  it('빈 문자열 → null', () => {
    expect(extractKoreanVerbStem('')).toBeNull();
  });
  it('null 입력 → null', () => {
    expect(extractKoreanVerbStem(null as unknown as string)).toBeNull();
  });
  it('"복용으" → "복용"', () => {
    expect(extractKoreanVerbStem('복용으')).toBe('복용');
  });
});

// ─────────────────────────────────────────────
// splitKorean
// ─────────────────────────────────────────────
describe('splitKorean', () => {
  it('18자 이하 → 그대로 반환', () => {
    const text = '짧은 문장입니다';
    expect(splitKorean(text)).toEqual([text]);
  });

  it('긴 문장 → 여러 줄로 분할', () => {
    const text = '비타민C는 면역력을 높이고, 피부 건강에도 좋습니다.';
    const lines = splitKorean(text, 18);
    expect(lines.length).toBeGreaterThan(1);
    // 각 줄은 maxChars+여유 이하
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(22);
    }
  });

  it('분할 후 합치면 원문 내용 보존', () => {
    const text = '매일 아침 물 한 잔을 마시면 건강에 매우 좋은 효과가 있다고 합니다.';
    const lines = splitKorean(text, 18);
    const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
    // 원문 키워드가 분할 결과에 모두 포함되는지
    expect(joined).toContain('매일');
    expect(joined).toContain('건강');
  });

  it('maxChars 커스텀 적용', () => {
    const text = '1234567890123456789012345';
    const lines = splitKorean(text, 10);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────
// formatSrtTime
// ─────────────────────────────────────────────
describe('formatSrtTime', () => {
  it('0초 → 00:00:00,000', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
  });
  it('1.5초 → 00:00:01,500', () => {
    expect(formatSrtTime(1.5)).toBe('00:00:01,500');
  });
  it('61초 → 00:01:01,000', () => {
    expect(formatSrtTime(61)).toBe('00:01:01,000');
  });
  it('3661.25초 → 01:01:01,250', () => {
    expect(formatSrtTime(3661.25)).toBe('01:01:01,250');
  });
  it('밀리초 정밀도 — 1.999초', () => {
    expect(formatSrtTime(1.999)).toBe('00:00:01,999');
  });
  it('SRT 형식 검증 — HH:MM:SS,mmm 패턴', () => {
    const result = formatSrtTime(3723.456);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2},\d{3}$/);
  });
});

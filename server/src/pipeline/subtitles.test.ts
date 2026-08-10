import { describe, it, expect } from 'vitest';
import { buildSrt, buildAss, formatSrtTime, wrapKorean } from './subtitles.js';

describe('subtitles', () => {
  it('SRT 시간 포맷', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(61.5)).toBe('00:01:01,500');
    expect(formatSrtTime(3723.042)).toBe('01:02:03,042');
  });

  it('SRT 빌드', () => {
    const srt = buildSrt([
      { start: 0, end: 2.5, text: '첫 번째 자막' },
      { start: 2.5, end: 5, text: '두 번째 자막' },
    ]);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\n첫 번째 자막');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:05,000\n두 번째 자막');
  });

  it('ASS 헤더에 9:16 해상도와 하단 마진', () => {
    const ass = buildAss([{ start: 0, end: 1, text: '테스트' }]);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain(`,${Math.round(1920 * 0.2)},1`); // MarginV = 384
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.00');
  });

  it('ASS 줄바꿈은 \\N', () => {
    const ass = buildAss([{ start: 0, end: 1, text: '위\n아래' }]);
    expect(ass).toContain('위\\N아래');
  });

  it('한국어 자막 줄바꿈', () => {
    expect(wrapKorean('짧은 자막')).toBe('짧은 자막');
    const wrapped = wrapKorean('이것은 아주 길어서 두 줄로 나뉘어야 하는 자막입니다', 18);
    expect(wrapped).toContain('\n');
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(18);
    }
  });
});

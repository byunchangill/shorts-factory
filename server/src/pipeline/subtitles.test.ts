import { describe, it, expect } from 'vitest';
import { assColor, buildSrt, buildAss, formatSrtTime, wrapKorean } from './subtitles.js';

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
    expect(ass).toContain(`,${Math.round(1920 * 0.35)},1`); // MarginV = 672 (아래에서 35%)
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

describe('강조 표시', () => {
  it('ASS에서는 색 태그로, SRT에서는 표시를 뗀 글자로 나간다', () => {
    const cues = [{ start: 0, end: 1, text: '세면용품 *여기 두지* 마세요' }];
    const ass = buildAss(cues);
    expect(ass).toContain('세면용품 {\\c&H0000D8FF&}여기 두지{\\c&H00FFFFFF&} 마세요');
    expect(buildSrt(cues)).toContain('세면용품 여기 두지 마세요');
    expect(buildSrt(cues)).not.toContain('*');
  });

  /*
    미리보기로 잡은 버그 둘. 강조 구간이 줄바꿈에 걸리면 별표가 화면에 그대로 찍혔고,
    안 보이는 별표까지 세는 바람에 한 줄이 일찍 접혔다.
  */
  it('강조 구간이 줄바꿈에 걸려도 색이 먹는다', () => {
    const ass = buildAss([{ start: 0, end: 1, text: '세면용품 *여기\n두지* 마세요' }]);
    expect(ass).not.toContain('*');
    expect(ass).toContain('{\\c&H0000D8FF&}여기\\N두지{\\c&H00FFFFFF&}');
  });

  it('줄바꿈은 별표를 뺀 글자 수로 센다', () => {
    expect(wrapKorean('세면용품 *여기 두지* 마세요', 14)).toBe('세면용품 *여기 두지* 마세요');
  });

  it('색은 BGR로 뒤집어 넣는다 — 그대로 넣으면 빨강과 파랑이 바뀐다', () => {
    expect(assColor('#FFD800')).toBe('&H0000D8FF&');
    expect(assColor('#FF0000')).toBe('&H000000FF&');
    expect(assColor('엉뚱한 값')).toBe('&H00FFFFFF&');
  });

  it('설정값이 스타일 줄에 그대로 실린다', () => {
    const ass = buildAss([{ start: 0, end: 1, text: '가' }], {
      fontSize: 150, outline: 12, bottomRatio: 0.6, color: '#FFFFFF', highlightColor: '#00E5FF',
    });
    expect(ass).toContain(',150,&H00FFFFFF&,');
    expect(ass).toContain(',1,12,0,2,30,30,1152,1');
  });

  it('자막은 화면 아래 35% 지점에 굵은 외곽선으로 깔린다', () => {
    const ass = buildAss([{ start: 0, end: 1, text: '가' }], { playResY: 1920 });
    // Outline 7 · Shadow 0 · MarginV 672
    expect(ass).toContain(',1,7,0,2,30,30,672,1');
  });
});

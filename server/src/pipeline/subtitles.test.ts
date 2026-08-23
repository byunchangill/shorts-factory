import { describe, it, expect } from 'vitest';
import { assColor, buildSrt, buildAss, formatSrtTime, splitLines, wrapKorean } from './subtitles.js';

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

describe('줄 단위 자막', () => {
  /*
    두 줄이 한꺼번에 뜨면 읽는 순서가 사라진다. 씬의 음성 길이를 글자 수 비례로 나눠
    차례로 지나가게 한다 — 씬 안의 낱말 타이밍은 합성 API가 주지 않는다.
  */
  it('음성 길이를 글자 수 비례로 나눠 갖는다', () => {
    const cues = splitLines(['세면용품 여기 두지 마세요', '물때가 금방'].join('\n'), 10, 6);
    expect(cues).toHaveLength(2);
    // 음절 11자 vs 5자 → 6초를 4.125초 / 1.875초로 나눈다
    expect(cues[0].text).toBe('세면용품 여기 두지 마세요');
    expect(cues[0].end).toBeCloseTo(14.125, 3);
    expect(cues[1]).toEqual({ start: cues[0].end, end: 16, text: '물때가 금방' });
  });

  it('마지막 줄은 씬 끝에 정확히 닿는다 — 오차가 다음 씬으로 새면 안 된다', () => {
    const cues = splitLines(['가나다', '라마', '바사아자차'].join('\n'), 0, 5);
    expect(cues[cues.length - 1].end).toBe(5);
    expect(cues[0].start).toBe(0);
  });

  it('한 줄이면 그대로 둔다', () => {
    expect(splitLines('한 줄뿐', 2, 3)).toEqual([{ start: 2, end: 5, text: '한 줄뿐' }]);
  });

  it('길이는 강조 표시를 뺀 글자로 잰다', () => {
    const [a] = splitLines(['*가나다*', '라마바'].join('\n'), 0, 6);
    expect(a.end).toBe(3);
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

  /*
    줄바꿈을 렌더러가 「균형 맞춰」 나누면 「여기 두지 / 마세요」처럼 구가 쪼개진다.
    첫 줄부터 채우고 넘겨야 한국어 문장이 안 끊긴다.
  */
  it('첫 줄부터 채우고 넘긴다 (WrapStyle 1)', () => {
    expect(buildAss([{ start: 0, end: 1, text: '가' }])).toContain('WrapStyle: 1');
  });

  it('자막은 화면 아래 35% 지점에 굵은 외곽선으로 깔린다', () => {
    const ass = buildAss([{ start: 0, end: 1, text: '가' }], { playResY: 1920 });
    // Outline 7 · Shadow 0 · MarginV 672
    expect(ass).toContain(',1,7,0,2,30,30,672,1');
  });
});

/*
  줄바꿈은 앞줄부터 꽉 채우지 않는다 (2026-08-23). 채워 넣으면 마지막 줄에 한 어절만
  남아 — 실측에서 「함」 한 글자가 한 줄을 차지했다 — 그 순간 화면이 비어 보인다.
*/
describe('wrapKorean 균형 배분', () => {
  const REAL = [
    '침대 없는 신혼집이 늘고 있다는데 이유가 좀 의외였음',
    '낮엔 소파, 밤엔 침대. 좁은 집에 오히려 최적이었다는 후기가 많더라',
    '리모컨 하나로 이백 센티 침대. 전동 소파베드, 육십육만 원대부터',
    '근데 리모컨에서 중국어 음성 나오고, 화물이라 일층에 두고 가기도 한다고 함',
    '방 한 칸 아쉬운 사람 있으면 저장해뒀다가 보여주면 됨',
  ];

  it('어떤 줄도 상한을 넘지 않는다', () => {
    for (const t of REAL) {
      for (const l of wrapKorean(t, 14).split('\n')) expect(l.length).toBeLessThanOrEqual(14);
    }
  });

  it('글자를 잃거나 더하지 않는다', () => {
    for (const t of REAL) expect(wrapKorean(t, 14).replace(/\n/g, ' ')).toBe(t);
  });

  it('마지막 줄에 한 어절만 떨어뜨리지 않는다', () => {
    for (const t of REAL) {
      const lines = wrapKorean(t, 14).split('\n');
      if (lines.length > 1) {
        expect(lines[lines.length - 1].split(' ').length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('줄 수는 채워 넣기와 같다 — 균형을 잡자고 줄을 늘리지 않는다', () => {
    // 늘리면 자막이 그만큼 빨리 넘어가 읽을 시간이 준다
    expect(wrapKorean('근데 리모컨에서 중국어 음성 나오고, 화물이라 일층에 두고 가기도 한다고 함', 14)
      .split('\n')).toHaveLength(4);
    expect(wrapKorean('침대 없는 신혼집이 늘고 있다는데 이유가 좀 의외였음', 14)
      .split('\n')).toHaveLength(3);
  });

  it('상한 안에 들면 안 자른다', () => {
    expect(wrapKorean('짧은 문장', 14)).toBe('짧은 문장');
  });

  it('한 어절이 상한보다 길면 그 줄만 넘치게 둔다', () => {
    const out = wrapKorean('가나다라마바사아자차카타파하가나다라 뒤', 14);
    expect(out.replace(/\n/g, ' ')).toBe('가나다라마바사아자차카타파하가나다라 뒤');
  });

  it('강조 표시는 길이에 안 센다', () => {
    // `*`는 화면에 안 보인다 — 세면 한 줄이 일찍 접힌다
    const withMark = wrapKorean('리모컨 하나로 *이백 센티* 침대', 14).split('\n').length;
    const without = wrapKorean('리모컨 하나로 이백 센티 침대', 14).split('\n').length;
    expect(withMark).toBe(without);
  });
});

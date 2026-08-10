import { describe, it, expect } from 'vitest';
import { SettingsSchema } from '@shared/types';
import { wrapCardText, suggestCards } from './cards.js';
import { buildLayoutFilter, toConcatPath } from './assemble.js';
import { fontFamilyOf, escapeDrawText, escapeFilterPath } from './fonts.js';

describe('wrapCardText', () => {
  it('짧은 문구는 한 줄', () => {
    expect(wrapCardText('3만원의 실력')).toEqual(['3만원의 실력']);
  });

  it('긴 문구는 여러 줄로 나눔', () => {
    const lines = wrapCardText('밀가루 쌀알 모래까지 전부 흡입 테스트', 11);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
  });

  it('최대 줄 수를 넘으면 말줄임', () => {
    const lines = wrapCardText('가 나 다 라 마 바 사 아 자 차 카 타 파 하 거 너 더 러', 6, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('…');
  });

  it('단어 하나가 길어도 깨지지 않음', () => {
    expect(wrapCardText('초장문단어초장문단어초장문단어', 5).length).toBeGreaterThan(0);
  });
});

describe('suggestCards', () => {
  it('짧은 자막만 카드 후보로 뽑는다', () => {
    const cards = suggestCards([
      { sceneId: 's01', subtitle: '3만원의 실력' },
      { sceneId: 's02', subtitle: '이건 스무 자를 훌쩍 넘어가는 아주 긴 자막이라 카드로는 부적합함' },
      { sceneId: 's03', subtitle: '' },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].headline).toBe('3만원의 실력');
  });
});

describe('buildLayoutFilter', () => {
  const base = SettingsSchema.parse({});

  it('fullscreen은 소스를 화면에 꽉 채운다', () => {
    const f = buildLayoutFilter({ ...base, layout: 'fullscreen' }, null);
    expect(f).toContain('scale=1080:1920');
    expect(f).toContain('crop=1080:1920');
    expect(f).not.toContain('overlay');
  });

  it('framed는 배경 블러 + 축소 오버레이 + 자기 레이어를 만든다', () => {
    const f = buildLayoutFilter({ ...base, layout: 'framed' }, null);
    expect(f).toContain('boxblur');       // 배경
    expect(f).toContain('overlay=');       // 소스 축소 배치
    expect(f).toContain('drawbox');        // 강조 바 + 테두리
    expect(f).not.toContain('drawtext');   // 폰트 없으면 문구 없음
  });

  it('폰트와 상단 문구가 있으면 drawtext를 추가한다', () => {
    const f = buildLayoutFilter(
      { ...base, layout: 'framed', frameTitle: '꿀템창고' },
      '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
    );
    expect(f).toContain('drawtext');
    expect(f).toContain('꿀템창고');
  });

  it('상단 문구가 비어 있으면 drawtext 없음', () => {
    const f = buildLayoutFilter({ ...base, layout: 'framed', frameTitle: '  ' }, '/font.ttf');
    expect(f).not.toContain('drawtext');
  });
});

describe('폰트 유틸', () => {
  it('파일명에서 폰트 패밀리를 유추', () => {
    expect(fontFamilyOf('/x/NanumGothicBold.ttf')).toBe('NanumGothic');
    expect(fontFamilyOf('/x/NanumBarunGothicBold.ttf')).toBe('NanumBarunGothic');
    expect(fontFamilyOf('/x/NotoSansCJK-Bold.ttc')).toBe('Noto Sans CJK KR');
    expect(fontFamilyOf('C:/Windows/Fonts/malgunbd.ttf')).toBe('Malgun Gothic');
    expect(fontFamilyOf(null)).toBe('Sans');
  });

  it('drawtext 값의 특수문자를 이스케이프', () => {
    expect(escapeDrawText('가격: 3만원')).toContain('\\:');
    expect(escapeDrawText("it's")).not.toContain("'"); // 인용 깨짐 방지
    expect(escapeDrawText('50%')).toContain('\\%');
  });

  it('윈도우 경로의 드라이브 콜론을 2단계 이스케이프', () => {
    // 필터그래프는 두 번 파싱되므로 백슬래시 하나로는 옵션 구분자로 먹힌다
    expect(escapeFilterPath('C:/Windows/Fonts/malgun.ttf')).toBe('C\\\\:/Windows/Fonts/malgun.ttf');
  });

  it('윈도우 백슬래시 경로를 슬래시로 정규화', () => {
    expect(escapeFilterPath('C:\\Windows\\Fonts\\malgun.ttf')).toBe('C\\\\:/Windows/Fonts/malgun.ttf');
  });

  it('concat 목록 경로는 백슬래시를 슬래시로 바꾼다', () => {
    // concat 데먹서는 백슬래시를 이스케이프로 해석해 `\U`, `\s` 등이 깨진다
    expect(toConcatPath('C:\\Users\\me\\jobs\\seg_01.mp4')).toBe('C:/Users/me/jobs/seg_01.mp4');
    expect(toConcatPath('/home/me/jobs/seg_01.mp4')).toBe('/home/me/jobs/seg_01.mp4');
  });
});

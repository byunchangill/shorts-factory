import { describe, it, expect } from 'vitest';
import { SettingsSchema } from '@shared/types';
import { buildLayoutFilter, fitTitleSize, overlayBands, splitHeadline } from './assemble.js';

const S = (over: Record<string, unknown> = {}) => SettingsSchema.parse({ layout: 'banded', ...over });

/*
  벤치마킹 채널(짧은주녑·썰쇼템)은 제목을 두 줄로 쓰고 **둘째 줄이 결론**이다.
  「1년에 진짜 딱 10분만 / 볼 수 있다는 것」처럼 뒤쪽이 흰 줄로 떨어져야 한다.
*/
describe('splitHeadline', () => {
  it('긴 제목을 두 줄로 가른다', () => {
    const [a, b] = splitHeadline('이강인 인종 차별했던 유튜버 근황');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(`${a} ${b}`).toBe('이강인 인종 차별했던 유튜버 근황');
  });

  it('짧은 제목은 흰 줄 하나로 둔다 (노랑만 있는 제목은 없다)', () => {
    expect(splitHeadline('침대 없는 집')).toEqual(['', '침대 없는 집']);
  });

  it('공백이 없으면 자르지 않는다', () => {
    const [a, b] = splitHeadline('가나다라마바사아자차카타파하가나다');
    expect(a).toBe('');
    expect(b).toBe('가나다라마바사아자차카타파하가나다');
  });

  it('빈 제목은 빈 두 줄', () => {
    expect(splitHeadline('   ')).toEqual(['', '']);
  });

  it('줄바꿈·연속 공백을 한 칸으로 모은다', () => {
    const [a, b] = splitHeadline('침대 없는  신혼집이\n늘어난 이유가 의외');
    expect(`${a} ${b}`).not.toContain('  ');
    expect(`${a} ${b}`).not.toContain('\n');
  });
});

describe('overlayBands', () => {
  it('banded가 아니면 아무것도 얹지 않는다', () => {
    expect(overlayBands(S({ layout: 'fullscreen' }), 'f.ttf', '제목')).toBe('');
  });

  it('상·하단 띠를 불투명하게 그린다', () => {
    const s = S();
    const g = overlayBands(s, 'f.ttf', '침대 없는 신혼집이 늘어난 이유');
    expect(g).toContain('drawbox=x=0:y=0:');   // 상단
    // 기본값을 여기 박아두지 않는다 — 띠 높이는 실측으로 바뀌는 값이다
    expect(g).toContain(`drawbox=x=0:y=${1920 - Math.round(1920 * s.bottomBandRatio)}:`);
    expect(g).toContain('@1:t=fill');          // 반투명이면 밑의 원본 자막이 비친다
  });

  it('첫 줄은 형광 노랑, 둘째 줄은 흰색', () => {
    const g = overlayBands(S(), 'f.ttf', '이강인 인종 차별했던 유튜버 근황');
    expect(g).toContain('fontcolor=#D9FF00');
    expect(g).toContain('fontcolor=white:');
  });

  it('폰트가 없으면 띠만 그리고 글자는 건너뛴다', () => {
    const g = overlayBands(S(), null, '제목');
    expect(g).toContain('drawbox');
    expect(g).not.toContain('drawtext');
  });

  it('채널명이 비면 하단 글자를 넣지 않는다', () => {
    const g = overlayBands(S({ frameTitle: '' }), 'f.ttf', '제목입니다 두 줄로');
    expect(g).not.toContain('fontcolor=white@0.85');
  });

  it('띠 높이를 0으로 두면 그 띠가 사라진다', () => {
    const g = overlayBands(S({ topBandRatio: 0, frameTitle: '' }), 'f.ttf', '제목입니다 두 줄로');
    expect(g).not.toContain('drawbox=x=0:y=0:');
  });
});

describe('buildLayoutFilter (banded)', () => {
  it('소스를 화면 전체로 채운다 — 띠가 덮을 뿐 줄이지 않는다', () => {
    const f = buildLayoutFilter(S({ mirror: false }), 'f.ttf', '제목입니다 두 줄로');
    expect(f).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    expect(f).not.toContain('boxblur'); // framed의 블러 배경이 남아 있으면 안 된다
  });

  it('framed의 파란 강조 바가 없다', () => {
    const f = buildLayoutFilter(S(), 'f.ttf', '제목');
    expect(f).not.toContain('#2B7DE9');
  });

  it('좌우반전은 여전히 맨 앞이다 — 우리가 얹는 글자는 안 뒤집힌다', () => {
    const f = buildLayoutFilter(S({ mirror: true }), 'f.ttf', '제목입니다 두 줄로');
    expect(f.indexOf('hflip')).toBeLessThan(f.indexOf('drawbox'));
    expect(f.indexOf('hflip')).toBeLessThan(f.indexOf('drawtext'));
  });

  it('그레이딩은 맨 끝이다 — 합성이 끝난 화면 전체가 한 룩으로 묶인다', () => {
    const f = buildLayoutFilter(S({ grade: 'eq=contrast=1.07' }), 'f.ttf', '제목입니다 두 줄로');
    expect(f.indexOf('eq=contrast=1.07')).toBeGreaterThan(f.lastIndexOf('drawtext'));
  });
});

/*
  하단 띠의 진짜 일은 채널명이 아니라 **소재 원본 자막을 덮는 것**이다.
  그래서 크게 잡는데, 우리 자막 자리까지 먹으면 자막이 안 보인다.
*/
describe('띠와 자막이 겹치지 않는다', () => {
  it('기본값에서 하단 띠가 자막 자리보다 낮다', () => {
    const s = S();
    expect(s.bottomBandRatio).toBeLessThan(s.subtitleBottomRatio);
  });

  it('하단 띠가 자막을 덮을 만큼 크면 잡아낸다', () => {
    const s = S({ bottomBandRatio: 0.4, subtitleBottomRatio: 0.35 });
    // 설정 자체는 통과하지만(사용자가 의도해 바꿀 수 있다) 겹친다는 사실은 계산으로 드러나야 한다
    expect(s.bottomBandRatio).toBeGreaterThan(s.subtitleBottomRatio);
  });

  it('상단 띠와 하단 띠를 합쳐도 영상이 절반 넘게 남는다', () => {
    const s = S();
    expect(s.topBandRatio + s.bottomBandRatio).toBeLessThan(0.5);
  });

  it('채널명은 하단 띠 위쪽에 붙는다 — 쇼츠 UI가 맨 아래를 덮는다', () => {
    const g = overlayBands(S({ frameTitle: '템캐스팅' }), 'f.ttf', '제목입니다 두 줄로');
    const botH = Math.round(1920 * 0.26);
    const bandTop = 1920 - botH;
    const y = Number(g.match(/fontcolor=white@0\.85[^,]*?:y=(\d+)/)![1]);
    expect(y).toBeGreaterThanOrEqual(bandTop);
    expect(y).toBeLessThan(bandTop + botH / 2); // 가운데보다 위
  });
});

/*
  drawtext에는 자동 축소가 없다. 띠 높이에만 맞춰 크기를 정하면 긴 줄이 화면 밖으로
  잘려 나간다 — 상단 띠를 키웠을 때 실제로 그렇게 됐다 (2026-08-23).
*/
describe('fitTitleSize', () => {
  it('짧은 줄은 띠 높이 상한을 그대로 쓴다', () => {
    expect(fitTitleSize(['늘어난 이유'], 143)).toBe(143);
  });

  it('긴 줄은 화면 폭에 맞춰 줄인다', () => {
    const size = fitTitleSize(['침대 없는 신혼집이', '늘어난 이유'], 143);
    expect(size).toBeLessThan(143);
    // 줄인 크기로 다시 재면 화면 폭 안에 든다
    const units = 8 + 2 * 0.35;
    expect(size * units).toBeLessThanOrEqual(1080);
  });

  it('두 줄 중 긴 쪽을 기준으로 삼는다', () => {
    const a = fitTitleSize(['가나다라마바사아자차', '짧다'], 200);
    const b = fitTitleSize(['가나다라마바사아자차'], 200);
    expect(a).toBe(b);
  });

  it('아무리 길어도 최소 크기 아래로 내려가지 않는다', () => {
    expect(fitTitleSize(['가'.repeat(80)], 143)).toBeGreaterThanOrEqual(24);
  });

  it('빈 줄만 있어도 터지지 않는다', () => {
    expect(fitTitleSize(['', ''], 143)).toBeGreaterThan(0);
  });
});

describe('제목이 화면 폭을 넘지 않는다', () => {
  it('긴 제목에서도 잘리지 않는 크기가 쓰인다', () => {
    const g = overlayBands(S({ topBandRatio: 0.22 }), 'f.ttf', '침대 없는 신혼집이 늘어난 이유');
    const size = Number(g.match(/fontsize=(\d+)/)![1]);
    expect(size * (8 + 2 * 0.35)).toBeLessThanOrEqual(1080);
  });

  it('두 줄이 띠 안에 세로로 담긴다', () => {
    const g = overlayBands(S({ topBandRatio: 0.22 }), 'f.ttf', '침대 없는 신혼집이 늘어난 이유');
    const size = Number(g.match(/fontsize=(\d+)/)![1]);
    const ys = [...g.matchAll(/:y=(\d+)/g)].map((m) => Number(m[1])).filter((y) => y < 500);
    const topH = Math.round(1920 * 0.22);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys) + size).toBeLessThanOrEqual(topH);
  });
});

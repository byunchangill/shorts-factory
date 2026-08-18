import { describe, it, expect } from 'vitest';
import { matchFreeFont, FREE_FONTS } from './freeFonts.js';

describe('무료 글꼴 고르기', () => {
  it('자유 이용 글꼴만 목록에 올린다 — 윈도우 기본 글꼴은 뺀다', () => {
    expect(matchFreeFont('C:/Windows/Fonts/NotoSansKR-Black.otf')?.family).toBe('Noto Sans KR Black');
    expect(matchFreeFont('C:/Windows/Fonts/GmarketSansBold.otf')?.label).toBe('지마켓 산스 Bold');
    // 맑은 고딕·굴림은 윈도우에 딸려 오는 것이라 영상에 새겨 배포할 권리가 별개다
    expect(matchFreeFont('C:/Windows/Fonts/malgunbd.ttf')).toBeNull();
    expect(matchFreeFont('C:/Windows/Fonts/gulim.ttc')).toBeNull();
  });

  it('글꼴 파일이 아니면 무시한다', () => {
    expect(matchFreeFont('NotoSansKR-Black.txt')).toBeNull();
  });

  it('같은 가족에서는 굵은 것이 먼저 걸린다 — 쇼츠 자막은 굵어야 산다', () => {
    const black = FREE_FONTS.findIndex((f) => f.match === 'notosanskr-black');
    const regular = FREE_FONTS.findIndex((f) => f.match === 'notosanskr-regular');
    expect(black).toBeLessThan(regular);
  });
});

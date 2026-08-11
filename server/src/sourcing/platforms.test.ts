import { describe, it, expect } from 'vitest';
import { PLATFORMS } from './platforms.js';

/**
 * 선택자는 실제 사이트에서만 검증할 수 있지만, **주소 판별과 id 추출**은
 * 여기서 고정할 수 있다. 이게 틀리면 결과가 통째로 0건이 된다.
 */
describe('영상 주소 판별', () => {
  it('도우인 영상 주소를 잡고 id를 뽑는다', () => {
    const cfg = PLATFORMS.douyin;
    const href = 'https://www.douyin.com/video/7412345678901234567?previous_page=search';
    expect(cfg.videoHref.test(href)).toBe(true);
    expect(cfg.idFrom(href)).toBe('7412345678901234567');
  });

  it('도우인 사용자 페이지는 결과로 삼지 않는다', () => {
    expect(PLATFORMS.douyin.videoHref.test('https://www.douyin.com/user/MS4wLjAB')).toBe(false);
  });

  it('틱톡 영상 주소를 잡는다', () => {
    const cfg = PLATFORMS.tiktok;
    const href = 'https://www.tiktok.com/@someuser/video/7398765432109876543';
    expect(cfg.videoHref.test(href)).toBe(true);
    expect(cfg.idFrom(href)).toBe('7398765432109876543');
  });

  it('틱톡 프로필·태그 주소는 거른다', () => {
    expect(PLATFORMS.tiktok.videoHref.test('https://www.tiktok.com/@someuser')).toBe(false);
    expect(PLATFORMS.tiktok.videoHref.test('https://www.tiktok.com/tag/kitchen')).toBe(false);
  });

  it('샤오홍슈 노트 주소를 잡는다', () => {
    const cfg = PLATFORMS.xiaohongshu;
    const href = 'https://www.xiaohongshu.com/explore/66a1b2c3d4e5f60700000000?xsec_token=AB';
    expect(cfg.videoHref.test(href)).toBe(true);
    expect(cfg.idFrom(href)).toBe('66a1b2c3d4e5f60700000000');
  });

  it('1688은 상품 상세 주소를 잡는다', () => {
    const cfg = PLATFORMS.alibaba1688;
    const href = 'https://detail.1688.com/offer/844235565388.html?spm=a260k';
    expect(cfg.videoHref.test(href)).toBe(true);
    expect(cfg.idFrom(href)).toBe('844235565388');
  });

  it('검색 주소에 중국어 키워드가 인코딩돼 들어간다', () => {
    const url = PLATFORMS.douyin.searchUrl('厨房夹缝置物架');
    expect(url).toContain('%E5%8E%A8%E6%88%BF');
    expect(() => new URL(url)).not.toThrow();
  });

  it('로그인 없이 검색 가능한 플랫폼이 표시돼 있다', () => {
    // 샤오홍슈는 로그인 필수 — 이 값이 틀리면 빈 결과를 "영상 없음"으로 오해한다
    expect(PLATFORMS.xiaohongshu.guestSearch).toBe(false);
    expect(PLATFORMS.douyin.guestSearch).toBe(true);
  });
});

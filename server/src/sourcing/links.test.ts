import { describe, it, expect } from 'vitest';
import { buildSearchUrl, buildAllLinks, lensUrl, thumbnailUrl, SOURCE_PLATFORMS } from './links.js';

describe('buildSearchUrl', () => {
  it('중국어 검색어를 URL 인코딩한다', () => {
    const url = buildSearchUrl('douyin', '厨房夹缝置物架');
    expect(url).toBe('https://www.douyin.com/search/%E5%8E%A8%E6%88%BF%E5%A4%B9%E7%BC%9D%E7%BD%AE%E7%89%A9%E6%9E%B6');
    // 인코딩하지 않으면 플랫폼에 따라 검색어가 통째로 깨진다
    expect(url).not.toContain('厨');
  });

  it('공백·특수문자가 있는 검색어도 안전하게 만든다', () => {
    const url = buildSearchUrl('tiktok', 'kitchen gap shelf & rack');
    expect(url).toContain('kitchen%20gap%20shelf%20%26%20rack');
    expect(new URL(url).searchParams.get('q')).toBe('kitchen gap shelf & rack');
  });

  it('앞뒤 공백은 버린다', () => {
    expect(buildSearchUrl('tiktok', '  샤워기  ')).toBe(buildSearchUrl('tiktok', '샤워기'));
  });

  it('빈 검색어는 링크를 만들지 않는다', () => {
    expect(() => buildSearchUrl('douyin', '   ')).toThrow('검색어가 비어 있습니다');
  });

  it('네 플랫폼 모두 유효한 URL을 만든다', () => {
    const links = buildAllLinks('厨房置物架');
    expect(Object.keys(links).sort()).toEqual([...SOURCE_PLATFORMS].sort());
    for (const url of Object.values(links)) {
      expect(() => new URL(url)).not.toThrow();
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});

describe('lensUrl', () => {
  it('이미지 주소를 쿼리로 감싼다', () => {
    const url = lensUrl('https://i.ytimg.com/vi/abc123/maxresdefault.jpg');
    expect(new URL(url).searchParams.get('url')).toBe('https://i.ytimg.com/vi/abc123/maxresdefault.jpg');
  });

  it('이미지 주소의 쿼리스트링이 링크를 깨뜨리지 않는다', () => {
    const img = 'https://example.com/a.jpg?w=100&h=200';
    expect(new URL(lensUrl(img)).searchParams.get('url')).toBe(img);
  });
});

describe('thumbnailUrl', () => {
  it('기본은 항상 존재하는 hq를 쓴다', () => {
    expect(thumbnailUrl('abc')).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
  });

  it('maxres를 명시하면 고해상도', () => {
    expect(thumbnailUrl('abc', 'maxres')).toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
  });
});

import { describe, it, expect } from 'vitest';
import { buildSearchUrl, buildAllLinks, lensUrl, thumbnailUrl, normalizeSourceUrl, SOURCE_PLATFORMS } from './links.js';
import { PLATFORMS } from './platforms.js';

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

/*
  rednote.com은 샤오홍슈 국제판 도메인인데 yt-dlp 추출기에 등록돼 있지 않다.
  그대로 넘기면 generic 추출기로 떨어지고 앱의 포맷 선택자와 만나 `Unsupported URL`로
  끝난다 (2026-08-23 실측). 도메인만 바꿔 넘기면 정상으로 받힌다.
*/
describe('normalizeSourceUrl', () => {
  const TOKEN = 'ABEp1BHPL2HytymhkBminTm1LEGj3kvK-MWgvdpow1DAw=';

  it('rednote 검색결과 주소를 샤오홍슈 explore 주소로 바꾼다', () => {
    const out = normalizeSourceUrl(
      `https://www.rednote.com/search_result/6a15748c000000003501da09?xsec_token=${TOKEN}&xsec_source=pc_search`,
    );
    expect(out).toContain('xiaohongshu.com/explore/6a15748c000000003501da09');
    expect(out).not.toContain('rednote.com');
  });

  /** 토큰이 곧 열람 권한이다 — 쿼리를 자르면 404로 넘어간다 */
  it('xsec_token을 살려 둔다', () => {
    const out = normalizeSourceUrl(
      `https://www.rednote.com/explore/6a15748c000000003501da09?xsec_token=${TOKEN}&xsec_source=pc_search`,
    );
    expect(new URL(out).searchParams.get('xsec_token')).toBe(TOKEN);
    expect(new URL(out).searchParams.get('xsec_source')).toBe('pc_search');
  });

  it('바꾼 주소는 샤오홍슈 판별식에 걸린다', () => {
    const out = normalizeSourceUrl(
      `https://www.rednote.com/search_result/6a15748c000000003501da09?xsec_token=${TOKEN}`,
    );
    expect(PLATFORMS.xiaohongshu.videoHref.test(out)).toBe(true);
  });

  it('두 번 걸어도 결과가 같다', () => {
    const once = normalizeSourceUrl(
      `https://www.rednote.com/search_result/6a15748c000000003501da09?xsec_token=${TOKEN}`,
    );
    expect(normalizeSourceUrl(once)).toBe(once);
  });

  it('아는 형태가 아니면 손대지 않는다', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.tiktok.com/@user/video/123456789',
      'https://www.xiaohongshu.com/explore/6a15748c000000003501da09',
      'https://www.rednote.com/user/profile/abcdef', // 글 id가 없다
      '그냥 문자열',
    ]) {
      expect(normalizeSourceUrl(url)).toBe(url);
    }
  });

  it('앞뒤 공백이 붙어 와도 처리한다', () => {
    const out = normalizeSourceUrl('  https://www.rednote.com/search_result/6a15748c000000003501da09  ');
    expect(out).toContain('xiaohongshu.com/explore/');
  });
});

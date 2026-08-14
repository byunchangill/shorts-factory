import { describe, it, expect } from 'vitest';
import {
  platformOfUrl, needsBrowserDownload, extractPlayAddr, uploaderFromUrl,
} from './browserDownload.js';

/*
  틱톡은 yt-dlp를 요청 주체로 걸러낸다 (2026-08-13 확인: 브라우저 쿠키를 그대로 넘겨도 막힘).
  그래서 틱톡만 브라우저 경로로 보내고 나머지는 yt-dlp에 그대로 둔다 — 이 분기가 어긋나면
  유튜브까지 브라우저로 받으려 들거나, 틱톡이 다시 전부 실패한다.
*/

describe('platformOfUrl', () => {
  it.each([
    ['https://www.tiktok.com/@owen62269/video/7559513099561159958', 'tiktok'],
    ['https://www.douyin.com/video/7231234567890123456', 'douyin'],
    ['https://www.xiaohongshu.com/explore/64a1b2c3d4e5f6a7', 'xiaohongshu'],
  ])('%s → %s', (url, expected) => {
    expect(platformOfUrl(url)).toBe(expected);
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    // 1688은 영상 플랫폼이 아니다 — 상품 상세페이지라 애초에 받을 것이 없다
    'https://detail.1688.com/offer/844235565388.html',
    'https://detail.tmall.com/item.htm?id=123',
  ])('영상 플랫폼이 아니면 null: %s', (url) => {
    expect(platformOfUrl(url)).toBeNull();
  });

  it('추적 파라미터가 붙어도 알아본다', () => {
    const url = 'https://www.tiktok.com/@uk_trendshop/video/7613139469566348566?q=%EC%A0%91&t=178627';
    expect(platformOfUrl(url)).toBe('tiktok');
  });
});

describe('needsBrowserDownload', () => {
  it('틱톡만 브라우저로 보낸다', () => {
    expect(needsBrowserDownload('https://www.tiktok.com/@a/video/123456789012345')).toBe(true);
  });

  it('유튜브는 yt-dlp에 그대로 둔다 — 잘 받고 있다', () => {
    expect(needsBrowserDownload('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
  });

  it('도우인·샤오홍슈는 아직 yt-dlp가 받는다 — 막히면 그때 옮긴다', () => {
    expect(needsBrowserDownload('https://www.douyin.com/video/7231234567890123456')).toBe(false);
  });
});

describe('extractPlayAddr', () => {
  it('JSON 이스케이프를 풀어 실제 주소를 만든다', () => {
    const html = `<script>{"playAddr":"https:\\u002F\\u002Fv16-webapp-prime.tiktok.com\\u002Fvideo\\u002Ftos\\u002Fx?a=1\\u0026b=2"}</script>`;
    expect(extractPlayAddr(html)).toBe('https://v16-webapp-prime.tiktok.com/video/tos/x?a=1&b=2');
  });

  it('playAddr이 없으면 downloadAddr으로 물러선다', () => {
    const html = `{"downloadAddr":"https:\\u002F\\u002Fcdn.example.com\\u002Fvideo\\u002Fabcdefghijklmnop"}`;
    expect(extractPlayAddr(html)).toBe('https://cdn.example.com/video/abcdefghijklmnop');
  });

  it('둘 다 없으면 null — 껍데기 페이지를 받았다는 뜻이다', () => {
    expect(extractPlayAddr('<html><body>로그인이 필요합니다</body></html>')).toBeNull();
  });

  it('주소가 아닌 값은 받지 않는다', () => {
    expect(extractPlayAddr('{"playAddr":"blob:something-not-a-real-url-here"}')).toBeNull();
  });
});

describe('uploaderFromUrl', () => {
  it('@핸들을 업로더로 쓴다 — 저작권 체크리스트에 남는다', () => {
    expect(uploaderFromUrl('https://www.tiktok.com/@owen62269/video/755951309956115995')).toBe('owen62269');
  });

  it('추적 파라미터를 핸들에 섞지 않는다', () => {
    expect(uploaderFromUrl('https://www.tiktok.com/@uk_trendshop/video/761?q=a&t=1')).toBe('uk_trendshop');
  });

  it('핸들이 없으면 undefined', () => {
    expect(uploaderFromUrl('https://www.youtube.com/watch?v=x')).toBeUndefined();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ProductSchema } from '@shared/types';
import {
  validatePublicUrl, CrawlError, crawlFailureMessage, applyCrawl, crawlSource,
  defaultCrawlerPython, type CrawlResult,
} from './productCrawl.js';
import { findCrawlerRepo, resetBinCache } from '../util/toolPath.js';

/**
 * 상품 페이지 수집 (2026-09-07).
 *
 * 규칙을 산문에서 코드로 내렸다. 여기서 고정하는 것:
 *
 * 1. **주소는 사용자가 넣고 서버가 그리로 요청을 보낸다** — 내부망을 두드리게 두지 않는다
 * 2. 실패는 **종류를 갈라** 말한다. 사용자가 할 일이 다르다
 * 3. 수집 결과가 **사람이 적은 칸을 덮지 않는다**
 * 4. 칭찬·불만은 **우리가 가르지 않는다** (판단은 요청서가 한다)
 */

function crawled(patch: Partial<CrawlResult> = {}): CrawlResult {
  return {
    name: '무선청소기',
    url: 'https://shop.example.com/p/1',
    category: '생활가전',
    description: '가볍고 무선입니다',
    features: ['무게 1.2kg'],
    reviews: ['평점 5: 흡입력 좋아요', '평점 2: 배터리가 금방 닳아요'],
    avgRating: '4.6',
    reviewCount: '312',
    price: '39,900 KRW',
    fetcher: 'Fetcher',
    warnings: [],
    ...patch,
  };
}

describe('공개 상품 주소만 받는다', () => {
  /*
    🔴 서버가 사용자가 준 주소로 요청을 보낸다. 검사를 안 하면 앱을 시켜 내부망을
    두드리게 할 수 있다 — 이 목록은 ClipFlow(crawler.rs)가 이미 테스트로 굳혀둔 것이다.
  */
  it.each([
    ['http://localhost/item', '루프백 이름'],
    ['http://127.0.0.1/item', '루프백 IPv4'],
    ['http://[::1]/item', '루프백 IPv6'],
    /*
      🔴 아래 넷은 문자열 접두어 검사(`::1`·`fe80`)를 통과했다 (2026-09-07 실측).
      같은 주소를 여러 모양으로 쓸 수 있는 것이 IPv6라 펼쳐서 숫자로 봐야 한다.
    */
    ['http://[::ffff:127.0.0.1]/item', 'IPv4-매핑 루프백'],
    ['http://[::ffff:192.168.0.5]/item', 'IPv4-매핑 사설망'],
    ['http://[0:0:0:0:0:0:0:1]/item', '펼친 루프백'],
    ['http://[0:0:0:0:0:ffff:7f00:1]/item', '펼친 IPv4-매핑'],
    ['http://[fe80:0:0:0:0:0:0:1]/item', '펼친 링크로컬'],
    ['http://[fd12:3456::1]/item', '유니크 로컬'],
    ['http://192.168.0.2/item', '사설망'],
    ['http://10.1.2.3/item', '사설망'],
    ['http://172.16.0.9/item', '사설망'],
    ['http://169.254.169.254/latest/meta-data', '링크로컬(메타데이터)'],
    ['http://nas.local/item', '이름으로 오는 사설 주소'],
    ['http://box.internal/item', '이름으로 오는 사설 주소'],
    ['https://user:pass@example.com/item', '자격증명이 박힌 주소'],
    ['file:///C:/item.html', 'http가 아님'],
    ['ftp://example.com/item', 'http가 아님'],
    ['', '빈 값'],
    ['상품주소', '주소가 아님'],
  ])('%s 는 거부한다 (%s)', (url) => {
    expect(() => validatePublicUrl(url)).toThrow(CrawlError);
  });

  it('공개 주소는 통과하고 조각(#)은 떼어낸다', () => {
    expect(validatePublicUrl('https://shop.example.com/p/1?id=2#reviews'))
      .toBe('https://shop.example.com/p/1?id=2');
  });

  it('앞뒤 공백은 다듬는다', () => {
    expect(validatePublicUrl('  https://shop.example.com/p/1  '))
      .toBe('https://shop.example.com/p/1');
  });

  // 공인 IPv6는 막지 않는다 — 내부망만 거른다
  it('공인 IPv6는 통과한다', () => {
    expect(() => validatePublicUrl('http://[2606:4700:4700::1111]/item')).not.toThrow();
  });
});

describe('실패는 종류를 갈라 말한다', () => {
  /*
    robots가 막은 것과 사이트가 봇을 막은 것은 사용자가 할 일이 다르고, 앞의 것은
    기다린다고 풀리지 않는다. 한 문장으로 뭉치면 사용자가 계속 다시 누른다.
  */
  it('robots가 막았으면 저장한 HTML로 안내한다', () => {
    const msg = crawlFailureMessage('RuntimeError: ROBOTS_BLOCKED: https://x.com/robots.txt');
    expect(msg).toContain('robots.txt가');
    expect(msg).toContain('HTML');
    expect(msg).not.toContain('잠시 후');
  });

  it('robots를 못 읽었으면 다시 시도하라고 한다', () => {
    expect(crawlFailureMessage('ROBOTS_UNKNOWN: timeout')).toContain('잠시 후');
  });

  /*
    🔴 robots.txt 자체가 403인 것은 일시적 오류가 아니다 (2026-09-07 실측: 쿠팡).
    「잠시 후 다시」로 안내하면 사용자가 영원히 다시 누른다 — 다시 눌러도 같다고 말한다.
  */
  it('robots.txt가 403이면 다시 눌러도 같다고 말한다', () => {
    const msg = crawlFailureMessage('ROBOTS_FORBIDDEN: robots.txt 응답이 HTTP 403입니다');
    expect(msg).toContain('다시 시도해도 같습니다');
    expect(msg).toContain('HTML');
    expect(msg).not.toContain('잠시 후');
  });

  it('공개 단계로 못 찾았으면 차단 가능성을 말한다', () => {
    expect(crawlFailureMessage('PUBLIC_FETCH_FAILED: ...')).toContain('CAPTCHA');
  });

  it('런타임이 없으면 셋업을 안내한다 — 사이트 문제로 오해하지 않게', () => {
    const msg = crawlFailureMessage("ModuleNotFoundError: No module named 'scrapling'");
    expect(msg).toContain('setup.ps1');
  });

  it('모르는 실패는 마지막 줄을 남긴다', () => {
    expect(crawlFailureMessage('첫 줄\n진짜 원인')).toContain('진짜 원인');
  });
});

describe('수집 결과를 product.json에 얹는다', () => {
  /*
    🔴 사람이 고쳐 놓은 제품명을 크롤러가 페이지 제목으로 되돌리면, 고쳐놓고도 계속
    옛 값으로 나간다. 비어 있는 칸만 채운다.
  */
  it('사람이 적은 칸은 안 덮는다', () => {
    const prev = ProductSchema.parse({ name: '내가 고친 이름', price: '35,000원', features: ['내 정리'] });
    const next = applyCrawl(prev, crawled());
    expect(next.name).toBe('내가 고친 이름');
    expect(next.price).toBe('35,000원');
    expect(next.features).toEqual(['내 정리']);
  });

  it('비어 있는 칸은 채운다', () => {
    const next = applyCrawl(ProductSchema.parse({}), crawled());
    expect(next.name).toBe('무선청소기');
    expect(next.category).toBe('생활가전');
    expect(next.url).toBe('https://shop.example.com/p/1');
  });

  /*
    리뷰 칸은 수집이 소유한다 — 다시 모으면 갈아 끼우는 것이 맞다. 옛 표본이 남아
    「60개 모았다」고 적힌 채 새 표본과 섞이면 어느 쪽 이야기인지 알 수 없다.
  */
  it('리뷰는 갈아 끼운다', () => {
    const prev = ProductSchema.parse({ reviews: { count: 99, quotes: ['옛 인용'] } });
    const next = applyCrawl(prev, crawled());
    expect(next.reviews.count).toBe(2);
    expect(next.reviews.quotes).not.toContain('옛 인용');
    expect(next.reviews.avgRating).toBe('4.6');
  });

  /*
    🔴 칭찬과 불만을 가르는 것은 판단이다. 서버가 어림짐작으로 채우면 「검사했다」는
    잘못된 안심만 준다 — 얼굴 검출을 자동으로 안 하는 것과 같은 자리다.
  */
  it('칭찬·불만은 비워 둔다 — 가르는 일은 요청서가 한다', () => {
    const next = applyCrawl(ProductSchema.parse({}), crawled());
    expect(next.reviews.praises).toEqual([]);
    expect(next.reviews.complaints).toEqual([]);
    // 원문은 그대로 넘어간다 (별점이 붙어 있어 낮은 것을 골라낼 수 있다)
    expect(next.reviews.quotes).toContain('평점 2: 배터리가 금방 닳아요');
  });

  it('원본 파일이 근거 목록에 남는다', () => {
    expect(applyCrawl(ProductSchema.parse({}), crawled()).extractedFrom)
      .toContain('crawl/raw_data.json');
  });

  it('두 번 모아도 근거 목록이 중복되지 않는다', () => {
    const once = applyCrawl(ProductSchema.parse({}), crawled());
    const twice = applyCrawl(once, crawled());
    expect(twice.extractedFrom.filter((f) => f === 'crawl/raw_data.json')).toHaveLength(1);
  });

  it('결과가 스키마를 통과한다', () => {
    expect(() => ProductSchema.parse(applyCrawl(ProductSchema.parse({}), crawled()))).not.toThrow();
  });

  /*
    표본이 많으면 요청서 본문이 통째로 리뷰로 덮인다. 원본은 crawl/raw_data.json에
    남으므로 여기서 자르는 것은 근거를 버리는 것이 아니다.
  */
  it('요청서에 실을 인용은 개수와 길이를 자른다', () => {
    const many = Array.from({ length: 50 }, (_, i) => `리뷰${i} `.repeat(200));
    const next = applyCrawl(ProductSchema.parse({}), crawled({ reviews: many }));
    expect(next.reviews.count).toBe(50); // 센 것은 전부다
    expect(next.reviews.quotes).toHaveLength(20);
    expect(Math.max(...next.reviews.quotes.map((q) => q.length))).toBeLessThanOrEqual(300);
  });
});

describe('표본 출처를 적는다', () => {
  /*
    🔴 이 칸이 비면 리뷰 0개가 「불만이 없는 제품」으로 읽힌다. 0개일 때도 어디를
    봤는지는 적는다 — 안 모은 것과 없는 것이 갈려야 한다.
  */
  it('0개여도 어디를 봤는지 남는다', () => {
    const next = applyCrawl(ProductSchema.parse({}), crawled({ reviews: [], reviewCount: '' }));
    expect(next.reviews.count).toBe(0);
    expect(next.reviews.source).toContain('shop.example.com');
  });

  it('페이지가 표기한 후기 수도 같이 적는다 — 우리가 몇 개를 봤는지와 다르다', () => {
    expect(crawlSource(crawled())).toBe('shop.example.com 상품페이지 2개 (페이지 표기 312개)');
  });

  it('수집일을 적는다', () => {
    const next = applyCrawl(ProductSchema.parse({}), crawled(), new Date('2026-09-07T10:00:00Z'));
    expect(next.reviews.collectedAt).toBe('2026-09-07');
  });
});

describe('저장소 자리 찾기', () => {
  it('설정에 적어뒀으면 그것만 쓴다 — 지목한 설치본을 우리가 갈아치우지 않는다', async () => {
    expect(await findCrawlerRepo('  D:/내가/받은/web-crawler  ')).toBe('D:/내가/받은/web-crawler');
  });

  /*
    🔴 **cwd는 어떻게 띄웠느냐에 따라 다르다.** `npm run dev`는 저장소 뿌리지만
    `npm run doctor -w server`는 `server/`다 — cwd로 형제 폴더를 찾으면 같은 PC에서
    도구 점검만 「없음」이 된다 (2026-09-07 실측: 설치돼 있는데 ⚠️로 나왔다).
    찾았느냐가 아니라 **무엇을 보고 찾느냐**를 못 박는다. 그래야 PC와 무관하게 돈다.
  */
  it('형제 폴더를 process.cwd()로 찾지 않는다', async () => {
    resetBinCache();
    const cwd = vi.spyOn(process, 'cwd');
    try {
      await findCrawlerRepo('');
      expect(cwd).not.toHaveBeenCalled();
    } finally {
      cwd.mockRestore();
      resetBinCache();
    }
  });
});

describe('가상환경 파이썬 자리', () => {
  it('OS마다 다른 자리를 본다', () => {
    const got = defaultCrawlerPython('/repo');
    expect(got).toMatch(process.platform === 'win32' ? /Scripts/ : /bin/);
    expect(got).toContain('.venv');
  });
});

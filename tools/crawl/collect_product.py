"""상품 페이지 수집 — 제품 정보와 구매자 리뷰.

web-crawler(byungjunjang/web-crawler)의 Scrapling 런타임 위에서 돈다. 그 저장소의
`.venv`를 파이썬으로 쓰고, 수집 규칙은 여기서 **코드로** 정한다.

🔴 **공개 접근 사다리에서 멈춘다.** CAPTCHA를 풀지 않고, 브라우저인 척하지 않고,
봇 차단을 넘지 않는다 (`impersonate=None`, `stealthy_headers=False`). 막히면 막혔다고
말하고 끝낸다 — 우회 여부는 사람이 정할 일이지 서버가 조용히 정할 일이 아니다.

실패는 종류를 갈라 내보낸다. 사용자가 해야 할 일이 다르기 때문이다:
  ROBOTS_UNKNOWN     robots.txt를 못 읽었다 → 잠시 뒤 다시, 또는 저장한 HTML
  ROBOTS_BLOCKED     robots.txt가 막았다 → 저장한 HTML
  PUBLIC_FETCH_FAILED 공개 단계로는 내용을 못 찾았다 → 저장한 HTML

ClipFlow(C:\\YouTube_Channels\\clipflow)의 `crawl_product_template.py`에서 옮겨 왔다.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

UA = 'shorts-factory-product-crawler/1.0'


class RateLimiter:
    """초당 1건 이하. robots가 더 긴 간격을 요구하면 그쪽을 따른다."""

    def __init__(self, delay: float = 1.0):
        self.delay = max(delay, 1.0)
        self.last = 0.0

    def wait(self) -> None:
        remaining = self.delay - (time.monotonic() - self.last)
        if remaining > 0:
            time.sleep(remaining)
        self.last = time.monotonic()


def check_robots(url: str) -> dict:
    from protego import Protego

    parsed = urlparse(url)
    robots_url = f'{parsed.scheme}://{parsed.netloc}/robots.txt'
    result = {
        'allowed': True, 'crawl_delay': None, 'robots_url': robots_url,
        'error': None, 'forbidden': False,
    }
    try:
        req = Request(robots_url, headers={'User-Agent': UA})
        with urlopen(req, timeout=10) as response:
            body = response.read().decode('utf-8', errors='replace')
            status = response.status
    except HTTPError as exc:
        status = exc.code
        body = exc.read().decode('utf-8', errors='replace')
    except Exception as exc:
        result['error'] = f'robots.txt를 가져오지 못했습니다: {exc}'
        return result
    # robots.txt가 없는 것은 「막지 않았다」는 뜻이다 — 못 읽은 것과 다르다
    if status == 404 or not body.strip():
        return result
    """
    🔴 robots.txt **자체가** 401/403/429면 일시적 오류가 아니라 자동 접근 차단이다.
    2026-09-07 실측: 쿠팡은 robots.txt에 HTTP 403(Akamai)을 돌려준다 — 규칙을 읽을
    기회조차 안 준다. 이걸 「잠시 후 다시」로 안내하면 사용자가 영원히 다시 누른다.
    """
    if status in (401, 403, 429):
        result['forbidden'] = True
        result['error'] = f'robots.txt 응답이 HTTP {status}입니다'
        return result
    if status >= 400:
        result['error'] = f'robots.txt 응답이 HTTP {status}입니다'
        return result
    rules = Protego.parse(body)
    result['allowed'] = bool(rules.can_fetch(url, '*'))
    result['crawl_delay'] = rules.crawl_delay('*')
    return result


def plain_get(url: str):
    from scrapling.fetchers import Fetcher

    return Fetcher.get(url, impersonate=None, stealthy_headers=False)


def plain_session(url: str):
    from scrapling.fetchers import FetcherSession

    with FetcherSession(impersonate=None, stealthy_headers=False) as session:
        return session.get(url)


def plain_dynamic(url: str):
    from scrapling.fetchers import DynamicFetcher

    return DynamicFetcher.fetch(url, google_search=False, network_idle=True)


def soft_blocked(content: str, status: int) -> bool:
    """차단을 200으로 돌려주는 사이트가 많다. 본문 신호를 같이 본다."""
    if status in (401, 403, 407, 429, 503):
        return True
    sample = content[:20000].lower()
    signals = ('captcha', 'cf-chl-', 'access denied', 'verify you are human', 'bot detection')
    return sum(signal in sample for signal in signals) >= 2


def compact(value: object, limit: int = 12000) -> str:
    text = html.unescape(str(value or ''))
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def unique(values: list[str], limit: int = 40) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = compact(value, 3000)
        key = re.sub(r'\W+', '', value).lower()
        if len(key) < 4 or key in seen:
            continue
        seen.add(key)
        found.append(value)
        if len(found) >= limit:
            break
    return found


def css_texts(page, selectors: list[str], limit: int = 80) -> list[str]:
    values: list[str] = []
    for selector in selectors:
        try:
            for node in page.css(selector)[:limit]:
                text = compact(getattr(node, 'text', ''), 3000)
                if text:
                    values.append(text)
        except Exception:
            continue
    return unique(values, limit)


def css_attr(page, selectors: list[str]) -> str:
    for selector in selectors:
        try:
            value = page.css(selector).get('')
        except Exception:
            value = ''
        value = compact(value, 2000)
        if value:
            return value
    return ''


def walk_json(value: object):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def json_ld(page) -> list[dict]:
    """구조화 데이터를 먼저 읽는다 — 셀렉터 추측보다 훨씬 정확하다."""
    items: list[dict] = []
    try:
        scripts = page.css('script[type="application/ld+json"]::text').getall()
    except Exception:
        scripts = []
    for raw in scripts[:30]:
        try:
            parsed = json.loads(raw)
        except Exception:
            continue
        items.extend(node for node in walk_json(parsed) if isinstance(node, dict))
    return items


def as_types(node: dict) -> set[str]:
    raw = node.get('@type', [])
    if isinstance(raw, str):
        raw = [raw]
    return {str(value).lower() for value in raw if value}


def parse_reviews(nodes: list[dict], products: list[dict], page) -> tuple[list[str], str, str]:
    """리뷰 본문 · 평균 별점 · 후기 수.

    별점을 본문 앞에 붙여 둔다 — 낮은 별점이 단점 씬의 재료라, 어느 것이 불만인지
    사람이 골라낼 수 있어야 한다.
    """
    reviews: list[str] = []
    for node in [*products, *nodes]:
        raw = node.get('review') if isinstance(node, dict) else None
        if isinstance(raw, dict):
            raw = [raw]
        if not isinstance(raw, list):
            continue
        for review in raw:
            if not isinstance(review, dict):
                continue
            body = review.get('reviewBody') or review.get('description') or review.get('name')
            score = review.get('reviewRating', {})
            if isinstance(score, dict):
                score = score.get('ratingValue', '')
            if body:
                reviews.append(compact(f'평점 {score}: {body}' if score else body, 3000))
    reviews.extend(css_texts(page, [
        '[itemprop="review"]', '[itemprop="reviewBody"]',
        '[class*="review-item"]', '[class*="reviewItem"]',
        '[class*="review-content"]', '[class*="reviewContent"]',
        '[class*="customer-review"]', '[class*="testimonial"]',
        'article[class*="review"]', 'li[class*="review"]',
    ], 80))

    avg, count = '', ''
    for node in products:
        rating = node.get('aggregateRating')
        if isinstance(rating, dict):
            avg = compact(rating.get('ratingValue'), 40) or avg
            count = compact(rating.get('reviewCount') or rating.get('ratingCount'), 40) or count
    return unique(reviews, 40), avg, count


def parse_page(page, source_url: str, fetcher: str, robots: dict) -> dict:
    nodes = json_ld(page)
    products = [node for node in nodes if 'product' in as_types(node)]
    product = products[0] if products else {}

    name = compact(product.get('name'), 500) or css_attr(page, [
        'meta[property="og:title"]::attr(content)',
        'meta[name="twitter:title"]::attr(content)',
        'h1::text',
        'title::text',
    ])
    description = compact(product.get('description'), 6000) or css_attr(page, [
        'meta[name="description"]::attr(content)',
        'meta[property="og:description"]::attr(content)',
    ])

    offers = product.get('offers', {}) if isinstance(product, dict) else {}
    if isinstance(offers, list):
        offers = next((item for item in offers if isinstance(item, dict)), {})
    price = ''
    if isinstance(offers, dict):
        amount = compact(offers.get('price') or offers.get('lowPrice'), 100)
        currency = compact(offers.get('priceCurrency'), 30)
        price = compact(f'{amount} {currency}', 150)
    price = price or css_attr(page, [
        '[itemprop="price"]::attr(content)',
        'meta[property="product:price:amount"]::attr(content)',
        '[class*="price"]::text',
    ])

    features: list[str] = []
    for node in products:
        for key in ('category', 'material', 'color', 'size', 'sku', 'additionalProperty'):
            value = node.get(key)
            if isinstance(value, (str, int, float)):
                features.append(f'{key}: {value}')
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        label = item.get('name') or item.get('propertyID') or key
                        val = item.get('value')
                        if val:
                            features.append(f'{label}: {val}')
    features.extend(css_texts(page, [
        '[itemprop="description"]',
        '[class*="feature"] li', '[class*="Feature"] li',
        '[class*="detail"] li', '[class*="Detail"] li',
        '[class*="spec"] tr', '[class*="Spec"] tr',
        '[class*="benefit"] li', '[class*="Benefit"] li',
    ], 60))
    features = unique(features, 35)

    reviews, avg_rating, review_count = parse_reviews(nodes, products, page)

    body = css_texts(page, ['main', '[role="main"]', 'article', 'body'], 8)
    body_text = compact('\n'.join(body), 24000)
    if not description and body_text:
        description = body_text[:6000]

    category = ''
    for node in products:
        category = compact(node.get('category'), 200) or category

    return {
        'name': name or urlparse(source_url).netloc,
        'url': source_url,
        'category': category,
        'description': description,
        'features': features,
        'reviews': reviews,
        'avgRating': avg_rating,
        'reviewCount': review_count,
        'price': price,
        'fetcher': fetcher,
        'robots': robots,
    }


def score_of(result: dict) -> int:
    """어느 fetcher의 결과가 더 나은지. 리뷰가 제일 무겁다 — 그게 목적이다."""
    return len(result['description']) + len(result['features']) * 120 + len(result['reviews']) * 400


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('output')
    args = parser.parse_args()

    robots = check_robots(args.url)
    if robots.get('forbidden'):
        raise RuntimeError(f'ROBOTS_FORBIDDEN: {robots["error"]}')
    if robots.get('error'):
        raise RuntimeError(f'ROBOTS_UNKNOWN: {robots["error"]}')
    if not robots.get('allowed'):
        raise RuntimeError(f'ROBOTS_BLOCKED: {robots.get("robots_url", "")}')

    limiter = RateLimiter(delay=max(float(robots.get('crawl_delay') or 0), 1.0))
    ladder = [
        ('Fetcher', plain_get),
        ('FetcherSession', plain_session),
        ('DynamicFetcher', plain_dynamic),
    ]

    best: tuple[int, dict] | None = None
    errors: list[str] = []
    for fetcher_name, fetch in ladder:
        try:
            limiter.wait()
            page = fetch(args.url)
            status = int(getattr(page, 'status', 200) or 200)
            raw_html = str(getattr(page, 'html_content', '') or '')
            blocked = soft_blocked(raw_html, status)
            if status >= 400 or blocked:
                errors.append(f'{fetcher_name}: HTTP {status} / {"blocked" if blocked else "error"}')
                continue
            result = parse_page(page, args.url, fetcher_name, robots)
            score = score_of(result)
            if best is None or score > best[0]:
                best = (score, result)
            # 리뷰를 얻었으면 더 무거운 단계로 올라갈 이유가 없다
            if result['reviews'] or score >= 2200:
                break
        except Exception as exc:
            errors.append(f'{fetcher_name}: {exc}')

    if best is None or best[0] < 80:
        detail = '; '.join(errors[-3:])
        raise RuntimeError(f'PUBLIC_FETCH_FAILED: 공개 접근 단계에서 상품 내용을 찾지 못했습니다. {detail}')

    result = best[1]
    result['warnings'] = errors
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2)

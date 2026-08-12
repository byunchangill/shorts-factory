/**
 * 중국·글로벌 플랫폼 소싱 링크.
 *
 * 도우인·샤오홍슈·1688·틱톡에는 **공개 검색 API가 없다** (도우인·1688은 중국 사업자
 * 등록이 필요한 오픈플랫폼, 샤오홍슈는 아예 없음). 스크래핑은 약관 위반이고 차단된다.
 *
 * 그래서 자동 검색 대신 **검색 결과 페이지로 바로 가는 링크**를 만든다.
 * 클릭 한 번이면 그 플랫폼의 자체 검색에 중국어 키워드가 꽂힌 채로 열린다.
 * 거기서 찾은 영상 URL을 앱에 붙여넣으면 yt-dlp가 받아온다
 * (Douyin·TikTok·XiaoHongShu 추출기 모두 지원 확인).
 */

export const SOURCE_PLATFORMS = ['douyin', 'xiaohongshu', 'tiktok', 'alibaba1688'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<SourcePlatform, string> = {
  douyin: '도우인',
  xiaohongshu: '샤오홍슈',
  tiktok: '틱톡',
  alibaba1688: '1688',
};

/** 영상 소재를 구할 수 있는 곳 — 1688은 상품 페이지라 영상 소재로는 취약하다 */
export const VIDEO_PLATFORMS: SourcePlatform[] = ['douyin', 'xiaohongshu', 'tiktok'];

const BUILDERS: Record<SourcePlatform, (kw: string) => string> = {
  douyin: (kw) => `https://www.douyin.com/search/${encodeURIComponent(kw)}`,
  xiaohongshu: (kw) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(kw)}`,
  tiktok: (kw) => `https://www.tiktok.com/search?q=${encodeURIComponent(kw)}`,
  alibaba1688: (kw) => `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(kw)}`,
};

export function buildSearchUrl(platform: SourcePlatform, keyword: string): string {
  const kw = keyword.trim();
  if (!kw) throw new Error('검색어가 비어 있습니다');
  return BUILDERS[platform](kw);
}

export function buildAllLinks(keyword: string): Record<SourcePlatform, string> {
  return Object.fromEntries(
    SOURCE_PLATFORMS.map((p) => [p, buildSearchUrl(p, keyword)]),
  ) as Record<SourcePlatform, string>;
}

/**
 * 구글 렌즈 역이미지 검색.
 *
 * 중국 플랫폼에는 공개 이미지 검색 API가 없다(1688 拍立淘도 오픈플랫폼 승인 대상).
 * 렌즈는 공개 이미지 URL만 있으면 되고 유튜브 썸네일이 마침 공개 URL이라,
 * "이 제품이 뭔지" 알아내는 가장 빠른 경로다.
 */
export function lensUrl(imageUrl: string): string {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
}

/** 유튜브 썸네일 — maxres가 없는 영상이 있어 hq(항상 존재)를 기본으로 둔다 */
export function thumbnailUrl(videoId: string, quality: 'hq' | 'maxres' = 'hq'): string {
  const name = quality === 'maxres' ? 'maxresdefault' : 'hqdefault';
  return `https://i.ytimg.com/vi/${videoId}/${name}.jpg`;
}

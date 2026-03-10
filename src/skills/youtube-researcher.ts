/**
 * YouTube Researcher Skill (Step 1-2)
 *
 * 키워드 기반 YouTube 인기 영상 검색 + 구조 분석
 * - 이전 사용 영상 자동 배제
 * - 쿼리 확장 및 폴백 지원
 * - 종합 점수 산정 (조회수, 최근성, 댓글반응, 구조재활용성, 정책안전)
 * - 구조 분석 (훅, 구조, 감정선, 페이싱, 바이럴포인트, 리스크)
 * - 상위 5개 후보 제시
 */

import { google, youtube_v3 } from 'googleapis';
import type {
  ReferenceVideo,
  VideoAnalysis,
  VideoScore,
  ContentType,
} from '../types/index.js';
import {
  QUERY_EXPANSION,
  FALLBACK_QUERIES,
} from '../types/config.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';
import { UsedVideosManager } from '../utils/used-videos.js';

// ──────────────────────────────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────────────────────────────

interface YouTubeVideoItem extends youtube_v3.Schema$Video {
  id: string;
  snippet?: youtube_v3.Schema$VideoSnippet;
  statistics?: youtube_v3.Schema$VideoStatistics;
  contentDetails?: youtube_v3.Schema$VideoContentDetails;
}

interface SearchResultVideo {
  videoId: string;
  title: string;
  channelName: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  duration: number;
  thumbnailUrl: string;
  description: string;
}

// ──────────────────────────────────────────────────────────────────
// 유틸리티 함수
// ──────────────────────────────────────────────────────────────────

/**
 * ISO 8601 duration (PT1H30M45S) 을 초 단위로 변환
 * @param isoDuration ISO 8601 형식의 지속시간
 * @returns 초 단위 시간
 */
export function parseDuration(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * 3개월 전 날짜를 RFC 3339 형식으로 반환
 * @returns 3개월 전 날짜 (RFC 3339)
 */
export function threeMonthsAgo(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return date.toISOString();
}

/**
 * 발행일로부터 경과 일수 계산
 */
function getDaysSincePublished(publishedAt: string): number {
  const now = Date.now();
  const published = new Date(publishedAt).getTime();
  return Math.floor((now - published) / (1000 * 60 * 60 * 24));
}

/**
 * 숫자를 포맷팅 (e.g., 1000000 -> "100만")
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}백만`;
  } else if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}만`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}천`;
  }
  return num.toString();
}

// ──────────────────────────────────────────────────────────────────
// YouTube API 호출
// ──────────────────────────────────────────────────────────────────

/**
 * YouTube Data API v3를 이용한 영상 검색
 *
 * @param query 검색 키워드
 * @param apiKey YouTube API 키
 * @param limit 반환할 최대 결과 수 (기본값: 15)
 * @returns 검색 결과 영상 배열
 * @throws API 호출 실패 시 에러 발생
 */
export async function searchYouTube(
  query: string,
  apiKey: string,
  limit: number = 15,
): Promise<SearchResultVideo[]> {
  const youtube = google.youtube({
    version: 'v3',
    auth: apiKey,
  });

  try {
    // Step 1: 검색
    const searchResponse = await youtube.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoDuration: ['short'],
      order: 'viewCount',
      maxResults: Math.min(limit, 50),
      relevanceLanguage: 'ko',
      regionCode: 'KR',
      publishedAfter: threeMonthsAgo(),
    });

    if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
      return [];
    }

    // videoId 추출
    const videoIds = searchResponse.data.items
      .map(item => item.id?.videoId)
      .filter(Boolean) as string[];

    if (videoIds.length === 0) {
      return [];
    }

    // Step 2: 영상 상세 정보 조회
    const videosResponse = await youtube.videos.list({
      part: ['snippet', 'statistics', 'contentDetails'],
      id: videoIds,
    });

    if (!videosResponse.data.items) {
      return [];
    }

    // Step 3: 데이터 포맷팅
    const results: SearchResultVideo[] = videosResponse.data.items
      .map(item => formatVideoData(item as YouTubeVideoItem))
      .filter(v => v.duration > 0 && v.duration <= 60); // 60초 이하만 필터링

    return results;
  } catch (error) {
    console.error('YouTube API search error:', error);
    throw new Error(`YouTube 검색 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

/**
 * YouTube 영상 데이터를 정규화된 형식으로 변환
 */
function formatVideoData(item: YouTubeVideoItem): SearchResultVideo {
  const viewCount = parseInt(item.statistics?.viewCount || '0', 10);
  const likeCount = parseInt(item.statistics?.likeCount || '0', 10);
  const commentCount = parseInt(item.statistics?.commentCount || '0', 10);

  return {
    videoId: item.id || '',
    title: item.snippet?.title || '',
    channelName: item.snippet?.channelTitle || '',
    viewCount,
    likeCount,
    commentCount,
    publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
    duration: parseDuration(item.contentDetails?.duration || 'PT0S'),
    thumbnailUrl: item.snippet?.thumbnails?.high?.url || '',
    description: item.snippet?.description || '',
  };
}

// ──────────────────────────────────────────────────────────────────
// 점수 산정
// ──────────────────────────────────────────────────────────────────

/**
 * 조회수 점수 (0.25 가중치)
 * 100만↑ = 10점, 50만↑ = 8점, 10만↑ = 6점, 5만↑ = 4점
 */
function calculateViewCountScore(viewCount: number): number {
  if (viewCount >= 1000000) return 10;
  if (viewCount >= 500000) return 8;
  if (viewCount >= 100000) return 6;
  if (viewCount >= 50000) return 4;
  if (viewCount >= 10000) return 2;
  return 0;
}

/**
 * 최근성 점수 (0.15 가중치)
 * 1개월 이내 = 10점, 3개월 = 7점, 6개월 = 4점
 */
function calculateRecencyScore(publishedAt: string): number {
  const daysSince = getDaysSincePublished(publishedAt);
  if (daysSince <= 30) return 10;
  if (daysSince <= 60) return 9;
  if (daysSince <= 90) return 7;
  if (daysSince <= 180) return 4;
  return 2;
}

/**
 * 댓글 반응 점수 (0.15 가중치)
 * 좋아요:댓글 비율 및 절대값 기반
 */
function calculateCommentReactionScore(
  likeCount: number,
  commentCount: number,
): number {
  if (commentCount === 0) return 0;

  // 댓글이 있으면 기본 점수 3점
  let score = 3;

  // 좋아요 수에 따른 추가 점수
  if (likeCount >= 100000) score += 4;
  else if (likeCount >= 50000) score += 3;
  else if (likeCount >= 10000) score += 2;
  else if (likeCount >= 1000) score += 1;

  // 댓글이 많을수록 추가 점수
  if (commentCount >= 10000) score += 3;
  else if (commentCount >= 5000) score += 2;
  else if (commentCount >= 1000) score += 1;

  return Math.min(score, 10);
}

/**
 * 구조 재활용성 점수 (0.25 가중치)
 * 훅, 반전, 감정선 명확도에 따라 판정
 */
function calculateStructureReusabilityScore(analysis: VideoAnalysis): number {
  let score = 0;

  // 훅 타입에 따른 점수
  const hookScores: Record<string, number> = {
    emotional_shock: 10,
    curiosity: 9,
    question: 8,
    number: 7,
    confession: 6,
  };
  score += hookScores[analysis.hookType] || 5;

  // 구조 완성도 (단계가 많을수록)
  const structureLength = analysis.structure.length;
  if (structureLength >= 5) score += 5;
  else if (structureLength >= 4) score += 4;
  else if (structureLength >= 3) score += 2;

  // 감정 곡선 복잡도 (화살표 개수)
  const emotionalTransitions = (analysis.emotionalCurve.match(/→/g) || []).length;
  if (emotionalTransitions >= 3) score += 2;
  else if (emotionalTransitions >= 2) score += 1;

  // 페이싱
  if (analysis.pacing === 'fast') score += 1;

  return Math.min(score, 10);
}

/**
 * 정책 안전 점수 (0.20 가중치)
 * 리스크 플래그가 없을수록 높음
 */
function calculatePolicySafetyScore(riskFlags: string[]): number {
  if (riskFlags.length === 0) return 10;
  if (riskFlags.length === 1) return 7;
  if (riskFlags.length === 2) return 4;
  return 2;
}

/**
 * 종합 점수 계산 (총 100점 기준, 10점 스케일)
 *
 * 가중치:
 * - 조회수: 0.25
 * - 최근성: 0.15
 * - 댓글반응: 0.15
 * - 구조재활용성: 0.25
 * - 정책안전: 0.20
 *
 * @param video 검색 결과 영상
 * @param analysis 구조 분석 결과
 * @returns 종합 점수 (0~10)
 */
export function calculateScore(
  video: SearchResultVideo,
  analysis: VideoAnalysis,
): VideoScore {
  const viewCountScore = calculateViewCountScore(video.viewCount);
  const recencyScore = calculateRecencyScore(video.publishedAt);
  const commentReactionScore = calculateCommentReactionScore(
    video.likeCount,
    video.commentCount,
  );
  const structureReusabilityScore = calculateStructureReusabilityScore(analysis);
  const policySafetyScore = calculatePolicySafetyScore(analysis.riskFlags);

  const totalScore =
    viewCountScore * 0.25 +
    recencyScore * 0.15 +
    commentReactionScore * 0.15 +
    structureReusabilityScore * 0.25 +
    policySafetyScore * 0.2;

  return {
    viewCountScore,
    recencyScore,
    commentReactionScore,
    structureReusabilityScore,
    policySafetyScore,
    totalScore: Math.round(totalScore * 10) / 10,
  };
}

// ──────────────────────────────────────────────────────────────────
// 구조 분석
// ──────────────────────────────────────────────────────────────────

/**
 * 영상 제목, 설명, 댓글 기반 구조 분석 (현재: 스텁 구현)
 *
 * 실제 구현에서는 Claude API를 사용하여 자동 분석합니다.
 * 여기서는 기본 휴리스틱으로 분석합니다.
 *
 * @param video 검색 결과 영상
 * @returns 분석 결과
 */
function analyzeVideoStructure(video: SearchResultVideo): VideoAnalysis {
  // 제목과 설명으로부터 감정 단서 추출
  const titleLower = video.title.toLowerCase();
  const descLower = video.description.toLowerCase();
  const fullText = `${titleLower} ${descLower}`;

  // 훅 타입 결정
  let hookType: VideoAnalysis['hookType'] = 'curiosity';
  if (fullText.includes('눈물') || fullText.includes('감동')) {
    hookType = 'emotional_shock';
  } else if (fullText.includes('반전') || fullText.includes('충격')) {
    hookType = 'emotional_shock';
  } else if (fullText.includes('?') || titleLower.includes('왜')) {
    hookType = 'question';
  } else if (fullText.match(/(\d+개월|\d+년|\d+주)/)) {
    hookType = 'number';
  } else if (fullText.includes('실화') || fullText.includes('경험')) {
    hookType = 'confession';
  }

  // 구조 추측
  const structure: string[] = ['hook'];
  if (fullText.includes('배경') || fullText.includes('상황')) structure.push('setup');
  if (fullText.includes('갈등') || fullText.includes('문제')) structure.push('conflict');
  if (fullText.includes('반전') || fullText.includes('전개')) structure.push('turn');
  if (fullText.includes('결말') || fullText.includes('감동') || fullText.includes('해결')) {
    structure.push('payoff');
  }

  // 감정 곡선 추측
  let emotionalCurve = 'neutral';
  if (fullText.includes('슬프') || fullText.includes('눈물')) {
    emotionalCurve = 'neutral → sad → hopeful';
  } else if (fullText.includes('감동') || fullText.includes('감정')) {
    emotionalCurve = 'neutral → emotional_peak';
  } else if (fullText.includes('충격') || fullText.includes('반전')) {
    emotionalCurve = 'neutral → shock → relief';
  }

  // 페이싱 결정 (duration 기반)
  let pacing: VideoAnalysis['pacing'] = 'medium';
  if (video.duration <= 30) pacing = 'fast';
  else if (video.duration >= 45) pacing = 'slow';

  // 바이럴 포인트
  const viralPoints: string[] = [];
  if (hookType === 'emotional_shock') viralPoints.push('감정 충격');
  if (fullText.includes('반전')) viralPoints.push('반전 요소');
  if (fullText.includes('실화')) viralPoints.push('실제 이야기');
  if (video.viewCount > 1000000) viralPoints.push('높은 조회수');
  if (video.commentCount > 10000) viralPoints.push('높은 댓글 참여');

  // 리스크 플래그
  const riskFlags: string[] = [];
  if (fullText.includes('의료') || fullText.includes('치료') || fullText.includes('약')) {
    riskFlags.push('의료 관련 표현 주의');
  }
  if (fullText.includes('특정인') || fullText.includes('실명')) {
    riskFlags.push('특정인 언급 가능');
  }
  if (fullText.includes('논란') || fullText.includes('비판')) {
    riskFlags.push('논란 가능 주제');
  }

  return {
    hookType,
    structure: structure.length > 0 ? structure : ['hook'],
    emotionalCurve,
    pacing,
    viralPoints: viralPoints.length > 0 ? viralPoints : ['기본 바이럴 포인트'],
    riskFlags,
  };
}

// ──────────────────────────────────────────────────────────────────
// 메인 검색 함수
// ──────────────────────────────────────────────────────────────────

/**
 * 키워드 기반 YouTube 검색 (이전 사용 영상 자동 배제)
 *
 * 흐름:
 * 1. 배제 대상 videoId 로드
 * 2. 여유분 포함 검색 (limit * 3)
 * 3. 배제 필터링
 * 4. 부족하면 폴백 키워드로 추가 검색
 * 5. 상위 5개 선별
 * 6. 후보 영상을 used_videos.json에 기록
 * 7. 구조 분석 및 점수 산정
 *
 * @param keyword 검색 키워드
 * @param contentType 콘텐츠 타입
 * @param jobId 작업 ID
 * @param projectDir 프로젝트 디렉토리
 * @param limit 반환할 최대 후보 수 (기본값: 5)
 * @returns 상위 후보 영상 배열 (점수순)
 * @throws 검색 실패 시 에러 발생
 */
export async function searchWithExclusion(
  keyword: string,
  contentType: ContentType,
  jobId: string,
  projectDir: string,
  limit: number = 5,
): Promise<ReferenceVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY 환경 변수가 설정되지 않음');
  }

  const usedVideosManager = new UsedVideosManager(projectDir);
  const excluded = usedVideosManager.getExcludedVideoIds();

  try {
    // SEARCH_REQUESTED 이벤트 (상태 변경 없음)
    emitEvent({
      jobId,
      eventType: 'SEARCH_REQUESTED',
      actor: 'user',
      fromStatus: null,
      toStatus: null,
      reasonDetail: `"${keyword}" 검색 요청`,
    });

    // SEARCH_STARTED 이벤트
    const job = new JobManager(projectDir).getJob(jobId);
    if (job && job.status !== 'searching') {
      new JobManager(projectDir).transitionJob(jobId, 'searching', {
        eventType: 'SEARCH_STARTED',
        actor: 'system',
        reasonDetail: `"${keyword}" 검색 시작`,
      });
    }

    // Step 1: 검색 쿼리 확장
    const queries = QUERY_EXPANSION[keyword] || [`${keyword} shorts`];
    let filtered: SearchResultVideo[] = [];

    // Step 2: 각 쿼리로 검색
    for (const query of queries) {
      if (filtered.length >= limit * 3) break; // 여유분 도달

      try {
        const results = await searchYouTube(query, apiKey, limit * 2);
        for (const result of results) {
          if (filtered.length >= limit * 3) break;
          if (!excluded.includes(result.videoId) && !filtered.find(f => f.videoId === result.videoId)) {
            filtered.push(result);
          }
        }
      } catch (error) {
        console.warn(`쿼리 검색 실패 (${query}):`, error);
      }
    }

    // Step 3: 부족하면 폴백 키워드 사용
    if (filtered.length < limit) {
      const fallbacks = FALLBACK_QUERIES[keyword] || [];
      for (const fallback of fallbacks) {
        if (filtered.length >= limit * 3) break;

        try {
          const moreResults = await searchYouTube(fallback, apiKey, limit);
          for (const result of moreResults) {
            if (filtered.length >= limit * 3) break;
            if (!excluded.includes(result.videoId) && !filtered.find(f => f.videoId === result.videoId)) {
              filtered.push(result);
            }
          }
        } catch (error) {
          console.warn(`폴백 검색 실패 (${fallback}):`, error);
        }
      }
    }

    // Step 4: 구조 분석 및 점수 산정
    const analyzed: ReferenceVideo[] = filtered
      .slice(0, limit * 3)
      .map(video => {
        const analysis = analyzeVideoStructure(video);
        const score = calculateScore(video, analysis);

        return {
          videoId: video.videoId,
          title: video.title,
          channelName: video.channelName,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          publishedAt: video.publishedAt,
          duration: video.duration,
          thumbnailUrl: video.thumbnailUrl,
          description: video.description,
          analysis,
          score,
        };
      });

    // Step 5: 점수순 정렬
    analyzed.sort((a, b) => b.score.totalScore - a.score.totalScore);

    // Step 6: 상위 5개 선별
    const top5 = analyzed.slice(0, limit);

    // Step 7: used_videos.json에 기록 (presented_not_selected)
    for (const video of top5) {
      usedVideosManager.upsertVideo(
        video.videoId,
        video.title,
        video.channelName,
        jobId,
        'presented_not_selected',
      );
    }

    // REFERENCES_PRESENTED 이벤트
    if (job) {
      new JobManager(projectDir).transitionJob(jobId, 'references_presented', {
        eventType: 'REFERENCES_PRESENTED',
        actor: 'system',
        reasonDetail: `${top5.length}개 영상 제시`,
        metadata: {
          count: top5.length,
          keyword,
          excludedCount: excluded.length,
        },
      });
    }

    return top5;
  } catch (error) {
    console.error('검색 실패:', error);
    throw new Error(`YouTube 검색 중 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// 사용자 선택 처리
// ──────────────────────────────────────────────────────────────────

/**
 * 사용자가 특정 영상을 선택했을 때 처리
 *
 * 1. 영상을 used_videos.json에 selected_for_homage로 승격
 * 2. REFERENCE_SELECTED 이벤트 발행
 * 3. 작업 상태를 reference_selected로 전이
 *
 * @param videoId 선택된 영상 ID
 * @param jobId 작업 ID
 * @param projectDir 프로젝트 디렉토리
 */
export function onUserSelect(
  videoId: string,
  jobId: string,
  projectDir: string,
): void {
  const usedVideosManager = new UsedVideosManager(projectDir);
  const jobManager = new JobManager(projectDir);

  try {
    // used_videos.json에 영구 배제로 승격
    usedVideosManager.markAsSelected(videoId, jobId);

    // 작업 정보 조회
    const job = jobManager.getJob(jobId);
    if (job) {
      jobManager.updateJob(jobId, { selectedReferenceId: videoId });

      // REFERENCE_SELECTED 이벤트 발행
      jobManager.transitionJob(jobId, 'reference_selected', {
        eventType: 'REFERENCE_SELECTED',
        actor: 'user',
        targetId: videoId,
        reasonDetail: `영상 선택됨: ${videoId}`,
      });
    }
  } catch (error) {
    console.error('사용자 선택 처리 실패:', error);
    throw new Error(`선택 처리 중 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// 사용자 제시 형식
// ──────────────────────────────────────────────────────────────────

/**
 * 검색 결과를 사용자 친화적인 형식으로 포맷팅
 *
 * 예시:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔍 "강아지" 검색 결과 (종합 점수 순)
 *    ℹ️ 이전 사용 영상 3개 자동 배제됨
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * [1] ⭐ 9.2점 | 520만뷰 | 2주 전
 *     "제목"
 *     📊 훅: emotional_shock | 구조: hook→conflict→turn→payoff
 *     🎯 바이럴: 기다림 시간 강조, 재회 감정 폭발
 *     ⚠️ 리스크: 없음
 *
 * @param videos 영상 배열
 * @param keyword 검색 키워드
 * @param excludedCount 배제된 영상 수
 * @returns 포맷팅된 출력 문자열
 */
export function formatSearchResults(
  videos: ReferenceVideo[],
  keyword: string,
  excludedCount: number = 0,
): string {
  let output = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += `🔍 "${keyword}" 검색 결과 (종합 점수 순)\n`;

  if (excludedCount > 0) {
    output += `   ℹ️ 이전 사용 영상 ${excludedCount}개 자동 배제됨\n`;
  }

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const daysSince = getDaysSincePublished(video.publishedAt);
    let timeAgo = '';
    if (daysSince < 7) timeAgo = `${daysSince}일 전`;
    else if (daysSince < 30) timeAgo = `${Math.floor(daysSince / 7)}주 전`;
    else if (daysSince < 365) timeAgo = `${Math.floor(daysSince / 30)}개월 전`;
    else timeAgo = `${Math.floor(daysSince / 365)}년 전`;

    output += `[${i + 1}] ⭐ ${video.score.totalScore}점 | ${formatNumber(video.viewCount)}뷰 | ${timeAgo}\n`;
    output += `    "${video.title}"\n`;
    output += `    📊 훅: ${video.analysis.hookType} | 구조: ${video.analysis.structure.join('→')}\n`;
    output += `    🎯 바이럴: ${video.analysis.viralPoints.join(', ')}\n`;

    const riskText = video.analysis.riskFlags.length > 0
      ? video.analysis.riskFlags.join(', ')
      : '없음';
    output += `    ⚠️ 리스크: ${riskText}\n\n`;
  }

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '👉 번호 선택 (1-5)\n';
  output += '   "다시 검색" → 키워드 변경\n';
  output += '   "더 보기" → 6~10위\n';
  output += '   "배제 목록" → 현재 배제 중인 영상 확인\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  return output;
}

// ──────────────────────────────────────────────────────────────────
// 배제 목록 조회
// ──────────────────────────────────────────────────────────────────

/**
 * 현재 배제 중인 영상 목록 조회
 *
 * @param projectDir 프로젝트 디렉토리
 * @returns 배제 영상 정보
 */
export function getExcludedList(projectDir: string): string {
  const usedVideosManager = new UsedVideosManager(projectDir);
  const excludedEntries = usedVideosManager.getExcludedList();
  const stats = usedVideosManager.getStats();

  if (excludedEntries.length === 0) {
    return '배제된 영상이 없습니다.';
  }

  let output = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '🚫 현재 배제 목록\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  for (const entry of excludedEntries) {
    const type = entry.usageType === 'selected_for_homage' ? '🔒 영구 배제' : '⏰ 7일 임시 배제';
    output += `${type} | ${entry.title}\n`;
    output += `   채널: ${entry.channelName}\n`;
    output += `   ID: ${entry.videoId}\n\n`;
  }

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += `📊 통계: 총 선택 ${stats.totalSelected}개 | 제시됨 ${stats.totalPresented}개\n`;
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  return output;
}

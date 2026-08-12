/** 메뉴 식별자 */
export const MENUS = ['menu-a', 'menu-b'] as const;
export type Menu = (typeof MENUS)[number];

export const MENU_LABELS: Record<Menu, string> = {
  'menu-a': '해외영상 짜집기',
  'menu-b': '제품정보리뷰',
};

/** 메뉴 A (해외영상 짜집기) 잡 상태 흐름 */
export const MENU_A_STATES = [
  'draft',
  'collecting',
  'downloading',
  'analyzing',
  'cleaning',
  'scripting',
  'script_approved',
  'trimming',
  'voicing',
  'assembling',
  'review',
  'done',
] as const;

/** 메뉴 B (제품정보리뷰) 잡 상태 흐름 */
export const MENU_B_STATES = [
  'draft',
  'format_selected',
  'scripting',
  'script_approved',
  'scening',
  'voicing',
  'assembling',
  'review',
  'done',
] as const;

export const EXTRA_STATES = ['failed', 'paused'] as const;

export type JobState =
  | (typeof MENU_A_STATES)[number]
  | (typeof MENU_B_STATES)[number]
  | (typeof EXTRA_STATES)[number];

export const STATE_LABELS: Record<string, string> = {
  draft: '초안',
  collecting: '소스 수집',
  downloading: '영상 다운로드',
  analyzing: '영상 분석',
  cleaning: '자막/워터마크 제거',
  scripting: '대본 작성',
  script_approved: '대본 승인됨',
  trimming: '컷 선택',
  scening: '씬 이미지',
  format_selected: '포맷 선택됨',
  voicing: '음성 생성',
  assembling: '영상 조립',
  review: '최종 검수',
  done: '완료',
  failed: '실패',
  paused: '일시정지',
};

/** 상태별 사용자가 해야 할 다음 액션 (대시보드 카드 버튼 문구) */
export const STATE_NEXT_ACTION: Record<string, string> = {
  draft: '소스 입력하기',
  collecting: '다운로드 시작하기',
  downloading: '다운로드 진행 중…',
  analyzing: '분석 진행 중…',
  cleaning: '자막/워터마크 영역 지정하기',
  scripting: '대본 요청서 실행하기',
  script_approved: '컷 선택하기',
  trimming: '컷 마킹하기',
  scening: '씬 이미지 요청서 실행하기',
  format_selected: '대본 요청서 만들기',
  voicing: '음성 생성하기',
  assembling: '조립 진행 중…',
  review: '최종 검수하기',
  done: '완료됨',
  failed: '오류 확인하기',
  paused: '재개하기',
};

/** 요청서(패킷) 종류 */
export const PACKET_KINDS = [
  'product-extract',
  'script',
  'format-create',
  'scene-images',
  'upload-kit',
  'revision',
] as const;
export type PacketKind = (typeof PACKET_KINDS)[number];

export const PACKET_KIND_LABELS: Record<PacketKind, string> = {
  'product-extract': '제품정보 추출',
  script: '대본 작성',
  'format-create': '고유 포맷 생성',
  'scene-images': '씬 이미지',
  'upload-kit': '업로드 킷',
  revision: '수정 요청',
};

/** 요청서 종류별 한 줄 설명 — 화면에서 "이게 뭔지" 바로 알 수 있어야 한다 */
export const PACKET_KIND_DESCRIPTIONS: Record<PacketKind, string> = {
  'product-extract':
    '프로젝트에 첨부한 쿠팡 상세페이지(이미지·문서)에서 제품명·가격·핵심 사양을 뽑아 정리합니다. ' +
    '대본이 제품 정보를 지어내지 않게 하는 재료입니다 — 첨부 자료가 없으면 필요 없습니다.',
  script: '제품 정보·프로젝트 지침·확보한 장면을 재료로 씬별 대본을 씁니다.',
  'format-create': '채널 고유 포맷(구성·톤·길이 규칙)을 설계합니다.',
  'scene-images': '대본의 각 씬에 쓸 이미지를 만들거나 고릅니다 (제품정보리뷰 전용).',
  'upload-kit': '완성된 영상의 제목 후보·설명·해시태그·썸네일 문구를 만듭니다.',
  revision: '반려 사유를 반영해 대본을 다시 씁니다.',
};

export const PACKET_STATUSES = ['draft', 'waiting', 'received', 'accepted', 'rejected'] as const;
export type PacketStatus = (typeof PACKET_STATUSES)[number];

/** 지침 파일 종류 */
export const GUIDELINE_FILES = ['script.md', 'video.md', 'channel.md'] as const;
export type GuidelineFile = (typeof GUIDELINE_FILES)[number];

export const GUIDELINE_LABELS: Record<GuidelineFile, string> = {
  'script.md': '대본 지침',
  'video.md': '영상 지침',
  'channel.md': '채널 지침',
};

/** 쿠팡파트너스 공시문구 — 업로드 킷에 항상 포함 */
export const COUPANG_PARTNERS_DISCLOSURE =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

export const API_PORT = 4310;

// ── 대본 분량 ─────────────────────────────────────────────────────

/** 한국어 TTS 정속 낭독 속도 (분당 글자 수) */
export const CHARS_PER_MIN = 300;

/**
 * 메뉴별 목표 영상 길이 (초).
 *
 * 짧게 끝내 완주율을 올리는 전략이라 어느 쪽도 30초를 넘지 않는다.
 * 제품정보리뷰(menu-b)는 소재 흐름에 매일 이유가 없어 더 짧게 끊는다 — 권장 22초.
 * 해외영상 짜집기(menu-a)는 원본 컷의 리듬을 살려야 해서 여유를 둔다.
 * 이 길이는 배속과 함께 계산돼야 한다 — 1.25배속에서 30초는 약 187자다.
 */
export const TARGET_SEC_BY_MENU: Record<Menu, { min: number; recommended: number; max: number }> = {
  'menu-a': { min: 20, recommended: 27, max: 30 },
  'menu-b': { min: 18, recommended: 22, max: 26 },
};

/** 메뉴를 모를 때의 기준 (해외영상 짜집기 = 더 넉넉한 쪽) */
export const TARGET_SEC = TARGET_SEC_BY_MENU['menu-a'];

/**
 * 배속을 반영한 글자 수 상·하한.
 * 상한은 내림, 하한은 올림한다 — 반올림하면 경계에서 목표 시간을 넘긴다
 * (1.25배속 30초는 187.5자라, 반올림 188자는 30.08초가 되어 상한 위반).
 */
export function charBudget(
  speechRate: number,
  menu: Menu = 'menu-a',
): { min: number; recommended: number; max: number } {
  const target = TARGET_SEC_BY_MENU[menu];
  const perSec = (CHARS_PER_MIN * speechRate) / 60;
  return {
    min: Math.ceil(target.min * perSec),
    recommended: Math.round(target.recommended * perSec),
    max: Math.floor(target.max * perSec),
  };
}

/** 글자 수 → 예상 낭독 시간 (초) */
export function estimateSeconds(chars: number, speechRate: number): number {
  return (chars / (CHARS_PER_MIN * speechRate)) * 60;
}

// ── API 키 ────────────────────────────────────────────────────────

export const API_KEY_NAMES = ['youtube', 'anthropic', 'openai', 'gemini', 'typecast'] as const;
export type ApiKeyName = (typeof API_KEY_NAMES)[number];

export const API_KEY_INFO: Record<ApiKeyName, { label: string; desc: string; url: string }> = {
  youtube: {
    label: 'YouTube Data API',
    desc: '유튜브 리서치 (검색·채널 분석·인기 쇼츠). 무료 쿼터 10,000유닛/일',
    url: 'https://console.cloud.google.com/apis/credentials',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    desc: '요청서 API 자동 실행용',
    url: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI (GPT)',
    desc: '요청서 API 자동 실행용',
    url: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Google Gemini',
    desc: '요청서 API 자동 실행용',
    url: 'https://aistudio.google.com/apikey',
  },
  typecast: {
    label: 'Typecast (TTS)',
    desc: '나레이션 음성 합성. 미등록 시 씬별 음성 파일을 직접 첨부해야 합니다',
    url: 'https://typecast.ai/',
  },
};

// ── AI 프로바이더 (요청서 실행) ───────────────────────────────────

export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'GPT (OpenAI)',
  gemini: 'Gemini (Google)',
};

export const PACKET_MODES = ['claude-code', 'api', 'manual'] as const;
export type PacketMode = (typeof PACKET_MODES)[number];

export const PACKET_MODE_LABELS: Record<PacketMode, string> = {
  'claude-code': 'Claude Code',
  api: 'API 자동 실행',
  manual: '복사 / 붙여넣기',
};

// ── 내보내기 폴더 구조 (제품별 별도 저장) ─────────────────────────

export const EXPORT_DIRS = {
  final: '최종영상',
  video: '영상',
  sources: '원본영상',
  audio: '음성',
  script: '대본',
  image: '이미지',
  uploadKit: '업로드킷',
} as const;

// ── 유튜브 쿼터 ───────────────────────────────────────────────────

/** YouTube Data API v3 무료 일일 쿼터 */
export const YOUTUBE_DAILY_QUOTA = 10_000;

/** 엔드포인트별 쿼터 비용 */
export const YOUTUBE_QUOTA_COST = {
  search: 100,
  videos: 1,
  channels: 1,
  playlistItems: 1,
  videoCategories: 1,
} as const;

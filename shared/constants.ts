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
  /*
    `trimming`(컷 선택)은 흐름에서 뺐다 (2026-08-18). 쓸 구간은 그 앞
    「자막·워터마크 지우기」의 **쓸 장면 고르기**에서 이미 정해진다 — 같은 일을 두 번
    시키는 단계였다. 상태 이름 자체는 `JobStateSchema`에 남겨 뒀다.
    지난 잡의 `job.json`에 그 값이 적혀 있어서, 빼면 그 잡이 화면에서 통째로 사라진다.
  */
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

/**
 * 흐름 밖의 상태.
 *
 * `trimming`은 흐름에서 뺀 옛 단계다. 지난 잡의 `job.json`에 남아 있으므로 타입에서까지
 * 지우면 그 파일을 읽은 값이 `JobState`에 안 맞아 컴파일이 깨진다.
 * 읽을 때 `migrateState()`가 음성 단계로 바꿔주므로 화면에는 안 나타난다.
 */
export const EXTRA_STATES = ['failed', 'paused', 'trimming'] as const;

export type JobState =
  | (typeof MENU_A_STATES)[number]
  | (typeof MENU_B_STATES)[number]
  | (typeof EXTRA_STATES)[number];

export const STATE_LABELS: Record<string, string> = {
  draft: '초안',
  collecting: '영상 모으기',
  downloading: '영상 내려받기',
  analyzing: '영상 분석',
  cleaning: '자막·워터마크 지우기',
  scripting: '대본 작성',
  script_approved: '대본 승인됨',
  trimming: '컷 선택',
  scening: '씬 이미지 준비',
  format_selected: '포맷 선택됨',
  voicing: '음성 생성',
  assembling: '영상 합치기',
  review: '최종 검수',
  done: '완료',
  failed: '실패',
  paused: '일시정지',
};

/**
 * 상태별 사용자가 해야 할 다음 액션 (대시보드 카드 버튼 문구).
 *
 * 기본값은 해외영상 짜집기 기준이다 — 두 메뉴가 같은 이름의 단계를 쓰지만 뜻이 다른
 * 경우가 있어서, 다른 것만 `MENU_STATE_OVERRIDES`에서 덮어쓴다. 반드시 `stateNextAction()`
 * 으로 읽는다.
 */
export const STATE_NEXT_ACTION: Record<string, string> = {
  draft: '영상 주소 넣기',
  collecting: '내려받기 시작하기',
  downloading: '내려받는 중…',
  analyzing: '분석 진행 중…',
  cleaning: '쓸 장면 고르기',
  scripting: '대본 맡기거나 직접 쓰기',
  script_approved: '음성 만들기',
  trimming: '음성 만들기', // 흐름에서 뺀 단계 — 지난 잡이 이 값을 들고 있다
  scening: '씬 이미지 준비하기',
  format_selected: '대본 맡기거나 직접 쓰기',
  voicing: '음성 생성하기',
  assembling: '조립 진행 중…',
  review: '최종 검수하기',
  done: '완료됨',
  failed: '오류 확인하기',
  paused: '재개하기',
};

/**
 * 단계별 안내문. 화면 상단 안내 배너와 진행 레일 툴팁이 함께 쓴다.
 *
 * 이 앱은 12단계짜리 파이프라인이라, 단계 이름("컷 선택")만 봐서는 처음 쓰는 사람이
 * 무엇을 해야 하는지 알 수 없다. 세 가지를 항상 같이 보여준다:
 * - `what` 이 단계가 무엇을 하는 단계인가 (왜 필요한가)
 * - `todo` 지금 이 화면에서 사용자가 할 일
 * - `next` 무엇을 채우면 다음 단계로 넘어가는가 (완료 조건)
 *
 * 문구는 여기 한 곳에만 둔다 — 화면마다 따로 쓰면 곧 어긋난다.
 */
export interface StateGuide {
  what: string;
  todo: string;
  next: string;
}

export const STATE_GUIDE: Record<string, StateGuide> = {
  draft: {
    what: '영상 한 편을 만들기 위한 빈 작업입니다. 아직 재료가 없습니다.',
    todo: '참고할 해외 영상 주소를 넣거나, 이미 받아둔 영상 파일을 첨부하세요.',
    next: '영상이 한 개 이상 등록되면 다음 단계로 넘어갑니다.',
  },
  collecting: {
    what: '가져올 영상 목록을 모으는 단계입니다.',
    todo: '주소를 더 넣거나, 다 모았으면 내려받기를 시작하세요.',
    next: '내려받기를 시작하면 다음 단계로 넘어갑니다.',
  },
  downloading: {
    what: '등록한 주소에서 영상을 내려받는 중입니다.',
    todo: '기다리시면 됩니다. 실패한 항목은 다시 시도하거나 목록에서 빼세요.',
    next: '모든 영상을 받으면 자동으로 다음 단계로 넘어갑니다.',
  },
  analyzing: {
    what: '받은 영상의 길이·해상도를 확인하고 장면을 1초 간격으로 뽑아냅니다.',
    todo: '자동으로 진행됩니다.',
    next: '장면 추출이 끝나면 자동으로 다음 단계로 넘어갑니다.',
  },
  cleaning: {
    what:
      '원본에 박힌 외국어 자막과 워터마크를 지웁니다. 남이 만든 화면을 그대로 쓰면 ' +
      '재사용 콘텐츠로 분류되므로, 지우고 쓰는 것이 이 메뉴의 핵심입니다.',
    todo: '쓸 장면만 남기고 나머지는 지우세요. 자막 자리는 앱이 찾습니다.',
    next:
      '"영상 재생성"을 누르면 자막·워터마크 자리를 스스로 찾아 지우고, 고른 장면만 ' +
      '이어붙이고, 소리를 뺀 뒤 대본 단계로 넘어갑니다. 직접 드래그해 둔 자리가 있으면 그것을 씁니다.',
  },
  scripting: {
    what: '남긴 장면과 제품 정보를 재료로 씬별 대본을 씁니다.',
    todo:
      'AI에게 맡기거나(Claude Code·API·복사 붙여넣기), 직접 써서 넣으세요. ' +
      '결과가 들어오면 읽어보고 승인하거나 사유를 적어 다시 요청하세요.',
    next: '대본을 승인하면 다음 단계로 넘어갑니다.',
  },
  script_approved: {
    what: '대본이 확정됐습니다. 쓸 화면은 장면 고르기에서 이미 정해졌습니다.',
    todo: '대본을 읽어줄 나레이션을 만드세요.',
    next: '음성이 다 생기면 조립 단계로 넘어갑니다.',
  },
  format_selected: {
    what: '채널 고유 포맷이 정해졌습니다. 그 틀에 맞춰 대본을 씁니다.',
    todo: '대본을 AI에게 맡기거나 직접 쓰세요.',
    next: '대본이 들어오면 검토 후 승인합니다.',
  },
  trimming: {
    what: '대본의 각 문장에 어떤 화면을 붙일지 정하는 단계입니다.',
    todo:
      '영상마다 쓸 구간의 시작·끝을 지정하세요. 한 영상이 너무 오래 연속으로 ' +
      '나오면 경고가 뜹니다 — 재사용 판정을 피하려면 짧게 끊어 섞는 편이 안전합니다.',
    next: '구간을 저장하면 음성 단계로 넘어갑니다.',
  },
  scening: {
    what: '대본의 각 씬에 쓸 이미지를 만들거나 고릅니다.',
    todo: 'AI에게 이미지를 맡기거나, 직접 만든 이미지를 넣으세요.',
    next: '모든 씬에 이미지가 채워지면 음성 단계로 넘어갑니다.',
  },
  voicing: {
    what: '대본을 읽어주는 나레이션을 만듭니다. 이 음성 길이가 자막·편집의 기준이 됩니다.',
    todo:
      '타입캐스트 목소리를 골라 합성하거나, 씬마다 직접 녹음한 파일을 첨부하세요. ' +
      '섞어 써도 됩니다 — 파일이 있는 씬은 그 파일을, 없는 씬만 합성합니다.',
    next: '모든 씬에 음성이 생기면 조립 단계로 넘어갑니다.',
  },
  assembling: {
    what: '고른 화면·음성·자막을 하나의 세로 영상(9:16)으로 합칩니다.',
    todo: '자동으로 진행됩니다.',
    next: '합치기가 끝나면 검수 단계로 넘어갑니다.',
  },
  review: {
    what: '완성된 영상을 확인하고 업로드에 쓸 제목·설명·해시태그를 준비합니다.',
    todo: '영상을 재생해 확인하고, 업로드 킷을 만드세요. 고칠 곳이 있으면 앞 단계로 돌아가세요.',
    next: '완료 처리하면 결과물이 내보내기 폴더에 정리됩니다.',
  },
  done: {
    what: '이 영상은 완성됐습니다.',
    todo: '내보내기 폴더에서 결과물을 확인하세요. 다시 내보낼 수도 있습니다.',
    next: '',
  },
  failed: {
    what: '단계를 진행하다 멈췄습니다.',
    todo: '아래 오류 내용을 확인하고 다시 시도하세요.',
    next: '',
  },
  paused: {
    what: '진행을 잠시 멈춘 상태입니다.',
    todo: '이어서 진행하려면 다시 시작하세요.',
    next: '',
  },
};

/**
 * 메뉴마다 뜻이 다른 단계만 덮어쓴다.
 *
 * 두 메뉴는 `draft`·`script_approved` 같은 이름을 공유하지만 하는 일이 다르다.
 * 상태 이름만으로 문구를 고르면 **제품정보리뷰 화면에 해외영상 짜집기 안내가 뜬다** —
 * 실제로 "해외 영상 주소를 넣으세요"라고 안내해서 영상을 쓰지 않는 메뉴에 영상 14개가
 * 등록된 적이 있다(2026-08-13). 새 단계를 추가할 때 두 메뉴에서 뜻이 같은지 반드시 확인할 것.
 */
const MENU_STATE_OVERRIDES: Record<Menu, Record<string, { guide?: StateGuide; nextAction?: string }>> = {
  'menu-a': {},
  'menu-b': {
    draft: {
      guide: {
        what: '제품 정보만으로 영상을 만드는 작업입니다. 영상 소재는 쓰지 않습니다.',
        todo: '카테고리에 지정된 고유 포맷으로 시작하세요.',
        next: '포맷이 정해지면 대본 단계로 넘어갑니다.',
      },
      nextAction: '포맷 확인하고 시작하기',
    },
    script_approved: {
      guide: {
        what: '대본이 확정됐습니다. 이제 씬마다 보여줄 이미지를 준비합니다.',
        todo: '씬 이미지를 만들거나 직접 첨부하세요.',
        next: '모든 씬에 이미지가 채워지면 음성 단계로 넘어갑니다.',
      },
      nextAction: '씬 이미지 준비하기',
    },
  },
};

/** 단계 안내문 — 반드시 이걸로 읽는다. 메뉴를 빼먹으면 다른 메뉴의 안내가 뜬다 */
export function stateGuide(menu: Menu, state: string): StateGuide | undefined {
  return MENU_STATE_OVERRIDES[menu]?.[state]?.guide ?? STATE_GUIDE[state];
}

/** 다음 액션 문구 — 반드시 이걸로 읽는다 */
export function stateNextAction(menu: Menu, state: string): string {
  return MENU_STATE_OVERRIDES[menu]?.[state]?.nextAction ?? STATE_NEXT_ACTION[state] ?? '계속하기';
}

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
  // 해외영상 짜집기의 기준은 기본 대본 스킬(.claude/skills/shorts-direct-script)이 정한다 —
  // 스킬이 "20~28초, 기본 22초, 28초 초과 금지"라고 말하는데 앱이 30초라고 하면
  // 요청서 하나에 서로 다른 두 숫자가 실린다
  'menu-a': { min: 20, recommended: 22, max: 28 },
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

/**
 * 그 글자 크기에서 자막 한 줄에 들어가는 글자 수.
 *
 * 이 값보다 길게 잡으면 렌더러가 대신 줄을 접는데, **그 줄에는 시간을 줄 수 없다** —
 * 줄마다 차례로 띄우려면 줄바꿈을 우리가 해야 한다. 화면과 조립이 같은 값을 쓰도록
 * 여기 한 곳에 둔다.
 *
 * 이송폭 비율 0.64는 굵은 한글 글꼴 실측에서 나왔다 (본고딕 Black 118에 14자 = 916px).
 */
export function subtitleCharsPerLine(fontSize: number, width = 1080, marginX = 30): number {
  return Math.max(4, Math.floor((width - marginX * 2) / (fontSize * 0.64)));
}

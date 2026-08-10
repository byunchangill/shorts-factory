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

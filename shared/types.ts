import { z } from 'zod';
import {
  MENUS,
  PACKET_KINDS,
  PACKET_STATUSES,
  GUIDELINE_FILES,
} from './constants';

// ── 공통 ──────────────────────────────────────────────────────────

export const MenuSchema = z.enum(MENUS);

export const JobStateSchema = z.enum([
  'draft', 'collecting', 'downloading', 'analyzing', 'cleaning',
  'scripting', 'script_approved', 'trimming', 'scening', 'format_selected',
  'voicing', 'assembling', 'review', 'done', 'failed', 'paused',
]);

// ── 프로젝트 (세부 폴더) ──────────────────────────────────────────

export const ProjectSchema = z.object({
  id: z.string(),
  menu: MenuSchema,
  title: z.string().min(1),
  createdAt: z.string(),
  formatId: z.string().optional(), // menu-b 전용
  archived: z.boolean().default(false),
});
export type Project = z.infer<typeof ProjectSchema>;

// ── 고유 포맷 (menu-b) ────────────────────────────────────────────

export const FormatSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  version: z.number().int().default(1),
  createdAt: z.string(),
  structure: z.object({
    hook: z.string().describe('훅 패턴 설명'),
    beats: z.array(z.object({
      name: z.string(),
      purpose: z.string(),
      secondsHint: z.number(),
    })),
    cta: z.string(),
  }),
  tone: z.object({
    persona: z.string(),
    speechLevel: z.string().describe('말투: 해요체/반말 등'),
    bannedWords: z.array(z.string()).default([]),
  }),
  sceneTemplate: z.object({
    layout: z.string(),
    imageStylePrompt: z.string(),
    subtitleStyle: z.string(),
    transition: z.string(),
  }),
  branding: z.object({
    channelName: z.string(),
    watermarkText: z.string().optional(),
    colorPalette: z.array(z.string()).default([]),
    introOutro: z.string().optional(),
  }),
  typecastVoiceId: z.string().default(''), // 이 포맷의 기본 나레이션 캐릭터
});
export type Format = z.infer<typeof FormatSchema>;

// ── 소스 URL / 클립 ───────────────────────────────────────────────

export const SourceUrlSchema = z.object({
  id: z.string(),
  /** URL 소스는 주소, 첨부 파일 소스는 원본 파일명 (표시용) */
  url: z.string(),
  /** file = 사용자가 직접 받아둔 영상을 첨부한 것 — 다운로드 대상이 아니다 */
  origin: z.enum(['url', 'file']).default('url'),
  status: z.enum(['queued', 'downloading', 'downloaded', 'failed', 'skipped']),
  attempts: z.number().int().default(0),
  progress: z.number().min(0).max(100).default(0),
  error: z.string().optional(),
  filePath: z.string().optional(),
  uploader: z.string().optional(),
  license: z.string().optional(),
  licenseNote: z.string().optional(), // 사용자가 기록하는 사용 허락/라이선스 메모
});
export type SourceUrl = z.infer<typeof SourceUrlSchema>;

export const ZoneSchema = z.object({
  id: z.string(),
  kind: z.enum(['subtitle', 'logo', 'emoji']),
  // 원본 픽셀 좌표
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  t0: z.number().optional(), // 초 단위, 없으면 전체 구간
  t1: z.number().optional(),
  method: z.enum(['crop', 'delogo', 'boxblur', 'inpaint']),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const SegmentSchema = z.object({
  id: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  note: z.string().default(''),
  order: z.number().int().optional(),
  used: z.boolean().default(true),
});
export type Segment = z.infer<typeof SegmentSchema>;

/**
 * 클립에서 뽑아낸 프레임.
 *
 * 존 편집의 배경이자, 대본을 쓰는 AI가 보는 소재 이미지다.
 * **남아 있는 프레임이 곧 사용할 장면이다** — 사용자는 필요 없는 것을 지워서 고른다.
 */
export const ClipFrameSchema = z.object({
  file: z.string(), // 작업공간 상대경로
  t: z.number().min(0).default(0), // 영상 내 시각(초) — 컷 구간 후보 계산에 쓴다
  recommended: z.boolean().default(false), // 장면이 바뀌는 지점 (훑을 때 눈에 띄라고 표시만)
});
export type ClipFrame = z.infer<typeof ClipFrameSchema>;

/** 예전 clip.json은 frames가 경로 문자열 배열이었다 — 읽을 때 객체로 승격한다 */
const legacyFrames = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map((f) => (typeof f === 'string' ? { file: f, t: 0, recommended: true } : f))
    : v;

export const ClipSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  probe: z.object({
    width: z.number(), height: z.number(),
    fps: z.number(), duration: z.number(),
  }).optional(),
  frames: z.preprocess(legacyFrames, z.array(ClipFrameSchema)).default([]),
  zones: z.array(ZoneSchema).default([]),
  cleanVersions: z.array(z.object({
    v: z.number().int(),
    tier: z.union([z.literal(1), z.literal(2)]),
    params: z.string(),
    filePath: z.string(),
    createdAt: z.string(),
  })).default([]),
  currentCleanVersion: z.number().int().optional(),
  segments: z.array(SegmentSchema).default([]),
  /**
   * 고른 구간만 이어붙이고 소리를 뺀 영상 (`selected.mp4`).
   * 사용자가 이 단계에서 눈으로 확인하는 결과물이다. 조립은 여전히 `cleanVersions`와
   * `segments`를 쓴다 — 이 파일은 원본 시각 기준이 아니라서 컷 시각을 여기에 대면 어긋난다.
   */
  selectedVideo: z.string().optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

// ── 대본 ──────────────────────────────────────────────────────────

export const SceneLineSchema = z.object({
  sceneId: z.string(),
  narration: z.string(),
  subtitle: z.string(),
  clipRef: z.object({
    clipId: z.string(),
    suggestedSegment: z.object({ in: z.number(), out: z.number() }).optional(),
  }).optional(),
  imageRef: z.string().optional(), // menu-b 씬 이미지 경로
  imagePrompt: z.string().optional(), // menu-b 씬 이미지 프롬프트
  durationHint: z.number().optional(),
  bgmCue: z.string().optional(),
  /**
   * 이 씬이 제품의 단점·주의사항을 말하는 씬인가.
   * 제품정보리뷰(menu-b)는 최소 1개가 있어야 한다 — 단점 한 줄이
   * "광고 붙여넣기"와 "리뷰"를 가르고, 재사용 심사에서 제작자의 견해로 인정받는 장치다.
   */
  isDownside: z.boolean().default(false),
  /** 이 씬 앞에 끼울 텍스트 카드 문구 (하이브리드 믹싱) */
  cardText: z.string().optional(),
});
export type SceneLine = z.infer<typeof SceneLineSchema>;

export const ScriptSchema = z.object({
  version: z.number().int(),
  title: z.string().default(''),
  scenes: z.array(SceneLineSchema).min(1),
  notes: z.string().default(''),
});
export type Script = z.infer<typeof ScriptSchema>;

// ── 요청서 (패킷) ─────────────────────────────────────────────────

export const PacketSchema = z.object({
  id: z.string(),
  jobId: z.string().optional(), // format-create는 잡 없이도 발행
  projectId: z.string().optional(),
  formatId: z.string().optional(),
  /** 메뉴별로 분량·검증 규칙이 다르다. 예전 패킷에는 없으므로 dir에서 유추한다 */
  menu: MenuSchema.optional(),
  kind: z.enum(PACKET_KINDS),
  status: z.enum(PACKET_STATUSES),
  dir: z.string(), // workspace 기준 상대경로
  resultSpec: z.array(z.object({
    file: z.string(),
    schema: z.string(), // 'script' | 'product' | 'format' | 'markdown' | 'json'
  })),
  executionMode: z.enum(['claude-code', 'api', 'manual']).optional(), // 실제 실행된 방식
  provider: z.enum(['anthropic', 'openai', 'gemini']).optional(), // api 방식일 때
  attempts: z.number().int().default(0), // api 자동 실행 시도 횟수
  createdAt: z.string(),
  receivedAt: z.string().optional(),
  decidedAt: z.string().optional(),
  rejectNote: z.string().optional(),
  validationErrors: z.array(z.string()).default([]),
});
export type Packet = z.infer<typeof PacketSchema>;

// ── 잡 ────────────────────────────────────────────────────────────

export const JobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  menu: MenuSchema,
  title: z.string(),
  createdAt: z.string(),
  state: JobStateSchema,
  stateHistory: z.array(z.object({
    state: JobStateSchema,
    at: z.string(),
    by: z.enum(['server', 'user', 'claude']),
  })).default([]),
  sources: z.array(SourceUrlSchema).default([]),
  script: z.object({
    currentVersion: z.number().int().default(0),
    approved: z.boolean().default(false),
  }).default({ currentVersion: 0, approved: false }),
  voiceEngine: z.enum(['typecast', 'file']).optional(), // 실제 사용된 엔진
  typecastVoiceId: z.string().optional(),
  typecastEmotion: z.string().optional(), // ssfm-v30 감정 프리셋
  sceneVoiceFiles: z.record(z.string()).default({}), // sceneId → 업로드된 음성 파일명
  exportedAt: z.string().optional(), // 마지막 내보내기 시각
  rightsConfirmed: z.boolean().default(false), // 조립 전 저작권 확인 게이트
  packets: z.array(z.string()).default([]),
  output: z.object({
    currentVersion: z.number().int().optional(),
    uploadKitReady: z.boolean().default(false),
  }).default({ uploadKitReady: false }),
  error: z.string().optional(),
});
export type Job = z.infer<typeof JobSchema>;

// ── 제품 정보 ─────────────────────────────────────────────────────

export const ProductSchema = z.object({
  name: z.string().default(''),
  price: z.string().default(''),
  url: z.string().default(''),
  category: z.string().default(''),
  features: z.array(z.string()).default([]),
  specs: z.record(z.string()).default({}),
  sellingPoints: z.array(z.string()).default([]),
  cautions: z.array(z.string()).default([]),
  extractedFrom: z.array(z.string()).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

// ── 지침 ──────────────────────────────────────────────────────────

export const GuidelineFileSchema = z.enum(GUIDELINE_FILES);

// ── 설정 ──────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  parallelDownloads: z.number().int().min(1).max(8).default(3),
  burnSubtitles: z.boolean().default(true),
  burnDisclosure: z.boolean().default(true), // 쿠팡파트너스 공시 번인
  ytdlpPath: z.string().default('yt-dlp'),
  ffmpegPath: z.string().default('ffmpeg'),
  ffprobePath: z.string().default('ffprobe'),
  iopaintPath: z.string().default('iopaint'),
  /**
   * 글자 검출(자막 자리 자동 찾기)에 쓸 파이썬. 비워두면 서버가 찾아 쓴다
   * (윈도우 `py` → `python` → `python3`). 여기서 플랫폼을 보면 안 된다 —
   * 이 파일은 브라우저에서도 읽혀서 `process`를 만지는 순간 화면이 통째로 죽는다.
   */
  pythonPath: z.string().default(''),
  // 내보내기 (제품별 별도 폴더 저장)
  exportRoot: z.string().default(''), // 빈 값 = OS 다운로드 폴더 자동 사용
  exportIncludeSources: z.boolean().default(false), // 다운로드 원본 포함 (용량 큼)
  exportOnDone: z.boolean().default(true), // 잡 완료 시 자동 내보내기
  // 요청서 실행 기본 방식
  defaultPacketMode: z.enum(['claude-code', 'api', 'manual']).default('claude-code'),
  defaultAiProvider: z.enum(['anthropic', 'openai', 'gemini']).default('anthropic'),
  aiModels: z.object({
    anthropic: z.string().default('claude-sonnet-4-5'),
    openai: z.string().default('gpt-4o-mini'),
    gemini: z.string().default('gemini-2.0-flash'),
  }).default({ anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash' }),
  /**
   * 음성 경로는 셋이다: 타입캐스트 API · Voicebox(로컬) · 씬별 파일 첨부.
   * 첨부 파일이 있는 씬은 언제나 그 파일이 우선이고, 나머지 씬만 여기서 고른 방식으로 합성한다.
   */
  voiceProvider: z.enum(['typecast', 'voicebox']).default('typecast'),
  typecastVoiceId: z.string().default(''),
  /** Voicebox 서버 주소 — 앱이 띄우지 않는다. 사용자가 켜 둔 것에 붙는다 */
  voiceboxUrl: z.string().default('http://127.0.0.1:17493'),
  /** 쓸 목소리(프로필) id. 복제한 목소리든 프리셋이든 여기 들어간다 */
  voiceboxProfileId: z.string().default(''),
  /** 말투 지시 — 속도보다 어조를 잡는 용도다 (속도는 speechRate가 만든다) */
  voiceboxInstruct: z.string().default(
    '아주 빠르게 몰아치듯이 말한다. 흥분한 톤으로 쉼 없이 이어가고, 문장 끝은 짧게 끊는다.',
  ),
  /**
   * 나레이션 음정(반음). 0이면 그대로.
   * 쇼츠 톤은 높은 편이 얹히는데, 배속만 올리면 속도만 빨라지고 톤은 그대로다.
   */
  voicePitchSemitones: z.number().min(-12).max(12).default(0),
  /**
   * 나레이션 속도 배율. 쇼츠는 빠른 낭독이 유지율에 유리해 기본 1.25배.
   * 합성 음성에만 적용된다 — 첨부 파일은 사용자가 의도한 속도로 본다.
   * 이 값이 대본 분량 기준을 좌우한다 (300자/분 × 배율).
   */
  speechRate: z.number().min(0.5).max(2).default(1.25),
  // 한글 폰트 (자막 번인·텍스트 카드에 필요). 비우면 시스템에서 자동 탐색
  fontPath: z.string().default(''),
  /**
   * 화면 구성.
   * fullscreen = 소스를 화면 전체에 채움
   * framed = 자기 프레임(제목바·하단 정보영역) 안에 소스를 축소 배치 —
   *          재사용 콘텐츠로 분류될 위험을 낮추고 정보 밀도를 올린다
   */
  layout: z.enum(['fullscreen', 'framed']).default('framed'),
  frameTitle: z.string().default(''), // framed 레이아웃 상단 고정 문구 (채널명 등)
  // 씬 사이 텍스트 카드 삽입 (하이브리드 믹싱)
  insertCards: z.boolean().default(true),
  cardDurationSec: z.number().min(0.5).max(4).default(1.5),
  /** 한 소스 클립의 연속 노출 상한 (초). 초과 시 컷 선택 화면에서 경고 */
  maxClipExposureSec: z.number().min(1).max(30).default(3),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ── API 키 (workspace/secrets.json — 절대 커밋 금지) ──────────────

export const SecretsSchema = z.object({
  youtube: z.string().default(''),
  anthropic: z.string().default(''),
  openai: z.string().default(''),
  gemini: z.string().default(''),
  typecast: z.string().default(''),
  googleOauth: z.object({
    clientId: z.string().default(''),
    clientSecret: z.string().default(''),
    refreshToken: z.string().default(''),
  }).default({ clientId: '', clientSecret: '', refreshToken: '' }),
});
export type Secrets = z.infer<typeof SecretsSchema>;

// ── 유튜브 리서치 ─────────────────────────────────────────────────

export const YouTubeVideoSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelId: z.string(),
  channelTitle: z.string(),
  publishedAt: z.string(),
  thumbnail: z.string(),
  viewCount: z.number().default(0),
  likeCount: z.number().default(0),
  commentCount: z.number().default(0),
  durationSec: z.number().default(0),
  url: z.string(),
});
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>;

/**
 * 바이럴 발굴 항목.
 * 지금은 유튜브만 채우지만, 나중에 붙일 틱톡·인스타도 같은 카드로 보여줄 수 있게
 * `source`를 두고 플랫폼 공통 필드만 담는다.
 */
export const ViralItemSchema = z.object({
  video: YouTubeVideoSchema,
  source: z.enum(['youtube', 'tiktok', 'instagram']).default('youtube'),
  /** 이 영상이 걸린 검색 키워드들 (여러 키워드에서 겹쳐 나오면 그만큼 강한 신호) */
  keywords: z.array(z.string()).default([]),
  subscriberCount: z.number().default(0),
  viewsPerDay: z.number().default(0),
  outlierRatio: z.number().default(0),
  ageDays: z.number().default(0),
  discoveredAt: z.string(),
  /** 보관함에 담아둔 항목인지 — 담아둔 것만 workspace에 남는다 */
  note: z.string().default(''),
});
export type ViralItem = z.infer<typeof ViralItemSchema>;

export const ChannelAnalysisSchema = z.object({
  channelId: z.string(),
  title: z.string(),
  description: z.string().default(''),
  thumbnail: z.string().default(''),
  subscriberCount: z.number().default(0),
  videoCount: z.number().default(0),
  totalViewCount: z.number().default(0),
  avgViews: z.number().default(0),
  uploadsPerWeek: z.number().default(0),
  shortsRatio: z.number().default(0), // 최근 영상 중 쇼츠(≤3분) 비율
  recentVideos: z.array(YouTubeVideoSchema).default([]),
  topVideos: z.array(YouTubeVideoSchema).default([]),
});
export type ChannelAnalysis = z.infer<typeof ChannelAnalysisSchema>;

export const QuotaLedgerSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  used: z.number().int().default(0),
});
export type QuotaLedger = z.infer<typeof QuotaLedgerSchema>;

/** 패킷 결과 파일 검증에 쓰는 스키마 레지스트리 */
export const RESULT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  script: ScriptSchema.omit({ version: true }).extend({ version: z.number().int().optional() }),
  product: ProductSchema,
  format: FormatSchema.partial({ id: true, createdAt: true }),
  json: z.any(),
  markdown: z.string(),
};

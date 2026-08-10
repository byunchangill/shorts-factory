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
  ttsVoice: z.string().default('ko-KR-SunHiNeural'),
});
export type Format = z.infer<typeof FormatSchema>;

// ── 소스 URL / 클립 ───────────────────────────────────────────────

export const SourceUrlSchema = z.object({
  id: z.string(),
  url: z.string().url(),
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

export const ClipSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  probe: z.object({
    width: z.number(), height: z.number(),
    fps: z.number(), duration: z.number(),
  }).optional(),
  frames: z.array(z.string()).default([]), // 프레임 이미지 상대경로
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
  kind: z.enum(PACKET_KINDS),
  status: z.enum(PACKET_STATUSES),
  dir: z.string(), // workspace 기준 상대경로
  resultSpec: z.array(z.object({
    file: z.string(),
    schema: z.string(), // 'script' | 'product' | 'format' | 'markdown' | 'json'
  })),
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
  ttsVoice: z.string().optional(),
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
  defaultTtsVoice: z.string().default('ko-KR-SunHiNeural'),
  burnSubtitles: z.boolean().default(true),
  burnDisclosure: z.boolean().default(true), // 쿠팡파트너스 공시 번인
  ytdlpPath: z.string().default('yt-dlp'),
  ffmpegPath: z.string().default('ffmpeg'),
  ffprobePath: z.string().default('ffprobe'),
  edgeTtsPath: z.string().default('edge-tts'),
  iopaintPath: z.string().default('iopaint'),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** 패킷 결과 파일 검증에 쓰는 스키마 레지스트리 */
export const RESULT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  script: ScriptSchema.omit({ version: true }).extend({ version: z.number().int().optional() }),
  product: ProductSchema,
  format: FormatSchema.partial({ id: true, createdAt: true }),
  json: z.any(),
  markdown: z.string(),
};

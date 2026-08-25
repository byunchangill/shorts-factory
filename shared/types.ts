import { z } from 'zod';
import {
  MENUS,
  PACKET_KINDS,
  PACKET_STATUSES,
  GUIDELINE_FILES,
  BLOCKS,
  ASSET_KINDS,
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
  /**
   * 장면이 바뀌는 시각(초). 프레임 추출 때 이미 재는 값이라 버리지 않고 남긴다.
   *
   * 컷 구간이 씬 전환을 물면 화면이 튀는데, 프레임 4장짜리 미리보기로는 안 보인다
   * (샘플이 우연히 같은 씬에 걸린다). 구간을 씬 안쪽으로 자르는 데 쓴다.
   */
  sceneTimes: z.array(z.number()).default([]),
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
   * 템캐스팅 v3.3의 5블록 중 어디인가 (해외영상 짜집기 필수).
   * 선행 구간(①②③)이 러닝타임 연동 표를 지켰는지는 **이 표시가 있어야** 잴 수 있다 —
   * 문장만 보고 훅과 손실을 갈라내는 것은 기계가 못 한다.
   */
  block: z.enum(BLOCKS).optional(),
  /**
   * 이 씬이 제품의 단점·주의사항을 말하는 씬인가.
   * 제품정보리뷰(menu-b)는 최소 1개가 있어야 한다 — 단점 한 줄이
   * "광고 붙여넣기"와 "리뷰"를 가르고, 재사용 심사에서 제작자의 견해로 인정받는 장치다.
   */
  isDownside: z.boolean().default(false),
  /** 이 씬 앞에 끼울 텍스트 카드 문구 (하이브리드 믹싱) */
  cardText: z.string().optional(),
  /**
   * 이 씬 화면 위에 잠깐 얹을 짤 (자료실 자산 id).
   *
   * **씬 사이에 끼우지 않고 위에 얹는다** — 끼우면 영상이 그만큼 길어져 18~26초 예산을
   * 넘긴다. 얹으면 길이가 그대로다 (2026-08-23 사용자 결정).
   *
   * 자료실에서 사라진 id는 조용히 무시한다 — 짤 하나 때문에 조립이 멈추면 안 된다.
   */
  memeId: z.string().optional(),
  /** 짤이 뜨는 시점(씬 시작 기준 초). 비면 씬 시작에 맞춘다 */
  memeAt: z.number().min(0).optional(),
  /** 이 씬 시작에 깔 효과음 (자료실 자산 id). 나레이션 위에 섞인다 */
  sfxId: z.string().optional(),
  /** 효과음이 나는 시점(씬 시작 기준 초). 비면 씬 시작에 맞춘다 */
  sfxAt: z.number().min(0).optional(),
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
  /**
   * 발행 정보 — 성과 대장(`workspace/metrics.csv`)과 이 잡을 잇는 열쇠다.
   * 발행은 사람이 유튜브에서 하므로 앱이 알 길이 없다. 화면에서 주소를 붙여넣어 채운다.
   */
  videoId: z.string().optional(),
  publishedAt: z.string().optional(),
  /** 이 편에 쓴 훅 유형 (대사 인용·금지 명령 등). 다음 편이 연속으로 안 겹치게 하는 재료 */
  hookSeed: z.string().optional(),
  /**
   * 이 편에 쓸 편집 재료(짤방·효과음) — 자료실에서 담은 것들의 id.
   * 캡컷 재료 묶음에 같이 들어간다. 자료실에서 지워진 것은 조용히 빠진다
   * (id를 들고 있어도 파일이 없으면 묶음에서 걸러진다).
   */
  assets: z.array(z.string()).default([]),
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
  /*
    자막 모양. 기본값은 잘 도는 쇼핑쇼츠 한 편을 프레임 단위로 재서 맞춘 값이다
    (CLAUDE.md 「자막·낭독 속도는 레퍼런스에서 재서 맞췄다」). 설정 화면에서 미리보며 바꾼다.
  */
  subtitleFontSize: z.number().int().min(40).max(200).default(118),
  /** 화면 **아래에서** 얼마나 띄울지 (0~1). 하단은 쇼츠 UI가 덮으므로 0.35가 기본이다 */
  subtitleBottomRatio: z.number().min(0.05).max(0.8).default(0.35),
  subtitleOutline: z.number().int().min(0).max(20).default(7),
  /** 한 줄에 몇 글자까지. 글자 크기와 같이 움직인다 — 크게 키우면 줄여야 안 넘친다 */
  subtitleMaxChars: z.number().int().min(6).max(30).default(14),
  subtitleColor: z.string().default('#FFFFFF'),
  /** `*키워드*`로 감싼 부분의 색 */
  subtitleHighlightColor: z.string().default('#FFD800'),
  ytdlpPath: z.string().default('yt-dlp'),
  ffmpegPath: z.string().default('ffmpeg'),
  ffprobePath: z.string().default('ffprobe'),
  iopaintPath: z.string().default('iopaint'),
  /**
   * VSR(video-subtitle-remover) 저장소 폴더. 비우면 이 경로를 안 쓴다.
   *
   * 2차 제거의 1순위다 — 넘긴 좌표를 후보 영역으로만 쓰고 그 안에서 제 OCR이 글자를
   * 찾은 자리만 지운다. iopaint처럼 사각형을 통째로 지우지 않아 배경이 덜 상한다.
   */
  vsrPath: z.string().default(''),
  /** VSR을 돌릴 파이썬. 비우면 저장소 안의 `.venv`를 본다 */
  vsrPython: z.string().default(''),
  /** sttn-auto · sttn-det · lama · propainter · opencv. 이 PC 실측으로 lama가 기본 */
  vsrMode: z.string().default('lama'),
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
   * 나레이션 속도 배율. 쇼츠는 빠른 낭독이 유지율에 유리해 기본 1.6배.
   * 합성 음성에만 적용된다 — 첨부 파일은 사용자가 의도한 속도로 본다.
   * 이 값이 대본 분량 기준을 좌우한다 (`SYLLABLES_PER_MIN` × 배율).
   *
   * 🔴 **1.6에서 끊는 이유가 있다** (2026-08-23 타입캐스트 실측). 1.33→5.23,
   * 1.5→6.08, 1.6→6.51, **1.7→6.56음절/초**로 1.6 위에서는 거의 안 빨라진다 —
   * 앞뒤 무음이 배속을 따라가지 않아서다. 더 올리면 음질만 잃고 분량은 그대로다.
   */
  speechRate: z.number().min(0.5).max(2).default(1.6),
  // 한글 폰트 (자막 번인·텍스트 카드에 필요). 비우면 시스템에서 자동 탐색
  fontPath: z.string().default(''),
  /**
   * 화면 구성.
   * fullscreen = 소스를 화면 전체에 채움
   * banded = **기본값.** 소스를 화면 전체로 채우고 상·하단에 불투명 띠를 덮는다.
   *          상단 띠에 제목, 하단 띠에 채널명이 들어간다 (벤치마킹 채널 레이아웃).
   * framed = 소스를 세로 52%로 줄여 블러 배경 위에 얹는 옛 구성.
   *          9:16 소재에서는 화면이 작아지고 파란 강조 바가 눈에 띄어 기본에서 내렸다
   *
   * 🔴 **`banded`는 띠가 소스를 「덮는다」.** 줄이지 않는다 — 9:16 소재를 띠 아래로 밀어 넣으면
   * 영상이 손톱만 해진다. 덮기 때문에 **띠에 가려지는 자리의 원본 자막은 지울 필요가 없다.**
   */
  layout: z.enum(['fullscreen', 'framed', 'banded']).default('banded'),
  /** 상·하단 띠 배경색 (ffmpeg 색 표기). 벤치마킹 채널은 둘 다 검정이다 */
  bandColor: z.string().default('#0A0A0A'),
  /**
   * 상단 띠 높이 (화면 높이 대비). 제목 두 줄이 들어가는 크기.
   *
   * 제목 글자 크기가 이 값에 비례한다 — 띠를 키우면 글자도 같이 커진다.
   * 하단 띠(0.26)와 너무 차이 나면 화면이 아래로 쏠려 보인다.
   */
  topBandRatio: z.number().min(0).max(0.4).default(0.22),
  /**
   * 짤이 화면에 머무는 시간(초). 길면 영상을 가리고 짧으면 못 알아본다.
   * 1.2초는 짤 한 장을 알아보는 데 걸리는 시간이다.
   */
  memeDurationSec: z.number().min(0.3).max(5).default(1.2),
  /** 짤 가로 폭 (화면 폭 대비) */
  memeWidthRatio: z.number().min(0.1).max(0.9).default(0.38),
  /**
   * 효과음 음량 (나레이션 대비 배율).
   * 1을 넘기면 나레이션을 덮는다 — 효과음은 거들 뿐 말을 가리면 안 된다.
   */
  sfxVolume: z.number().min(0).max(2).default(0.55),
  /**
   * 하단 띠 높이 (화면 높이 대비).
   *
   * 🔴 **채널명 한 줄에 필요한 크기보다 훨씬 크게 잡는다.** 이 띠의 진짜 일은 소재 하단의
   * **원본 자막을 덮는 것**이다 — 벤치마킹 채널 실측이 25~36%였고, 우리가 처음 쓴 8.5%로는
   * 중국어 자막이 그대로 새어 나왔다 (2026-08-23 실측).
   *
   * ⚠️ 자막 자리(`subtitleBottomRatio`, 기본 0.35)보다 **작아야 한다.** 크면 우리 자막이
   * 띠에 먹힌다.
   */
  bottomBandRatio: z.number().min(0).max(0.4).default(0.26),
  /**
   * 제목 첫 줄 색. 벤치마킹 두 채널 모두 **첫 줄 형광 노랑 + 둘째 줄 흰색**을 쓴다 —
   * 목록에서 제목이 두 덩이로 읽혀 눈에 걸린다
   */
  titleAccentColor: z.string().default('#D9FF00'),
  /**
   * 채널 그레이딩 — 조립할 때 모든 영상에 같은 값으로 걸리는 ffmpeg 색보정 필터.
   *
   * 두 가지를 동시에 한다. 소재가 계정마다 색이 제각각인 것을 한 룩으로 묶고,
   * 픽셀을 원본과 다르게 만들어 재사용 판정을 피한다 (`layout: framed`와 같은 목적).
   * 기본값은 대비 +7% / 채도 −6% / 살짝 쿨톤 — 생활·살림의 흰 제품에 맞춘 값이다.
   *
   * **편마다 바꾸지 않는다.** 매 편 같은 값이어야 채널 룩이 된다. 카테고리가 통째로
   * 달라질 때만 바꾼다 (주방·음식은 웜톤 `colorbalance=rs=0.03:rm=0.02`).
   * 비우면 보정하지 않는다.
   */
  grade: z.string().default('eq=contrast=1.07:saturation=0.94:gamma=1.02,colorbalance=bs=0.04:bm=0.02'),
  frameTitle: z.string().default(''), // framed 레이아웃 상단 고정 문구 (채널명 등)
  /**
   * 좌우반전. 중복 회피에는 제일 강한 수단이다 — 픽셀이 통째로 달라진다.
   *
   * 소재 화면에만 걸고 우리가 얹는 층(제목바·자막·카드)에는 안 건다.
   * 그래서 화면의 글자는 뒤집히지 않는다.
   */
  mirror: z.boolean().default(true),
  /**
   * 소재 확대 배율. 1이면 원본 크기.
   *
   * 반전·그레이딩과 같은 목적이다 — **픽셀이 원본과 달라져야 재사용 판정을 피한다.**
   * 화면 가장자리를 조금 잘라내므로 자막이 가장자리에 있는 소재에서는 덤으로 지워진다.
   * 1.2를 넘기면 화질 손실이 눈에 띈다 — 소재가 이미 크롭으로 확대된 상태일 수 있다.
   */
  zoom: z.number().min(1).max(1.2).default(1),
  // 씬 사이 텍스트 카드 삽입 (하이브리드 믹싱)
  insertCards: z.boolean().default(true),
  /**
   * 훅 화면 변화량 임계. 0이면 게이트를 끈다.
   *
   * 발행 14편 실측에서 「계속 시청함」과 상관 있는 유일한 변수였다(r=+0.57).
   * 8에서 통과 11편 중앙값 33.8% / 미달 3편 19.1%. 표본이 늘면 **다시 재서** 바꾼다 —
   * 감으로 올리고 내리면 게이트가 근거를 잃는다.
   */
  hookMotionMin: z.number().min(0).max(60).default(8),
  /**
   * 짤방·효과음 공용 저장소 주소 (`store/assetSync.ts`).
   *
   * 관리자가 여기에 올리면 각 PC가 받아 쓴다. **이 저장소가 아니라 별도 저장소**여야 한다 —
   * 이 리포는 public이라 인터넷 짤을 커밋하면 남의 저작물을 공개 배포하는 셈이 된다.
   * 비워두면 자료실이 로컬 자료만 보여준다 (기능이 꺼지는 것은 아니다).
   */
  assetsRepoUrl: z.string().default(''),
  cardDurationSec: z.number().min(0.5).max(4).default(1.5),
  /**
   * 한 소스 클립의 **연속 노출 상한** (초).
   *
   * 두 곳이 이 하나를 본다 — 컷 선택 화면의 경고와, 조립의 컷 쪼개기(`planCuts`)다.
   * 🔴 예전엔 경고만 이 값을 보고 **조립은 무시했다.** 앱이 「3초 넘으면 재사용 판정
   * 위험」이라 경고해 놓고 씬 하나를 클립 하나로 12초씩 통째로 틀었다 (2026-08-23 실측).
   *
   * 기본 2초는 벤치마킹 쇼츠 3편의 컷 간격 중앙값(1.6·1.7·2.0초)에서 왔다.
   */
  maxClipExposureSec: z.number().min(1).max(30).default(2),
  /**
   * 인트로 타이틀이 떠 있는 시간 (초). 0이면 안 넣는다.
   *
   * 벤치마킹 쇼츠 3편이 전부 1.8~2.2초짜리 제목으로 연다. 🔴 **정지 카드가 아니다** —
   * 우리 훅 게이트로 그 셋을 채점하니 10.6·18.4·22.2로 전부 통과했다. 움직이는 제품
   * 영상 **위에** 큰 제목을 얹은 것이다. 정지 카드로 만들면 14편으로 잰 유일한 유효
   * 변수(첫 0.5초 화면 변화량, r=+0.57)와 정면으로 부딪힌다.
   *
   * 제품정보리뷰에만 걸린다 — 해외영상 짜집기는 음성=자막이라 안 읽는 글자를 못 띄운다.
   */
  introTitleSec: z.number().min(0).max(4).default(2),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ── API 키 (workspace/secrets.json — 절대 커밋 금지) ──────────────

export const SecretsSchema = z.object({
  youtube: z.string().default(''),
  anthropic: z.string().default(''),
  openai: z.string().default(''),
  gemini: z.string().default(''),
  typecast: z.string().default(''),
  /** 짤방·효과음 공용 저장소가 private일 때 쓰는 읽기 토큰 (`store/assetSync.ts`) */
  assetsToken: z.string().default(''),
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

// ── 편집 재료 자료실 (짤방·효과음) ────────────────────────────────

/**
 * 자료 하나. **파일시스템이 진실이다** — 목록은 폴더를 훑어 만든다.
 *
 * 그래서 인덱스 파일이 깨져도 자료가 사라지지 않고, 관리자가 공용 저장소에 파일만
 * 올려도 각 PC에서 그대로 보인다. `id`는 `{origin}:{kind폴더}/{파일명}` 형태라
 * 목록을 다시 만들어도 잡이 들고 있던 id가 그대로 맞는다.
 */
export const AssetSchema = z.object({
  id: z.string(),
  kind: z.enum(ASSET_KINDS),
  /** shared = 공용 저장소에서 받은 것(모든 PC 공통), local = 이 PC에서만 */
  origin: z.enum(['shared', 'local']),
  /** workspace 기준 상대경로 */
  file: z.string(),
  /** 미리보기 주소 (`/media/...`) */
  url: z.string(),
  title: z.string(),
  tags: z.array(z.string()).default([]),
  bytes: z.number().default(0),
  /**
   * 이 PC에서 숨긴 공용 자료인가. 목록은 기본으로 숨긴 것을 빼고 주므로 늘 false지만,
   * 「숨긴 것도 보기」로 받을 때는 어느 것이 숨겨진 것인지 화면이 알아야 한다.
   */
  hidden: z.boolean().default(false),
});
export type Asset = z.infer<typeof AssetSchema>;

/**
 * 이 PC에만 남는 덧칠. **공용 자료를 지우거나 고치는 유일한 방법이다** —
 * 공용 폴더의 파일을 직접 건드리면 다음 동기화에서 되살아나거나 충돌로 동기화가 막힌다.
 */
export const AssetLocalStateSchema = z.object({
  /** 이 PC에서 숨긴 공용 자료의 id */
  hidden: z.array(z.string()).default([]),
  /** id별 제목·태그 덧칠 (공용 자료에도 붙일 수 있다) */
  meta: z.record(z.object({
    title: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })).default({}),
  syncedAt: z.string().optional(),
});
export type AssetLocalState = z.infer<typeof AssetLocalStateSchema>;

/**
 * 공용 저장소가 같이 커밋하는 목록 (`library.json`, 선택).
 * 없으면 파일명에서 제목을 만든다 — 관리자가 파일만 올려도 동작해야 한다.
 */
export const AssetLibrarySchema = z.object({
  items: z.array(z.object({
    file: z.string(),
    title: z.string().optional(),
    tags: z.array(z.string()).default([]),
  })).default([]),
});
export type AssetLibrary = z.infer<typeof AssetLibrarySchema>;


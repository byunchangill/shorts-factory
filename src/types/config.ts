/**
 * 콘텐츠 타입 및 전역 설정 타입
 */

export type ContentType = 'dog' | 'sseoltoon' | 'health';

export interface AppConfig {
  youtubeApiKey: string;
  braveApiKey?: string;
  comfyuiUrl: string;
  projectDir: string;
}

// ── 음성 설정 ──
export interface VoiceConfig {
  voice: string;
  rate: string;
  pitch: string;
}

export const VOICE_SETTINGS: Record<ContentType, VoiceConfig> = {
  dog:       { voice: 'ko-KR-SunHiNeural',  rate: '-5%',  pitch: '+0Hz' },
  sseoltoon: { voice: 'ko-KR-HyunsuNeural', rate: '+3%',  pitch: '+0Hz' },
  health:    { voice: 'ko-KR-InJoonNeural',  rate: '+0%',  pitch: '+0Hz' },
};

// ── BGM 설정 ──
export interface BgmConfig {
  file: string;
  vol: number;
  fadeIn: number;
  fadeOut: number;
}

export const BGM_SETTINGS: Record<ContentType, BgmConfig> = {
  dog:       { file: 'emotional-piano.mp3',  vol: 0.12, fadeIn: 1,   fadeOut: 2 },
  sseoltoon: { file: 'suspense-beat.mp3',    vol: 0.10, fadeIn: 0.5, fadeOut: 1.5 },
  health:    { file: 'calm-corporate.mp3',    vol: 0.10, fadeIn: 1,   fadeOut: 2 },
};

// ── ComfyUI 카테고리 설정 ──
export interface ComfyuiCategorySettings {
  checkpoint: string;
  lora: string;
  loraWeight: number;
  sampler: string;
  steps: number;
  cfg: number;
}

export const COMFYUI_SETTINGS: Record<ContentType, ComfyuiCategorySettings> = {
  dog: {
    checkpoint: 'dreamshaper_8.safetensors',
    lora: 'watercolor_v1.safetensors',
    loraWeight: 0.7,
    sampler: 'euler_ancestral',
    steps: 30, cfg: 7.0,
  },
  sseoltoon: {
    checkpoint: 'animagine_xl_v3.safetensors',
    lora: 'korean_webtoon_v2.safetensors',
    loraWeight: 0.8,
    sampler: 'dpmpp_2m',
    steps: 25, cfg: 8.0,
  },
  health: {
    checkpoint: 'dreamshaper_8.safetensors',
    lora: 'flat_design_v1.safetensors',
    loraWeight: 0.6,
    sampler: 'euler_ancestral',
    steps: 25, cfg: 7.0,
  },
};

// ── 검색 쿼리 확장 ──
export const QUERY_EXPANSION: Record<string, string[]> = {
  '강아지': ['강아지 감동 실화 shorts', '강아지 감동 쇼츠', '반려견 감동 shorts'],
  '썰':    ['썰툰 레전드 shorts', '실화 썰 쇼츠 반전', '썰 소름 shorts'],
  '건강':  ['건강 상식 shorts', '건강 효능 쇼츠', '몸에 좋은 음식 shorts'],
};

export const FALLBACK_QUERIES: Record<string, string[]> = {
  '강아지': ['유기견 감동', '반려동물 스토리', '강아지 기적 실화'],
  '썰':    ['실화 모음 쇼츠', '소름 썰 레전드', '인간관계 썰'],
  '건강':  ['건강 꿀팁 쇼츠', '영양소 효능', '건강 습관 shorts'],
};

export const COMMON_NEGATIVE_PROMPT =
  'deformed, blurry, bad anatomy, extra limbs, extra fingers, ' +
  'mutated hands, poorly drawn face, ugly, text, watermark, ' +
  'signature, out of frame, duplicate, lowres, jpeg artifacts';

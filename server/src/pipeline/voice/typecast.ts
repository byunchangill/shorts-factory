import fsp from 'node:fs/promises';
import { getKey } from '../../store/secrets.js';

/**
 * Typecast API 어댑터.
 * 공식 스펙: https://typecast.ai/docs/api-reference
 *   - 인증: X-API-KEY 헤더
 *   - GET  /v1/voices          → [{ voice_id, voice_name, model, emotions[] }]
 *   - POST /v1/text-to-speech  → 오디오 바이너리 (JSON 아님)
 */

const BASE = 'https://api.typecast.ai/v1';
const TIMEOUT_MS = 120_000;

/** 기본 모델 — ssfm-v30은 37개 언어·7종 감정 프리셋을 지원한다 */
export const DEFAULT_MODEL = 'ssfm-v30';
/** 한국어 ISO-639-3 코드 (API는 3자리 코드를 받는다) */
export const KOREAN = 'kor';
/** 문서에 명시된 출력 포맷. 합성 결과 파일 확장자와 맞춰야 한다 */
export const AUDIO_FORMAT = 'wav';
export const AUDIO_EXT = '.wav';
export const AUDIO_MIME = 'audio/wav';

export interface TypecastVoice {
  id: string;
  name: string;
  model: string;
  emotions: string[];
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const key = await getKey('typecast');
  if (!key) throw new Error('Typecast API 키가 등록되지 않았습니다 (API 키 메뉴에서 등록)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'X-API-KEY': key, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Typecast API 오류 ${r.status}: ${body.slice(0, 300)}`);
    }
    return r;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('Typecast API 응답 시간 초과');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * /v1/voices 응답 → 내부 형태.
 * 문서상 응답은 최상위 배열이지만, 래핑된 형태로 와도 견디도록 처리한다.
 * (순수 함수 — 단위 테스트 대상)
 */
export function parseVoices(data: unknown, fallbackModel = DEFAULT_MODEL): TypecastVoice[] {
  const items: unknown[] = Array.isArray(data)
    ? data
    : (() => {
        const o = (data ?? {}) as Record<string, unknown>;
        const found = o.voices ?? o.result ?? o.items ?? o.data;
        return Array.isArray(found) ? found : [];
      })();

  return items
    .map((raw) => {
      const v = (raw ?? {}) as Record<string, unknown>;
      const id = String(v.voice_id ?? '');
      return {
        id,
        name: String(v.voice_name ?? id ?? '이름 없음'),
        model: String(v.model ?? fallbackModel),
        emotions: Array.isArray(v.emotions) ? (v.emotions as unknown[]).map(String) : [],
      };
    })
    .filter((v) => v.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 사용 가능한 캐릭터(보이스) 목록 */
export async function listVoices(model = DEFAULT_MODEL): Promise<TypecastVoice[]> {
  const r = await call(`/voices?model=${encodeURIComponent(model)}`);
  return parseVoices(await r.json(), model);
}

export interface SynthesizeOptions {
  model?: string;
  language?: string;
  /** ssfm-v30 프리셋: normal | happy | sad | angry | whisper | toneup | tonedown */
  emotion?: string;
  /** 음정 반음 (-12 ~ 12) */
  pitch?: number;
  /** 속도 배율 (0.5 ~ 2.0) */
  tempo?: number;
}

/** 텍스트 → 음성 바이너리. 미리듣기와 실제 합성 모두 이 함수를 쓴다 */
export async function synthesize(
  text: string,
  voiceId: string,
  opts: SynthesizeOptions = {},
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    voice_id: voiceId,
    text,
    model: opts.model ?? DEFAULT_MODEL,
    language: opts.language ?? KOREAN,
    output: {
      volume: 100,
      audio_pitch: opts.pitch ?? 0,
      audio_tempo: opts.tempo ?? 1,
      audio_format: AUDIO_FORMAT,
    },
  };
  if (opts.emotion) {
    body.prompt = { emotion_preset: opts.emotion };
  }

  const r = await call('/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // 정상 응답은 오디오 바이너리다. 혹시 JSON(URL 형태)으로 오면 받아서 내려받는다.
  const contentType = r.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await r.json();
    const url = data.audio_url ?? data.url ?? data.result?.audio_url;
    if (!url) throw new Error(`Typecast 응답에서 오디오를 찾지 못했습니다: ${JSON.stringify(data).slice(0, 200)}`);
    const audio = await fetch(url);
    if (!audio.ok) throw new Error(`오디오 다운로드 실패: ${audio.status}`);
    return Buffer.from(await audio.arrayBuffer());
  }

  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length === 0) throw new Error('Typecast가 빈 오디오를 반환했습니다');
  return buf;
}

export async function synthesizeToFile(
  text: string,
  voiceId: string,
  outPath: string,
  opts: SynthesizeOptions = {},
): Promise<void> {
  await fsp.writeFile(outPath, await synthesize(text, voiceId, opts));
}

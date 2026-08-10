import fsp from 'node:fs/promises';
import { getKey } from '../../store/secrets.js';

/**
 * Typecast API 어댑터.
 * 공개 API 스펙이 버전에 따라 응답 형태가 달라서, 목록·합성 모두
 * 흔한 응답 형태 몇 가지를 모두 받아들이도록 방어적으로 파싱한다.
 */

const BASE = 'https://typecast.ai/api';
const TIMEOUT_MS = 120_000;

export interface TypecastVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  emotions: string[];
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const key = await getKey('typecast');
  if (!key) throw new Error('Typecast API 키가 등록되지 않았습니다 (API 키 메뉴에서 등록)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...init,
      headers: { 'X-API-KEY': key, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Typecast API 오류 ${r.status}: ${body.slice(0, 200)}`);
    }
    return r;
  } finally {
    clearTimeout(timer);
  }
}

/** 사용 가능한 캐릭터(보이스) 목록 — 한국어 우선 정렬 */
export async function listVoices(): Promise<TypecastVoice[]> {
  const r = await call(`${BASE}/voices`);
  const data = await r.json();
  const items: unknown[] = Array.isArray(data)
    ? data
    : (data.result ?? data.voices ?? data.items ?? []);

  const voices = items.map((raw) => {
    const v = raw as Record<string, unknown>;
    return {
      id: String(v.voice_id ?? v.id ?? v.actor_id ?? ''),
      name: String(v.name ?? v.voice_name ?? v.title ?? '이름 없음'),
      language: String(v.language ?? v.lang ?? ''),
      gender: String(v.gender ?? ''),
      emotions: Array.isArray(v.emotions)
        ? (v.emotions as unknown[]).map(String)
        : Array.isArray(v.emotion_tone_presets)
          ? (v.emotion_tone_presets as unknown[]).map(String)
          : [],
    };
  }).filter((v) => v.id);

  // 한국어 보이스를 위로
  return voices.sort((a, b) => {
    const ak = a.language.toLowerCase().startsWith('ko') ? 0 : 1;
    const bk = b.language.toLowerCase().startsWith('ko') ? 0 : 1;
    return ak - bk || a.name.localeCompare(b.name);
  });
}

/** 텍스트 → 음성 바이너리. 미리듣기와 실제 합성 모두 이 함수를 쓴다 */
export async function synthesize(text: string, voiceId: string): Promise<Buffer> {
  const r = await call(`${BASE}/text-to-speech`, {
    method: 'POST',
    body: JSON.stringify({
      voice_id: voiceId,
      text,
      model: 'ssfm-v21',
      language: 'kor',
      output: { audio_format: 'mp3' },
    }),
  });

  const contentType = r.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // 일부 응답은 오디오 URL을 돌려준다
    const data = await r.json();
    const url = data.audio_url ?? data.url ?? data.result?.audio_url;
    if (!url) throw new Error('Typecast 응답에서 오디오를 찾지 못했습니다');
    const audio = await fetch(url);
    if (!audio.ok) throw new Error(`오디오 다운로드 실패: ${audio.status}`);
    return Buffer.from(await audio.arrayBuffer());
  }
  return Buffer.from(await r.arrayBuffer());
}

export async function synthesizeToFile(text: string, voiceId: string, outPath: string): Promise<void> {
  const buf = await synthesize(text, voiceId);
  await fsp.writeFile(outPath, buf);
}

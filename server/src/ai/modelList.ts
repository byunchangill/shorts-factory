import { getKey } from '../store/secrets.js';

/**
 * 고를 수 있는 모델 목록.
 *
 * **목록을 코드에 박아 두지 않는다.** 모델은 몇 달마다 바뀌는데 박아 두면 그날부터
 * 낡기 시작하고, 새 모델이 나와도 화면에서 못 고른다. 등록된 키로 각 제공자에게
 * 직접 물어본다. 키가 없거나 응답이 안 오면 화면은 직접 입력으로 떨어진다.
 */

export type AiProvider = 'anthropic' | 'openai' | 'gemini';

export interface AiModel {
  id: string;
  /** 사람이 읽는 이름 (없으면 id) */
  label: string;
}

const TIMEOUT_MS = 15_000;
/** 목록은 자주 안 바뀐다 — 화면을 열 때마다 외부로 나가지 않게 잠깐 들고 있는다 */
const CACHE_MS = 10 * 60 * 1000;

const cache = new Map<AiProvider, { at: number; models: AiModel[] }>();

async function get(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 제공자 응답 → 모델 목록 (순수 함수 — 테스트 대상).
 * 세 곳의 응답 모양이 다 다르다. 대화용이 아닌 모델(임베딩·음성·이미지)은 걸러 낸다.
 */
export function parseModels(provider: AiProvider, data: unknown): AiModel[] {
  const d = (data ?? {}) as Record<string, unknown>;
  if (provider === 'gemini') {
    const items = Array.isArray(d.models) ? d.models : [];
    return items
      .map((raw) => {
        const m = (raw ?? {}) as Record<string, unknown>;
        const id = String(m.name ?? '').replace(/^models\//, '');
        const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        return { id, label: String(m.displayName ?? id), chat: methods.includes('generateContent') };
      })
      .filter((m) => m.id && m.chat)
      .map(({ id, label }) => ({ id, label }));
  }

  const items = Array.isArray(d.data) ? d.data : [];
  const models = items
    .map((raw) => {
      const m = (raw ?? {}) as Record<string, unknown>;
      const id = String(m.id ?? '');
      return { id, label: String(m.display_name ?? id) };
    })
    .filter((m) => m.id);

  if (provider === 'openai') {
    // 대화 모델만 — 임베딩·음성·이미지·검열 모델은 요청서 처리에 못 쓴다
    return models.filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id)
      && !/(embedding|audio|realtime|image|tts|whisper|moderation|transcribe)/.test(m.id));
  }
  return models;
}

const ENDPOINT: Record<AiProvider, (key: string) => { url: string; headers: Record<string, string> }> = {
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=100',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  gemini: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
    headers: {},
  }),
};

export interface ModelListResult {
  provider: AiProvider;
  models: AiModel[];
  /** 목록을 못 받은 이유 — 화면은 이걸 보여 주고 직접 입력으로 떨어진다 */
  error?: string;
}

export async function listModels(provider: AiProvider): Promise<ModelListResult> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < CACHE_MS) return { provider, models: hit.models };

  const key = await getKey(provider);
  if (!key) return { provider, models: [], error: 'API 키가 등록되지 않았습니다' };

  try {
    const { url, headers } = ENDPOINT[provider](key);
    const models = parseModels(provider, await get(url, headers))
      .sort((a, b) => a.id.localeCompare(b.id));
    cache.set(provider, { at: Date.now(), models });
    return { provider, models };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider, models: [], error: msg.includes('abort') ? '응답 시간 초과' : msg };
  }
}

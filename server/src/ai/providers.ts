import type { AiProvider } from '@shared/constants';
import type { Settings } from '@shared/types';
import { loadSecrets } from '../store/secrets.js';

export interface AiRunOptions {
  prompt: string;
  settings: Settings;
  maxTokens?: number;
}

const TIMEOUT_MS = 180_000;

async function post(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureOk(r: Response, provider: string): Promise<void> {
  if (r.ok) return;
  let body = '';
  try {
    body = (await r.text()).slice(0, 300);
  } catch { /* 본문 없음 */ }
  throw new Error(`${provider} API 오류 ${r.status}: ${body}`);
}

/** SDK 없이 fetch로 호출 — 의존성 추가 없이 3사 지원 */
export async function runProvider(provider: AiProvider, opts: AiRunOptions): Promise<string> {
  const secrets = await loadSecrets();
  const { settings, prompt } = opts;
  const maxTokens = opts.maxTokens ?? 8000;

  switch (provider) {
    case 'anthropic': {
      const key = secrets.anthropic;
      if (!key) throw new Error('Anthropic API 키가 등록되지 않았습니다');
      const r = await post('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.aiModels.anthropic,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      await ensureOk(r, 'Anthropic');
      const data = await r.json();
      return (data.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n');
    }

    case 'openai': {
      const key = secrets.openai;
      if (!key) throw new Error('OpenAI API 키가 등록되지 않았습니다');
      const r = await post('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: settings.aiModels.openai,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      await ensureOk(r, 'OpenAI');
      const data = await r.json();
      return data.choices?.[0]?.message?.content ?? '';
    }

    case 'gemini': {
      const key = secrets.gemini;
      if (!key) throw new Error('Gemini API 키가 등록되지 않았습니다');
      const model = settings.aiModels.gemini;
      const r = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        },
      );
      await ensureOk(r, 'Gemini');
      const data = await r.json();
      return (data.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? '')
        .join('\n');
    }
  }
}

/** 키가 등록된 프로바이더 목록 (UI에서 선택 가능 여부 표시용) */
export async function availableProviders(): Promise<Record<AiProvider, boolean>> {
  const s = await loadSecrets();
  return {
    anthropic: !!s.anthropic,
    openai: !!s.openai,
    gemini: !!s.gemini,
  };
}

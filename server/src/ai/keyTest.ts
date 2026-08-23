import type { ApiKeyName } from '@shared/constants';

export interface KeyTestResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

const TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 각 API의 가장 저렴한(또는 무료) 엔드포인트를 호출해 키 유효성만 확인한다.
 * 실패 시 응답 본문 일부를 그대로 노출해 원인 파악을 돕는다.
 */
export async function testKey(name: ApiKeyName, key: string): Promise<KeyTestResult> {
  try {
    switch (name) {
      case 'youtube': {
        // videoCategories.list = 1유닛
        const r = await fetchWithTimeout(
          `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=KR&key=${encodeURIComponent(key)}`,
          { method: 'GET' },
        );
        if (!r.ok) return { ok: false, error: await shortError(r) };
        const data = await r.json();
        return { ok: true, detail: `카테고리 ${data.items?.length ?? 0}개 조회됨 (1유닛 사용)` };
      }
      case 'anthropic': {
        const r = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        if (!r.ok) return { ok: false, error: await shortError(r) };
        const data = await r.json();
        return { ok: true, detail: `모델 ${data.data?.length ?? 0}종 사용 가능` };
      }
      case 'openai': {
        const r = await fetchWithTimeout('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!r.ok) return { ok: false, error: await shortError(r) };
        const data = await r.json();
        return { ok: true, detail: `모델 ${data.data?.length ?? 0}종 사용 가능` };
      }
      case 'gemini': {
        const r = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          { method: 'GET' },
        );
        if (!r.ok) return { ok: false, error: await shortError(r) };
        const data = await r.json();
        return { ok: true, detail: `모델 ${data.models?.length ?? 0}종 사용 가능` };
      }
      case 'typecast': {
        const r = await fetchWithTimeout('https://api.typecast.ai/v1/voices', {
          method: 'GET',
          headers: { 'X-API-KEY': key },
        });
        if (!r.ok) return { ok: false, error: await shortError(r) };
        const data = await r.json();
        const count = Array.isArray(data)
          ? data.length
          : (data.voices?.length ?? data.result?.length ?? data.items?.length ?? 0);
        return { ok: true, detail: `캐릭터 ${count}종 사용 가능` };
      }
      /*
        자료 저장소 토큰은 깃허브 PAT다. 여기서는 **토큰이 살아 있는지**만 본다 —
        그 저장소에 접근되는지는 자료실의 「공용 자료 받기」가 실제로 클론해 보며 확인한다
        (저장소 주소는 설정에 있고 깃허브가 아닐 수도 있다).
      */
      case 'assetsToken': {
        const r = await fetchWithTimeout('https://api.github.com/user', {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json' },
        });
        if (!r.ok) return { ok: false, error: await shortError(r) };
        const data = await r.json();
        return { ok: true, detail: `깃허브 계정 ${data.login ?? '(이름 없음)'} 확인됨` };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes('abort') ? '응답 시간 초과' : msg };
  }
}

async function shortError(r: Response): Promise<string> {
  let body = '';
  try {
    body = (await r.text()).slice(0, 200);
  } catch { /* 본문 없음 */ }
  return `${r.status} ${r.statusText}${body ? ` — ${body}` : ''}`;
}

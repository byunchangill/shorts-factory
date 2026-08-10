/**
 * API 서버(:4310) 연결 상태.
 * 서버가 안 떠 있으면 모든 화면이 원인 모를 실패로 보이므로, 여기서 한 곳에 모아
 * 상단 배너로 알린다.
 */
export type ApiHealth = { online: true } | { online: false; reason: string };

let health: ApiHealth = { online: true };
const listeners = new Set<(h: ApiHealth) => void>();

export function subscribeApiHealth(fn: (h: ApiHealth) => void): () => void {
  listeners.add(fn);
  fn(health);
  return () => listeners.delete(fn);
}

function setHealth(next: ApiHealth): void {
  const unchanged = next.online
    ? health.online
    : !health.online && health.reason === next.reason;
  if (unchanged) return;
  health = next;
  for (const fn of listeners) fn(health);
}

/** 배너의 "다시 시도" — 서버가 살아났는지 직접 확인한다 */
export async function pingApi(): Promise<boolean> {
  try {
    const res = await fetch('/api/system/status');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setHealth({ online: false, reason: body.error ?? OFFLINE_MESSAGE });
      return false;
    }
    setHealth({ online: true });
    return true;
  } catch {
    setHealth({ online: false, reason: OFFLINE_MESSAGE });
    return false;
  }
}

const OFFLINE_MESSAGE =
  'API 서버(localhost:4310)에 연결할 수 없습니다. `npm run dev` 터미널의 [api] 로그를 확인하세요.';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let offline = false;
    let booting = false;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.details) message += `: ${body.details.join(', ')}`;
      offline = !!body.offline;
      booting = !!body.booting;
    } catch { /* JSON 아님 */ }
    // 503 offline은 vite 프록시가 만든 것 — API 서버 자체가 죽어 있다
    if (offline) setHealth({ online: false, reason: message });
    else if (booting) setHealth({ online: false, reason: message });
    else setHealth({ online: true });
    throw new Error(message);
  }
  setHealth({ online: true });
  return res.json() as Promise<T>;
}

/** fetch 자체가 실패하면(서버 다운·프록시 없음) 원인을 알 수 있는 메시지로 바꾼다 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    setHealth({ online: false, reason: OFFLINE_MESSAGE });
    throw new Error(OFFLINE_MESSAGE);
  }
  return handle<T>(res);
}

const json = (body: unknown): RequestInit['body'] =>
  body !== undefined ? JSON.stringify(body) : undefined;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const api = {
  get: <T>(url: string) => request<T>(`/api${url}`),
  post: <T>(url: string, body?: unknown) =>
    request<T>(`/api${url}`, { method: 'POST', headers: JSON_HEADERS, body: json(body) }),
  put: <T>(url: string, body: unknown) =>
    request<T>(`/api${url}`, { method: 'PUT', headers: JSON_HEADERS, body: json(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(`/api${url}`, { method: 'PATCH', headers: JSON_HEADERS, body: json(body) }),
  upload: <T>(url: string, formData: FormData) =>
    request<T>(`/api${url}`, { method: 'POST', body: formData }),
};

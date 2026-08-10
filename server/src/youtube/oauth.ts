import { API_PORT } from '@shared/constants';
import { loadSecrets, saveSecrets } from '../store/secrets.js';

/**
 * 구글 OAuth 2.0 루프백 플로우 (로컬 앱용).
 * 내 채널의 비공개 통계(YouTube Analytics API)를 읽기 위해서만 사용하며,
 * 요청하는 스코프는 모두 읽기 전용이다.
 */

export const REDIRECT_URI = `http://localhost:${API_PORT}/api/youtube/oauth/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export async function buildAuthUrl(state: string): Promise<string> {
  const secrets = await loadSecrets();
  const { clientId } = secrets.googleOauth;
  if (!clientId) {
    throw Object.assign(
      new Error('구글 OAuth 클라이언트 ID가 없습니다. API 키 메뉴에서 등록하세요 (tools/setup-youtube-oauth.md 참고)'),
      { status: 400 },
    );
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent'); // refresh_token을 확실히 받기 위해
  url.searchParams.set('state', state);
  return url.toString();
}

/** 인가 코드 → refresh_token 저장 */
export async function exchangeCode(code: string): Promise<void> {
  const secrets = await loadSecrets();
  const { clientId, clientSecret } = secrets.googleOauth;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`토큰 교환 실패 ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data.refresh_token) {
    throw new Error('refresh_token을 받지 못했습니다. 구글 계정 연결을 해제한 뒤 다시 시도하세요.');
  }
  secrets.googleOauth.refreshToken = data.refresh_token;
  await saveSecrets(secrets);
}

/** 액세스 토큰은 짧게 살아 있으므로 매번 refresh_token으로 발급받는다 */
export async function getAccessToken(): Promise<string> {
  const secrets = await loadSecrets();
  const { clientId, clientSecret, refreshToken } = secrets.googleOauth;
  if (!refreshToken) {
    throw Object.assign(new Error('구글 계정이 연결되지 않았습니다'), { status: 401 });
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw Object.assign(
      new Error(`액세스 토큰 갱신 실패 ${r.status}: ${body.slice(0, 200)}`),
      { status: 401 },
    );
  }
  const data = await r.json();
  return data.access_token as string;
}

export async function isConnected(): Promise<boolean> {
  const secrets = await loadSecrets();
  return !!secrets.googleOauth.refreshToken;
}

export async function disconnect(): Promise<void> {
  const secrets = await loadSecrets();
  secrets.googleOauth.refreshToken = '';
  await saveSecrets(secrets);
}

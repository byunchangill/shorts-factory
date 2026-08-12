import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';

/**
 * 실제로 터진 두 가지를 고정한다.
 *
 * 1) PUT /keys/google-oauth 가 `/keys/:name` 에 먼저 잡혀 키 이름 enum 검증에서 튕겼다
 * 2) 그 zod 예외가 Express 4에서 unhandledRejection으로 새어나가 **응답 자체가 오지 않았다**
 *    (화면은 저장 중에서 멈추고 서버 로그에만 스택이 찍힌다)
 */

let base: string;
let server: http.Server;
let tmp: string;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'keys-route-'));
  process.env.SHORTS_WORKSPACE = tmp;

  const [{ default: express }, { ZodError }, { default: keyRoutes }] = await Promise.all([
    import('express'),
    import('zod'),
    import('./keys.js'),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api', keyRoutes);
  // app.ts와 같은 에러 핸들러 — 이게 실제로 불려야 한다
  app.use((err: unknown, _req: unknown, res: any, _next: unknown) => {
    if (err instanceof ZodError) return res.status(400).json({ error: '입력값 오류' });
    res.status(500).json({ error: String(err) });
  });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await fsp.rm(tmp, { recursive: true, force: true });
  delete process.env.SHORTS_WORKSPACE;
});

describe('API 키 라우트', () => {
  it('구글 OAuth 클라이언트 정보를 저장한다 (:name 에 먼저 잡히지 않는다)', async () => {
    const res = await fetch(`${base}/keys/google-oauth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' }),
    });
    expect(res.status).toBe(200);

    const list = await (await fetch(`${base}/keys`)).json();
    expect(list.googleOauth.clientIdConfigured).toBe(true);
    expect(list.googleOauth.clientSecretConfigured).toBe(true);
  });

  it('모르는 키 이름은 응답 없이 죽지 않고 400으로 답한다', async () => {
    const res = await fetch(`${base}/keys/no-such-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('키를 저장하면 값은 감춘 채 등록 여부만 알려준다', async () => {
    await fetch(`${base}/keys/typecast`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'tc_secret_1234' }),
    });
    const list = await (await fetch(`${base}/keys`)).json();
    const typecast = list.keys.find((k: { name: string }) => k.name === 'typecast');
    expect(typecast.configured).toBe(true);
    expect(typecast.masked).toContain('1234');
    expect(typecast.masked).not.toContain('secret');
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';

/**
 * 업로드 관문 — **거부한 파일이 자료실에 흔적을 남기지 않는가.**
 *
 * 🔴 실제로 터진 것을 고정한다 (2026-08-26). `multer.diskStorage`는 핸들러가 돌기 **전에**
 * 파일을 쓴다. 받는 자리가 자료실 폴더였을 때, 출처 검사가 400을 돌려줘도 파일은 그대로
 * 남았고 — **목록의 진실이 파일시스템이라** — 거부된 자료가 출처 없이 목록에 떴다.
 * 핀터레스트라서 이름을 박아 막은 파일까지 들어왔는데 진짜 출처는 아무 데도 안 남아,
 * 나중에 화이트리스트 URL을 적으면 블랙리스트가 뚫렸다.
 *
 * 하네스도 이 경로를 밟지만 8분이 걸린다. 관문은 몇 초 만에 도는 검사로 잠가 둔다.
 */

let base: string;
let server: http.Server;
let tmp: string;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'assets-route-'));
  process.env.SHORTS_WORKSPACE = tmp;

  const [{ default: express }, { ZodError }, { default: assetRoutes }] = await Promise.all([
    import('express'),
    import('zod'),
    import('./assets.js'),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api', assetRoutes);
  // app.ts와 같은 에러 핸들러 — `status`가 붙은 예외가 400으로 나가야 한다
  app.use((err: unknown, _req: unknown, res: any, _next: unknown) => {
    if (err instanceof ZodError) return res.status(400).json({ error: '입력값 오류' });
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
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

beforeEach(async () => {
  await fsp.rm(path.join(tmp, 'assets'), { recursive: true, force: true });
  await fsp.rm(path.join(tmp, '.uploads'), { recursive: true, force: true });
});

/** 자료 올리기. `fields`에 넣은 것만 실린다 (안 넣으면 안 보낸 것이다) */
async function upload(
  name: string,
  fields: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return uploadMany([[name, 'GIF89a']], fields);
}

/** 여러 파일을 한 요청에. 각 항목은 `[파일명, 내용]` — 내용으로 누가 이겼는지 가른다 */
async function uploadMany(
  files: Array<[string, string]>,
  fields: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const fd = new FormData();
  for (const [name, body] of files) {
    fd.append('files', new Blob([Buffer.from(body)], { type: 'image/gif' }), name);
  }
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/assets?kind=meme`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** 자료실에 실제로 들어간 바이트 */
async function bytesOf(file: string): Promise<string> {
  return fsp.readFile(path.join(tmp, 'assets', 'local', 'memes', file), 'utf8');
}

/** 대기 자리에 남은 것 */
async function staged(): Promise<string[]> {
  return fsp.readdir(path.join(tmp, '.uploads')).catch(() => [] as string[]);
}

async function listed(): Promise<any[]> {
  return (await (await fetch(`${base}/assets`)).json()).items;
}

/** 자료실 폴더에 실제로 있는 파일 (목록이 아니라 디스크를 본다) */
async function filesOnDisk(): Promise<string[]> {
  return fsp.readdir(path.join(tmp, 'assets', 'local', 'memes')).catch(() => [] as string[]);
}

const PIXABAY = 'https://pixabay.com/gifs/1/';

describe('POST /assets — 출처 관문', () => {
  it('출처를 갖추면 올라가고 목록에 출처가 남는다', async () => {
    const r = await upload('놀란 고양이.gif', { sourceUrl: PIXABAY, hasFace: 'false' });
    expect(r.status).toBe(200);
    const items = await listed();
    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe(PIXABAY);
    // 화이트리스트 사이트면 라이선스 이름이 자동으로 붙는다
    expect(items[0].license).toBe('Pixabay Content License');
    expect(items[0].hasFace).toBe(false);
    expect(await filesOnDisk()).toHaveLength(1);
  });

  /*
    🔴 400만 보고 넘어가면 안 되는 자리다. 「거부했다」는 응답이 아니라 **자료실 상태**로
    확인해야 한다 — 예전 구현도 400은 정확히 돌려줬고, 파일만 들어와 있었다.
  */
  it('출처 없이 올리면 400이고 자료실에 아무것도 안 남는다', async () => {
    const r = await upload('무출처.gif');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('출처 URL이 필요합니다');
    expect(await listed()).toEqual([]);
    expect(await filesOnDisk()).toEqual([]);
  });

  it('블랙리스트 출처면 400이고 그 파일도 안 남는다', async () => {
    const r = await upload('핀터.gif', { sourceUrl: 'https://pinterest.com/pin/1/' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('핀터레스트');
    expect(await listed()).toEqual([]);
    expect(await filesOnDisk()).toEqual([]);
  });

  it('주소 형태가 아니면 400이고 파일이 안 남는다', async () => {
    const r = await upload('메모.gif', { sourceUrl: '나중에 적을게요' });
    expect(r.status).toBe(400);
    expect(await filesOnDisk()).toEqual([]);
  });

  /*
    🔴 `hasFace=yes`가 **`false`(인물 없음)로 뒤집혀** 저장되던 자리다.
    값을 잃는 정도가 아니라 정반대로 기록되고 게이트가 통과시킨다.
  */
  it('모르는 hasFace 값은 400 — 조용히 「인물 없음」으로 떨어지지 않는다', async () => {
    const r = await upload('인물.gif', { sourceUrl: PIXABAY, hasFace: 'yes' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('hasFace');
    expect(await listed()).toEqual([]);
    expect(await filesOnDisk()).toEqual([]);
  });

  it('hasFace를 안 보내면 「안 봤음」으로 남는다 (false가 아니다)', async () => {
    expect((await upload('미표시.gif', { sourceUrl: PIXABAY })).status).toBe(200);
    expect((await listed())[0].hasFace).toBeUndefined();
  });

  it('hasFace=true는 그대로 「인물 있음」이다', async () => {
    await upload('사람.gif', { sourceUrl: PIXABAY, hasFace: 'true' });
    expect((await listed())[0].hasFace).toBe(true);
  });

  /*
    대기 자리(`.uploads`)는 통과·거부 어느 쪽에서도 비어 있어야 한다.
    거부 경로는 `finally`가, 통과 경로는 `commitUpload`의 이동이 치운다.
  */
  it('대기 자리에 파일이 쌓이지 않는다', async () => {
    await upload('통과.gif', { sourceUrl: PIXABAY, hasFace: 'false' });
    await upload('거부.gif');
    expect(await staged()).toEqual([]);
  });
});

/*
  🔴 **대기 자리는 모든 요청이 같이 쓰는 폴더 하나다** (2026-08-26 재검증 지적).

  거기 슬러그 이름으로 받으면 서로 다른 파일이 같은 경로를 놓고 다툰다 — `slugify`가
  `.`·공백을 `-`로 바꾸고 60자에서 자르므로 「`a b.gif`」와 「`a-b.gif`」가 같은 이름이 된다.
  실측(고치기 전): 한 요청에 그 둘 → **ENOENT 500 + 파일 유실 + 응답에 절대경로**,
  같은 이름 동시 업로드 → **5회 중 3회 얼굴 있는 파일이 「인물 없음」으로 앉았다.**

  대기 자리 이름을 `randomUUID()`로 두고 최종 이름만 따로 넘기면 둘 다 사라진다.
*/
describe('대기 자리 이름 충돌', () => {
  it('슬러그가 같아지는 파일 둘을 한 번에 올려도 둘 다 남는다', async () => {
    const r = await uploadMany(
      [['a b.gif', 'AAA'], ['a-b.gif', 'BBB']],
      { sourceUrl: PIXABAY, hasFace: 'false' },
    );
    expect(r.status).toBe(200);
    // 사용자는 파일 **둘**을 고른 것이다 — 하나가 조용히 사라지면 안 된다
    expect((await listed()).length).toBe(2);
    expect(await filesOnDisk()).toEqual(expect.arrayContaining(['a-b.gif', 'a-b_2.gif']));
    expect(await bytesOf('a-b.gif')).toBe('AAA');
    expect(await bytesOf('a-b_2.gif')).toBe('BBB');
    expect(await staged()).toEqual([]);
  });

  /** 500 자체도 회귀 신호지만, **응답에 작업공간 절대경로가 실려 나가던 것**이 더 나쁘다 */
  it('충돌해도 500이 아니고 응답에 작업공간 경로가 안 실린다', async () => {
    const r = await uploadMany(
      [['긴이름 하나.gif', 'A'], ['긴이름-하나.gif', 'B']],
      { sourceUrl: PIXABAY, hasFace: 'false' },
    );
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(tmp);
  });

  /*
    🔴 **파일과 기록의 승자가 갈리면 안 된다.** 갈리면 얼굴 있는 파일에 「인물 없음」이
    붙고 조립 게이트는 **기록만 보므로 통과시킨다** — 이 기능이 존재하는 이유가 무너진다.
    출처 없는 자료가 들어오는 것은 대장을 보면 보이지만 이건 대장을 봐도 안 보인다.
  */
  it('같은 이름을 동시에 올려도 파일과 출처 기록의 승자가 같다', async () => {
    for (let round = 0; round < 5; round++) {
      await fsp.rm(path.join(tmp, 'assets'), { recursive: true, force: true });
      await Promise.all([
        uploadMany([['rc.gif', 'SAFEIMG']], { sourceUrl: PIXABAY, hasFace: 'false' }),
        uploadMany([['rc.gif', 'FACEIMG']],
          { sourceUrl: 'https://pexels.com/photo/1/', hasFace: 'true' }),
      ]);
      const item = (await listed()).find((i: any) => i.id.endsWith('rc.gif'));
      const fileIsFace = (await bytesOf('rc.gif')).includes('FACEIMG');
      expect(item.hasFace, `${round + 1}회차: 파일과 기록이 어긋났다`).toBe(fileIsFace);
      expect(await staged()).toEqual([]);
    }
  });
});

describe('PATCH /assets/:id — 출처 수정', () => {
  it('블랙리스트로는 못 고친다 — 올릴 때만 막으면 그쪽을 피해 들어온다', async () => {
    await upload('a.gif', { sourceUrl: PIXABAY, hasFace: 'false' });
    const id = (await listed())[0].id;
    const res = await fetch(`${base}/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceUrl: 'https://fmkorea.com/1' }),
    });
    expect(res.status).toBe(400);
    // 실패한 수정이 기존 값을 건드리지 않는다
    expect((await listed())[0].sourceUrl).toBe(PIXABAY);
  });

  it('빈 문자열로 지울 수 있다 — 잘못 적은 출처를 되돌릴 길이 있어야 한다', async () => {
    await upload('b.gif', { sourceUrl: PIXABAY, hasFace: 'false' });
    const id = (await listed())[0].id;
    const res = await fetch(`${base}/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceUrl: '' }),
    });
    expect(res.status).toBe(200);
    expect((await listed())[0].sourceUrl).toBeUndefined();
  });
});

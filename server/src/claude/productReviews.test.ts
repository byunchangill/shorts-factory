import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { ProductSchema } from '@shared/types';

/**
 * 구매자 리뷰 배선 — `product.json`의 `reviews` → 대본 요청서 (2026-09-06).
 *
 * 리뷰를 모아 놓고도 **요청서에 안 실리면 아무 일도 안 한다.** 첨부파일 목록에만 적는 것으로는
 * 모자라다 — 파일을 못 여는 경로(API 자동 실행·웹 챗 복붙)에서 그 지시가 허공을 가리킨다
 * (CLAUDE.md 「스킬은 자기완결이어야 한다」와 같은 함정). 여기서 고정하는 것:
 *
 * 1. 옛 `product.json`(리뷰 칸 없음)이 그대로 열린다
 * 2. 리뷰가 있으면 요청서 본문에 **값과 경계 규칙이 같이** 실린다
 * 3. 리뷰가 없으면 경계 규칙을 안 싣는다 — 없는 재료의 규칙은 소음이다
 */

/* 임시 폴더에 진짜 파일을 쓰는 통합 검사다. 윈도우 백신 지터를 감안해 넉넉히 잡는다 */
vi.setConfig({ testTimeout: 30_000 });

let tmp: string;
let jobs: typeof import('../store/jobs.js');
let projects: typeof import('../store/projects.js');
let packets: typeof import('./packets.js');
let projectId: string;
let jobSeq = 1;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'product-reviews-'));
  process.env.SHORTS_WORKSPACE = tmp;
  // WORKSPACE_ROOT는 모듈 로드 시점에 정해진다 — 환경변수를 먼저 세운 뒤 불러온다
  [jobs, projects, packets] = await Promise.all([
    import('../store/jobs.js'),
    import('../store/projects.js'),
    import('./packets.js'),
  ]);
});

beforeEach(async () => {
  await fsp.rm(path.join(tmp, 'menu-b'), { recursive: true, force: true });
  await jobs.scanJobs();
  await packets.scanPackets();
  projectId = (await projects.createProject('menu-b', '리뷰제품')).id;
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
  delete process.env.SHORTS_WORKSPACE;
});

/** 잡 하나를 만들고 그 product.json에 주어진 값을 심는다 */
async function seed(product: Record<string, unknown>) {
  const job = await jobs.createJob('menu-b', projectId, `편${jobSeq++}`);
  const ref = { menu: 'menu-b' as const, projectId, jobId: job.id };
  await fsp.mkdir(path.join(tmp, 'menu-b', projectId, 'jobs', job.id, 'product'), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, 'menu-b', projectId, 'jobs', job.id, 'product', 'product.json'),
    JSON.stringify(product),
    'utf8',
  );
  return ref;
}

/** 대본 요청서를 발행하고 그 request.md 본문을 읽는다 */
async function requestMd(ref: import('../store/jobs.js').JobRef): Promise<string> {
  const packet = await packets.createPacket({ kind: 'script', jobRef: ref });
  return fsp.readFile(path.join(tmp, packet.dir, 'request.md'), 'utf8');
}

const REVIEWS = {
  count: 60,
  avgRating: '4.6',
  praises: ['흡입력이 세다'],
  complaints: ['배터리가 십오 분이면 끝난다'],
  quotes: ['소리는 좀 크네요'],
  source: '쿠팡 상품평 최신순 60개',
  collectedAt: '2026-09-06',
};

describe('리뷰 칸 하위호환', () => {
  /*
    리뷰 칸을 더하기 전에 만든 product.json이 이미 디스크에 있다. 여기가 깨지면 그 잡들이
    통째로 「제품 정보 없음」이 되고, 원인이 리뷰와 아무 상관 없어 보인다.
  */
  it('리뷰 칸이 없는 옛 product.json이 그대로 열린다', async () => {
    const parsed = ProductSchema.parse({ name: '무선청소기', price: '39,900원' });
    expect(parsed.name).toBe('무선청소기');
    expect(parsed.reviews.count).toBe(0);
    expect(parsed.reviews.complaints).toEqual([]);
  });

  it('일부만 적힌 리뷰도 나머지가 기본값으로 채워진다', () => {
    const parsed = ProductSchema.parse({ name: 'x', reviews: { complaints: ['시끄럽다'] } });
    expect(parsed.reviews.complaints).toEqual(['시끄럽다']);
    expect(parsed.reviews.avgRating).toBe('');
  });
});

describe('요청서에 리뷰가 실린다', () => {
  it('불만·인용·표본이 대본 요청서 본문에 그대로 들어간다', async () => {
    const md = await requestMd(await seed({ name: '무선청소기', reviews: REVIEWS }));
    expect(md).toContain('배터리가 십오 분이면 끝난다');
    expect(md).toContain('소리는 좀 크네요');
    expect(md).toContain('쿠팡 상품평 최신순 60개');
  });

  /*
    🔴 값만 싣고 경계를 안 실으면 리뷰가 「~라고 하더라」의 방패가 된다 — 화법만 바뀌었을 뿐
    검증 안 된 효능 주장은 그대로다 (CLAUDE.md 썰형 교리). 값과 경계는 한 벌로 실린다.
  */
  it('리뷰를 어디에 쓸 수 있는지가 값과 같이 실린다', async () => {
    const md = await requestMd(await seed({ name: '무선청소기', reviews: REVIEWS }));
    expect(md).toContain('구매자 의견');
    expect(md).toMatch(/효능·사양·성능 주장의 근거로/);
  });

  it('리뷰가 없으면 그 규칙을 안 싣는다 — 없는 재료의 규칙은 소음이다', async () => {
    const md = await requestMd(await seed({ name: '무선청소기' }));
    expect(md).toContain('무선청소기');
    expect(md).not.toContain('구매자 의견');
  });

  /*
    표본 수를 안 적고 불만만 모은 경우에도 그 경계는 실려야 한다 — 리뷰를 실제로 들고 있는
    상태이기 때문이다. `count`만 보고 가르면 이 경우가 조용히 빠진다.
  */
  it('표본 수가 비어도 불만이 있으면 규칙이 실린다', async () => {
    const md = await requestMd(await seed({ name: '무선청소기', reviews: { complaints: ['시끄럽다'] } }));
    expect(md).toContain('구매자 의견');
  });
});

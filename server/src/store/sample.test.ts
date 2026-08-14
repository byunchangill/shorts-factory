import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * 샘플 소재는 소스 영상 4개다 — 그걸 받아 쓰는 파이프라인은 메뉴 A 하나뿐이다.
 * 제품정보리뷰(메뉴 B)에는 영상을 모으는 단계(`collecting`) 자체가 없어서,
 * 여기에 샘플을 심으려 하면 파이프라인 중간에서 "전이 불가: draft → collecting"으로 터졌다.
 *
 * 고정할 것 두 가지:
 * 1) 메뉴 B에는 아무것도 만들기 전에 막는다 (영상 4개를 복사한 뒤 실패하지 않는다)
 * 2) 실패하면 잡이 흔적 없이 사라진다 — 폴더도, 잡 인덱스도
 */

let tmp: string;
let sample: typeof import('./sample.js');
let jobs: typeof import('./jobs.js');
let projects: typeof import('./projects.js');

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sample-store-'));
  process.env.SHORTS_WORKSPACE = tmp;

  // WORKSPACE_ROOT는 모듈 로드 시점에 정해진다 — 환경변수를 먼저 세운 뒤 불러온다
  [sample, jobs, projects] = await Promise.all([
    import('./sample.js'),
    import('./jobs.js'),
    import('./projects.js'),
  ]);
});

afterAll(async () => {
  // 샘플 첨부는 배경에서 ffprobe를 돌린다 — 그게 파일을 놓기 전에 지우면
  // 윈도우에서 EBUSY가 난다. 임시 폴더라 못 지워도 테스트를 깨뜨리지 않는다
  await fsp.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    .catch(() => {});
  delete process.env.SHORTS_WORKSPACE;
});

describe('createSampleJob', () => {
  it('메뉴 B에서는 만들기 전에 막는다', async () => {
    const project = await projects.createProject('menu-b', '주방');
    const before = jobs.listJobRefs().length;

    await expect(sample.createSampleJob('menu-b', project.id)).rejects.toMatchObject({
      status: 400,
    });

    // 잡을 만들었다가 되돌리는 게 아니라 아예 시작을 안 해야 한다
    expect(jobs.listJobRefs().length).toBe(before);
    expect(await jobs.listJobs('menu-b', project.id)).toEqual([]);
  });

  it('메뉴 A에서는 소재를 붙이고 collecting까지 넘어간다', async () => {
    const project = await projects.createProject('menu-a', '생활용품');
    const r = await sample.createSampleJob('menu-a', project.id);

    expect(r.attached).toBe(4);
    expect(r.job.state).toBe('collecting');
    // 원본 샘플은 옮기지 않고 복사해 쓴다
    expect(await fsp.readdir(sample.SAMPLE_DIR)).toContain('clip1.mp4');
  });

  it('첨부 도중 실패하면 폴더도 잡 인덱스도 남지 않는다', async () => {
    const project = await projects.createProject('menu-a', '깨진소재');
    const before = jobs.listJobRefs().length;

    /*
      마지막 클립만 폴더로 바꿔치기한다. `sampleAvailable()`은 있다고 보고 통과하지만
      복사에서 EISDIR로 터진다 — 잡을 만들고 3개를 붙인 뒤 실패하는,
      되돌리기 경로가 실제로 밟히는 유일한 모양이다
    */
    const clip = path.join(sample.SAMPLE_DIR, 'clip4.mp4');
    const stashed = path.join(sample.SAMPLE_DIR, 'clip4.stash');
    await fsp.rename(clip, stashed);
    await fsp.mkdir(clip);
    try {
      await expect(sample.createSampleJob('menu-a', project.id)).rejects.toThrow();
    } finally {
      await fsp.rmdir(clip);
      await fsp.rename(stashed, clip);
    }

    expect(await jobs.listJobs('menu-a', project.id)).toEqual([]);
    expect(jobs.listJobRefs().length).toBe(before);
  });
});

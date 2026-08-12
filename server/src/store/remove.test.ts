import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * 삭제는 되돌릴 수 없는 동작이라, 세 가지를 고정한다.
 *
 * 1) 지우지 않고 `.trash`로 옮긴다 — 잘못 누른 한 번이 몇 시간치 소재를 날리면 안 된다
 * 2) 인덱스(잡·요청서)에서도 빠진다 — 남으면 사라진 폴더를 가리키는 잡이 화면에 뜬다
 * 3) `:pid`에 `..`이 섞여도 작업공간 밖을 건드리지 않는다
 */

let tmp: string;
let remove: typeof import('./remove.js');
let jobs: typeof import('./jobs.js');
let projects: typeof import('./projects.js');
let packets: typeof import('../claude/packets.js');
let workspace: typeof import('./workspace.js');

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'remove-store-'));
  process.env.SHORTS_WORKSPACE = tmp;

  // WORKSPACE_ROOT는 모듈 로드 시점에 정해진다 — 환경변수를 먼저 세운 뒤 불러온다
  [remove, jobs, projects, packets, workspace] = await Promise.all([
    import('./remove.js'),
    import('./jobs.js'),
    import('./projects.js'),
    import('../claude/packets.js'),
    import('./workspace.js'),
  ]);
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
  delete process.env.SHORTS_WORKSPACE;
});

beforeEach(async () => {
  for (const dir of ['menu-a', 'menu-b', '.trash']) {
    await fsp.rm(path.join(tmp, dir), { recursive: true, force: true });
  }
  await jobs.scanJobs();
  await packets.scanPackets();
});

/** 카테고리 + 잡 + 요청서 1건씩 심는다 */
async function seed(title = '주방-수납대') {
  const project = await projects.createProject('menu-a', title);
  const job = await jobs.createJob('menu-a', project.id, '1편');
  const packet = await packets.createPacket({
    kind: 'script',
    jobRef: { menu: 'menu-a', projectId: project.id, jobId: job.id },
  });
  return { project, job, packet };
}

describe('카테고리·작업 삭제', () => {
  it('작업을 .trash로 옮기고 잡·요청서 인덱스에서 뺀다', async () => {
    const { project, job, packet } = await seed();
    const jobDir = workspace.paths.job('menu-a', project.id, job.id);

    const { trashed } = await remove.trashJob({ menu: 'menu-a', projectId: project.id, jobId: job.id });

    expect(await exists(jobDir)).toBe(false);
    // 지운 것이 아니라 옮긴 것이다 — 폴더 내용이 그대로 있어야 되돌릴 수 있다
    expect(await exists(path.join(tmp, trashed, 'job.json'))).toBe(true);
    expect(jobs.resolveJob(job.id)).toBeNull();
    expect(packets.resolvePacketDir(packet.id)).toBeNull();
    // 카테고리 자체는 남는다
    expect(await projects.getProject('menu-a', project.id)).not.toBeNull();
  });

  it('카테고리를 삭제하면 그 안의 작업도 함께 빠진다', async () => {
    const { project, job, packet } = await seed();

    const result = await remove.trashProject('menu-a', project.id);

    expect(result.jobs).toBe(1);
    expect(await exists(path.join(tmp, result.trashed, 'jobs', job.id, 'job.json'))).toBe(true);
    expect(await projects.listProjects('menu-a')).toEqual([]);
    expect(jobs.resolveJob(job.id)).toBeNull();
    expect(packets.resolvePacketDir(packet.id)).toBeNull();
  });

  it('없는 카테고리·작업은 404로 답한다', async () => {
    await expect(remove.trashProject('menu-a', '없는-카테고리')).rejects.toMatchObject({ status: 404 });
    await expect(
      remove.trashJob({ menu: 'menu-a', projectId: '없는-카테고리', jobId: '없는-잡' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('작업공간 밖을 가리키는 이름은 거부한다', async () => {
    for (const pid of ['..', '../..', 'a/../..', path.join('..', 'menu-b')]) {
      await expect(remove.trashProject('menu-a', pid)).rejects.toMatchObject({ status: 400 });
    }
    // 상위 폴더가 통째로 날아가지 않았는지 직접 확인한다
    expect(await exists(tmp)).toBe(true);
  });

  it('예약 폴더(formats)는 카테고리로 지울 수 없다', async () => {
    await expect(remove.trashProject('menu-b', 'formats')).rejects.toMatchObject({ status: 400 });
  });

  it('같은 이름을 다시 만들어 지워도 휴지통에서 서로 덮어쓰지 않는다', async () => {
    const first = await seed('중복-이름');
    const a = await remove.trashProject('menu-a', first.project.id);
    const second = await seed('중복-이름');
    const b = await remove.trashProject('menu-a', second.project.id);

    expect(a.trashed).not.toBe(b.trashed);
    expect(await exists(path.join(tmp, a.trashed))).toBe(true);
    expect(await exists(path.join(tmp, b.trashed))).toBe(true);
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

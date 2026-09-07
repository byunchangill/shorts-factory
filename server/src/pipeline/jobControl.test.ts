import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * 긴 작업 제어 — 중복 차단 · 취소 · 일시정지 · 중단 복구 (2026-09-07).
 *
 * **조립은 몇 분이 걸리는데 시작하면 손댈 방법이 없었다.** 두 번 누르면 렌더가 둘 붙고,
 * 서버가 죽으면 잡이 `assembling`에 갇힌 채 아무 신호도 없이 남았다.
 * ClipFlow(`auto.rs`)가 43줄로 갖춘 것을 옮겨 왔다. 여기서 고정하는 것:
 *
 * 1. 같은 잡에 두 번째 작업이 **못 붙는다**
 * 2. 취소는 **다음 검문소에서** 끊긴다. 실패와 구분된다
 * 3. 일시정지는 **거기서 선다**. 취소가 일시정지를 깨운다
 * 4. 재시작하면 남은 표식이 **중단으로 표시된다**
 */

vi.setConfig({ testTimeout: 30_000 });

let tmp: string;
let jobs: typeof import('../store/jobs.js');
let projects: typeof import('../store/projects.js');
let ctl: typeof import('./jobControl.js');
let projectId: string;
let seq = 1;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'job-control-'));
  process.env.SHORTS_WORKSPACE = tmp;
  [jobs, projects, ctl] = await Promise.all([
    import('../store/jobs.js'),
    import('../store/projects.js'),
    import('./jobControl.js'),
  ]);
});

beforeEach(async () => {
  await fsp.rm(path.join(tmp, 'menu-b'), { recursive: true, force: true });
  await jobs.scanJobs();
  ctl.resetJobControl();
  projectId = (await projects.createProject('menu-b', '제어제품')).id;
});

afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
  delete process.env.SHORTS_WORKSPACE;
});

async function seed() {
  const job = await jobs.createJob('menu-b', projectId, `편${seq++}`);
  return { menu: 'menu-b' as const, projectId, jobId: job.id };
}

describe('중복 실행 차단', () => {
  /*
    🔴 응답을 먼저 보내는 구조라 화면 버튼 잠금은 새로고침 한 번에 뚫린다.
    두 번째가 붙으면 같은 `output/tmp/`에 둘이 쓰고 판 번호도 둘 다 올라간다.
  */
  it('같은 잡에 두 번째 작업이 못 붙는다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    await expect(ctl.beginJob(ref, 'assemble')).rejects.toThrow(/이미 조립/);
  });

  it('끝내면 다시 붙는다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    await ctl.endJob(ref);
    await expect(ctl.beginJob(ref, 'assemble')).resolves.toBeUndefined();
  });

  it('다른 잡은 서로 막지 않는다', async () => {
    const a = await seed();
    const b = await seed();
    await ctl.beginJob(a, 'assemble');
    await expect(ctl.beginJob(b, 'assemble')).resolves.toBeUndefined();
  });
});

describe('취소', () => {
  it('취소하면 다음 검문소에서 끊긴다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    await expect(ctl.checkpoint(ref.jobId)).resolves.toBeUndefined();
    expect(ctl.requestCancel(ref.jobId)).toBe(true);
    await expect(ctl.checkpoint(ref.jobId)).rejects.toThrow(ctl.CancelledError);
  });

  /*
    🔴 취소를 실패와 같은 자리로 흘려보내면 사용자가 스스로 멈춘 것을 화면이 「오류」라고
    말한다. 부르는 쪽이 갈라낼 수 있어야 한다.
  */
  it('취소는 실패와 구분된다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    ctl.requestCancel(ref.jobId);
    const err = await ctl.checkpoint(ref.jobId).catch((e) => e);
    expect(ctl.isCancelled(err)).toBe(true);
    expect(ctl.isCancelled(new Error('ffmpeg 실패'))).toBe(false);
  });

  it('안 도는 잡에는 취소가 안 먹는다 — 「없음」과 「멈춤」은 다르다', async () => {
    const ref = await seed();
    expect(ctl.requestCancel(ref.jobId)).toBe(false);
  });

  /*
    제어 밖에서 도는 호출(하네스·테스트)은 검문소를 그냥 지나가야 한다.
    안 그러면 잡 없이 `assembleFinal`을 부르는 경로가 통째로 막힌다.
  */
  it('잡지 않은 작업의 검문소는 그냥 지나간다', async () => {
    await expect(ctl.checkpoint('없는-잡')).resolves.toBeUndefined();
  });
});

describe('일시정지', () => {
  it('멈추면 검문소에서 서고, 재개하면 지나간다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    ctl.requestPause(ref.jobId, true);

    let passed = false;
    const waiting = ctl.checkpoint(ref.jobId).then(() => { passed = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(passed).toBe(false);
    expect(ctl.controlState(ref.jobId)?.paused).toBe(true);

    ctl.requestPause(ref.jobId, false);
    await waiting;
    expect(passed).toBe(true);
    expect(ctl.controlState(ref.jobId)?.paused).toBe(false);
  });

  /*
    🔴 **취소가 일시정지를 깨워야 한다.** 안 그러면 멈춰 세운 작업은 취소로 끝낼 수 없고,
    재개했다가 다시 취소하는 두 단계를 거쳐야 한다 — 멈춰둔 이유가 보통 그만두려는 것이다.
  */
  it('멈춰 있어도 취소가 통한다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    ctl.requestPause(ref.jobId, true);
    const waiting = ctl.checkpoint(ref.jobId).catch((e) => e);
    await new Promise((r) => setTimeout(r, 300));
    ctl.requestCancel(ref.jobId);
    expect(ctl.isCancelled(await waiting)).toBe(true);
  });

  it('멈추는 중과 멈췄다를 갈라 보여준다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    ctl.requestPause(ref.jobId, true);
    expect(ctl.controlState(ref.jobId)).toMatchObject({ pauseRequested: true, paused: false });
  });
});

describe('중단 복구', () => {
  /*
    🔴 메모리 플래그만으로는 중단을 못 알아본다 — 서버와 함께 죽는다.
    디스크 표식이 남아야 부팅이 보고 수습한다.
  */
  it('표식이 job.json에 남는다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    expect((await jobs.readJob(ref))?.running?.task).toBe('assemble');
    await ctl.endJob(ref);
    expect((await jobs.readJob(ref))?.running).toBeUndefined();
  });

  it('재시작하면 남은 표식이 중단으로 표시된다', async () => {
    const ref = await seed();
    await ctl.beginJob(ref, 'assemble');
    // 서버가 죽은 상황 — 메모리 잠금만 사라지고 디스크 표식은 남는다
    ctl.resetJobControl();

    expect(await ctl.recoverInterrupted()).toBe(1);
    const job = await jobs.readJob(ref);
    expect(job?.running).toBeUndefined();
    expect(job?.state).toBe('failed');
    expect(job?.error).toContain('중단');
    // 수습된 잡은 다시 시작할 수 있어야 한다
    await expect(ctl.beginJob(ref, 'assemble')).resolves.toBeUndefined();
  });

  it('안 돌던 잡은 건드리지 않는다', async () => {
    const ref = await seed();
    const before = await jobs.readJob(ref);
    expect(await ctl.recoverInterrupted()).toBe(0);
    expect((await jobs.readJob(ref))?.state).toBe(before?.state);
  });

  /*
    표식을 못 남겼으면 메모리 잠금도 풀어야 한다 — 안 그러면 아무도 안 도는 잡이
    영원히 「실행 중」이 되어 다시 시작할 방법이 없다.
  */
  it('표식 쓰기가 실패하면 잠금도 안 남는다', async () => {
    const ref = await seed();
    const spy = vi.spyOn(jobs, 'mutateJob').mockRejectedValueOnce(new Error('디스크 오류'));
    await expect(ctl.beginJob(ref, 'assemble')).rejects.toThrow('디스크 오류');
    spy.mockRestore();
    expect(ctl.isBusy(ref.jobId)).toBe(false);
  });
});

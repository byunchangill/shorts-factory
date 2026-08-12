import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

/**
 * 잡 ID 충돌.
 *
 * 잡 번호는 프로젝트 안에서 매겨지는데 인덱스는 ID 하나로 찾는다.
 * 같은 날 다른 제품에 같은 제목("1편")으로 잡을 만들면 ID가 겹쳐,
 * `/jobs/{id}/...` 요청이 통째로 남의 제품 폴더로 갔다.
 * 시리즈로 찍을수록 "1편"이 겹치므로 반드시 막아야 한다.
 */

let jobs: typeof import('./jobs.js');
let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'jobids-'));
  process.env.SHORTS_WORKSPACE = tmp;
  // WORKSPACE_ROOT와 잡 인덱스는 모듈 로드 시점에 굳으므로 매번 새로 읽어들인다
  vi.resetModules();
  jobs = await import('./jobs.js');
});

describe('잡 ID는 전역으로 유일하다', () => {
  it('다른 제품에 같은 날 같은 제목이어도 ID가 겹치지 않는다', async () => {
    const a = await jobs.createJob('menu-a', '충전기', '1편');
    const b = await jobs.createJob('menu-b', '세제통', '1편');

    expect(a.id).not.toBe(b.id);
    // 각자 자기 폴더로 찾아가야 한다 — 이게 깨지면 대본이 남의 제품에 쌓인다
    expect(jobs.resolveJob(a.id)).toMatchObject({ menu: 'menu-a', projectId: '충전기' });
    expect(jobs.resolveJob(b.id)).toMatchObject({ menu: 'menu-b', projectId: '세제통' });
  });

  it('제목이 다르면 번호를 밀지 않는다 (불필요한 건너뛰기 방지)', async () => {
    const a = await jobs.createJob('menu-a', '충전기', '1편');
    const b = await jobs.createJob('menu-b', '세제통', '2편');
    expect(a.id.split('-')[1]).toBe('001');
    expect(b.id.split('-')[1]).toBe('001'); // 슬러그가 달라 이미 유일하다
  });

  it('같은 제품 안에서는 기존대로 번호가 올라간다', async () => {
    const first = await jobs.createJob('menu-a', '충전기', '1편');
    const second = await jobs.createJob('menu-a', '충전기', '1편');
    expect(first.id).not.toBe(second.id);
    expect(second.id.split('-')[1]).toBe('002');
  });
});

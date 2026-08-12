import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { writeJsonAtomic, readJson, withFileLock } from './fsx.js';

/** 윈도우 EPERM을 흉내내는 오류 */
function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(`${code}: operation not permitted, rename`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe('writeJsonAtomic', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('같은 밀리초에 동시 호출해도 임시 파일이 충돌하지 않는다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fsx-'));
    const file = path.join(dir, 'state.json');
    // 임시 파일명이 pid+시각만으로 만들어지면 여기서 ENOENT가 터진다 (실제 발생했던 버그)
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { n: i })),
    );
    const result = await readJson<{ n: number }>(file);
    expect(result).not.toBeNull();
    expect(typeof result!.n).toBe('number');
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('윈도우 EPERM(백신·탐색기 잠금)이면 rename을 다시 시도한다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fsx-eperm-'));
    const file = path.join(dir, 'job.json');
    const real = fsp.rename;
    let calls = 0;
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      // 처음 두 번은 잠겨 있다가 풀리는 상황
      if (++calls <= 2) throw errno('EPERM');
      return real(from, to);
    });

    await writeJsonAtomic(file, { ok: true });
    expect(calls).toBe(3);
    expect(await readJson<{ ok: boolean }>(file)).toEqual({ ok: true });
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('재시도해도 안 되면 임시 파일을 남기지 않고 오류를 올린다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fsx-fail-'));
    const file = path.join(dir, 'job.json');
    vi.spyOn(fsp, 'rename').mockRejectedValue(errno('ENOSPC')); // 재시도 대상이 아닌 오류

    await expect(writeJsonAtomic(file, { ok: true })).rejects.toThrow('ENOSPC');
    expect(await fsp.readdir(dir)).toEqual([]); // .tmp- 잔해 없음
    await fsp.rm(dir, { recursive: true, force: true });
  });
});

describe('withFileLock', () => {
  it('읽기-수정-쓰기를 직렬화해 갱신이 유실되지 않는다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fsx-lock-'));
    const file = path.join(dir, 'counter.json');
    await writeJsonAtomic(file, { items: [] as number[] });

    // 락이 없으면 각자 읽은 배열을 덮어써서 대부분의 항목이 사라진다
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        withFileLock(file, async () => {
          const cur = (await readJson<{ items: number[] }>(file))!;
          await new Promise((r) => setTimeout(r, 3)); // 읽기와 쓰기 사이 지연
          cur.items.push(i);
          await writeJsonAtomic(file, cur);
        }),
      ),
    );

    const final = (await readJson<{ items: number[] }>(file))!;
    expect(final.items).toHaveLength(15);
    expect([...final.items].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('다른 경로는 서로를 막지 않는다', async () => {
    const order: string[] = [];
    await Promise.all([
      withFileLock('/tmp/a.json', async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('a');
      }),
      withFileLock('/tmp/b.json', async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['b', 'a']); // b가 a를 기다리지 않음
  });

  it('앞 작업이 실패해도 뒤 작업은 실행된다', async () => {
    const done: string[] = [];
    const first = withFileLock('/tmp/c.json', async () => {
      throw new Error('실패');
    });
    const second = withFileLock('/tmp/c.json', async () => {
      done.push('second');
    });
    await expect(first).rejects.toThrow('실패');
    await second;
    expect(done).toEqual(['second']);
  });
});

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { writeJsonAtomic, readJson, withFileLock } from './fsx.js';

describe('writeJsonAtomic', () => {
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

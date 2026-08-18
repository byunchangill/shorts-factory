import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  검출기가 **없는** 기계에서 파이썬을 몇 번이나 띄우는지 본다.

  예전에는 성공만 캐시했다. 답이 늘 "없음"이면 캐시가 영영 비어서 부를 때마다 후보를
  전부 다시 띄웠고, 소재를 받을 때마다 묻게 되자 CI 하네스가 1분에서 7분이 됐다.
*/
const checkTool = vi.hoisted(() => vi.fn(async () => ({ available: false })));
const pythonCandidates = vi.hoisted(() => vi.fn(async () => ['py', 'python', 'python3']));

vi.mock('../util/exec.js', () => ({ checkTool, run: vi.fn(), PYTHON_CLI_ENV: {} }));
vi.mock('../util/toolPath.js', () => ({ pythonCandidates, resolveBin: async (b: string) => b }));

const { resolvePython } = await import('./ocrDetect.js');
const settings = { pythonPath: '' } as never;

beforeEach(() => {
  checkTool.mockClear();
  pythonCandidates.mockClear();
});

describe('resolvePython — 못 찾았을 때', () => {
  it('두 번째 물음은 파이썬을 다시 띄우지 않는다', async () => {
    expect(await resolvePython(settings, 'no_such_module_a')).toBeNull();
    const first = checkTool.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    expect(await resolvePython(settings, 'no_such_module_a')).toBeNull();
    expect(checkTool.mock.calls.length).toBe(first);
  });

  it('찾는 모듈이 다르면 따로 묻는다 — 하나가 없다고 다른 것까지 없는 건 아니다', async () => {
    await resolvePython(settings, 'no_such_module_b');
    const n = checkTool.mock.calls.length;
    await resolvePython(settings, 'no_such_module_c');
    expect(checkTool.mock.calls.length).toBeGreaterThan(n);
  });

  /** 방금 설치한 사람이 서버를 재시작해야 하면 안 된다 — 잠깐만 붙든다 */
  it('시간이 지나면 다시 찾아본다', async () => {
    await resolvePython(settings, 'no_such_module_d');
    const n = checkTool.mock.calls.length;

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    checkTool.mockResolvedValue({ available: true } as never);
    expect(await resolvePython(settings, 'no_such_module_d')).toBe('py');
    vi.useRealTimers();
    expect(checkTool.mock.calls.length).toBeGreaterThan(n);
  });
});

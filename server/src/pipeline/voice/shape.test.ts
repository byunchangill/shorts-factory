import { describe, it, expect, vi } from 'vitest';

const run = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ stdout: '', stderr: '' })));
vi.mock('../../util/exec.js', () => ({ run }));
vi.mock('node:fs/promises', () => ({ default: { rename: vi.fn(async () => {}) } }));

const { shapeAudio } = await import('./shape.js');

const settings = { ffmpegPath: 'ffmpeg' } as never;
/** 마지막 ffmpeg 호출의 -filter:a 값 */
const lastFilter = (): string => {
  const args = run.mock.calls.at(-1)![1] as unknown as string[];
  return args[args.indexOf('-filter:a') + 1];
};

describe('shapeAudio', () => {
  it('손댈 것이 없으면 ffmpeg을 부르지 않는다', async () => {
    run.mockClear();
    await shapeAudio(settings, 'a.wav', { rate: 1, semitones: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it('배속만 바꾼다', async () => {
    run.mockClear();
    await shapeAudio(settings, 'a.wav', { rate: 1.395, semitones: 0 });
    expect(lastFilter()).toBe('atempo=1.395');
  });

  /*
    atempo는 한 번에 0.5~2.0배만 낸다. 그 밖의 값을 그대로 넘기면 ffmpeg이 거부한다 —
    조용히 실패하는 게 아니라 음성 단계가 통째로 멈춘다.
  */
  it('2배를 넘는 배속은 여러 번으로 나눈다', async () => {
    run.mockClear();
    await shapeAudio(settings, 'a.wav', { rate: 3, semitones: 0 });
    expect(lastFilter()).toBe('atempo=2,atempo=1.5');
  });

  it('느리게 할 때도 하한(0.5배)을 지킨다', async () => {
    run.mockClear();
    await shapeAudio(settings, 'a.wav', { rate: 0.3, semitones: 0 });
    const parts = lastFilter().split(',');
    expect(parts[0]).toBe('atempo=0.5');
    expect(parts).toHaveLength(2);
  });

  it('rubberband가 있으면 음정만 옮긴다 (길이를 건드리지 않는다)', async () => {
    run.mockClear();
    run.mockResolvedValueOnce({ stdout: ' .. rubberband      A->A  pitch', stderr: '' });
    await shapeAudio(settings, 'a.wav', { rate: 1, semitones: 2 });
    // 2반음 = 2^(2/12) ≈ 1.122462
    expect(lastFilter()).toMatch(/^rubberband=pitch=1\.1224/);
  });
});

describe('shapeAudio — rubberband가 없는 빌드', () => {
  it('표본율을 올리고 그만큼 템포를 되돌려 음정만 바꾼다', async () => {
    vi.resetModules();
    const run2 = vi.fn(async (..._args: unknown[]) => ({ stdout: 'aresample atempo asetrate', stderr: '' }));
    vi.doMock('../../util/exec.js', () => ({ run: run2 }));
    vi.doMock('node:fs/promises', () => ({ default: { rename: vi.fn(async () => {}) } }));
    const mod = await import('./shape.js');

    await mod.shapeAudio(settings, 'a.wav', { rate: 1, semitones: 2 });
    const args = run2.mock.calls.at(-1)![1] as unknown as string[];
    const filter = args[args.indexOf('-filter:a') + 1];
    // 24000 × 1.122462 ≈ 26939 → 다시 24000으로 리샘플 → 템포 1/1.122462 ≈ 0.8909
    expect(filter).toContain('asetrate=26939');
    expect(filter).toContain('aresample=24000');
    expect(filter).toContain('atempo=0.8909');
  });
});

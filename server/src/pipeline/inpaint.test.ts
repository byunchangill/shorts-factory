import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 2차 제거(AI 인페인팅) 가용성 판정.
 *
 * 예전엔 설정 경로를 무시하고 맨 `iopaint`를 찾았다. 권장 설치 방식인 가상환경에
 * 깔면 PATH에 없으므로, 경로를 제대로 넣어둬도 항상 "없음"이 되어 2차 제거가 막혔다.
 */
const checkTool = vi.hoisted(() => vi.fn());
const iopaintPath = vi.hoisted(() => ({ value: 'iopaint' }));

// 실물과 같은 값을 쓴다 — 모킹하면서 값이 갈라지면 검증이 의미를 잃는다
const { PYTHON_CLI_ENV } = await vi.importActual<typeof import('../util/exec.js')>('../util/exec.js');

vi.mock('../util/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../util/exec.js')>('../util/exec.js');
  return { checkTool, run: vi.fn(), PYTHON_CLI_ENV: actual.PYTHON_CLI_ENV };
});
vi.mock('../store/workspace.js', () => ({
  loadSettings: async () => ({ iopaintPath: iopaintPath.value }),
}));

const { iopaintProvider, iopaintFailureMessage, planFrames, zonesAtTime, maxMaskRatio } =
  await import('./inpaint.js');

const zone = (id: string, t0?: number, t1?: number) =>
  ({ id, kind: 'subtitle' as const, x: 0, y: 0, w: 10, h: 10, t0, t1, method: 'inpaint' as const });

/**
 * 존은 대개 몇 초짜리인데 클립 전체를 돌리면 75초 클립이 CPU로 20시간이다(실측).
 * 걸린 프레임만 고르면 4초짜리 자막은 120장, 6분이면 끝난다.
 */
describe('planFrames — 존이 걸린 프레임만 고른다', () => {
  const files = Array.from({ length: 10 }, (_, i) => `f_${String(i + 1).padStart(6, '0')}.png`);

  it('구간 밖 프레임은 건드리지 않는다', () => {
    // 10fps · 10장 = 0.0~0.9초. 0.3~0.5초 존이면 4·5·6번째 장만 대상이다
    const { skip, groups } = planFrames(files, 10, [zone('z1', 0.3, 0.5)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toEqual(['f_000004.png', 'f_000005.png', 'f_000006.png']);
    expect(skip).toHaveLength(7);
  });

  it('구간이 없는 존은 전체 구간이다 — 예전 동작 그대로', () => {
    const { skip, groups } = planFrames(files, 10, [zone('z1')]);
    expect(skip).toEqual([]);
    expect(groups[0].files).toHaveLength(10);
  });

  it('겹치는 존은 조합별로 묶는다 — 마스크를 조합마다 한 장만 만들면 된다', () => {
    const { groups } = planFrames(files, 10, [zone('a', 0, 0.4), zone('b', 0.2, 0.9)]);
    // a만 / a+b / b만 — 세 조합
    expect(groups.map((g) => g.zones.map((z) => z.id).join('+'))).toEqual(['a', 'a+b', 'b']);
    expect(groups.reduce((n, g) => n + g.files.length, 0)).toBe(10);
  });

  it('구간이 영상 밖이면 대상이 없다 — 전체를 돌리는 것으로 되돌아가면 안 된다', () => {
    const { skip, groups } = planFrames(files, 10, [zone('z1', 50, 60)]);
    expect(groups).toEqual([]);
    expect(skip).toHaveLength(10);
  });

  it('경계 시각은 포함한다', () => {
    expect(zonesAtTime([zone('z', 1, 2)], 1)).toHaveLength(1);
    expect(zonesAtTime([zone('z', 1, 2)], 2)).toHaveLength(1);
    expect(zonesAtTime([zone('z', 1, 2)], 2.1)).toHaveLength(0);
  });
});

describe('iopaint 가용성', () => {
  beforeEach(() => {
    checkTool.mockReset();
    iopaintPath.value = 'iopaint';
  });

  it('설정에 적어둔 절대경로를 본다 — 가상환경에 깔면 PATH에 없다', async () => {
    iopaintPath.value = process.execPath; // 반드시 존재하는 절대경로
    expect(await iopaintProvider.available()).toBe(true);
  });

  it('절대경로면 실행하지 않는다 — 파이썬·torch를 올리다 8초 상한을 넘겨 "없음"이 됐다', async () => {
    iopaintPath.value = process.execPath;
    await iopaintProvider.available();
    expect(checkTool).not.toHaveBeenCalled();
  });

  it('그 자리에 파일이 없으면 false — 1차 제거로 강등되어야 한다', async () => {
    iopaintPath.value = path.join(process.cwd(), '없는폴더', 'iopaint.exe');
    expect(await iopaintProvider.available()).toBe(false);
  });

  it('PATH에서 찾는 이름이면 실행해 확인한다', async () => {
    checkTool.mockResolvedValue({ available: true, version: '1.6.0' });
    expect(await iopaintProvider.available()).toBe(true);
    expect(checkTool.mock.calls[0][0]).toBe('iopaint');
  });

  it('--version이 없는 빌드는 --help로 다시 확인한다', async () => {
    checkTool.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes('--help')
        ? { available: true, version: 'Usage: iopaint [OPTIONS] COMMAND [ARGS]...' }
        : { available: false, error: 'No such option: --version' });
    expect(await iopaintProvider.available()).toBe(true);
  });

  it('PATH에도 없으면 false', async () => {
    checkTool.mockResolvedValue({ available: false, error: 'ENOENT' });
    expect(await iopaintProvider.available()).toBe(false);
  });
});

/**
 * 한국어 윈도우에서 실제로 겪은 실패다. iopaint는 모델까지 다 읽고 나서 진행률 스피너
 * `⠋`(U+280B)를 콘솔에 찍다가 UnicodeEncodeError로 죽었다. 도구도 모델도 멀쩡한데
 * 출력 한 글자 때문에 2차 제거 전체가 막혔다.
 */
describe('파이썬 CLI 환경변수', () => {
  it('출력 인코딩을 UTF-8로 고정한다 (cp949 콘솔 대응)', () => {
    expect(PYTHON_CLI_ENV.PYTHONIOENCODING).toBe('utf-8');
    expect(PYTHON_CLI_ENV.PYTHONUTF8).toBe('1');
  });

  it('스피너·색상 출력을 끈다 — 파이프로 받는 출력에는 필요 없다', () => {
    expect(PYTHON_CLI_ENV.TERM).toBe('dumb');
    expect(PYTHON_CLI_ENV.NO_COLOR).toBe('1');
  });

  it('실제로 죽었던 스피너 문자가 UTF-8에서는 인코딩된다', () => {
    expect(Buffer.from('⠋', 'utf-8').toString('utf-8')).toBe('⠋');
  });
});

/**
 * 인페인팅은 주변 배경을 보고 채운다. 지울 자리가 넓으면 참조할 배경이 모자라 뭉갠다 —
 * 큰 자막 블록을 통째로 넣었다가 그 자리가 문드러져 반려된 적이 있다.
 */
describe('maxMaskRatio — 한 시점에 가장 넓게 겹친 넓이', () => {
  const box = (id: string, w: number, h: number, t0?: number, t1?: number) =>
    ({ id, kind: 'subtitle' as const, x: 0, y: 0, w, h, t0, t1, method: 'inpaint' as const });

  it('구간이 안 겹치는 존은 따로 잰다 — 합치면 안 넓은데도 막힌다', () => {
    const zones = [box('a', 100, 100, 0, 2), box('b', 100, 100, 5, 7)];
    expect(maxMaskRatio(zones, 200, 100)).toBeCloseTo(0.5);
  });

  it('같은 시각에 겹쳐 걸리면 더한다', () => {
    const zones = [box('a', 100, 100, 0, 5), box('b', 100, 100, 1, 3)];
    expect(maxMaskRatio(zones, 200, 100)).toBeCloseTo(1);
  });

  it('존이 없으면 0', () => {
    expect(maxMaskRatio([], 200, 100)).toBe(0);
  });
});

describe('iopaint 실패 메시지', () => {
  it('인코딩 오류는 도구 문제가 아니라고 알린다', () => {
    const msg = iopaintFailureMessage([
      "UnicodeEncodeError: 'cp949' codec can't encode character '\\u280b' in position 0",
    ]);
    expect(msg).toContain('cp949');
    expect(msg).toContain('도구나 모델 문제가 아닙니다');
    // 엉뚱한 곳을 뒤지게 만들던 예전 문구가 다시 붙으면 안 된다
    expect(msg).not.toContain('사내망');
  });

  it('모델 내려받기 실패는 사내망을 짚어준다', () => {
    const msg = iopaintFailureMessage(['urlopen error [Errno 110] Connection timed out (big-lama.pt)']);
    expect(msg).toContain('사내망');
  });

  it('원인을 모르면 표준 오류 마지막 줄을 그대로 보여준다', () => {
    const msg = iopaintFailureMessage(['Error: --mask must have same count as --image']);
    expect(msg).toContain('--mask must have same count');
  });

  it('표준 오류가 비어 있으면 예외 메시지라도 붙인다', () => {
    const msg = iopaintFailureMessage([], new Error('spawn iopaint ENOENT\n두 번째 줄'));
    expect(msg).toContain('spawn iopaint ENOENT');
    expect(msg).not.toContain('두 번째 줄');
  });
});

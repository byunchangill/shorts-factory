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

const { iopaintProvider, iopaintFailureMessage } = await import('./inpaint.js');

describe('iopaint 가용성', () => {
  beforeEach(() => {
    checkTool.mockReset();
    iopaintPath.value = 'C:\\repo\\.venv-inpaint\\Scripts\\iopaint.exe';
  });

  it('설정에 적어둔 경로로 확인한다', async () => {
    checkTool.mockResolvedValue({ available: true, version: '1.6.0' });
    expect(await iopaintProvider.available()).toBe(true);
    expect(checkTool.mock.calls[0][0]).toBe('C:\\repo\\.venv-inpaint\\Scripts\\iopaint.exe');
  });

  it('--version이 없는 빌드는 --help로 다시 확인한다', async () => {
    checkTool.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes('--help')
        ? { available: true, version: 'Usage: iopaint [OPTIONS] COMMAND [ARGS]...' }
        : { available: false, error: 'No such option: --version' });
    expect(await iopaintProvider.available()).toBe(true);
  });

  it('정말 없으면 false — 1차 제거로 강등되어야 한다', async () => {
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

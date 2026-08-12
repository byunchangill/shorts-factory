import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 2차 제거(AI 인페인팅) 가용성 판정.
 *
 * 예전엔 설정 경로를 무시하고 맨 `iopaint`를 찾았다. 권장 설치 방식인 가상환경에
 * 깔면 PATH에 없으므로, 경로를 제대로 넣어둬도 항상 "없음"이 되어 2차 제거가 막혔다.
 */
const checkTool = vi.hoisted(() => vi.fn());
const iopaintPath = vi.hoisted(() => ({ value: 'iopaint' }));

vi.mock('../util/exec.js', () => ({ checkTool, run: vi.fn() }));
vi.mock('../store/workspace.js', () => ({
  loadSettings: async () => ({ iopaintPath: iopaintPath.value }),
}));

const { iopaintProvider } = await import('./inpaint.js');

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

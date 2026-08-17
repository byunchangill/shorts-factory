import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 부팅 직후 프로세스 실행이 한 번 실패하면 "미설치"가 캐시되어,
 * 설치돼 있는 ffmpeg를 계속 없다고 표시하던 문제를 막는다.
 * (실제로 이 리포 서버 부팅 로그에 ❌ ffmpeg가 찍히고, 새로고침하면 ✅로 바뀌는 것을 확인했다)
 */
const checkTool = vi.hoisted(() => vi.fn());

vi.mock('./util/exec.js', () => ({ checkTool }));
vi.mock('./store/workspace.js', () => ({
  loadSettings: async () => ({
    ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', ytdlpPath: 'yt-dlp', iopaintPath: 'iopaint',
    fontPath: '',
  }),
}));
const hasKey = vi.hoisted(() => vi.fn(async () => false));
vi.mock('./store/secrets.js', () => ({ hasKey }));
vi.mock('./pipeline/fonts.js', () => ({ findKoreanFont: async () => '/fonts/NanumGothic.ttf' }));

/*
  도구 탐색은 실제 파일시스템을 훑는다 — 캐시 동작을 보는 테스트에 끌어들이면
  이 PC에 뭐가 깔렸느냐에 따라 결과가 갈린다. 탐색 자체는 toolPath.test.ts가 본다.
*/
vi.mock('./util/toolPath.js', () => ({ resolveBin: async (b: string) => b }));
vi.mock('./pipeline/ocrDetect.js', () => ({
  resolvePython: async () => null,
  OCR_MODULE: 'rapidocr_onnxruntime',
}));
vi.mock('./pipeline/vsr.js', () => ({
  vsrProvider: { available: async () => false },
  vsrPaths: async () => ({ repo: '', python: '' }),
}));
vi.mock('./sourcing/browser.js', () => ({ chromiumAvailable: async () => ({ available: false }) }));

const { runDoctor, resetDoctorCache } = await import('./doctor.js');

describe('runDoctor 캐시', () => {
  beforeEach(() => {
    resetDoctorCache();
    checkTool.mockReset();
    hasKey.mockReset();
    hasKey.mockResolvedValue(false);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('성공한 결과는 계속 재사용한다 (프로세스를 다시 띄우지 않는다)', async () => {
    checkTool.mockResolvedValue({ available: true, version: 'x' });
    await runDoctor();
    const calls = checkTool.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    vi.setSystemTime(Date.now() + 10 * 60_000);
    const again = await runDoctor();
    expect(again.ok).toBe(true);
    expect(checkTool.mock.calls.length).toBe(calls); // 재점검 없음
  });

  it('실패한 결과는 잠깐만 들고 있다가 다시 점검한다', async () => {
    checkTool.mockResolvedValue({ available: false, error: 'spawn 실패' });
    const first = await runDoctor();
    expect(first.ok).toBe(false);
    const calls = checkTool.mock.calls.length;

    // 30초 안에는 캐시를 쓴다 — 매 요청마다 프로세스를 띄우면 화면이 느려진다
    await runDoctor();
    expect(checkTool.mock.calls.length).toBe(calls);

    // 그 뒤에는 다시 점검하고, 이번엔 도구를 찾는다
    vi.setSystemTime(Date.now() + 31_000);
    checkTool.mockResolvedValue({ available: true, version: 'ffmpeg 6.1' });
    const healed = await runDoctor();
    expect(healed.ok).toBe(true);
    expect(checkTool.mock.calls.length).toBeGreaterThan(calls);
  });

  /**
   * iopaint는 버전마다 CLI가 다르다. --version이 없는 빌드에서 그 인자만 보고 판정하면
   * 멀쩡히 깔린 도구가 계속 "없음"으로 나온다 (회사 PC에서 실제로 그랬다).
   */
  it('버전 인자가 안 통하면 다음 인자로 다시 확인한다', async () => {
    checkTool.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes('--help')
        ? { available: true, version: 'Usage: iopaint [OPTIONS] COMMAND [ARGS]...' }
        : { available: false, error: 'No such option: --version' });

    const report = await runDoctor();
    const iopaint = report.tools.find((t) => t.name === 'iopaint');
    expect(iopaint?.available).toBe(true);
    // 사용법 안내가 버전 자리에 그대로 나가면 안 된다
    expect(iopaint?.version).toBeUndefined();
  });

  /**
   * force는 "지금 다시 봐달라"는 뜻이다. 진행 중인 점검에 편승하면 그 점검이 시작된
   * 시점의 상태를 돌려주게 되어, 요청한 쪽은 새 결과를 받은 줄 알고 낡은 답을 쓴다.
   *
   * 실제로 `npm run seed`가 이걸 밟았다 — 서버를 직접 띄우고 곧바로 refresh=1로
   * 물었더니 부팅 점검(index.ts)에 편승해 "ffmpeg 없음"을 받고, 멀쩡한 ffmpeg를
   * 두고 클립 분석·프레임 추출을 통째로 건너뛰었다.
   */
  it('진행 중인 점검이 있어도 force는 새로 점검한다', async () => {
    // 부팅 점검 — 붐벼서 실패하고, 늦게 끝난다
    let releaseBoot!: () => void;
    const bootBusy = new Promise<void>((r) => { releaseBoot = r; });
    checkTool.mockImplementation(async () => {
      await bootBusy;
      return { available: false, error: 'spawn 실패' };
    });
    const boot = runDoctor({ force: true });
    // 부팅 점검이 실제로 checkTool까지 들어가 붙들려 있게 한다
    for (let i = 0; i < 100 && checkTool.mock.calls.length === 0; i++) await Promise.resolve();
    expect(checkTool.mock.calls.length).toBeGreaterThan(0);

    // 그 사이 seed가 물어본다 — 이번엔 도구가 정상 응답한다
    checkTool.mockResolvedValue({ available: true, version: 'ffmpeg 6.1' });
    const seed = runDoctor({ force: true });

    releaseBoot();
    const [bootReport, seedReport] = await Promise.all([boot, seed]);

    expect(bootReport.ok).toBe(false); // 부팅 점검은 자기가 본 대로
    expect(seedReport.ok).toBe(true);  // seed는 새로 점검해 찾아낸다

    // 늦게 끝난 실패가 새 성공을 덮어쓰면 도구가 다시 "없음"으로 돌아간다
    expect((await runDoctor()).ok).toBe(true);
  });

  /**
   * API 키는 도구 설치와 달리 언제든 바뀐다. 캐시가 이걸 같이 붙들고 있으면
   * 타입캐스트 키를 등록해도 도구 상태는 계속 "없음"으로 남는다 (실제로 그랬다).
   */
  it('API 키로 판정하는 항목은 캐시에 갇히지 않는다', async () => {
    checkTool.mockResolvedValue({ available: true, version: 'x' });
    const before = await runDoctor();
    expect(before.tools.find((t) => t.name === 'Typecast (음성)')?.available).toBe(false);

    hasKey.mockResolvedValue(true); // 사용자가 키를 등록했다
    const calls = checkTool.mock.calls.length;
    const after = await runDoctor();

    expect(after.tools.find((t) => t.name === 'Typecast (음성)')?.available).toBe(true);
    expect(checkTool.mock.calls.length).toBe(calls); // 외부 도구는 다시 안 띄운다
  });
});

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
vi.mock('./store/secrets.js', () => ({ hasKey: async () => false }));
vi.mock('./pipeline/fonts.js', () => ({ findKoreanFont: async () => '/fonts/NanumGothic.ttf' }));

const { runDoctor, resetDoctorCache } = await import('./doctor.js');

describe('runDoctor 캐시', () => {
  beforeEach(() => {
    resetDoctorCache();
    checkTool.mockReset();
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
});

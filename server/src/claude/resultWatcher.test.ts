import { describe, it, expect } from 'vitest';
import { isWatchIgnored } from './resultWatcher.js';

// 인자는 작업공간 기준 상대경로다
describe('isWatchIgnored', () => {
  it('감시해야 할 결과 파일은 통과시킨다', () => {
    expect(isWatchIgnored('menu-a/충전기/jobs/j1/requests/p01/result/.done')).toBe(false);
    expect(isWatchIgnored('menu-a\\충전기\\jobs\\j1\\requests\\p01\\result\\.done')).toBe(false);
  });

  it('원자적 쓰기 임시 파일은 무시한다', () => {
    // 워처가 이 파일을 붙잡으면 윈도우에서 rename이 EPERM으로 거절된다
    expect(isWatchIgnored('menu-a/충전기/jobs/j1/job.json.tmp-29464-1786359615329-39')).toBe(true);
    expect(isWatchIgnored('jobs\\j1\\job.json.tmp-1-2-3')).toBe(true);
  });

  it('상태 파일 자체는 무시하지 않는다', () => {
    expect(isWatchIgnored('menu-a/충전기/jobs/j1/job.json')).toBe(false);
    expect(isWatchIgnored('settings.json')).toBe(false);
  });

  it('영상·음성 등 무거운 폴더는 훑지 않는다', () => {
    for (const p of [
      'menu-a/충전기/jobs/j1/sources/s1.mp4',
      'menu-a/충전기/jobs/j1/output/final_v1.mp4',
      'menu-a/충전기/jobs/j1/voice/scene1.wav',
      'menu-a/충전기/jobs/j1/clips/c1/frames/f1.jpg',
      // 자료실 — 공용 자료를 받을 때 git이 수백 개 파일을 한꺼번에 쓴다
      'assets/shared/memes/a.gif',
      // 올라오는 자료가 잠깐 머무는 자리 — 한 번에 수십 개를 올리면 그만큼 이벤트가 온다
      '.uploads/고양이.gif',
      'cache\\youtube\\q.json',
    ]) {
      expect(isWatchIgnored(p)).toBe(true);
    }
  });
});

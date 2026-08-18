import { describe, it, expect } from 'vitest';
import type { Zone } from '@shared/types';
import { vsrAreaArgs, vsrFailureMessage, defaultVsrPython } from './vsr.js';

const zone = (x: number, y: number, w: number, h: number): Zone =>
  ({ id: 'z', kind: 'subtitle', x, y, w, h, method: 'inpaint' });

/**
 * VSR은 `-c YMIN YMAX XMIN XMAX` 순서다. 우리 존은 x/y/w/h라 그대로 넘기면
 * 엉뚱한 자리를 지운다 — 세로가 먼저고, 폭이 아니라 끝 좌표다.
 */
describe('vsrAreaArgs', () => {
  /*
    🔴 아래로 한 줄 넓혀 넘긴다 — 틱톡 자막 밑의 **이모지 행**이 거기 있다.
    우리 검출기는 글자만 찾아 그 행을 놓치는데, VSR 검출기는 영역에 들어오면 잡는다
    (실측: 소재 8개 중 2개가 이모지 행을 갖고 있었고, 넓혀 주니 같이 지워졌다).
  */
  it('세로 먼저·끝 좌표로 바꾸고, 아래로 한 줄 넓힌다', () => {
    // y800 h60 → 위·옆 18px 여유 + 아래로 96px 더 (이모지 한 줄 + 검출기 여백)
    expect(vsrAreaArgs([zone(100, 800, 400, 60)], 1080, 1920))
      .toEqual(['-c', '782', '956', '82', '518']);
  });

  it('넓힌 영역이 화면을 넘지 않는다 — 넘기면 VSR이 통째로 실패한다', () => {
    const args = vsrAreaArgs([zone(0, 1850, 1080, 60)], 1080, 1920);
    expect(Number(args[2])).toBeLessThanOrEqual(1920); // ymax
    expect(Number(args[4])).toBeLessThanOrEqual(1080); // xmax
  });

  it('여러 존은 -c를 여러 번 넘긴다 (VSR이 반복 지정을 받는다)', () => {
    const args = vsrAreaArgs([zone(0, 0, 10, 10), zone(20, 20, 10, 10)], 1080, 1920);
    expect(args.filter((a) => a === '-c')).toHaveLength(2);
  });

  it('화면 밖으로 나간 좌표는 잘라낸다', () => {
    // y1900 h200은 아래가 화면 밖 — 잘린 뒤 높이 20이 되고, 그 20을 기준으로 넓힌다
    expect(vsrAreaArgs([zone(-20, 1900, 2000, 200)], 1080, 1920))
      .toEqual(['-c', '1894', '1920', '0', '1080']);
  });

  it('잘라내고 나면 넓이가 없는 존은 아예 뺀다', () => {
    expect(vsrAreaArgs([zone(1080, 0, 50, 50)], 1080, 1920)).toEqual([]);
  });
});

describe('vsrFailureMessage', () => {
  it('글자를 못 찾은 것은 고장이 아니라고 알린다 — 제일 흔한 실패다', () => {
    const msg = vsrFailureMessage(['Exception: NoSubtitleDetected for clip.mp4']);
    expect(msg).toContain('도구 문제가 아닙니다');
    expect(msg).toContain('크롭');
  });

  it('가속 실패는 lama(CPU)를 짚어준다', () => {
    expect(vsrFailureMessage(['RuntimeError: DirectML device out of memory'])).toContain('lama');
  });

  it('원인을 모르면 표준 오류 마지막 줄을 그대로 보여준다', () => {
    expect(vsrFailureMessage(['ModuleNotFoundError: No module named torch']))
      .toContain('No module named torch');
  });

  it('표준 오류가 비어 있으면 예외 메시지라도 붙인다', () => {
    expect(vsrFailureMessage([], new Error('spawn python ENOENT'))).toContain('ENOENT');
  });
});

describe('defaultVsrPython', () => {
  /**
   * **가상환경의 실행 파일 자리는 OS마다 다르다** — 윈도우만 `Scripts\python.exe`이고
   * 나머지는 `bin/python`이다. 한쪽을 박아두면 다른 OS에서 VSR이 통째로 안 잡힌다.
   */
  it('파이썬을 안 적었으면 저장소 안의 가상환경을 본다 — 자리는 OS를 따른다', () => {
    const expected = process.platform === 'win32'
      ? '/vsr/.venv/Scripts/python.exe'
      : '/vsr/.venv/bin/python';
    expect(defaultVsrPython('/vsr').replace(/\\/g, '/')).toBe(expected);
  });
});

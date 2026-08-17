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
  it('x/y/w/h를 세로 먼저, 끝 좌표로 바꾼다', () => {
    expect(vsrAreaArgs([zone(100, 800, 400, 60)], 1080, 1920))
      .toEqual(['-c', '800', '860', '100', '500']);
  });

  it('여러 존은 -c를 여러 번 넘긴다 (VSR이 반복 지정을 받는다)', () => {
    const args = vsrAreaArgs([zone(0, 0, 10, 10), zone(20, 20, 10, 10)], 1080, 1920);
    expect(args.filter((a) => a === '-c')).toHaveLength(2);
  });

  it('화면 밖으로 나간 좌표는 잘라낸다 — 넘기면 VSR이 통째로 실패한다', () => {
    expect(vsrAreaArgs([zone(-20, 1900, 2000, 200)], 1080, 1920))
      .toEqual(['-c', '1900', '1920', '0', '1080']);
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { resolveBin, resetBinCache, findVsrRepo } from './toolPath.js';

/**
 * 도구 찾기는 **PC마다 다른 결과가 나오는 것이 정상**이다.
 * 그래서 특정 경로를 기대하지 않고, 규칙만 확인한다:
 * 경로를 적어준 값은 손대지 않는다 · PATH에 있으면 그 파일을 집는다 ·
 * 없으면 받은 이름을 그대로 돌려준다(오류를 지어내지 않는다).
 */
describe('resolveBin', () => {
  let tmp: string;
  const originalPath = process.env.PATH;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'toolpath-'));
    resetBinCache();
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await fsp.rm(tmp, { recursive: true, force: true });
    resetBinCache();
  });

  it('경로를 적어준 값은 그대로 쓴다 — 사용자가 지목한 설치본을 바꾸지 않는다', async () => {
    const abs = path.join(tmp, 'ffmpeg');
    expect(await resolveBin(abs)).toBe(abs);
    expect(await resolveBin('./bin/ffmpeg')).toBe('./bin/ffmpeg');
  });

  it('PATH에 있으면 그 파일의 절대경로를 돌려준다', async () => {
    const name = process.platform === 'win32' ? 'faketool.exe' : 'faketool';
    const file = path.join(tmp, name);
    await fsp.writeFile(file, '#!/bin/sh\n'); // 0바이트가 아니어야 한다
    process.env.PATH = tmp;

    expect(await resolveBin('faketool')).toBe(file);
  });

  it('0바이트여도 집는다 — 윈도우 스토어판 파이썬의 실행 별칭이 0바이트다', async () => {
    // 크기로 거르면 검출기가 깔린 유일한 파이썬을 놓친다 (2026-08-17 실측).
    // 진짜 껍데기는 실행해보는 단계에서 걸러진다
    const name = process.platform === 'win32' ? 'aliastool.exe' : 'aliastool';
    const file = path.join(tmp, name);
    await fsp.writeFile(file, '');
    process.env.PATH = tmp;

    expect(await resolveBin('aliastool')).toBe(file);
  });

  it('폴더는 실행 파일이 아니다', async () => {
    await fsp.mkdir(path.join(tmp, 'dirtool'));
    process.env.PATH = tmp;

    expect(await resolveBin('dirtool')).toBe('dirtool');
  });

  it('못 찾으면 받은 이름을 그대로 돌려준다 (execa가 평소 오류를 내게 둔다)', async () => {
    process.env.PATH = tmp;
    expect(await resolveBin('없는도구')).toBe('없는도구');
  });

  it('빈 값은 건드리지 않는다', async () => {
    expect(await resolveBin('')).toBe('');
  });
});

describe('findVsrRepo', () => {
  beforeEach(() => resetBinCache());
  afterEach(() => resetBinCache());

  it('설정에 적혀 있으면 그것을 쓴다', async () => {
    expect(await findVsrRepo('  D:/somewhere/vsr  ')).toBe('D:/somewhere/vsr');
  });

  it('안 적혀 있으면 홈 아래를 보고, 없으면 빈 문자열', async () => {
    const found = await findVsrRepo('');
    if (found) {
      // 찾았다면 반드시 진입점이 있는 폴더여야 한다
      await expect(fsp.access(path.join(found, 'backend', 'main.py'))).resolves.toBeUndefined();
    } else {
      expect(found).toBe('');
    }
  });
});

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { checkTool } from './exec.js';

describe('checkTool', () => {
  it('없는 도구는 즉시 unavailable', async () => {
    const r = await checkTool('__없는도구__abcdef');
    expect(r.available).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    '자식이 죽어도 손자가 파이프를 물고 있으면 시간 내에 포기한다',
    async () => {
      // 실제로 서버 부팅을 무한정 멈춰 세웠던 상황: execa의 timeout은 자식만 죽이고
      // 손자가 stdout을 붙들고 있어 프로미스가 영영 끝나지 않았다 (iopaint 같은 런처).
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'exec-hang-'));
      const bin = path.join(dir, 'hang.sh');
      await fsp.writeFile(bin, '#!/bin/sh\nsleep 300 &\nsleep 300\n', 'utf8');
      await fsp.chmod(bin, 0o755);

      const t0 = Date.now();
      const r = await checkTool(bin, ['--version'], 1_000);
      const elapsed = Date.now() - t0;

      expect(r.available).toBe(false);
      expect(elapsed).toBeLessThan(6_000);
      await fsp.rm(dir, { recursive: true, force: true });
    },
    15_000,
  );
});

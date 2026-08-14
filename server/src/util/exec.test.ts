import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { checkTool, toolFailureMessage } from './exec.js';

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

describe('toolFailureMessage', () => {
  /*
    실제로 화면에 떴던 메시지. 첫 줄이 명령 전체(다운로드 URL 포함, 수백 자)라
    앞에서 3줄을 잘라 쓰면 정작 원인인 ERROR 줄이 잘려나갔다 —
    사용자에게는 "Command failed with exit code 1: yt..." 만 보였다
  */
  const ytdlpTikTok = new Error(
    'Command failed with exit code 1: yt-dlp --no-playlist --write-info-json -f "bv*[height<=1080]+ba/b"'
    + ' -o "C:\Users\chang\...\s01.%(ext)s" "https://www.tiktok.com/@owen62269/video/7559513099561159958?q=…"\n'
    + '\n'
    + 'WARNING: [generic] Falling back on generic information extractor\n'
    + 'ERROR: [TikTok] 7559513099561159958: Unexpected response from webpage request; please report this issue',
  );

  it('명령 에코를 버리고 ERROR 줄을 남긴다', () => {
    const msg = toolFailureMessage(ytdlpTikTok);
    expect(msg).toContain('Unexpected response from webpage request');
    expect(msg).not.toContain('--no-playlist');
    expect(msg).not.toContain('tiktok.com/@owen62269');
  });

  it('ERROR가 있으면 WARNING은 버린다', () => {
    expect(toolFailureMessage(ytdlpTikTok)).not.toContain('Falling back');
  });

  it('ERROR 줄이 없으면 마지막 출력을 쓴다', () => {
    const e = new Error('Command failed with exit code 1: ffmpeg -i in.mp4\n\nno such file: in.mp4');
    expect(toolFailureMessage(e)).toBe('no such file: in.mp4');
  });

  it('출력이 아예 없으면 종료 코드라도 남긴다', () => {
    const e = new Error('Command failed with exit code 9: iopaint --model lama');
    expect(toolFailureMessage(e)).toContain('exit code 9');
  });

  it('길어도 잘라서 돌려준다', () => {
    const e = new Error(`cmd\nERROR: ${'가'.repeat(500)}`);
    expect(toolFailureMessage(e).length).toBeLessThanOrEqual(300);
  });

  it('Error가 아니면 문자열로', () => {
    expect(toolFailureMessage('그냥 문자열')).toBe('그냥 문자열');
  });
});

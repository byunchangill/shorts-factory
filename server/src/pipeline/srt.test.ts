import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseSrt } from '../../../tools/srt.js';

/**
 * 샘플 심기가 자막을 대본으로 옮긴다. 여기가 틀리면 씬 수도 구간도 통째로 어긋나는데,
 * seed는 새 PC에서 처음 돌리는 명령이라 그때 깨지면 원인을 찾기 어렵다.
 */
describe('SRT 파싱', () => {
  it('시간과 본문을 읽는다', () => {
    const cues = parseSrt(
      '1\n00:00:00,000 --> 00:00:01,400\n칠십 킬로를 버팁니다.\n\n'
      + '2\n00:00:01,400 --> 00:00:02,850\n이 조그만 주방 선반이요.\n',
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 0, end: 1.4, text: '칠십 킬로를 버팁니다.' });
    expect(cues[1].start).toBe(1.4);
  });

  it('여러 줄로 나뉜 자막을 한 문장으로 합친다', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:03,000\n앞줄\n뒷줄\n');
    expect(cues[0].text).toBe('앞줄 뒷줄');
  });

  it('윈도우 줄바꿈(CRLF)도 같은 결과를 낸다', () => {
    const cues = parseSrt('1\r\n00:00:01,000 --> 00:00:02,500\r\n한 줄\r\n');
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('한 줄');
  });

  it('시:분:초를 모두 반영한다', () => {
    const cues = parseSrt('1\n01:02:03,500 --> 01:02:04,000\nx\n');
    expect(cues[0].start).toBeCloseTo(3723.5, 3);
  });

  it('실제 샘플 자막을 끝까지 읽는다', async () => {
    const raw = await fsp.readFile(
      path.resolve(__dirname, '../../../samples/kitchen-shelf/narration.srt'), 'utf8');
    const cues = parseSrt(raw);
    expect(cues).toHaveLength(10);
    expect(cues.every((c) => c.end > c.start)).toBe(true);
    // 씬이 순서대로 이어져야 음성 분할 구간이 겹치지 않는다
    expect(cues.every((c, i) => i === 0 || c.start >= cues[i - 1].end)).toBe(true);
    expect(cues.at(-1)!.end).toBeCloseTo(30.6, 1);
  });
});

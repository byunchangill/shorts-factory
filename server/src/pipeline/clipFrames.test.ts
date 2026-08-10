import { describe, it, expect } from 'vitest';
import { ClipSchema } from '@shared/types';

/**
 * 프레임은 원래 경로 문자열 배열이었다.
 * 기존 작업공간의 clip.json이 그대로 열려야 한다 — 안 열리면 진행 중이던 잡이 통째로 사라진다.
 */
describe('ClipSchema 프레임 하위호환', () => {
  it('예전 문자열 배열을 객체로 승격한다', () => {
    const clip = ClipSchema.parse({
      id: 'c01',
      sourceId: 's01',
      frames: ['menu-a/p/jobs/j/clips/c01/frames/frame_01.jpg'],
    });
    expect(clip.frames).toEqual([
      {
        file: 'menu-a/p/jobs/j/clips/c01/frames/frame_01.jpg',
        t: 0,
        recommended: true, // 옛 프레임은 전부 추천으로 — 화면이 비어 보이지 않게
        selected: false,
      },
    ]);
  });

  it('새 객체 형식은 그대로 통과한다', () => {
    const clip = ClipSchema.parse({
      id: 'c01',
      sourceId: 's01',
      frames: [{ file: 'a/frame_01.jpg', t: 1.5, recommended: true, selected: true }],
    });
    expect(clip.frames[0]).toEqual({ file: 'a/frame_01.jpg', t: 1.5, recommended: true, selected: true });
  });

  it('frames가 없으면 빈 배열', () => {
    expect(ClipSchema.parse({ id: 'c01', sourceId: 's01' }).frames).toEqual([]);
  });

  it('t·recommended·selected는 생략 가능', () => {
    const clip = ClipSchema.parse({
      id: 'c01', sourceId: 's01', frames: [{ file: 'a.jpg' }],
    });
    expect(clip.frames[0]).toEqual({ file: 'a.jpg', t: 0, recommended: false, selected: false });
  });
});

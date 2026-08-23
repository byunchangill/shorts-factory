import { describe, it, expect } from 'vitest';
import { SettingsSchema, type Script } from '@shared/types';
import { memeOverlayFor, sceneSfxCues } from './assemble.js';

const S = (over: Record<string, unknown> = {}) => SettingsSchema.parse({ layout: 'banded', ...over });
const scene = (over: Partial<Script['scenes'][number]> = {}) => ({
  sceneId: 's01', narration: '나', subtitle: '나', isDownside: false, ...over,
}) as Script['scenes'][number];

const PATHS = { 'local:memes/충격.gif': '/a/충격.gif', 'local:sfx/뿅.mp3': '/a/뿅.mp3' };

/*
  짤은 **씬 위에 얹는다.** 씬 사이에 끼우면 그만큼 영상이 길어져 18~26초 예산을 넘긴다.
*/
describe('memeOverlayFor', () => {
  it('짤이 없으면 아무것도 안 만든다', () => {
    expect(memeOverlayFor(scene(), 5, S(), PATHS)).toBeNull();
  });

  it('자료실에 없는 id는 조용히 건너뛴다', () => {
    expect(memeOverlayFor(scene({ memeId: 'local:memes/없음.gif' }), 5, S(), PATHS)).toBeNull();
  });

  it('경로 표가 아예 없어도 터지지 않는다', () => {
    expect(memeOverlayFor(scene({ memeId: 'local:memes/충격.gif' }), 5, S(), undefined)).toBeNull();
  });

  it('gif는 여러 장으로 푼다 — 안 풀면 첫 프레임에서 멈춘다', () => {
    const r = memeOverlayFor(scene({ memeId: 'local:memes/충격.gif' }), 5, S(), PATHS)!;
    expect(r.animated).toBe(true);
  });

  it('뜨는 구간이 씬 길이를 넘지 않는다', () => {
    const r = memeOverlayFor(scene({ memeId: 'local:memes/충격.gif', memeAt: 4.8 }), 5, S(), PATHS)!;
    const [, a, b] = r.filter.match(/between\(t,([\d.]+),([\d.]+)\)/)!;
    expect(Number(b)).toBeLessThanOrEqual(5);
    expect(Number(a)).toBeLessThan(Number(b));
  });

  it('씬 끝에 붙어 보일 시간이 없으면 넣지 않는다', () => {
    expect(memeOverlayFor(scene({ memeId: 'local:memes/충격.gif' }), 0.3, S(), PATHS)).toBeNull();
  });

  it('상단 띠 아래에 놓는다 — 제목을 가리지 않는다', () => {
    const s = S({ topBandRatio: 0.22 });
    const r = memeOverlayFor(scene({ memeId: 'local:memes/충격.gif' }), 5, s, PATHS)!;
    const y = Number(r.filter.match(/overlay=\d+:(\d+):/)![1]);
    expect(y).toBeGreaterThanOrEqual(Math.round(1920 * 0.22));
  });
});

/*
  효과음은 나레이션 **위에 섞는다.** 이어 붙이면 그 구간에 말이 없어 완주율이 깎인다.
*/
describe('sceneSfxCues', () => {
  const scenes = [
    scene({ sceneId: 's01', sfxId: 'local:sfx/뿅.mp3' }),
    scene({ sceneId: 's02' }),
    scene({ sceneId: 's03', sfxId: 'local:sfx/뿅.mp3', sfxAt: 1 }),
  ];
  const tl = [
    { kind: 'scene' as const, dur: 4, sceneIdx: 0 },
    { kind: 'scene' as const, dur: 5, sceneIdx: 1 },
    { kind: 'scene' as const, dur: 3, sceneIdx: 2 },
  ];

  it('효과음이 있는 씬만 큐를 만든다', () => {
    expect(sceneSfxCues(scenes, tl, S(), PATHS)).toHaveLength(2);
  });

  it('씬 시작 시각을 타임라인에서 잰다', () => {
    const cues = sceneSfxCues(scenes, tl, S(), PATHS);
    expect(cues[0].at).toBe(0);
    expect(cues[1].at).toBe(4 + 5 + 1); // s03 시작(9초) + sfxAt 1초
  });

  /** 카드가 끼면 씬이 밀린다 — 씬 순서만 보고 계산하면 한 씬씩 어긋난다 */
  it('중간에 카드가 끼면 그만큼 밀린다', () => {
    const withCard = [
      tl[0],
      { kind: 'card' as const, dur: 2 },
      tl[1],
      tl[2],
    ];
    const cues = sceneSfxCues(scenes, withCard, S(), PATHS);
    expect(cues[1].at).toBe(4 + 2 + 5 + 1);
  });

  it('음량을 0으로 두면 효과음을 끈다', () => {
    expect(sceneSfxCues(scenes, tl, S({ sfxVolume: 0 }), PATHS)).toHaveLength(0);
  });

  it('자료실에 없는 id는 빠진다', () => {
    expect(sceneSfxCues(scenes, tl, S(), {})).toHaveLength(0);
  });
});

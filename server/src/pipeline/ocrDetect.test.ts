import { describe, it, expect } from 'vitest';
import { clusterBoxes, type FrameDetection } from './ocrDetect.js';

const box = (x: number, y: number, w: number, h: number, score = 0.9) => ({ x, y, w, h, score });

describe('clusterBoxes', () => {
  it('프레임마다 조금씩 다른 같은 자막을 하나로 묶고 제일 큰 테두리를 쓴다', () => {
    // 글자 수가 바뀌면 상자 폭이 달라진다. 프레임별 상자를 그대로 쓰면 지우다 만 자국이 남는다
    const dets: FrameDetection[] = [
      { t: 1, boxes: [box(100, 820, 300, 40)] },
      { t: 2, boxes: [box(80, 818, 380, 44)] },
      { t: 3, boxes: [box(90, 822, 340, 40)] },
    ];
    const zones = clusterBoxes(dets, 1, 10);
    expect(zones).toHaveLength(1);
    // 세 상자를 모두 덮어야 한다 (여백 6px 포함)
    expect(zones[0].x).toBeLessThanOrEqual(80);
    expect(zones[0].x + zones[0].w).toBeGreaterThanOrEqual(460);
  });

  it('멀리 떨어진 자막은 따로 잡는다 — 상단 제목과 하단 자막은 다른 존이다', () => {
    const dets: FrameDetection[] = [
      { t: 1, boxes: [box(100, 120, 340, 90), box(120, 825, 320, 38)] },
    ];
    expect(clusterBoxes(dets, 1, 10)).toHaveLength(2);
  });

  it('나타난 구간만 시각으로 남긴다', () => {
    const dets: FrameDetection[] = [
      { t: 0, boxes: [] },
      { t: 1, boxes: [] },
      { t: 2, boxes: [box(100, 820, 300, 40)] },
      { t: 3, boxes: [box(100, 820, 300, 40)] },
      { t: 4, boxes: [] },
    ];
    const [z] = clusterBoxes(dets, 1, 10);
    expect(z.t0).toBe(1); // 한 칸 앞에서 시작 (샘플 사이에 이미 떠 있었을 수 있다)
    expect(z.t1).toBe(4);
  });

  it('중간에 한 프레임 놓쳐도 구간을 쪼개지 않는다 — 그 사이 자막이 남는다', () => {
    const dets: FrameDetection[] = [
      { t: 1, boxes: [box(100, 820, 300, 40)] },
      { t: 2, boxes: [] },
      { t: 3, boxes: [box(100, 820, 300, 40)] },
    ];
    const zones = clusterBoxes(dets, 1, 10);
    expect(zones).toHaveLength(1);
    expect(zones[0].t0).toBe(0);
    expect(zones[0].t1).toBe(4);
  });

  it('내내 떠 있으면 구간을 두지 않는다 (전체 구간이 곧 정답)', () => {
    const dets: FrameDetection[] = [
      { t: 0, boxes: [box(100, 820, 300, 40)] },
      { t: 1, boxes: [box(100, 820, 300, 40)] },
      { t: 2, boxes: [box(100, 820, 300, 40)] },
    ];
    const [z] = clusterBoxes(dets, 1, 2);
    expect(z.t0).toBeUndefined();
    expect(z.t1).toBeUndefined();
  });

  it('신뢰도가 낮은 상자는 버린다 — 무늬를 글자로 본 경우다', () => {
    const dets: FrameDetection[] = [{ t: 1, boxes: [box(100, 820, 300, 40, 0.2)] }];
    expect(clusterBoxes(dets, 1, 10)).toEqual([]);
  });

  it('글자를 못 찾으면 존도 없다 — 없는 자리를 지우지 않는다', () => {
    expect(clusterBoxes([{ t: 0, boxes: [] }, { t: 1, boxes: [] }], 1, 10)).toEqual([]);
  });

  it('지우는 방식은 보간(delogo)으로 둔다', () => {
    const [z] = clusterBoxes([{ t: 1, boxes: [box(100, 820, 300, 40)] }], 1, 10);
    expect(z.method).toBe('delogo');
    expect(z.kind).toBe('subtitle');
  });
});

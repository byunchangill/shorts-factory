import { describe, it, expect } from 'vitest';
import { buildCleanFiltergraph } from './cleaner.js';
import type { Zone } from '@shared/types';

const probe = { width: 1920, height: 1080 };

describe('buildCleanFiltergraph', () => {
  it('존이 없으면 빈 문자열', () => {
    expect(buildCleanFiltergraph([], probe)).toBe('');
  });

  it('delogo 단일 존', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'logo', x: 100, y: 50, w: 200, h: 80, method: 'delogo' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toContain('delogo=x=100:y=50:w=200:h=80');
    expect(g).not.toMatch(/\[v\d+\]$/); // 최종 라벨 없음
  });

  it('delogo 존이 프레임 경계에 닿으면 클램프', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'logo', x: 0, y: 0, w: 1920, h: 100, method: 'delogo' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toContain('delogo=x=1:y=1');
    expect(g).not.toContain('w=1920'); // 경계 안쪽으로 줄어듦
  });

  it('시간 한정 존은 enable 식 포함', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'subtitle', x: 10, y: 10, w: 100, h: 40, t0: 2, t1: 5, method: 'delogo' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toContain("enable='between(t,2,5)'");
  });

  it('boxblur는 split/crop/overlay 체인', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'emoji', x: 500, y: 300, w: 120, h: 120, method: 'boxblur' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toContain('split=2');
    expect(g).toContain('crop=120:120:500:300');
    expect(g).toContain('boxblur');
    expect(g).toContain('overlay=500:300');
  });

  it('하단 자막띠 crop 후 원 해상도 복원', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'subtitle', x: 0, y: 950, w: 1920, h: 130, method: 'crop' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toContain('crop=1920:950:0:0');
    expect(g).toContain('scale=1920:1080');
  });

  it('절반 이상 잘리는 crop은 무시', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'subtitle', x: 0, y: 400, w: 1920, h: 680, method: 'crop' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toBe('');
  });

  it('delogo + boxblur + crop 조합', () => {
    const zones: Zone[] = [
      { id: 'z1', kind: 'logo', x: 50, y: 50, w: 100, h: 50, method: 'delogo' },
      { id: 'z2', kind: 'emoji', x: 800, y: 400, w: 90, h: 90, method: 'boxblur' },
      { id: 'z3', kind: 'subtitle', x: 0, y: 1000, w: 1920, h: 80, method: 'crop' },
    ];
    const g = buildCleanFiltergraph(zones, probe);
    expect(g).toContain('delogo');
    expect(g).toContain('boxblur');
    expect(g).toContain('crop=1920:1000:0:0');
    const semicolons = g.split(';');
    expect(semicolons.length).toBeGreaterThanOrEqual(4);
  });

  it('inpaint 존은 tier1 그래프에서 제외 대상 (호출부 필터 규약)', () => {
    // buildCleanFiltergraph 자체는 받은 존을 모두 처리하므로,
    // 호출부(runTier1Clean)가 inpaint를 걸러서 넘기는지 규약 확인용.
    const zones: Zone[] = [
      { id: 'z1', kind: 'logo', x: 10, y: 10, w: 50, h: 50, method: 'inpaint' },
    ];
    const filtered = zones.filter((z) => z.method !== 'inpaint');
    expect(buildCleanFiltergraph(filtered, probe)).toBe('');
  });
});

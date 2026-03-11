/**
 * state-machine.ts 단위 테스트
 * canTransition, transition, getNextStates
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  getNextStates,
  VALID_TRANSITIONS,
} from '../core/state-machine.js';
import type { JobStatus } from '../types/job.js';

// ─────────────────────────────────────────────
// canTransition
// ─────────────────────────────────────────────
describe('canTransition', () => {
  describe('정상 전이 경로', () => {
    it('searching → references_presented', () => {
      expect(canTransition('searching', 'references_presented')).toBe(true);
    });
    it('references_presented → reference_selected', () => {
      expect(canTransition('references_presented', 'reference_selected')).toBe(true);
    });
    it('script_approved → images_generating', () => {
      expect(canTransition('script_approved', 'images_generating')).toBe(true);
    });
    it('images_fully_approved → video_generating (강아지/건강)', () => {
      expect(canTransition('images_fully_approved', 'video_generating')).toBe(true);
    });
    it('images_fully_approved → tts_generating (썰툰)', () => {
      expect(canTransition('images_fully_approved', 'tts_generating')).toBe(true);
    });
    it('qc_passed → exporting', () => {
      expect(canTransition('qc_passed', 'exporting')).toBe(true);
    });
    it('exporting → exported', () => {
      expect(canTransition('exporting', 'exported')).toBe(true);
    });
  });

  describe('재수정/복구 경로', () => {
    it('script_pending_approval → scripting (재수정)', () => {
      expect(canTransition('script_pending_approval', 'scripting')).toBe(true);
    });
    it('images_pending_approval → images_regen_requested', () => {
      expect(canTransition('images_pending_approval', 'images_regen_requested')).toBe(true);
    });
    it('images_regen_requested → images_pending_approval', () => {
      expect(canTransition('images_regen_requested', 'images_pending_approval')).toBe(true);
    });
    it('qc_failed → images_generating (이미지 재생성)', () => {
      expect(canTransition('qc_failed', 'images_generating')).toBe(true);
    });
    it('error → scripting (복구)', () => {
      expect(canTransition('error', 'scripting')).toBe(true);
    });
  });

  describe('abandoned — 어디서든 가능', () => {
    const allStatuses: JobStatus[] = [
      'searching', 'scripting', 'images_generating',
      'video_generating', 'qc_reviewing', 'exported', 'error',
    ];
    for (const status of allStatuses) {
      it(`${status} → abandoned`, () => {
        expect(canTransition(status, 'abandoned')).toBe(true);
      });
    }
  });

  describe('잘못된 전이 — false 반환', () => {
    it('searching → exported (건너뜀)', () => {
      expect(canTransition('searching', 'exported')).toBe(false);
    });
    it('exported → searching (역방향)', () => {
      expect(canTransition('exported', 'searching')).toBe(false);
    });
    it('script_approved → tts_generating (이미지 단계 생략)', () => {
      expect(canTransition('script_approved', 'tts_generating')).toBe(false);
    });
    it('exporting → searching', () => {
      expect(canTransition('exporting', 'searching')).toBe(false);
    });
    it('searching → searching (자기 자신)', () => {
      expect(canTransition('searching', 'searching')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────
// transition
// ─────────────────────────────────────────────
describe('transition', () => {
  it('유효한 전이 → to 상태 반환', () => {
    expect(transition('searching', 'references_presented')).toBe('references_presented');
  });

  it('유효한 전이 → script_approved → images_generating', () => {
    expect(transition('script_approved', 'images_generating')).toBe('images_generating');
  });

  it('잘못된 전이 → Error 발생', () => {
    expect(() => transition('searching', 'exported')).toThrowError(
      /Invalid transition.*searching.*exported/,
    );
  });

  it('역방향 전이 → Error 발생', () => {
    expect(() => transition('exported', 'searching')).toThrowError(/Invalid transition/);
  });

  it('어디서든 abandoned → abandoned 반환', () => {
    expect(transition('images_generating', 'abandoned')).toBe('abandoned');
    expect(transition('qc_reviewing', 'abandoned')).toBe('abandoned');
  });
});

// ─────────────────────────────────────────────
// getNextStates
// ─────────────────────────────────────────────
describe('getNextStates', () => {
  it('searching → [references_presented, error, abandoned] 포함', () => {
    const next = getNextStates('searching');
    expect(next).toContain('references_presented');
    expect(next).toContain('error');
    expect(next).toContain('abandoned');
  });

  it('images_fully_approved → video_generating + tts_generating 모두 포함', () => {
    const next = getNextStates('images_fully_approved');
    expect(next).toContain('video_generating');
    expect(next).toContain('tts_generating');
  });

  it('모든 상태에 abandoned 포함', () => {
    for (const status of Object.keys(VALID_TRANSITIONS) as JobStatus[]) {
      const next = getNextStates(status);
      expect(next).toContain('abandoned');
    }
  });

  it('exported 상태 → abandoned만 있음 (더 이상 진행 없음)', () => {
    const next = getNextStates('exported');
    // exported는 VALID_TRANSITIONS에 없으므로 abandoned만
    expect(next).toContain('abandoned');
  });
});

// ─────────────────────────────────────────────
// VALID_TRANSITIONS 무결성 검사
// ─────────────────────────────────────────────
describe('VALID_TRANSITIONS 무결성', () => {
  it('모든 전이 대상 상태가 JobStatus 목록에 있어야 함', () => {
    const knownStatuses = new Set<string>([
      'searching', 'references_presented', 'reference_selected',
      'scripting', 'script_pending_approval', 'script_failed', 'script_approved',
      'images_generating', 'images_pending_approval', 'images_partial',
      'images_regen_requested', 'images_version_restored', 'images_fully_approved',
      'video_generating', 'video_pending_approval', 'video_regen_requested',
      'video_failed', 'video_approved',
      'tts_generating', 'tts_syncing', 'tts_failed',
      'compose_done', 'qc_reviewing', 'qc_passed', 'qc_warning', 'qc_failed',
      'exporting', 'exported', 'error', 'abandoned',
    ]);

    for (const [from, tos] of Object.entries(VALID_TRANSITIONS)) {
      expect(knownStatuses.has(from), `source status "${from}" not in JobStatus`).toBe(true);
      for (const to of tos) {
        expect(knownStatuses.has(to), `target status "${to}" (from "${from}") not in JobStatus`).toBe(true);
      }
    }
  });

  it('중복 전이 목록 없음', () => {
    for (const [from, tos] of Object.entries(VALID_TRANSITIONS)) {
      const uniqueTos = new Set(tos);
      expect(uniqueTos.size).toBe(tos.length);
    }
  });
});

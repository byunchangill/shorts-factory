/**
 * 상태 머신 — VALID_TRANSITIONS가 유일한 진짜
 * data-models-v6.md 기반
 */

import type { JobStatus } from '../types/job.js';

// ── 단일 소스: VALID_TRANSITIONS ──
// 이 코드가 유일한 진짜. 다이어그램은 파생. 충돌 시 코드 우선.
export const VALID_TRANSITIONS: Record<string, JobStatus[]> = {
  searching:                ['references_presented', 'error'],
  references_presented:     ['reference_selected', 'searching'],
  reference_selected:       ['scripting'],
  scripting:                ['script_pending_approval', 'script_failed', 'error'],
  script_pending_approval:  ['script_approved', 'scripting'],
  script_failed:            ['scripting'],
  script_approved:          ['images_generating'],
  images_generating:        ['images_pending_approval', 'images_partial', 'error'],
  images_partial:           ['images_generating'],
  images_pending_approval:  ['images_fully_approved', 'images_regen_requested', 'images_version_restored'],
  images_regen_requested:   ['images_pending_approval'],
  images_version_restored:  ['images_pending_approval'],
  images_fully_approved:    ['video_generating', 'tts_generating'],
  video_generating:         ['video_pending_approval', 'video_failed', 'error'],
  video_pending_approval:   ['video_approved', 'video_regen_requested'],
  video_regen_requested:    ['video_pending_approval'],
  video_failed:             ['video_generating'],
  video_approved:           ['tts_generating'],
  tts_generating:           ['tts_syncing', 'tts_failed', 'error'],
  tts_syncing:              ['compose_done', 'error'],
  tts_failed:               ['tts_generating'],
  compose_done:             ['qc_reviewing'],
  qc_reviewing:             ['qc_passed', 'qc_warning', 'qc_failed'],
  qc_passed:                ['exporting'],
  qc_warning:               ['exporting', 'scripting', 'images_generating', 'video_generating', 'tts_generating'],
  qc_failed:                ['scripting', 'images_generating', 'video_generating', 'tts_generating'],
  exporting:                ['exported', 'error'],
  error:                    ['searching', 'scripting', 'images_generating', 'video_generating', 'tts_generating'],
};

/**
 * 전이 가능 여부 확인
 */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  // abandoned는 어디서든 가능
  if (to === 'abandoned') return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 상태 전이 실행 — 유효하지 않으면 에러
 */
export function transition(from: JobStatus, to: JobStatus): JobStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
  return to;
}

/**
 * 현재 상태에서 가능한 다음 상태 목록
 */
export function getNextStates(current: JobStatus): JobStatus[] {
  const next = VALID_TRANSITIONS[current] ?? [];
  return [...next, 'abandoned' as JobStatus];
}

/**
 * StateEvent 타입 + 이벤트 레지스트리
 * data-models-v6.md 기반
 */

import type { JobStatus } from './job.js';

export type EventActor = 'user' | 'system' | 'tool';

// ── 전체 이벤트 타입 enum ──
export type EventType =
  // 검색 (youtube-researcher)
  | 'SEARCH_REQUESTED'
  | 'SEARCH_STARTED'
  | 'REFERENCES_PRESENTED'
  | 'REFERENCE_SELECTED'
  | 'SEARCH_RETRY'
  // 대본 (script-creator)
  | 'SCRIPT_GENERATION_STARTED'
  | 'SCRIPT_GENERATED'
  | 'SCRIPT_APPROVED'
  | 'SCRIPT_REVISION_REQUESTED'
  | 'SCRIPT_FAILED'
  | 'HEALTH_COMPLIANCE_AUTOFIX'
  | 'SIMILARITY_CHECK_COMPLETED'
  // 이미지 (image-generator)
  | 'STYLE_BIBLE_CREATED'
  | 'CHARACTER_BIBLE_CREATED'
  | 'IMAGES_GENERATION_STARTED'
  | 'IMAGES_GENERATED'
  | 'IMAGES_PARTIAL_FAILURE'
  | 'IMAGES_ALL_APPROVED'
  | 'SCENE_IMAGE_REGEN_REQUESTED'
  | 'SCENE_IMAGE_REGEN_COMPLETED'
  | 'SCENE_IMAGE_VERSION_RESTORED'
  | 'IMAGES_VERSION_RESTORE_DONE'
  // 영상 (video-maker)
  | 'VIDEO_GENERATION_STARTED'
  | 'VIDEO_GENERATED'
  | 'VIDEO_APPROVED'
  | 'VIDEO_REGEN_REQUESTED'
  | 'VIDEO_REGEN_COMPLETED'
  | 'VIDEO_FAILED'
  // TTS/합성 (tts-sync)
  | 'TTS_GENERATION_STARTED'
  | 'TTS_GENERATED'
  | 'TTS_FAILED'
  | 'TTS_SYNC_COMPLETED'
  | 'COMPOSE_FAILED'
  // QC (shorts-qc-reviewer)
  | 'QC_STARTED'
  | 'QC_PASSED'
  | 'QC_WARNING'
  | 'QC_FAILED'
  | 'QC_OVERRIDE'
  | 'QC_REVISE_TO_SCRIPT'
  | 'QC_REVISE_TO_IMAGES'
  | 'QC_REVISE_TO_VIDEO'
  | 'QC_REVISE_TO_TTS'
  // 패키징 (export-packager)
  | 'EXPORT_STARTED'
  | 'EXPORT_COMPLETED'
  | 'EXPORT_FAILED'
  // 공통
  | 'JOB_ABANDONED'
  | 'ERROR_OCCURRED'
  | 'ERROR_RECOVERED_TO_SEARCHING'
  | 'ERROR_RECOVERED_TO_SCRIPTING'
  | 'ERROR_RECOVERED_TO_IMAGES'
  | 'ERROR_RECOVERED_TO_VIDEO'
  | 'ERROR_RECOVERED_TO_TTS';

// ── StateEvent ──
export interface StateEvent {
  eventId: string;
  jobId: string;
  timestamp: string;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  eventType: EventType;
  actor: EventActor;
  targetId?: string;
  reasonCode?: string;
  reasonDetail?: string;
  metadata?: Record<string, unknown>;
}

// ── 이벤트 레지스트리 정의 ──
export interface EventRegistryEntry {
  eventType: EventType;
  actor: EventActor;
  fromStatus: JobStatus | JobStatus[] | '*' | null;
  toStatus: JobStatus | null;
  skill: string;
}

export const EVENT_REGISTRY: EventRegistryEntry[] = [
  // 검색
  { eventType: 'SEARCH_REQUESTED',   actor: 'user',   fromStatus: '*',                        toStatus: null,                    skill: 'youtube-researcher' },
  { eventType: 'SEARCH_STARTED',     actor: 'system', fromStatus: '*',                        toStatus: 'searching',             skill: 'youtube-researcher' },
  { eventType: 'REFERENCES_PRESENTED', actor: 'system', fromStatus: 'searching',              toStatus: 'references_presented',  skill: 'youtube-researcher' },
  { eventType: 'REFERENCE_SELECTED', actor: 'user',   fromStatus: 'references_presented',     toStatus: 'reference_selected',    skill: 'youtube-researcher' },
  { eventType: 'SEARCH_RETRY',       actor: 'user',   fromStatus: 'references_presented',     toStatus: 'searching',             skill: 'youtube-researcher' },

  // 대본
  { eventType: 'SCRIPT_GENERATION_STARTED', actor: 'system', fromStatus: 'reference_selected',     toStatus: 'scripting',               skill: 'script-creator' },
  { eventType: 'SCRIPT_GENERATED',          actor: 'system', fromStatus: 'scripting',               toStatus: 'script_pending_approval', skill: 'script-creator' },
  { eventType: 'SCRIPT_APPROVED',           actor: 'user',   fromStatus: 'script_pending_approval', toStatus: 'script_approved',         skill: 'script-creator' },
  { eventType: 'SCRIPT_REVISION_REQUESTED', actor: 'user',   fromStatus: 'script_pending_approval', toStatus: 'scripting',               skill: 'script-creator' },
  { eventType: 'SCRIPT_FAILED',             actor: 'system', fromStatus: 'scripting',               toStatus: 'script_failed',           skill: 'script-creator' },
  { eventType: 'HEALTH_COMPLIANCE_AUTOFIX', actor: 'system', fromStatus: null,                      toStatus: null,                      skill: 'script-creator' },
  { eventType: 'SIMILARITY_CHECK_COMPLETED', actor: 'system', fromStatus: null,                     toStatus: null,                      skill: 'script-creator' },

  // 이미지
  { eventType: 'STYLE_BIBLE_CREATED',         actor: 'system', fromStatus: null,                      toStatus: null,                      skill: 'image-generator' },
  { eventType: 'CHARACTER_BIBLE_CREATED',      actor: 'system', fromStatus: null,                      toStatus: null,                      skill: 'image-generator' },
  { eventType: 'IMAGES_GENERATION_STARTED',    actor: 'system', fromStatus: 'script_approved',         toStatus: 'images_generating',       skill: 'image-generator' },
  { eventType: 'IMAGES_GENERATED',             actor: 'tool',   fromStatus: 'images_generating',       toStatus: 'images_pending_approval', skill: 'image-generator' },
  { eventType: 'IMAGES_PARTIAL_FAILURE',       actor: 'tool',   fromStatus: 'images_generating',       toStatus: 'images_partial',          skill: 'image-generator' },
  { eventType: 'IMAGES_ALL_APPROVED',          actor: 'user',   fromStatus: 'images_pending_approval', toStatus: 'images_fully_approved',   skill: 'image-generator' },
  { eventType: 'SCENE_IMAGE_REGEN_REQUESTED',  actor: 'user',   fromStatus: 'images_pending_approval', toStatus: 'images_regen_requested',  skill: 'image-generator' },
  { eventType: 'SCENE_IMAGE_REGEN_COMPLETED',  actor: 'tool',   fromStatus: 'images_regen_requested',  toStatus: 'images_pending_approval', skill: 'image-generator' },
  { eventType: 'SCENE_IMAGE_VERSION_RESTORED', actor: 'user',   fromStatus: 'images_pending_approval', toStatus: 'images_version_restored', skill: 'image-generator' },
  { eventType: 'IMAGES_VERSION_RESTORE_DONE',  actor: 'system', fromStatus: 'images_version_restored', toStatus: 'images_pending_approval', skill: 'image-generator' },

  // 영상
  { eventType: 'VIDEO_GENERATION_STARTED', actor: 'system', fromStatus: 'images_fully_approved',   toStatus: 'video_generating',        skill: 'video-maker' },
  { eventType: 'VIDEO_GENERATED',          actor: 'tool',   fromStatus: 'video_generating',        toStatus: 'video_pending_approval',  skill: 'video-maker' },
  { eventType: 'VIDEO_APPROVED',           actor: 'user',   fromStatus: 'video_pending_approval',  toStatus: 'video_approved',          skill: 'video-maker' },
  { eventType: 'VIDEO_REGEN_REQUESTED',    actor: 'user',   fromStatus: 'video_pending_approval',  toStatus: 'video_regen_requested',   skill: 'video-maker' },
  { eventType: 'VIDEO_REGEN_COMPLETED',    actor: 'tool',   fromStatus: 'video_regen_requested',   toStatus: 'video_pending_approval',  skill: 'video-maker' },
  { eventType: 'VIDEO_FAILED',             actor: 'tool',   fromStatus: 'video_generating',        toStatus: 'video_failed',            skill: 'video-maker' },

  // TTS/합성
  { eventType: 'TTS_GENERATION_STARTED', actor: 'system', fromStatus: ['video_approved', 'images_fully_approved'], toStatus: 'tts_generating', skill: 'tts-sync' },
  { eventType: 'TTS_GENERATED',          actor: 'tool',   fromStatus: 'tts_generating',  toStatus: 'tts_syncing',   skill: 'tts-sync' },
  { eventType: 'TTS_FAILED',             actor: 'tool',   fromStatus: 'tts_generating',  toStatus: 'tts_failed',    skill: 'tts-sync' },
  { eventType: 'TTS_SYNC_COMPLETED',     actor: 'system', fromStatus: 'tts_syncing',     toStatus: 'compose_done',  skill: 'tts-sync' },
  { eventType: 'COMPOSE_FAILED',         actor: 'tool',   fromStatus: 'tts_syncing',     toStatus: 'error',         skill: 'tts-sync' },

  // QC
  { eventType: 'QC_STARTED',           actor: 'system', fromStatus: 'compose_done',                    toStatus: 'qc_reviewing',      skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_PASSED',            actor: 'system', fromStatus: 'qc_reviewing',                    toStatus: 'qc_passed',         skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_WARNING',           actor: 'system', fromStatus: 'qc_reviewing',                    toStatus: 'qc_warning',        skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_FAILED',            actor: 'system', fromStatus: 'qc_reviewing',                    toStatus: 'qc_failed',         skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_OVERRIDE',          actor: 'user',   fromStatus: 'qc_warning',                      toStatus: 'exporting',         skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_REVISE_TO_SCRIPT',  actor: 'user',   fromStatus: ['qc_warning', 'qc_failed'],       toStatus: 'scripting',         skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_REVISE_TO_IMAGES',  actor: 'user',   fromStatus: ['qc_warning', 'qc_failed'],       toStatus: 'images_generating', skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_REVISE_TO_VIDEO',   actor: 'user',   fromStatus: ['qc_warning', 'qc_failed'],       toStatus: 'video_generating',  skill: 'shorts-qc-reviewer' },
  { eventType: 'QC_REVISE_TO_TTS',     actor: 'user',   fromStatus: ['qc_warning', 'qc_failed'],       toStatus: 'tts_generating',    skill: 'shorts-qc-reviewer' },

  // 패키징
  { eventType: 'EXPORT_STARTED',   actor: 'system', fromStatus: ['qc_passed', 'qc_warning'], toStatus: 'exporting', skill: 'export-packager' },
  { eventType: 'EXPORT_COMPLETED', actor: 'system', fromStatus: 'exporting',                  toStatus: 'exported',  skill: 'export-packager' },
  { eventType: 'EXPORT_FAILED',    actor: 'system', fromStatus: 'exporting',                  toStatus: 'error',     skill: 'export-packager' },

  // 공통
  { eventType: 'JOB_ABANDONED',                 actor: 'user',   fromStatus: '*',     toStatus: 'abandoned',        skill: '*' },
  { eventType: 'ERROR_OCCURRED',                actor: 'system', fromStatus: '*',     toStatus: 'error',            skill: '*' },
  { eventType: 'ERROR_RECOVERED_TO_SEARCHING',  actor: 'system', fromStatus: 'error', toStatus: 'searching',        skill: '*' },
  { eventType: 'ERROR_RECOVERED_TO_SCRIPTING',  actor: 'system', fromStatus: 'error', toStatus: 'scripting',        skill: '*' },
  { eventType: 'ERROR_RECOVERED_TO_IMAGES',     actor: 'system', fromStatus: 'error', toStatus: 'images_generating', skill: '*' },
  { eventType: 'ERROR_RECOVERED_TO_VIDEO',      actor: 'system', fromStatus: 'error', toStatus: 'video_generating', skill: '*' },
  { eventType: 'ERROR_RECOVERED_TO_TTS',        actor: 'system', fromStatus: 'error', toStatus: 'tts_generating',   skill: '*' },
];

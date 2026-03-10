/**
 * StateEvent 발행 + 검증
 * data-models-v6.md 이벤트 레지스트리 기반
 */

import type { JobStatus } from '../types/job.js';
import type { StateEvent, EventType, EventActor, EventRegistryEntry } from '../types/events.js';
import { EVENT_REGISTRY } from '../types/events.js';

let eventCounter = 0;

// ── 이벤트 검증 ──
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateEvent(
  event: Pick<StateEvent, 'eventType' | 'fromStatus' | 'toStatus' | 'actor'>,
): ValidationResult {
  const def = EVENT_REGISTRY.find(e => e.eventType === event.eventType);
  if (!def) {
    return { valid: false, reason: `unknown eventType: ${event.eventType}` };
  }

  // fromStatus 검증 (배열이면 포함 여부, 문자열이면 일치, *이면 무조건 통과)
  if (def.fromStatus !== null && def.fromStatus !== '*') {
    const allowedFrom = Array.isArray(def.fromStatus)
      ? def.fromStatus
      : [def.fromStatus];
    if (event.fromStatus !== null && !allowedFrom.includes(event.fromStatus)) {
      return { valid: false, reason: `invalid fromStatus: ${event.fromStatus}` };
    }
  }

  // toStatus 검증
  if (def.toStatus !== null && event.toStatus !== def.toStatus) {
    return { valid: false, reason: `invalid toStatus: ${event.toStatus}` };
  }

  // actor 검증
  if (event.actor !== def.actor) {
    return { valid: false, reason: `invalid actor: ${event.actor}, expected: ${def.actor}` };
  }

  return { valid: true };
}

// ── 이벤트 리스너 ──
type EventListener = (event: StateEvent) => void;
const listeners: EventListener[] = [];

export function onEvent(listener: EventListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// ── 이벤트 히스토리 ──
const eventHistory: StateEvent[] = [];

export function getEventHistory(jobId?: string): StateEvent[] {
  if (jobId) return eventHistory.filter(e => e.jobId === jobId);
  return [...eventHistory];
}

// ── 이벤트 발행 ──
export function emitEvent(params: {
  jobId: string;
  eventType: EventType;
  actor: EventActor;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  targetId?: string;
  reasonCode?: string;
  reasonDetail?: string;
  metadata?: Record<string, unknown>;
}): StateEvent {
  const event: StateEvent = {
    eventId: `evt_${String(++eventCounter).padStart(4, '0')}`,
    jobId: params.jobId,
    timestamp: new Date().toISOString(),
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    eventType: params.eventType,
    actor: params.actor,
    targetId: params.targetId,
    reasonCode: params.reasonCode,
    reasonDetail: params.reasonDetail,
    metadata: params.metadata,
  };

  // 검증
  const validation = validateEvent(event);
  if (!validation.valid) {
    throw new Error(`Event validation failed: ${validation.reason}`);
  }

  // 히스토리에 추가
  eventHistory.push(event);

  // 리스너 통지
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error(`Event listener error:`, err);
    }
  }

  return event;
}

/**
 * 이벤트 레지스트리에서 특정 스킬이 발행할 수 있는 이벤트 조회
 */
export function getSkillEvents(skillName: string): EventRegistryEntry[] {
  return EVENT_REGISTRY.filter(e => e.skill === skillName || e.skill === '*');
}

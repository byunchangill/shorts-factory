/**
 * 에러 복구 & 재시도 핸들러
 *
 * CLAUDE.md 원칙 #9 "운영 안전":
 * - 재시도는 씬당 최대 3회로 제한
 * - 모든 실패에 로그를 남긴다
 * - 실패/부분완료/재수정/복원 흐름을 포함
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── 재시도 설정 ──
export interface RetryConfig {
  maxAttempts: number;      // 최대 시도 횟수 (기본: 3)
  delayMs: number;          // 재시도 간격 (기본: 1000ms)
  backoffMultiplier: number; // 지수 백오프 배수 (기본: 2)
  onRetry?: (attempt: number, error: Error) => void;
  onFail?: (attempts: number, lastError: Error) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

// ── 재시도 실행 결과 ──
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDurationMs: number;
  log: RetryAttemptLog[];
}

export interface RetryAttemptLog {
  attempt: number;
  startedAt: string;
  succeededAt?: string;
  failedAt?: string;
  errorMessage?: string;
  durationMs: number;
}

// ── 재시도 실행 함수 ──
/**
 * 비동기 함수를 최대 maxAttempts 번 재시도.
 * 성공 시 즉시 반환, 모두 실패 시 마지막 에러를 담아 반환.
 *
 * @example
 * const result = await withRetry(() => generateImage(params), { maxAttempts: 3 });
 * if (!result.success) throw result.error;
 * return result.data;
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<RetryResult<T>> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  const log: RetryAttemptLog[] = [];
  const overallStart = Date.now();

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const startedAt = new Date().toISOString();
    const attemptStart = Date.now();

    try {
      const data = await fn();
      const durationMs = Date.now() - attemptStart;

      log.push({
        attempt,
        startedAt,
        succeededAt: new Date().toISOString(),
        durationMs,
      });

      return {
        success: true,
        data,
        attempts: attempt,
        totalDurationMs: Date.now() - overallStart,
        log,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - attemptStart;

      log.push({
        attempt,
        startedAt,
        failedAt: new Date().toISOString(),
        errorMessage: error.message,
        durationMs,
      });

      cfg.onRetry?.(attempt, error);

      // 마지막 시도였으면 종료
      if (attempt >= cfg.maxAttempts) {
        cfg.onFail?.(attempt, error);
        return {
          success: false,
          error,
          attempts: attempt,
          totalDurationMs: Date.now() - overallStart,
          log,
        };
      }

      // 지수 백오프 대기
      const delay = cfg.delayMs * Math.pow(cfg.backoffMultiplier, attempt - 1);
      await sleep(delay);
    }
  }

  // 이론상 여기 도달하지 않음
  return {
    success: false,
    error: new Error('Unexpected retry loop exit'),
    attempts: cfg.maxAttempts,
    totalDurationMs: Date.now() - overallStart,
    log,
  };
}

// ── 씬 단위 재시도 래퍼 ──
/**
 * 씬별 작업 (이미지 생성, 영상 생성 등)에 재시도 + 로그 저장.
 * CLAUDE.md: "재시도는 씬당 최대 3회로 제한"
 */
export async function withSceneRetry<T>(params: {
  sceneId: string;
  jobId: string;
  taskName: string;
  fn: () => Promise<T>;
  logDir: string;
  config?: Partial<RetryConfig>;
}): Promise<RetryResult<T>> {
  const { sceneId, jobId, taskName, fn, logDir, config } = params;

  const result = await withRetry(fn, {
    maxAttempts: 3, // CLAUDE.md 원칙 #9 고정
    ...config,
    onRetry: (attempt, error) => {
      console.warn(
        `[RETRY] ${jobId}/${sceneId} ${taskName} — attempt ${attempt} failed: ${error.message}`,
      );
      config?.onRetry?.(attempt, error);
    },
    onFail: (attempts, error) => {
      console.error(
        `[FAILED] ${jobId}/${sceneId} ${taskName} — all ${attempts} attempts failed: ${error.message}`,
      );
      config?.onFail?.(attempts, error);
    },
  });

  // 로그 저장
  saveRetryLog({ jobId, sceneId, taskName, result, logDir });

  return result;
}

// ── 에러 분류 ──
export type ErrorCategory =
  | 'network'          // API 호출 실패, 타임아웃
  | 'resource'         // ComfyUI 메모리 부족, GPU 사용 중
  | 'validation'       // 입력값 오류, 스키마 불일치
  | 'rate_limit'       // API 쿼터 초과
  | 'not_found'        // 파일/경로 없음
  | 'tool_missing'     // ffmpeg, edge-tts 등 도구 없음
  | 'unknown';

export function classifyError(error: Error): ErrorCategory {
  const msg = error.message.toLowerCase();

  if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('etimedout') ||
      msg.includes('network') || msg.includes('fetch failed') || msg.includes('connection')) {
    return 'network';
  }
  if (msg.includes('out of memory') || msg.includes('cuda') || msg.includes('gpu') ||
      msg.includes('resource')) {
    return 'resource';
  }
  if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('429') ||
      msg.includes('too many requests')) {
    return 'rate_limit';
  }
  // tool_missing을 not_found보다 먼저 체크 ("command not found"가 "not found"에 선점되지 않도록)
  if (msg.includes('command not found') || msg.includes('spawn')) {
    return 'tool_missing';
  }
  if (msg.includes('enoent') || msg.includes('no such file') || msg.includes('not found')) {
    return 'not_found';
  }
  if (msg.includes('invalid') || msg.includes('schema') || msg.includes('validation')) {
    return 'validation';
  }

  return 'unknown';
}

// ── 복구 전략 제안 ──
export interface RecoveryAdvice {
  category: ErrorCategory;
  retryable: boolean;
  suggestedDelay?: number; // ms
  userMessage: string;
  technicalMessage: string;
}

export function getRecoveryAdvice(error: Error): RecoveryAdvice {
  const category = classifyError(error);

  switch (category) {
    case 'network':
      return {
        category,
        retryable: true,
        suggestedDelay: 3000,
        userMessage: '네트워크 연결을 확인하고 잠시 후 다시 시도합니다',
        technicalMessage: `Network error: ${error.message}`,
      };
    case 'resource':
      return {
        category,
        retryable: true,
        suggestedDelay: 10000,
        userMessage: 'GPU 메모리 부족. ComfyUI 재시작 후 다시 시도합니다',
        technicalMessage: `Resource error: ${error.message}`,
      };
    case 'rate_limit':
      return {
        category,
        retryable: true,
        suggestedDelay: 60000,
        userMessage: 'API 할당량 초과. 1분 후 자동으로 재시도합니다',
        technicalMessage: `Rate limit: ${error.message}`,
      };
    case 'not_found':
      return {
        category,
        retryable: false,
        userMessage: '필요한 파일을 찾을 수 없습니다. assets/ 폴더를 확인하세요',
        technicalMessage: `Not found: ${error.message}`,
      };
    case 'tool_missing':
      return {
        category,
        retryable: false,
        userMessage: '필수 도구가 설치되지 않았습니다. scripts/setup.sh를 실행하세요',
        technicalMessage: `Tool missing: ${error.message}`,
      };
    case 'validation':
      return {
        category,
        retryable: false,
        userMessage: '입력값 오류. 대본이나 설정을 확인하세요',
        technicalMessage: `Validation error: ${error.message}`,
      };
    default:
      return {
        category: 'unknown',
        retryable: true,
        suggestedDelay: 2000,
        userMessage: '알 수 없는 오류가 발생했습니다. 재시도 중...',
        technicalMessage: `Unknown error: ${error.message}`,
      };
  }
}

// ── 실패 로그 저장 ──
interface RetryLogEntry {
  jobId: string;
  sceneId: string;
  taskName: string;
  savedAt: string;
  success: boolean;
  attempts: number;
  totalDurationMs: number;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  log: RetryAttemptLog[];
}

function saveRetryLog<T>(params: {
  jobId: string;
  sceneId: string;
  taskName: string;
  result: RetryResult<T>;
  logDir: string;
}): void {
  const { jobId, sceneId, taskName, result, logDir } = params;

  const entry: RetryLogEntry = {
    jobId,
    sceneId,
    taskName,
    savedAt: new Date().toISOString(),
    success: result.success,
    attempts: result.attempts,
    totalDurationMs: result.totalDurationMs,
    errorCategory: result.error ? classifyError(result.error) : undefined,
    errorMessage: result.error?.message,
    log: result.log,
  };

  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const logPath = join(logDir, 'retry_log.json');
    const existing: RetryLogEntry[] = existsSync(logPath)
      ? JSON.parse(readFileSync(logPath, 'utf-8'))
      : [];

    existing.push(entry);
    writeFileSync(logPath, JSON.stringify(existing, null, 2), 'utf-8');
  } catch {
    // 로그 저장 실패는 무시 (원래 작업 결과에 영향 없음)
    console.warn(`[RETRY-LOG] Failed to save retry log for ${jobId}/${sceneId}`);
  }
}

// ── 유틸리티 ──
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 특정 Job의 재시도 로그 조회
 */
export function getRetryLog(logDir: string): RetryLogEntry[] {
  const logPath = join(logDir, 'retry_log.json');
  if (!existsSync(logPath)) return [];
  try {
    return JSON.parse(readFileSync(logPath, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * 재시도 통계 요약
 */
export function getRetryStats(logDir: string): {
  total: number;
  succeeded: number;
  failed: number;
  avgAttempts: number;
  failedByCategory: Record<ErrorCategory, number>;
} {
  const logs = getRetryLog(logDir);
  const failedByCategory = {} as Record<ErrorCategory, number>;

  let totalAttempts = 0;
  for (const entry of logs) {
    totalAttempts += entry.attempts;
    if (!entry.success && entry.errorCategory) {
      failedByCategory[entry.errorCategory] = (failedByCategory[entry.errorCategory] ?? 0) + 1;
    }
  }

  const succeeded = logs.filter(l => l.success).length;
  const failed = logs.filter(l => !l.success).length;

  return {
    total: logs.length,
    succeeded,
    failed,
    avgAttempts: logs.length > 0 ? totalAttempts / logs.length : 0,
    failedByCategory,
  };
}

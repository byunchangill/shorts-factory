/**
 * retry-handler.ts 단위 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  classifyError,
  getRecoveryAdvice,
} from '../utils/retry-handler.js';

// ─────────────────────────────────────────────
// withRetry
// ─────────────────────────────────────────────
describe('withRetry', () => {
  it('첫 번째 시도 성공 → attempts=1, success=true', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { delayMs: 0 });
    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('2번째에 성공 → attempts=2', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce('success');
    const result = await withRetry(fn, { maxAttempts: 3, delayMs: 0 });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('maxAttempts 모두 실패 → success=false, error 포함', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const result = await withRetry(fn, { maxAttempts: 3, delayMs: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('always fails');
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('log에 모든 시도 기록됨', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce('done');
    const result = await withRetry(fn, { maxAttempts: 3, delayMs: 0 });
    expect(result.log).toHaveLength(3);
    expect(result.log[0].errorMessage).toBe('fail1');
    expect(result.log[1].errorMessage).toBe('fail2');
    expect(result.log[2].succeededAt).toBeDefined();
  });

  it('onRetry 콜백 호출됨', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('retry'))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { delayMs: 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('onFail 콜백 — 전부 실패 시 호출됨', async () => {
    const onFail = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await withRetry(fn, { maxAttempts: 2, delayMs: 0, onFail });
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts=1 → 재시도 없음', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('one shot'));
    const result = await withRetry(fn, { maxAttempts: 1, delayMs: 0 });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('총 소요시간 기록됨 (totalDurationMs >= 0)', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn, { delayMs: 0 });
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────
// classifyError
// ─────────────────────────────────────────────
describe('classifyError', () => {
  it('ECONNREFUSED → network', () => {
    expect(classifyError(new Error('ECONNREFUSED 127.0.0.1:8188'))).toBe('network');
  });
  it('fetch failed → network', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('network');
  });
  it('out of memory → resource', () => {
    expect(classifyError(new Error('CUDA out of memory'))).toBe('resource');
  });
  it('429 → rate_limit', () => {
    expect(classifyError(new Error('HTTP 429 Too Many Requests'))).toBe('rate_limit');
  });
  it('quota → rate_limit', () => {
    expect(classifyError(new Error('API quota exceeded'))).toBe('rate_limit');
  });
  it('ENOENT → not_found', () => {
    expect(classifyError(new Error("ENOENT: no such file or directory 'assets/font.ttf'"))).toBe('not_found');
  });
  it('command not found → tool_missing', () => {
    expect(classifyError(new Error('command not found: ffmpeg'))).toBe('tool_missing');
  });
  it('invalid schema → validation', () => {
    expect(classifyError(new Error('invalid schema format'))).toBe('validation');
  });
  it('알 수 없는 에러 → unknown', () => {
    expect(classifyError(new Error('some weird thing happened'))).toBe('unknown');
  });
});

// ─────────────────────────────────────────────
// getRecoveryAdvice
// ─────────────────────────────────────────────
describe('getRecoveryAdvice', () => {
  it('network 에러 → retryable: true', () => {
    const advice = getRecoveryAdvice(new Error('ECONNREFUSED'));
    expect(advice.retryable).toBe(true);
    expect(advice.category).toBe('network');
    expect(advice.userMessage).toBeTruthy();
  });

  it('tool_missing → retryable: false', () => {
    const advice = getRecoveryAdvice(new Error('command not found: edge-tts'));
    expect(advice.retryable).toBe(false);
    expect(advice.userMessage).toContain('설치');
  });

  it('rate_limit → suggestedDelay >= 60000', () => {
    const advice = getRecoveryAdvice(new Error('rate limit exceeded'));
    expect(advice.suggestedDelay).toBeGreaterThanOrEqual(60000);
  });

  it('not_found → retryable: false', () => {
    const advice = getRecoveryAdvice(new Error('ENOENT: no such file'));
    expect(advice.retryable).toBe(false);
  });

  it('항상 userMessage, technicalMessage 포함', () => {
    const errors = [
      new Error('network error'),
      new Error('out of memory'),
      new Error('unexpected random error'),
    ];
    for (const err of errors) {
      const advice = getRecoveryAdvice(err);
      expect(advice.userMessage).toBeTruthy();
      expect(advice.technicalMessage).toBeTruthy();
    }
  });
});

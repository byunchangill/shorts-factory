import path from 'node:path';
import { QuotaLedgerSchema, type QuotaLedger } from '@shared/types';
import { YOUTUBE_DAILY_QUOTA } from '@shared/constants';
import { WORKSPACE_ROOT } from '../store/workspace.js';
import { readJson, writeJsonAtomic } from '../util/fsx.js';

const LEDGER_PATH = path.join(WORKSPACE_ROOT, 'youtube-quota.json');

/** 오늘 날짜 (로컬 기준 YYYY-MM-DD) — 구글은 태평양시 자정에 리셋하지만 근사로 충분하다 */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 날짜가 바뀌면 사용량을 0으로 되돌린다 (순수 함수 — 테스트 대상) */
export function rollOver(ledger: QuotaLedger, today: string): QuotaLedger {
  return ledger.date === today ? ledger : { date: today, used: 0 };
}

export async function readQuota(): Promise<QuotaLedger> {
  const raw = await readJson<unknown>(LEDGER_PATH);
  const parsed = QuotaLedgerSchema.safeParse(raw);
  const ledger = parsed.success ? parsed.data : { date: todayKey(), used: 0 };
  return rollOver(ledger, todayKey());
}

export async function spendQuota(cost: number): Promise<QuotaLedger> {
  const ledger = await readQuota();
  const next = { date: ledger.date, used: ledger.used + cost };
  await writeJsonAtomic(LEDGER_PATH, next);
  return next;
}

export function remaining(ledger: QuotaLedger): number {
  return Math.max(0, YOUTUBE_DAILY_QUOTA - ledger.used);
}

/** 남은 쿼터가 부족하면 호출 자체를 막아 초과 과금(=차단)을 방지한다 */
export async function assertQuota(cost: number): Promise<void> {
  const ledger = await readQuota();
  if (remaining(ledger) < cost) {
    throw Object.assign(
      new Error(
        `오늘의 YouTube API 무료 쿼터를 거의 다 썼습니다 (${ledger.used}/${YOUTUBE_DAILY_QUOTA}). 내일 다시 시도하세요.`,
      ),
      { status: 429 },
    );
  }
}

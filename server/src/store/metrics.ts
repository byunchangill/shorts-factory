import path from 'node:path';
import fsp from 'node:fs/promises';
import { WORKSPACE_ROOT } from './workspace.js';

import { exists, withFileLock } from '../util/fsx.js';

/**
 * 성과 대장 — 내가 낸 편을 채점하는 자리.
 *
 * 이 앱에는 남의 채널을 보는 리서치는 있어도 **내 편을 채점하는 자리가 없었다.**
 * 그러면 편수만 늘고 성적은 안 오른다. 컬럼은 쇼핑쇼츠 저장소의 원장
 * (`docs/from-shopping-shorts/_metrics.csv`)을 그대로 쓴다 — 두 저장소가 같은 채널을
 * 만들므로 표를 합쳐 볼 수 있어야 한다.
 *
 * CSV인 이유는 사람이 엑셀로 열어 직접 채우기 때문이다. 「계속 시청함」은 유튜브
 * 스튜디오에만 있고 API로 안 나온다 — 그 칸은 손으로 적는다.
 */

export const METRICS_COLUMNS = [
  'slug', 'video_id', 'title_published', 'published', 'channel',
  'views', 'retained_pct', 'avg_view_pct', 'watch_sec', 'duration_sec',
  'likes', 'comments', 'shares', 'orders', 'link_clicks',
  'retention_head', 'hook_seed', 'rehook', 'hook_q', 'title_form',
  'hook_cuts', 'hook_first_sec', 'hook_delta', 'chips', 'note',
] as const;

export type MetricsRow = Partial<Record<(typeof METRICS_COLUMNS)[number], string>>;

const FILE = () => path.join(WORKSPACE_ROOT, 'metrics.csv');

/** 한 줄을 CSV 규칙대로 쪼갠다 (따옴표 안의 쉼표·줄바꿈 보존) */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 쉼표·따옴표·줄바꿈이 있으면 감싼다. 제목에 쉼표가 흔하다 */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function readLedger(): Promise<MetricsRow[]> {
  const file = FILE();
  if (!await exists(file)) return [];
  const text = (await fsp.readFile(file, 'utf8')).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: MetricsRow = {};
    header.forEach((h, i) => {
      if ((METRICS_COLUMNS as readonly string[]).includes(h)) {
        (row as Record<string, string>)[h] = cells[i] ?? '';
      }
    });
    return row;
  });
}

async function writeLedger(rows: MetricsRow[]): Promise<void> {
  const body = [
    METRICS_COLUMNS.join(','),
    ...rows.map((r) => METRICS_COLUMNS.map((c) => csvCell(r[c] ?? '')).join(',')),
  ].join('\n');
  await fsp.writeFile(FILE(), `${body}\n`, 'utf8');
}

/**
 * 한 편을 대장에 올린다. 같은 `slug`가 이미 있으면 덮어쓰지 않고 **채워 넣는다** —
 * 사람이 손으로 적은 「계속 시청함」을 자동 갱신이 지우면 안 된다.
 */
export async function upsertRow(row: MetricsRow & { slug: string }): Promise<MetricsRow> {
  return withFileLock(FILE(), async () => {
    const rows = await readLedger();
    const idx = rows.findIndex((r) => r.slug === row.slug);
    let merged: MetricsRow;
    if (idx < 0) {
      merged = row;
      rows.push(merged);
    } else {
      merged = { ...rows[idx] };
      for (const [k, v] of Object.entries(row)) {
        if (v !== undefined && v !== '') (merged as Record<string, string>)[k] = v;
      }
      rows[idx] = merged;
    }
    await writeLedger(rows);
    return merged;
  });
}

/**
 * 직전 편들의 훅 유형·인물 — 새 잡의 요청서에 실어 **연속 중복을 막는다.**
 * 교리는 동일 인물 연속 2편 초과 금지, 10편 중 3회 초과 금지다.
 */
export async function recentHooks(limit = 3): Promise<Array<{ slug: string; hookSeed: string; note: string }>> {
  const rows = await readLedger();
  return rows
    .filter((r) => r.published)
    .sort((a, b) => (a.published ?? '').localeCompare(b.published ?? ''))
    .slice(-limit)
    .reverse()
    .map((r) => ({ slug: r.slug ?? '', hookSeed: r.hook_seed ?? '', note: r.note ?? '' }));
}

/** 판정 — 두 지표를 **따로** 읽는다. 뭉뚱그리면 훅 문제를 대본 문제로 오진한다 */
export function verdictOf(row: MetricsRow): { verdict: string; next: string } | null {
  const retained = Number(row.retained_pct);
  if (!row.retained_pct || Number.isNaN(retained)) return null;
  if (retained < 20) {
    return {
      verdict: '첫 2초 실패 — 대본은 용의자가 아닙니다',
      next: '다음 편 훅을 제품이 크게 움직이는 구간으로 바꾸세요',
    };
  }
  const avg = Number(row.avg_view_pct);
  if (!Number.isNaN(avg) && avg > 0 && avg < 60) {
    return { verdict: '중반 이탈', next: '대본 구조와 러닝타임을 줄이세요' };
  }
  return { verdict: '정상', next: '같은 훅 유형을 연속으로 쓰지만 마세요' };
}

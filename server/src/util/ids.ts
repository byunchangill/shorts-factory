/** 날짜 기반 잡 ID: 20260810-001 (프로젝트 내 시퀀스) */
export function nextJobId(existingIds: string[], now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const todays = existingIds
    .filter((id) => id.startsWith(ymd))
    .map((id) => parseInt(id.split('-')[1] ?? '0', 10))
    .filter((n) => !Number.isNaN(n));
  const seq = (todays.length ? Math.max(...todays) : 0) + 1;
  return `${ymd}-${String(seq).padStart(3, '0')}`;
}

/** 시퀀스 접두 ID: c01, c02 / p01-script 등 */
export function nextSeqId(prefix: string, existingIds: string[], suffix = ''): string {
  const nums = existingIds
    .map((id) => {
      const m = id.match(new RegExp(`^${prefix}(\\d+)`));
      return m ? parseInt(m[1], 10) : 0;
    });
  const seq = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(seq).padStart(2, '0')}${suffix ? `-${suffix}` : ''}`;
}

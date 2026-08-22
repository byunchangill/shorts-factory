import { z } from 'zod';
import { asyncRouter } from '../util/asyncRouter.js';
import { readLedger, upsertRow, recentHooks, verdictOf } from '../store/metrics.js';
import { videoMetrics } from '../youtube/analytics.js';

/**
 * 성과 대장 API.
 *
 * 발행은 사람이 유튜브에서 한다 — 앱은 그 결과를 **받아 적을** 뿐이다.
 * 자동으로 채울 수 있는 것과 손으로 적어야 하는 것이 갈린다:
 * 조회수·평균 조회율·좋아요는 Analytics가 주고, **「계속 시청함」은 스튜디오에만 있다.**
 */
const router = asyncRouter();

/** 발행 뒤 48시간이 지나야 지표가 안정된다 — 그 전 갱신은 헛수고다 */
const SETTLE_HOURS = 48;

router.get('/metrics', async (_req, res) => {
  const rows = await readLedger();
  res.json({
    rows: rows.map((r) => ({ ...r, verdict: verdictOf(r) })),
    recentHooks: await recentHooks(),
  });
});

/** 한 편 올리기·고치기. 화면에서 「계속 시청함」을 직접 적는 자리도 이것이다 */
router.post('/metrics/row', async (req, res) => {
  const body = z.object({ slug: z.string().min(1) }).catchall(z.string()).parse(req.body ?? {});
  res.json({ row: await upsertRow(body) });
});

/**
 * 유튜브에서 지표를 끌어와 채운다.
 *
 * 사람이 적은 칸은 **덮어쓰지 않는다**(`upsertRow`가 빈 값만 채운다).
 * OAuth가 안 붙어 있으면 한 줄도 못 채우므로 그대로 오류를 올린다 —
 * 조용히 0으로 채우면 대장이 거짓말을 한다.
 */
router.post('/metrics/refresh', async (_req, res) => {
  const rows = await readLedger();
  const now = Date.now();
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    if (!row.video_id || !row.slug) continue;
    const published = row.published ? Date.parse(row.published) : NaN;
    if (!Number.isNaN(published) && now - published < SETTLE_HOURS * 3600_000) {
      skipped.push(`${row.slug}: 발행 ${SETTLE_HOURS}시간 전`);
      continue;
    }
    const m = await videoMetrics(row.video_id);
    await upsertRow({
      slug: row.slug,
      views: String(m.views),
      avg_view_pct: m.avgViewPercentage.toFixed(1),
      watch_sec: m.avgViewDuration.toFixed(0),
      likes: String(m.likes),
      comments: String(m.comments),
      shares: String(m.shares),
    });
    updated.push(row.slug);
  }
  res.json({
    updated,
    skipped,
    // 자동으로 못 채우는 칸을 화면이 알아야 「왜 비었지」를 안 묻는다
    manualColumns: ['retained_pct', 'orders', 'link_clicks'],
  });
});

export default router;

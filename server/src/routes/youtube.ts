import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { YOUTUBE_DAILY_QUOTA } from '@shared/constants';
import { ViralItemSchema } from '@shared/types';
import {
  discoverViral, discoverByCategory, discoverByChannels, resolveChannel, sortViral,
} from '../youtube/viral.js';
import {
  readBoard, saveToBoard, removeFromBoard, readChannels, addChannel, removeChannel,
} from '../store/viralBoard.js';
import { readQuota, remaining } from '../youtube/quota.js';
import { clearCache } from '../youtube/client.js';
import {
  searchVideos, popularVideos, searchChannels, analyzeChannel, videoCategories,
} from '../youtube/research.js';
import { buildAuthUrl, exchangeCode, isConnected, disconnect, REDIRECT_URI } from '../youtube/oauth.js';
import { myChannel, channelSummary, dailyViews, trafficSources, topVideos } from '../youtube/analytics.js';
import { hasKey } from '../store/secrets.js';
import { resolveJob, mutateJob } from '../store/jobs.js';
import { nextSeqId } from '../util/ids.js';

const router = Router();

/** 상태 표시줄용 — 키 등록 여부 + 오늘 쿼터 */
router.get('/youtube/status', async (_req, res) => {
  const ledger = await readQuota();
  res.json({
    keyConfigured: await hasKey('youtube'),
    oauthConnected: await isConnected(),
    quota: { used: ledger.used, total: YOUTUBE_DAILY_QUOTA, remaining: remaining(ledger) },
  });
});

router.post('/youtube/cache/clear', async (_req, res) => {
  res.json({ cleared: await clearCache() });
});

// ── 바이럴 제품 발굴 ──────────────────────────────────────────────

const YT_KEY_MISSING = '유튜브 API 키가 없습니다. "API 키" 메뉴에서 먼저 등록하세요.';

async function quotaView() {
  const ledger = await readQuota();
  return { used: ledger.used, total: YOUTUBE_DAILY_QUOTA, remaining: remaining(ledger) };
}

/**
 * 키워드로 최근 급상승 영상을 모아 이상치 점수를 매긴다.
 * 비용이 큰 동작(키워드당 100유닛)이라 키워드 수를 제한한다 —
 * 실수로 20개를 넣으면 하루 쿼터의 5분의 1이 한 번에 나간다.
 */
router.post('/viral/discover', async (req, res) => {
  if (!(await hasKey('youtube'))) return res.status(400).json({ error: YT_KEY_MISSING });
  const body = z.object({
    keywords: z.array(z.string().min(1)).min(1).max(10),
    withinDays: z.number().int().min(1).max(90).default(7),
    shortsOnly: z.boolean().default(true),
    perKeyword: z.number().int().min(5).max(50).default(25),
    sort: z.enum(['outlier', 'viewsPerDay', 'views', 'newest']).default('outlier'),
  }).parse(req.body ?? {});

  const items = await discoverViral(body);
  res.json({ items: sortViral(items, body.sort), quota: await quotaView() });
});

/** 카테고리 인기 급상승 — 2유닛. 하루 수천 번 가능하니 제한을 두지 않는다 */
router.post('/viral/category', async (req, res) => {
  if (!(await hasKey('youtube'))) return res.status(400).json({ error: YT_KEY_MISSING });
  const body = z.object({
    categoryId: z.string().optional(),
    shortsOnly: z.boolean().default(true),
    sort: z.enum(['outlier', 'viewsPerDay', 'views', 'newest']).default('outlier'),
  }).parse(req.body ?? {});
  const items = await discoverByCategory(body);
  res.json({ items: sortViral(items, body.sort), quota: await quotaView() });
});

/** 등록 채널 훑기 — 채널당 2유닛 */
router.post('/viral/channels/scan', async (req, res) => {
  if (!(await hasKey('youtube'))) return res.status(400).json({ error: YT_KEY_MISSING });
  const body = z.object({
    withinDays: z.number().int().min(1).max(90).default(14),
    shortsOnly: z.boolean().default(true),
    sort: z.enum(['outlier', 'viewsPerDay', 'views', 'newest']).default('outlier'),
  }).parse(req.body ?? {});
  const channels = await readChannels();
  if (!channels.length) {
    return res.status(400).json({ error: '추적 중인 채널이 없습니다. 채널 주소를 붙여넣어 등록하세요.' });
  }
  const items = await discoverByChannels({ ...body, channelIds: channels.map((c) => c.channelId) });
  res.json({ items: sortViral(items, body.sort), quota: await quotaView() });
});

router.get('/viral/channels', async (_req, res) => {
  res.json(await readChannels());
});

router.post('/viral/channels', async (req, res) => {
  if (!(await hasKey('youtube'))) return res.status(400).json({ error: YT_KEY_MISSING });
  const { input } = z.object({ input: z.string().min(1) }).parse(req.body);
  const ch = await resolveChannel(input);
  res.json(await addChannel(ch));
});

router.delete('/viral/channels/:channelId', async (req, res) => {
  res.json(await removeChannel(req.params.channelId));
});

router.get('/viral/board', async (_req, res) => {
  res.json(await readBoard());
});

router.post('/viral/board', async (req, res) => {
  const item = ViralItemSchema.parse(req.body);
  res.json(await saveToBoard(item));
});

router.delete('/viral/board/:videoId', async (req, res) => {
  res.json(await removeFromBoard(req.params.videoId));
});

// ── 검색 / 인기 ───────────────────────────────────────────────────

router.get('/youtube/search', async (req, res) => {
  const q = z.object({
    query: z.string().min(1),
    shortsOnly: z.enum(['true', 'false']).optional(),
    order: z.enum(['viewCount', 'date', 'relevance']).optional(),
    days: z.coerce.number().int().positive().optional(),
  }).parse(req.query);

  const videos = await searchVideos({
    query: q.query,
    shortsOnly: q.shortsOnly === 'true',
    order: q.order,
    publishedWithinDays: q.days,
  });
  res.json(videos);
});

router.get('/youtube/popular', async (req, res) => {
  const q = z.object({
    categoryId: z.string().optional(),
    shortsOnly: z.enum(['true', 'false']).optional(),
  }).parse(req.query);
  res.json(await popularVideos({
    categoryId: q.categoryId,
    shortsOnly: q.shortsOnly === 'true',
  }));
});

router.get('/youtube/categories', async (_req, res) => {
  res.json(await videoCategories('KR'));
});

// ── 타채널 분석 ───────────────────────────────────────────────────

router.get('/youtube/channels/search', async (req, res) => {
  const q = z.object({ query: z.string().min(1) }).parse(req.query);
  res.json(await searchChannels(q.query));
});

router.get('/youtube/channels/:cid', async (req, res) => {
  res.json(await analyzeChannel(req.params.cid));
});

// ── 내 채널 분석 (OAuth) ──────────────────────────────────────────

const pendingStates = new Set<string>();

router.get('/youtube/oauth/start', async (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.add(state);
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);
  res.json({ url: await buildAuthUrl(state), redirectUri: REDIRECT_URI });
});

/** 구글이 리디렉트로 돌아오는 지점 — 브라우저에 결과 페이지를 직접 렌더한다 */
router.get('/youtube/oauth/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
     <style>body{font-family:system-ui,sans-serif;padding:60px;text-align:center;color:#1e293b}
     h1{font-size:20px}p{color:#64748b}</style></head>
     <body><h1>${title}</h1><p>${body}</p></body></html>`;

  if (!code || !pendingStates.has(state)) {
    return res.status(400).send(page('연결 실패', '인증 요청이 유효하지 않습니다. 앱에서 다시 시도하세요.'));
  }
  pendingStates.delete(state);
  try {
    await exchangeCode(code);
    res.send(page('구글 계정 연결 완료', '이 창을 닫고 앱으로 돌아가세요.'));
  } catch (e) {
    res.status(500).send(page('연결 실패', e instanceof Error ? e.message : String(e)));
  }
});

router.post('/youtube/oauth/disconnect', async (_req, res) => {
  await disconnect();
  res.json({ ok: true });
});

router.get('/youtube/me', async (req, res) => {
  const days = z.coerce.number().int().positive().max(365).default(28).parse(req.query.days ?? 28);
  const [channel, summary, daily, traffic, top] = await Promise.all([
    myChannel(),
    channelSummary(days),
    dailyViews(days),
    trafficSources(days),
    topVideos(days),
  ]);
  res.json({ channel, summary, daily, traffic, topVideos: top, days });
});

// ── 리서치 → 제작 연결 ────────────────────────────────────────────

/** 검색 결과 영상을 메뉴 A 잡의 소스로 추가 */
router.post('/youtube/to-job', async (req, res) => {
  const body = z.object({
    jobId: z.string(),
    urls: z.array(z.string().url()).min(1),
  }).parse(req.body);

  const ref = resolveJob(body.jobId);
  if (!ref) return res.status(404).json({ error: '잡 없음' });
  if (ref.menu !== 'menu-a') return res.status(400).json({ error: '해외영상 짜집기 작업에만 추가할 수 있습니다' });

  const job = await mutateJob(ref, (j) => {
    const existing = new Set(j.sources.map((s) => s.url));
    for (const url of body.urls) {
      if (existing.has(url)) continue;
      const id = nextSeqId('s', j.sources.map((s) => s.id));
      j.sources.push({ id, url, origin: 'url', status: 'queued', attempts: 0, progress: 0 });
      existing.add(url);
    }
  });
  res.json({ sources: job.sources.length });
});

export default router;

import { asyncRouter } from '../util/asyncRouter.js';
import { FormatSchema } from '@shared/types';
import * as formats from '../store/formats.js';

const router = asyncRouter();

router.get('/formats', async (_req, res) => {
  res.json(await formats.listFormats());
});

router.get('/formats/:fid', async (req, res) => {
  const format = await formats.getFormat(req.params.fid);
  if (!format) return res.status(404).json({ error: '포맷 없음' });
  res.json(format);
});

/** 수동 저장/수정 (마법사 없이 직접 편집하는 경우) */
router.put('/formats/:fid', async (req, res) => {
  const body = FormatSchema.partial({ id: true, createdAt: true, version: true }).parse(req.body);
  const saved = await formats.saveFormat({ ...body, id: req.params.fid } as Parameters<typeof formats.saveFormat>[0]);
  res.json(saved);
});

export default router;

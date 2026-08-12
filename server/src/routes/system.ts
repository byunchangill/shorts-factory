import { asyncRouter } from '../util/asyncRouter.js';
import { SettingsSchema } from '@shared/types';
import { runDoctor } from '../doctor.js';
import { loadSettings, saveSettings } from '../store/workspace.js';

const router = asyncRouter();

// ?refresh=1 이면 외부 도구를 다시 점검한다 (기본은 캐시 — 매 요청마다 프로세스 4개를 띄우지 않는다)
router.get('/system/doctor', async (req, res) => {
  res.json(await runDoctor({ force: req.query.refresh === '1' }));
});

router.get('/settings', async (_req, res) => {
  res.json(await loadSettings());
});

router.put('/settings', async (req, res) => {
  const settings = SettingsSchema.parse(req.body);
  await saveSettings(settings);
  res.json(settings);
});

export default router;

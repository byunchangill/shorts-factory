import { Router } from 'express';
import { SettingsSchema } from '@shared/types';
import { runDoctor } from '../doctor.js';
import { loadSettings, saveSettings } from '../store/workspace.js';

const router = Router();

router.get('/system/doctor', async (_req, res) => {
  res.json(await runDoctor());
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

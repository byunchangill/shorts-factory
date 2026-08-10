import { Router } from 'express';
import { z } from 'zod';
import { API_KEY_NAMES, API_KEY_INFO, type ApiKeyName } from '@shared/constants';
import { loadSecrets, saveSecrets, maskKey, getKey } from '../store/secrets.js';
import { testKey } from '../ai/keyTest.js';

const router = Router();

const KeyNameSchema = z.enum(API_KEY_NAMES);

/** 마스킹된 키 목록 — 실제 값은 절대 응답에 넣지 않는다 */
router.get('/keys', async (_req, res) => {
  const secrets = await loadSecrets();
  res.json({
    keys: API_KEY_NAMES.map((name) => ({
      name,
      ...API_KEY_INFO[name],
      configured: !!secrets[name],
      masked: maskKey(secrets[name]),
    })),
    googleOauth: {
      clientIdConfigured: !!secrets.googleOauth.clientId,
      clientSecretConfigured: !!secrets.googleOauth.clientSecret,
      connected: !!secrets.googleOauth.refreshToken,
    },
  });
});

router.put('/keys/:name', async (req, res) => {
  const name = KeyNameSchema.parse(req.params.name) as ApiKeyName;
  const body = z.object({ value: z.string() }).parse(req.body);
  const secrets = await loadSecrets();
  secrets[name] = body.value.trim();
  await saveSecrets(secrets);
  res.json({ name, configured: !!secrets[name], masked: maskKey(secrets[name]) });
});

router.delete('/keys/:name', async (req, res) => {
  const name = KeyNameSchema.parse(req.params.name) as ApiKeyName;
  const secrets = await loadSecrets();
  secrets[name] = '';
  await saveSecrets(secrets);
  res.json({ name, configured: false, masked: '' });
});

/** 저비용 검증 호출로 키가 실제로 동작하는지 확인 */
router.post('/keys/:name/test', async (req, res) => {
  const name = KeyNameSchema.parse(req.params.name) as ApiKeyName;
  const key = await getKey(name);
  if (!key) return res.status(400).json({ ok: false, error: '키가 등록되지 않았습니다' });
  const result = await testKey(name, key);
  res.json(result);
});

/** 구글 OAuth 클라이언트 정보 (내 채널 분석용) */
router.put('/keys/google-oauth', async (req, res) => {
  const body = z.object({
    clientId: z.string(),
    clientSecret: z.string(),
  }).parse(req.body);
  const secrets = await loadSecrets();
  secrets.googleOauth.clientId = body.clientId.trim();
  secrets.googleOauth.clientSecret = body.clientSecret.trim();
  await saveSecrets(secrets);
  res.json({ ok: true });
});

export default router;

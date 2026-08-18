import { z } from 'zod';
import { asyncRouter } from '../util/asyncRouter.js';
import { listFreeFonts } from '../pipeline/freeFonts.js';
import { listModels, type AiProvider } from '../ai/modelList.js';
import { listAvailable, installFamilies } from '../pipeline/googleFonts.js';

/** 설정 화면에서 고르는 목록들 — 이 PC에 깔린 무료 글꼴, 제공자별 AI 모델 */
const router = asyncRouter();

router.get('/fonts', async (_req, res) => {
  res.json({ fonts: await listFreeFonts() });
});

/** 구글 폰트에서 받을 수 있는 한국어 글꼴 (전부 OFL) */
router.get('/fonts/available', async (_req, res) => {
  res.json({ families: await listAvailable() });
});

/*
  받기 — **누를 때만** 밖으로 나간다. 자동으로 받지 않는다.
  파일은 workspace/fonts/에만 쓰고 시스템에는 설치하지 않는다.
*/
router.post('/fonts/install', async (req, res) => {
  const body = z.object({ families: z.array(z.string()).optional() }).parse(req.body ?? {});
  res.json(await installFamilies(body.families));
});

router.get('/ai/models', async (req, res) => {
  const provider = z.enum(['anthropic', 'openai', 'gemini']).parse(req.query.provider) as AiProvider;
  res.json(await listModels(provider));
});

export default router;

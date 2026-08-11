import { Router } from 'express';
import { z } from 'zod';
import { AI_PROVIDERS } from '@shared/constants';
import {
  SOURCE_PLATFORMS, PLATFORM_LABELS, VIDEO_PLATFORMS,
  buildAllLinks, lensUrl, thumbnailUrl,
} from '../sourcing/links.js';
import { suggestKeywords } from '../sourcing/keywords.js';
import { availableProviders } from '../ai/providers.js';
import { loadSettings } from '../store/workspace.js';

const router = Router();

/** 화면이 플랫폼 목록·라벨을 하드코딩하지 않게 */
router.get('/sourcing/platforms', (_req, res) => {
  res.json({
    platforms: SOURCE_PLATFORMS.map((id) => ({
      id, label: PLATFORM_LABELS[id], video: VIDEO_PLATFORMS.includes(id),
    })),
  });
});

/** 검색어 → 플랫폼별 검색 링크 (AI 없이도 쓸 수 있어야 한다) */
router.get('/sourcing/links', (req, res) => {
  const { keyword } = z.object({ keyword: z.string().min(1) }).parse(req.query);
  res.json({ keyword, links: buildAllLinks(keyword) });
});

/** 유튜브 영상 → 썸네일 역이미지 검색 (구글 렌즈) */
router.get('/sourcing/lens/:videoId', (req, res) => {
  const image = thumbnailUrl(req.params.videoId, 'maxres');
  res.json({ image, lens: lensUrl(image) });
});

/**
 * 제목에서 제품을 알아내고 중국어 검색어를 만든다.
 * 한국어로는 도우인·샤오홍슈에서 아무것도 못 찾기 때문에 이 단계가 필요하다.
 */
router.post('/sourcing/keywords', async (req, res) => {
  const body = z.object({
    title: z.string().min(1),
    channelTitle: z.string().optional(),
    provider: z.enum(AI_PROVIDERS).optional(),
  }).parse(req.body);

  const available = await availableProviders();
  const settings = await loadSettings();
  const provider = body.provider
    ?? (available[settings.defaultAiProvider] ? settings.defaultAiProvider : undefined)
    ?? AI_PROVIDERS.find((p) => available[p]);
  if (!provider) {
    return res.status(400).json({
      error: 'AI 키가 없습니다. "API 키" 메뉴에서 Claude·GPT·Gemini 중 하나를 등록하거나, '
        + '검색어를 직접 입력하세요.',
    });
  }

  const result = await suggestKeywords(provider, body);
  const all = [...result.keywordsZh, ...result.keywordsEn];
  res.json({
    ...result,
    provider,
    // 검색어마다 바로 열 수 있는 링크를 같이 준다 — 화면에서 다시 조립하지 않게
    suggestions: all.map((text) => ({
      text,
      lang: result.keywordsZh.includes(text) ? 'zh' : 'en',
      links: buildAllLinks(text),
    })),
  });
});

export default router;

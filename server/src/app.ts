import path from 'node:path';
import { existsSync } from 'node:fs';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { REPO_ROOT, WORKSPACE_ROOT } from './store/workspace.js';
import { addClient } from './sse.js';
import { bootState, isReady } from './boot.js';
import systemRoutes from './routes/system.js';
import subtitlePreviewRoutes from './routes/subtitlePreview.js';
import catalogRoutes from './routes/catalog.js';
import projectRoutes from './routes/projects.js';
import jobRoutes from './routes/jobs.js';
import packetRoutes from './routes/packets.js';
import formatRoutes from './routes/formats.js';
import keyRoutes from './routes/keys.js';
import youtubeRoutes from './routes/youtube.js';
import sourcingRoutes from './routes/sourcing.js';

export const CLIENT_DIST = path.join(REPO_ROOT, 'client', 'dist');

/**
 * 빌드된 화면(client/dist)을 API와 같은 포트로 낸다.
 *
 * dist 유무를 미들웨어 등록 시점에 한 번만 보고 확정하면, 서버를 띄운 뒤 빌드한
 * 경우 영영 화면이 안 나온다. 요청마다 확인하는 편이 로컬 앱에선 훨씬 덜 헷갈린다.
 */
function mountClient(app: express.Express): void {
  app.use(express.static(CLIENT_DIST, { index: false }));

  app.get('*', (req, res, next) => {
    // API·미디어는 각자 404를 내야 한다 — 여기서 index.html을 돌려주면
    // 없는 엔드포인트가 200 HTML로 답해 프론트가 JSON 파싱에서 터진다
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();

    const indexHtml = path.join(CLIENT_DIST, 'index.html');
    if (!existsSync(indexHtml)) {
      return res.status(503).type('html').send(
        '<meta charset="utf-8"><h1>화면이 아직 빌드되지 않았습니다</h1>' +
          '<p><code>npm run build</code>를 실행한 뒤 새로고침하세요.</p>' +
          '<p>개발 중이라면 <code>npm run dev</code>로 띄운 http://localhost:5173 을 여세요.</p>',
      );
    }
    res.sendFile(indexHtml);
  });
}

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/events', (_req, res) => addClient(res));

  // 부팅 상태는 준비 전에도 항상 답한다 — 화면이 "왜 안 되는지"를 알 수 있어야 한다
  app.get('/api/system/status', (_req, res) => res.json(bootState()));

  // 인덱스 재구성이 끝나기 전에는 빈 목록 같은 틀린 답 대신 503으로 명확히 알린다
  app.use('/api', (_req, res, next) => {
    if (isReady()) return next();
    res.status(503).json({
      error: '서버가 아직 준비 중입니다. 잠시 후 다시 시도하세요.',
      booting: true,
    });
  });

  app.use('/api', systemRoutes);
  app.use('/api', subtitlePreviewRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', projectRoutes);
  app.use('/api', jobRoutes);
  app.use('/api', packetRoutes);
  app.use('/api', formatRoutes);
  app.use('/api', keyRoutes);
  app.use('/api', youtubeRoutes);
  app.use('/api', sourcingRoutes);

  // workspace 미디어 서빙 (영상/이미지/음성 미리보기)
  app.use('/media', express.static(WORKSPACE_ROOT, { fallthrough: false, index: false }));

  // 빌드된 웹 UI 서빙 — 서버 하나로 화면까지 낸다 (터미널 없이 아이콘으로 여는 경로).
  // 개발 중에는 vite dev(:5173)가 화면을 맡으므로 dist가 없어도 정상이다.
  mountClient(app);

  // 에러 핸들러
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: '입력값 오류',
        details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: message });
  });

  return app;
}

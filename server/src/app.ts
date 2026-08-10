import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { WORKSPACE_ROOT } from './store/workspace.js';
import { addClient } from './sse.js';
import { bootState, isReady } from './boot.js';
import systemRoutes from './routes/system.js';
import projectRoutes from './routes/projects.js';
import jobRoutes from './routes/jobs.js';
import packetRoutes from './routes/packets.js';
import formatRoutes from './routes/formats.js';
import keyRoutes from './routes/keys.js';
import youtubeRoutes from './routes/youtube.js';

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
  app.use('/api', projectRoutes);
  app.use('/api', jobRoutes);
  app.use('/api', packetRoutes);
  app.use('/api', formatRoutes);
  app.use('/api', keyRoutes);
  app.use('/api', youtubeRoutes);

  // workspace 미디어 서빙 (영상/이미지/음성 미리보기)
  app.use('/media', express.static(WORKSPACE_ROOT, { fallthrough: false, index: false }));

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

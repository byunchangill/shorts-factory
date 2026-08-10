import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { WORKSPACE_ROOT } from './store/workspace.js';
import { addClient } from './sse.js';
import systemRoutes from './routes/system.js';
import projectRoutes from './routes/projects.js';
import jobRoutes from './routes/jobs.js';
import packetRoutes from './routes/packets.js';
import formatRoutes from './routes/formats.js';

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/events', (_req, res) => addClient(res));

  app.use('/api', systemRoutes);
  app.use('/api', projectRoutes);
  app.use('/api', jobRoutes);
  app.use('/api', packetRoutes);
  app.use('/api', formatRoutes);

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

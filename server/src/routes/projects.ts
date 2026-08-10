import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { MENUS, GUIDELINE_FILES, type Menu, type GuidelineFile } from '@shared/constants';
import { ProductSchema } from '@shared/types';
import * as projects from '../store/projects.js';
import { listJobs } from '../store/jobs.js';
import { paths, toMediaUrl } from '../store/workspace.js';
import { slugify } from '../util/fsx.js';

const router = Router();

function parseMenu(v: unknown): Menu {
  const parsed = z.enum(MENUS).safeParse(v);
  if (!parsed.success) throw Object.assign(new Error('menu는 menu-a 또는 menu-b'), { status: 400 });
  return parsed.data;
}

router.get('/projects', async (req, res) => {
  const menu = parseMenu(req.query.menu);
  const list = await projects.listProjects(menu);
  const withCounts = await Promise.all(
    list.map(async (p) => {
      const jobs = await listJobs(menu, p.id);
      return {
        ...p,
        jobCounts: {
          total: jobs.length,
          done: jobs.filter((j) => j.state === 'done').length,
          active: jobs.filter((j) => j.state !== 'done').length,
        },
      };
    }),
  );
  res.json(withCounts);
});

router.post('/projects', async (req, res) => {
  const body = z.object({
    menu: z.enum(MENUS),
    title: z.string().min(1),
    formatId: z.string().optional(),
  }).parse(req.body);
  const project = await projects.createProject(body.menu, body.title, body.formatId);
  res.status(201).json(project);
});

router.get('/projects/:menu/:pid', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const project = await projects.getProject(menu, req.params.pid);
  if (!project) return res.status(404).json({ error: '프로젝트 없음' });
  res.json(project);
});

router.patch('/projects/:menu/:pid', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const body = z.object({
    title: z.string().min(1).optional(),
    formatId: z.string().optional(),
    archived: z.boolean().optional(),
  }).parse(req.body);
  const updated = await projects.updateProject(menu, req.params.pid, body);
  if (!updated) return res.status(404).json({ error: '프로젝트 없음' });
  res.json(updated);
});

// ── 지침 ──────────────────────────────────────────────────────────

router.get('/projects/:menu/:pid/guidelines/:file', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const file = z.enum(GUIDELINE_FILES).parse(req.params.file) as GuidelineFile;
  res.json({ content: await projects.readGuideline(menu, req.params.pid, file) });
});

router.put('/projects/:menu/:pid/guidelines/:file', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const file = z.enum(GUIDELINE_FILES).parse(req.params.file) as GuidelineFile;
  const body = z.object({ content: z.string() }).parse(req.body);
  await projects.writeGuideline(menu, req.params.pid, file, body.content);
  res.json({ ok: true });
});

// ── 제품 자료 (쿠팡 상세페이지 파일 첨부) ─────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const menu = parseMenu(req.params.menu);
        cb(null, paths.product(menu, req.params.pid));
      } catch (e) {
        cb(e as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(original);
      cb(null, `${slugify(path.basename(original, ext))}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 },
});

router.post('/projects/:menu/:pid/product/files', upload.array('files'), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.json({ uploaded: files.map((f) => f.filename) });
});

router.get('/projects/:menu/:pid/product', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const product = await projects.readProduct(menu, req.params.pid);
  const files = await projects.listProductFiles(menu, req.params.pid);
  const productDir = paths.product(menu, req.params.pid);
  res.json({
    product,
    files: files.map((f) => ({ name: f, url: toMediaUrl(path.join(productDir, f)) })),
  });
});

router.put('/projects/:menu/:pid/product', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const product = ProductSchema.parse(req.body);
  await projects.writeProduct(menu, req.params.pid, product);
  res.json({ ok: true });
});

export default router;

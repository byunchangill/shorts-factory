import { asyncRouter } from '../util/asyncRouter.js';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { MENUS, GUIDELINE_FILES, type Menu, type GuidelineFile } from '@shared/constants';
import { ProductSchema } from '@shared/types';
import * as projects from '../store/projects.js';
import { listJobs } from '../store/jobs.js';
import fsp from 'node:fs/promises';
import { paths, toMediaUrl, REPO_ROOT } from '../store/workspace.js';
import {
  createSampleJob, seedSample, sampleAvailable,
  DEFAULT_SAMPLE_JOB_TITLE, DEFAULT_SAMPLE_CATEGORY, SAMPLE_NARRATION, SAMPLE_SRT,
} from '../store/sample.js';
import { slugify } from '../util/fsx.js';
import { extractZip, safeEntryPath } from '../util/zip.js';

const router = asyncRouter();

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

/**
 * 샘플 소재 안내.
 *
 * `/projects/:menu/:pid` 보다 먼저 선언한다 — 뒤에 두면 :menu='sample'로 잡힌다.
 */
router.get('/projects/sample', async (_req, res) => {
  res.json({
    available: await sampleAvailable(),
    jobTitle: DEFAULT_SAMPLE_JOB_TITLE,
    category: DEFAULT_SAMPLE_CATEGORY,
  });
});

/** 카테고리까지 함께 만드는 경로 — npm run seed 용 */
router.post('/projects/sample', async (req, res) => {
  const body = z.object({ category: z.string().optional() }).parse(req.body ?? {});
  const r = await seedSample(body.category);
  res.status(201).json({ ...r, ...sampleExtras() });
});

/** 화면에서 쓰는 경로 — 이미 있는 카테고리 안에 샘플 영상 작업을 만든다 */
router.post('/projects/:menu/:pid/jobs/sample', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const body = z.object({ title: z.string().optional() }).parse(req.body ?? {});
  const r = await createSampleJob(menu, req.params.pid, body.title);
  res.status(201).json({ ...r, ...sampleExtras() });
});

/** 나레이션·자막은 음성 단계에서 직접 첨부할 수 있게 경로를 알려준다 */
function sampleExtras(): { narration: string; subtitles: string } {
  return {
    narration: toWorkspaceLikePath(SAMPLE_NARRATION),
    subtitles: toWorkspaceLikePath(SAMPLE_SRT),
  };
}

/** 화면에 보여줄 용도의 리포 상대경로 (workspace 밖이라 /media로는 못 준다) */
function toWorkspaceLikePath(abs: string): string {
  return path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
}

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

/** multer는 파일명을 latin1로 넘긴다 — 한글 파일명이 깨지지 않게 되돌린다 */
function originalName(file: Express.Multer.File): string {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}

/**
 * 폴더째 올리면 파일명에 상대경로가 들어온다 (`캡처/사양표.png`).
 * 그 구조를 그대로 살려서 저장한다 — 파일이 수십 개일 때 폴더가 곧 분류다.
 */
function relativeDir(file: Express.Multer.File): string {
  const rel = safeEntryPath(originalName(file));
  if (!rel) return '';
  const dir = path.posix.dirname(rel);
  if (dir === '.' || dir === '/') return '';
  return dir.split('/').map((s) => slugify(s)).join(path.sep);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const menu = parseMenu(req.params.menu);
        const dir = path.join(paths.product(menu, req.params.pid), relativeDir(file));
        fsp.mkdir(dir, { recursive: true }).then(() => cb(null, dir), (e) => cb(e as Error, ''));
      } catch (e) {
        cb(e as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const base = path.posix.basename(originalName(file).replace(/\\/g, '/'));
      const ext = path.extname(base);
      cb(null, `${slugify(path.basename(base, ext))}${ext}`);
    },
  }),
  // 상세페이지 캡처를 폴더째 올리는 경우가 있어 장수를 넉넉히 잡는다
  limits: { fileSize: 100 * 1024 * 1024, files: 300 },
});

router.post('/projects/:menu/:pid/product/files', upload.array('files'), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const uploaded: string[] = [];
  const errors: string[] = [];

  for (const f of files) {
    // 압축 파일을 그대로 두면 AI가 열지 못한다 (붙여넣기·API 방식에는 해제 수단이 없다).
    // 풀어서 같은 이름의 폴더에 넣고 압축 파일 자체는 지운다
    if (/\.zip$/i.test(f.filename)) {
      const root = path.dirname(f.path);
      const fallback = path.basename(f.filename, path.extname(f.filename));
      try {
        const written = await extractZip(await fsp.readFile(f.path), root, fallback);
        if (!written.length) throw new Error('압축 안에 쓸 만한 파일이 없습니다');
        uploaded.push(...written);
        await fsp.rm(f.path, { force: true });
      } catch (e) {
        // 못 푼 압축은 지우지 않고 남긴다 — 사용자가 다시 올리지 않아도 되게
        errors.push(`${f.filename}: ${e instanceof Error ? e.message : String(e)}`);
        uploaded.push(f.filename);
      }
      continue;
    }
    uploaded.push(f.filename);
  }
  res.json({ uploaded, errors });
});

/** 잘못 올린 자료 정리 — 폴더째 올리면 필요 없는 파일이 섞여 온다 */
router.delete('/projects/:menu/:pid/product/files', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const rel = safeEntryPath(z.string().min(1).parse(req.query.file));
  if (!rel) return res.status(400).json({ error: '잘못된 경로' });
  if (rel === 'product.json') return res.status(400).json({ error: 'product.json은 여기서 지울 수 없습니다' });
  const target = path.join(paths.product(menu, req.params.pid), rel);
  await fsp.rm(target, { recursive: true, force: true });
  res.json({ ok: true });
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

import { asyncRouter } from '../util/asyncRouter.js';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { MENUS, GUIDELINE_FILES, type Menu, type GuidelineFile } from '@shared/constants';
import { ProductSchema } from '@shared/types';
import * as projects from '../store/projects.js';
import { listJobs } from '../store/jobs.js';
import { trashProject } from '../store/remove.js';
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

/**
 * 카테고리 삭제 — 지침·제품자료·그 안의 영상 작업이 전부 함께 사라진다.
 * 지우지 않고 workspace/.trash 로 옮기므로 응답의 trashed 경로로 되돌릴 수 있다.
 */
router.delete('/projects/:menu/:pid', async (req, res) => {
  const menu = parseMenu(req.params.menu);
  const result = await trashProject(menu, req.params.pid);
  res.json({ ok: true, ...result });
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
export default router;

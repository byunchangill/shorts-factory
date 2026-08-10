import path from 'node:path';
import fsp from 'node:fs/promises';
import { ProjectSchema, type Project, ProductSchema, type Product } from '@shared/types';
import { GUIDELINE_FILES, type Menu, type GuidelineFile } from '@shared/constants';
import { paths } from './workspace.js';
import { ensureDir, exists, listDirs, listFiles, readJson, slugify, writeJsonAtomic } from '../util/fsx.js';

/** menu-b의 formats 디렉토리는 프로젝트가 아님 */
const RESERVED_DIRS = new Set(['formats', 'templates']);

const DEFAULT_GUIDELINES: Record<GuidelineFile, string> = {
  'script.md': `# 대본 지침

- 총 낭독 시간: 45~58초
- 첫 문장은 3초 안에 시선을 잡는 훅으로 시작한다
- 과장 표현 금지: "무조건", "100%", "기적" 등
- 효능 주장은 "~에 도움이 될 수 있다" 수준으로 완화
- 마지막 씬에 구매 유도 CTA 1문장
`,
  'video.md': `# 영상 지침

- 최종 규격: 1080x1920 (9:16), 30fps
- 씬 전환은 컷 위주, 페이드 최소화
- 자막은 화면 하단 20% 안전영역에 배치
- 제품 클로즈업 컷을 반드시 1개 이상 포함
`,
  'channel.md': `# 채널 지침

- 채널 톤: (여기에 채널 컨셉/톤을 적으세요)
- 금지 소재: (여기에 다루지 않을 소재를 적으세요)
`,
};

export async function listProjects(menu: Menu): Promise<Project[]> {
  const dirs = await listDirs(paths.menu(menu));
  const projects: Project[] = [];
  for (const dir of dirs) {
    if (RESERVED_DIRS.has(dir)) continue;
    const raw = await readJson<unknown>(paths.projectJson(menu, dir));
    const parsed = ProjectSchema.safeParse(raw);
    if (parsed.success && !parsed.data.archived) projects.push(parsed.data);
  }
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(menu: Menu, id: string): Promise<Project | null> {
  const raw = await readJson<unknown>(paths.projectJson(menu, id));
  const parsed = ProjectSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function createProject(
  menu: Menu,
  title: string,
  formatId?: string,
): Promise<Project> {
  let id = slugify(title);
  if (RESERVED_DIRS.has(id)) id = `${id}-1`;
  let candidate = id;
  let n = 1;
  while (await exists(paths.project(menu, candidate))) {
    n += 1;
    candidate = `${id}-${n}`;
  }
  id = candidate;

  const project = ProjectSchema.parse({
    id,
    menu,
    title,
    createdAt: new Date().toISOString(),
    formatId,
    archived: false,
  });

  const root = paths.project(menu, id);
  await ensureDir(path.join(root, 'jobs'));
  await ensureDir(paths.product(menu, id));
  await ensureDir(paths.guidelines(menu, id));
  for (const file of GUIDELINE_FILES) {
    await fsp.writeFile(path.join(paths.guidelines(menu, id), file), DEFAULT_GUIDELINES[file], 'utf8');
  }
  await writeJsonAtomic(paths.projectJson(menu, id), project);
  return project;
}

export async function updateProject(
  menu: Menu,
  id: string,
  patch: Partial<Pick<Project, 'title' | 'formatId' | 'archived'>>,
): Promise<Project | null> {
  const project = await getProject(menu, id);
  if (!project) return null;
  const updated = ProjectSchema.parse({ ...project, ...patch });
  await writeJsonAtomic(paths.projectJson(menu, id), updated);
  return updated;
}

// ── 지침 ──────────────────────────────────────────────────────────

export async function readGuideline(menu: Menu, projectId: string, file: GuidelineFile): Promise<string> {
  try {
    return await fsp.readFile(path.join(paths.guidelines(menu, projectId), file), 'utf8');
  } catch {
    return '';
  }
}

export async function writeGuideline(
  menu: Menu,
  projectId: string,
  file: GuidelineFile,
  content: string,
): Promise<void> {
  await ensureDir(paths.guidelines(menu, projectId));
  await fsp.writeFile(path.join(paths.guidelines(menu, projectId), file), content, 'utf8');
}

export async function readAllGuidelines(menu: Menu, projectId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of GUIDELINE_FILES) {
    const content = await readGuideline(menu, projectId, file);
    if (content.trim()) out[file] = content;
  }
  return out;
}

// ── 제품 자료 ─────────────────────────────────────────────────────

export async function listProductFiles(menu: Menu, projectId: string): Promise<string[]> {
  const files = await listFiles(paths.product(menu, projectId));
  return files.filter((f) => f !== 'product.json');
}

export async function readProduct(menu: Menu, projectId: string): Promise<Product> {
  const raw = await readJson<unknown>(path.join(paths.product(menu, projectId), 'product.json'));
  const parsed = ProductSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ProductSchema.parse({});
}

export async function writeProduct(menu: Menu, projectId: string, product: Product): Promise<void> {
  await writeJsonAtomic(path.join(paths.product(menu, projectId), 'product.json'), ProductSchema.parse(product));
}

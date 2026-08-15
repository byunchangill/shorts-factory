import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProjectSchema, type Project, ProductSchema, type Product } from '@shared/types';
import {
  GUIDELINE_FILES, charBudget, TARGET_SEC_BY_MENU, type Menu, type GuidelineFile,
} from '@shared/constants';
import { paths, loadSettings } from './workspace.js';
import type { JobRef } from './jobs.js';
import { ensureDir, exists, listDirs, listFiles, readJson, slugify, writeJsonAtomic } from '../util/fsx.js';

/** menu-b의 formats 디렉토리는 프로젝트가 아님 */
const RESERVED_DIRS = new Set(['formats', 'templates']);

/**
 * 기본 지침의 분량 숫자를 메뉴·배속에서 계산해 채운다.
 * 지침 본문에 숫자를 박아두면 메뉴별 목표가 바뀌어도 그대로 남아, 요청서와 지침이 서로 다른
 * 분량을 말하게 된다 (실제로 menu-b 프로젝트에 menu-a 기준 187자가 박혀 나갔다).
 */
async function fillGuideline(template: string, menu: Menu): Promise<string> {
  const { speechRate } = await loadSettings();
  const budget = charBudget(speechRate, menu);
  const target = TARGET_SEC_BY_MENU[menu];
  return template
    .replaceAll('{SPEECH_RATE}', String(speechRate))
    .replaceAll('{SEC_MAX}', String(target.max))
    .replaceAll('{SEC_REC}', String(target.recommended))
    .replaceAll('{CHAR_MIN}', String(budget.min))
    .replaceAll('{CHAR_MAX}', String(budget.max))
    .replaceAll('{CHAR_REC}', String(budget.recommended));
}

const DEFAULT_GUIDELINES: Record<GuidelineFile, string> = {
  'script.md': `# 대본 지침

## 분량·구조
- **{SEC_MAX}초 이내로 끝낸다** — 완주율이 알고리즘에 가장 강하게 작용한다 (권장 {SEC_REC}초)
- 나레이션 {SPEECH_RATE}배속 기준 총 {CHAR_MIN}~{CHAR_MAX}자 (권장 {CHAR_REC}자)
- 씬 4~5개, 씬당 35~45자
- 반전은 1개에 집중한다 — 짧은 분량에 2개를 넣으면 둘 다 약해진다
- 첫 문장은 3초 안에 시선을 잡는 훅으로 시작한다
- 마지막 씬에 구매 유도 CTA 1문장

## 비평·정보 관점 (중요)
단순 제품 소개나 사용 장면 나열은 재사용 콘텐츠로 분류될 수 있다.
대본에 아래 중 **최소 2가지**를 반드시 포함한다.

- **단점·주의점 분석** — 이 제품이 안 맞는 상황, 아쉬운 점
- **실사용자 반응** — 커뮤니티·리뷰에서 실제로 나온 평가
- **비교 평가** — 대체품이나 상위 모델과 무엇이 다른가
- **가격 대비 판단** — 이 값을 낼 만한가에 대한 견해

즉 "이 제품 좋아요"가 아니라 "이 제품을 이렇게 평가한다"로 쓴다.

## 표현
- 감정 표현은 허용: 미친, 환장하는, 레전드, 끝판왕 (말투의 온도)
- 허위·효능 과장 금지: 무조건, 100%, 기적, 완치, 부작용 없음
- 효능은 "~에 도움이 될 수 있다" 수준으로 완화
- 제품 자료에 없는 수치·사양을 지어내지 않는다
`,
  'video.md': `# 영상 지침

- 최종 규격: 1080x1920 (9:16), 30fps
- 씬 전환은 컷 위주, 페이드 최소화
- 자막은 화면 하단 20% 안전영역에 배치
- 제품 클로즈업 컷을 반드시 1개 이상 포함

## 외부 소스 사용 시 (메뉴 A)
- 원본 오디오는 사용하지 않는다 — 나레이션과 BGM만 쓴다 (조립 시 자동 처리)
- 한 소스를 3초 넘게 연속 노출하지 않는다 — 구간을 나누거나 사이에 카드를 넣는다
- 자기 레이어를 덮는다: 프레임 템플릿, 텍스트 카드, 비교표
- 소스 사용 권리는 조립 전에 반드시 확인한다 (변형은 권리를 만들어주지 않는다)
`,
  'channel.md': `# 채널 지침

- 채널 톤: (여기에 채널 컨셉/톤을 적으세요)
- 금지 소재: (여기에 다루지 않을 소재를 적으세요)
`,
};

/**
 * 메뉴별 기본 대본 지침을 담은 스킬. **이 파일이 단일 출처다** —
 * 내용을 코드로 복사해오면 스킬을 고쳤을 때 둘이 어긋난다.
 *
 * 저장소에 커밋되어 있으므로 어느 PC에서 받아도 같은 지침으로 시작한다. 카테고리를 만들 때
 * 그 시점의 내용이 `workspace/{menu}/{project}/guidelines/`로 복사되고, 그 뒤로는 사용자가
 * 화면에서 고친 것이 그 카테고리의 지침이다 (PC마다 따로 쌓인다).
 */
const MENU_SKILL: Partial<Record<Menu, string>> = {
  'menu-a': fileURLToPath(new URL('../../../.claude/skills/temcasting-shorts/SKILL.md', import.meta.url)),
};

/** 스킬 문서의 앞머리(name/description)는 지침이 아니다 — 본문만 쓴다 */
export function skillBody(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

/**
 * 그 메뉴의 기본 대본 지침. 스킬 파일이 없으면 일반 지침으로 돌아간다 —
 * 파일 하나 때문에 카테고리를 못 만드는 일은 없어야 한다.
 */
async function defaultScriptGuideline(menu: Menu): Promise<string> {
  const file = MENU_SKILL[menu];
  if (!file) return DEFAULT_GUIDELINES['script.md'];
  try {
    return skillBody(await fsp.readFile(file, 'utf8'));
  } catch {
    console.warn(`[projects] 기본 대본 스킬을 읽지 못해 일반 지침을 씁니다: ${file}`);
    return DEFAULT_GUIDELINES['script.md'];
  }
}

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
  await ensureDir(paths.guidelines(menu, id));
  for (const file of GUIDELINE_FILES) {
    const template = file === 'script.md'
      ? await defaultScriptGuideline(menu)
      : DEFAULT_GUIDELINES[file];
    await fsp.writeFile(
      path.join(paths.guidelines(menu, id), file),
      await fillGuideline(template, menu),
      'utf8',
    );
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

/**
 * 첨부된 제품 자료 목록.
 * 압축을 풀거나 폴더째 올리면 하위 폴더가 생기므로 재귀로 훑는다 —
 * 여기서 빠지면 요청서에 경로가 실리지 않아 AI가 자료를 못 본다.
 */
export async function listProductFiles(ref: JobRef): Promise<string[]> {
  const root = paths.product(ref.menu, ref.projectId, ref.jobId);
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else if (rel !== 'product.json') out.push(rel);
    }
  };
  await walk(root, '');
  return out.sort();
}

export async function readProduct(ref: JobRef): Promise<Product> {
  const raw = await readJson<unknown>(path.join(paths.product(ref.menu, ref.projectId, ref.jobId), 'product.json'));
  const parsed = ProductSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ProductSchema.parse({});
}

export async function writeProduct(ref: JobRef, product: Product): Promise<void> {
  await writeJsonAtomic(
    path.join(paths.product(ref.menu, ref.projectId, ref.jobId), 'product.json'),
    ProductSchema.parse(product),
  );
}

import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  ASSET_KINDS, ASSET_KIND_DIRS, ASSET_EXTS, type AssetKind,
} from '@shared/constants';
import {
  AssetLocalStateSchema, AssetLibrarySchema,
  type Asset, type AssetLocalState,
} from '@shared/types';
import { paths, toMediaUrl, toWorkspaceRel } from './workspace.js';
import { ensureDir, readJson, writeJsonAtomic, exists } from '../util/fsx.js';

/**
 * 편집 재료 자료실 — 짤방·효과음.
 *
 * **두 겹이다.** 공용(`shared/`)은 관리자가 별도 저장소에 올린 것이라 모든 PC에서 같고,
 * 로컬(`local/`)은 그 PC에서만 산다. 이 갈래가 요구사항 자체다 — 관리자가 깃에 올리면
 * 전 PC에 퍼지고, 각자 추가·삭제한 것은 자기 PC에만 남아야 한다.
 *
 * 🔴 **목록의 진실은 파일시스템이다.** 인덱스 파일을 진실로 삼으면 관리자가 파일만 올렸을 때
 * 각 PC에서 안 보이고, 동기화가 인덱스를 덮어쓰면 로컬 자료가 통째로 사라진다.
 * 폴더를 훑어 목록을 만들고, `local.json`은 **덧칠**(숨김·제목·태그)만 들고 있는다.
 *
 * 🔴 **공용 자료는 파일을 지우지 않는다.** 지워도 다음 동기화에서 되살아나고, 그 사이
 * `git pull`이 로컬 삭제와 충돌해 동기화 자체가 막힌다. 숨김 목록에 넣는 것이 삭제다.
 */

const SHARED = 'shared';
const LOCAL = 'local';

export const assetPaths = {
  root: () => path.join(paths.root(), 'assets'),
  shared: () => path.join(paths.root(), 'assets', SHARED),
  local: () => path.join(paths.root(), 'assets', LOCAL),
  localState: () => path.join(paths.root(), 'assets', 'local.json'),
  /** 공용 저장소가 같이 커밋하는 목록 (선택) */
  library: () => path.join(paths.root(), 'assets', SHARED, 'library.json'),
  kindDir: (origin: 'shared' | 'local', kind: AssetKind) =>
    path.join(paths.root(), 'assets', origin, ASSET_KIND_DIRS[kind]),
  /** 삭제한 로컬 자료가 가는 곳 — 카테고리·잡과 같은 규칙으로 지우지 않고 옮긴다 */
  trash: () => path.join(paths.trash(), 'assets'),
};

/** `{origin}:{kind폴더}/{파일명}` — 목록을 다시 만들어도 잡이 들고 있던 id가 그대로 맞는다 */
export function assetId(origin: 'shared' | 'local', kind: AssetKind, file: string): string {
  return `${origin}:${ASSET_KIND_DIRS[kind]}/${file}`;
}

export interface ParsedAssetId {
  origin: 'shared' | 'local';
  kind: AssetKind;
  file: string;
}

/**
 * id를 파일 자리로 되돌린다. 못 읽으면 null.
 *
 * **경로 조작을 여기서 끊는다** — id는 잡 파일이나 요청 본문에서 오므로 `..`가 섞이면
 * 작업공간 밖 파일을 지우거나 내보낼 수 있다. 파일명에 구분자를 아예 허용하지 않는다.
 */
export function parseAssetId(id: string): ParsedAssetId | null {
  const m = /^(shared|local):([^/]+)\/(.+)$/.exec(id);
  if (!m) return null;
  const [, origin, dir, file] = m;
  const kind = ASSET_KINDS.find((k) => ASSET_KIND_DIRS[k] === dir);
  if (!kind) return null;
  if (file.includes('/') || file.includes('\\') || file.includes('..')) return null;
  return { origin: origin as 'shared' | 'local', kind, file };
}

export function assetFilePath(parsed: ParsedAssetId): string {
  return path.join(assetPaths.kindDir(parsed.origin, parsed.kind), parsed.file);
}

/** 확장자가 그 종류에 맞는가 — 공용 저장소에 딸려 온 README·라이선스를 목록에서 뺀다 */
function allowedExt(kind: AssetKind, file: string): boolean {
  return ASSET_EXTS[kind].includes(path.extname(file).toLowerCase());
}

/**
 * 파일명에서 만드는 기본 제목 — `01 삐삑.mp3` → `삐삑`.
 *
 * 앞 번호는 **구분자가 뒤따를 때만** 뗀다. 숫자를 무조건 떼면 해시로 된 짤 파일명
 * (`0a0e0e4d8a…`)의 첫 글자가 먹혀 `a0e0e4d8a…`가 된다 — 원본을 찾을 수 없게 된다.
 */
export function titleFromFile(file: string): string {
  const base = path.basename(file, path.extname(file));
  return base.replace(/^[\s._-]*\d+[\s._-]+/, '').trim() || base;
}

export async function readLocalState(): Promise<AssetLocalState> {
  const raw = await readJson<unknown>(assetPaths.localState());
  const parsed = AssetLocalStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AssetLocalStateSchema.parse({});
}

export async function writeLocalState(state: AssetLocalState): Promise<void> {
  await ensureDir(assetPaths.root());
  await writeJsonAtomic(assetPaths.localState(), AssetLocalStateSchema.parse(state));
}

/** 공용 저장소의 `library.json` — 없으면 빈 것으로 본다 (관리자가 파일만 올려도 돌아야 한다) */
async function readLibrary(): Promise<Map<string, { title?: string; tags: string[] }>> {
  const raw = await readJson<unknown>(assetPaths.library());
  const parsed = AssetLibrarySchema.safeParse(raw ?? {});
  const map = new Map<string, { title?: string; tags: string[] }>();
  if (!parsed.success) return map;
  for (const item of parsed.data.items) {
    map.set(item.file.replace(/\\/g, '/'), { title: item.title, tags: item.tags });
  }
  return map;
}

async function scanKind(origin: 'shared' | 'local', kind: AssetKind): Promise<string[]> {
  const dir = assetPaths.kindDir(origin, kind);
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => allowedExt(kind, n)).sort((a, b) => a.localeCompare(b, 'ko'));
}

export interface ListOptions {
  kind?: AssetKind;
  /** 제목·태그·파일명 부분 일치 */
  q?: string;
  /** 숨긴 것도 포함 (자료실 화면에서 「숨긴 것 보기」) */
  includeHidden?: boolean;
}

/**
 * 자료 목록. 공용 + 로컬을 합쳐 돌려준다.
 *
 * 같은 파일명이 양쪽에 있어도 id가 달라 둘 다 남는다 — 로컬이 공용을 덮어쓰는 것처럼
 * 보이게 만들면, 공용이 갱신됐는데 화면이 안 바뀌는 이유를 아무도 못 짚는다.
 */
export async function listAssets(opts: ListOptions = {}): Promise<Asset[]> {
  const state = await readLocalState();
  const library = await readLibrary();
  const hidden = new Set(state.hidden);
  const out: Asset[] = [];

  for (const origin of [SHARED, LOCAL] as const) {
    for (const kind of ASSET_KINDS) {
      if (opts.kind && opts.kind !== kind) continue;
      for (const file of await scanKind(origin, kind)) {
        const id = assetId(origin, kind, file);
        if (hidden.has(id) && !opts.includeHidden) continue;
        const abs = path.join(assetPaths.kindDir(origin, kind), file);
        const stat = await fsp.stat(abs).catch(() => null);
        const lib = origin === SHARED
          ? library.get(`${ASSET_KIND_DIRS[kind]}/${file}`)
          : undefined;
        const override = state.meta[id];
        out.push({
          id,
          kind,
          origin,
          file: toWorkspaceRel(abs),
          url: toMediaUrl(abs),
          title: override?.title ?? lib?.title ?? titleFromFile(file),
          tags: override?.tags ?? lib?.tags ?? [],
          bytes: stat?.size ?? 0,
          hidden: hidden.has(id),
        });
      }
    }
  }

  const q = opts.q?.trim().toLowerCase();
  if (!q) return out;
  return out.filter((a) => {
    const hay = [a.title, a.file, ...a.tags].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** id 목록을 자료로 — 없어진 것은 조용히 빠진다 (잡이 들고 있던 id가 지워졌을 수 있다) */
export async function resolveAssets(ids: string[]): Promise<Asset[]> {
  if (!ids.length) return [];
  const all = await listAssets({ includeHidden: true });
  const byId = new Map(all.map((a) => [a.id, a]));
  return ids.map((id) => byId.get(id)).filter((a): a is Asset => Boolean(a));
}

export async function setAssetMeta(
  id: string,
  patch: { title?: string; tags?: string[] },
): Promise<void> {
  const parsed = parseAssetId(id);
  if (!parsed) throw Object.assign(new Error(`모르는 자료: ${id}`), { status: 400 });
  const state = await readLocalState();
  const next = { ...(state.meta[id] ?? {}) };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.tags !== undefined) {
    next.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))];
  }
  state.meta[id] = next;
  await writeLocalState(state);
}

export interface RemoveResult {
  /** hidden = 공용이라 숨김 처리, trashed = 로컬이라 휴지통으로 옮김 */
  how: 'hidden' | 'trashed';
}

/**
 * 자료 지우기.
 *
 * 로컬은 `.trash/assets/`로 옮긴다 (되돌리려면 원래 자리로 옮기면 된다).
 * 공용은 **파일을 건드리지 않고** 숨김 목록에 넣는다 — 위 주석 참고.
 */
export async function removeAsset(id: string): Promise<RemoveResult> {
  const parsed = parseAssetId(id);
  if (!parsed) throw Object.assign(new Error(`모르는 자료: ${id}`), { status: 400 });

  if (parsed.origin === SHARED) {
    const state = await readLocalState();
    if (!state.hidden.includes(id)) state.hidden.push(id);
    await writeLocalState(state);
    return { how: 'hidden' };
  }

  const src = assetFilePath(parsed);
  if (!(await exists(src))) throw Object.assign(new Error('파일이 없습니다'), { status: 404 });
  const destDir = path.join(assetPaths.trash(), ASSET_KIND_DIRS[parsed.kind]);
  await ensureDir(destDir);
  await fsp.rename(src, await uniqueTrashPath(path.join(destDir, parsed.file)));

  // 덧칠도 같이 치운다 — 안 치우면 같은 이름으로 다시 올렸을 때 옛 태그가 따라붙는다
  const state = await readLocalState();
  delete state.meta[id];
  await writeLocalState(state);
  return { how: 'trashed' };
}

/** 숨긴 공용 자료를 다시 보이게 */
export async function unhideAsset(id: string): Promise<void> {
  const state = await readLocalState();
  state.hidden = state.hidden.filter((h) => h !== id);
  await writeLocalState(state);
}

async function uniqueTrashPath(target: string): Promise<string> {
  if (!(await exists(target))) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${base}_${n}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

/** 업로드가 들어갈 자리를 미리 만든다 (multer의 destination이 부른다) */
export async function ensureLocalKindDir(kind: AssetKind): Promise<string> {
  const dir = assetPaths.kindDir(LOCAL, kind);
  await ensureDir(dir);
  return dir;
}

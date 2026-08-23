import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { asyncRouter } from '../util/asyncRouter.js';
import {
  ASSET_KINDS, ASSET_EXTS, ASSET_MAX_BYTES, ASSET_KIND_LABELS, type AssetKind,
} from '@shared/constants';
import {
  listAssets, removeAsset, unhideAsset, setAssetMeta, ensureLocalKindDir,
  assetId, titleFromFile,
} from '../store/assets.js';
import { syncSharedAssets, syncStatus } from '../store/assetSync.js';
import { slugify } from '../util/fsx.js';

/**
 * 편집 재료 자료실 API — 짤방·효과음.
 *
 * 화면에서 보고·듣고·태그를 붙이고, 잡에 담아 캡컷 재료 묶음으로 내보낸다.
 * **추가·삭제는 이 PC에만 남고**, 공용 자료는 `POST /assets/sync`로 받아온다
 * (`store/assets.ts`의 두 겹 구조 참고).
 */
const router = asyncRouter();

function parseKind(v: unknown): AssetKind {
  const parsed = z.enum(ASSET_KINDS).safeParse(v);
  if (!parsed.success) {
    throw Object.assign(new Error(`kind는 ${ASSET_KINDS.join(' 또는 ')}`), { status: 400 });
  }
  return parsed.data;
}

router.get('/assets', async (req, res) => {
  const kind = req.query.kind ? parseKind(req.query.kind) : undefined;
  const items = await listAssets({
    kind,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    includeHidden: req.query.includeHidden === '1',
  });
  res.json({ items, sync: await syncStatus() });
});

/** multer는 파일명을 latin1로 넘긴다 — 한글 파일명이 깨지지 않게 되돌린다 */
function originalName(file: Express.Multer.File): string {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}

/**
 * 업로드가 어느 칸에 들어가는가.
 *
 * 🔴 **쿼리스트링을 먼저 본다.** multipart에서 `req.body`는 그 필드가 파일보다 **앞에**
 * 실려 있을 때만 채워져 있는데, 브라우저가 순서를 보장해주지 않는다. 파일이 먼저 오면
 * destination이 도는 시점에 `body.kind`가 비어 있어 업로드가 통째로 400이 된다.
 */
function uploadKind(req: { query?: unknown; body?: unknown }): AssetKind {
  const q = (req.query as Record<string, unknown> | undefined)?.kind;
  const b = (req.body as Record<string, unknown> | undefined)?.kind;
  return parseKind(q ?? b);
}

/**
 * 업로드 저장 자리.
 *
 * 파일명은 그대로 두지 않고 슬러그로 바꾼다 — 자료실 id가 파일명이라 공백·괄호가
 * 그대로 들어가면 주소와 캡컷 묶음 안에서 다루기 나쁘다. 원래 이름은 제목으로 남는다.
 */
const assetUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        ensureLocalKindDir(uploadKind(req))
          .then((dir) => cb(null, dir), (e) => cb(e as Error, ''));
      } catch (e) {
        cb(e as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const base = path.posix.basename(originalName(file).replace(/\\/g, '/'));
      const ext = path.extname(base).toLowerCase();
      cb(null, `${slugify(path.basename(base, ext))}${ext}`);
    },
  }),
  limits: { fileSize: ASSET_MAX_BYTES, files: 100 },
  fileFilter: (req, file, cb) => {
    let kind: AssetKind;
    try {
      kind = uploadKind(req);
    } catch (e) {
      return cb(e as Error);
    }
    const ext = path.extname(originalName(file)).toLowerCase();
    if (!ASSET_EXTS[kind].includes(ext)) {
      return cb(new Error(
        `${ASSET_KIND_LABELS[kind]}에 넣을 수 없는 형식입니다: ${ext || '(확장자 없음)'} `
        + `— ${ASSET_EXTS[kind].join(' ')}만 됩니다`,
      ));
    }
    cb(null, true);
  },
});

router.post('/assets', assetUpload.array('files'), async (req, res) => {
  const kind = uploadKind(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: '올린 파일이 없습니다' });

  /*
    원래 파일명을 제목으로 남긴다 — 저장 파일명은 슬러그라 「01 삐삑.mp3」가
    「01-.mp3」처럼 남을 수 있고, 그러면 목록에서 뭘 넣었는지 알아볼 수 없다.
  */
  const added: string[] = [];
  for (const f of files) {
    const id = assetId('local', kind, f.filename);
    await setAssetMeta(id, { title: titleFromFile(originalName(f)) });
    added.push(id);
  }
  res.json({ added, items: await listAssets({ kind }) });
});

const metaBody = z.object({
  title: z.string().max(120).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

router.patch('/assets/:id', async (req, res) => {
  await setAssetMeta(req.params.id, metaBody.parse(req.body ?? {}));
  res.json({ ok: true });
});

/**
 * 지우기 — 로컬은 휴지통으로, 공용은 숨김.
 * 어느 쪽인지 응답에 담는다. 「지웠는데 다음 동기화에서 돌아왔다」는 오해를 막는다.
 */
router.delete('/assets/:id', async (req, res) => {
  const { how } = await removeAsset(req.params.id);
  res.json({ ok: true, how });
});

router.post('/assets/:id/unhide', async (req, res) => {
  await unhideAsset(req.params.id);
  res.json({ ok: true });
});

router.get('/assets-sync', async (_req, res) => {
  res.json(await syncStatus());
});

router.post('/assets-sync', async (_req, res) => {
  const result = await syncSharedAssets();
  res.json({ ...result, status: await syncStatus(), items: await listAssets() });
});

export default router;

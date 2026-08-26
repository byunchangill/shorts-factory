import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { asyncRouter } from '../util/asyncRouter.js';
import {
  ASSET_KINDS, ASSET_EXTS, ASSET_MAX_BYTES, ASSET_KIND_LABELS, type AssetKind,
} from '@shared/constants';
import {
  listAssets, removeAsset, unhideAsset, setAssetMeta, ensureStagingDir,
  commitUpload, discardUploads, assetId, titleFromFile, assertSourceAllowed, assetPaths,
} from '../store/assets.js';
import { syncSharedAssets, syncStatus } from '../store/assetSync.js';
import { SELF_MADE } from '@shared/assetPolicy';
import { slugify, withFileLock } from '../util/fsx.js';

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
 * 자료실에 들어갈 최종 파일명 — 원본 이름을 슬러그로 바꾼 것.
 *
 * 자료실 id가 파일명이라 공백·괄호가 그대로 들어가면 주소와 캡컷 묶음 안에서 다루기
 * 나쁘다. 원래 이름은 제목으로 남는다.
 */
function assetFileNameOf(file: Express.Multer.File): string {
  const base = path.posix.basename(originalName(file).replace(/\\/g, '/'));
  const ext = path.extname(base).toLowerCase();
  return `${slugify(path.basename(base, ext))}${ext}`;
}

/**
 * 업로드 저장 자리.
 *
 * 🔴 **자료실이 아니라 대기 자리(`.uploads`)에 받는다** (2026-08-26). multer는 핸들러가
 * 돌기 전에 파일을 쓰므로, 자료실에 바로 받으면 출처 검사가 400을 돌려줘도 파일이
 * 남아 **거부한 자료가 목록에 그대로 뜬다** (`assetPaths.staging` 주석에 실측이 있다).
 * 통과한 것만 `commitUpload`으로 옮긴다.
 *
 * 🔴 **대기 자리에서는 이름을 안 쓴다 — `randomUUID()`다.** 대기 자리는 모든 요청이
 * 같이 쓰는 폴더 하나인데 슬러그 이름으로 받으면 **서로 다른 파일이 같은 경로를 놓고
 * 다툰다.** `slugify`가 `.`·공백을 `-`로 바꾸고 60자에서 자르므로 충돌은 드문 일이
 * 아니다 — 「`a b.gif`」와 「`a-b.gif`」가 같은 이름이 된다. 실측(2026-08-26):
 *
 * - 한 요청에 그 둘을 올리면 뒤엣것이 앞엣것을 덮고, 옮긴 뒤 두 번째 `commitUpload`이
 *   없는 파일을 찾아 **ENOENT 500 + 파일 유실 + 응답에 작업공간 절대경로**가 나갔다
 * - 같은 이름 동시 업로드에서는 **파일의 승자와 기록의 승자가 갈렸다** — 5회 중 3회
 *   얼굴 있는 파일이 「인물 없음」으로 앉았고 게이트는 기록만 보므로 통과시켰다.
 *   출처 없는 자료가 들어오는 것은 대장을 보면 보이지만 **이건 대장을 봐도 안 보인다**
 *
 * 최종 이름은 `assetFileNameOf`가 따로 계산해 `commitUpload`에 넘긴다.
 */
const assetUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureStagingDir().then((dir) => cb(null, dir), (e) => cb(e as Error, ''));
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(originalName(file)).toLowerCase()}`);
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

/** multipart의 텍스트 필드 — 파일보다 늦게 실릴 수 있어 쿼리도 같이 본다 (`uploadKind` 참고) */
function field(req: { query?: unknown; body?: unknown }, name: string): string | undefined {
  const q = (req.query as Record<string, unknown> | undefined)?.[name];
  const b = (req.body as Record<string, unknown> | undefined)?.[name];
  const v = q ?? b;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * 인물 표시. 🔴 **모르는 값을 `false`로 떨어뜨리지 않는다** (2026-08-26).
 *
 * `hasFace=yes`를 「인물 없음」으로 저장하던 자리다 — 값을 잃는 정도가 아니라 **정반대로**
 * 기록되고 게이트가 통과시킨다. 이 기능의 불변식(「`undefined`=안 봤음」 ≠ 「`false`=봤고 없음」)이
 * HTTP 경계에서 무너지는 자리라, 모르는 값은 400으로 돌려보낸다.
 * 안 적은 것(`undefined`)은 그대로 「안 봤음」이고, 조립 게이트가 막는다.
 */
function parseHasFace(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw Object.assign(
    new Error(`hasFace는 true 또는 false여야 합니다 (받은 값: "${raw}")`),
    { status: 400 },
  );
}

/**
 * 자료 올리기 — 🔴 **출처 URL이 없으면 받지 않는다** (2026-08-26).
 *
 * 나중에 채우게 두면 안 채운다. 그리고 출처가 없으면 화이트리스트가 아무것도 못 거르므로
 * 정책 전체가 장식이 된다. 직접 만든 것이면 「직접제작」이라고 적는다.
 *
 * 🔴 **거부하면 자료실에 흔적이 남지 않아야 한다.** 파일은 대기 자리(`.uploads`)에
 * 떨어져 있고, 검사를 통과한 것만 `commitUpload`으로 옮긴다. 남은 것은 `finally`에서
 * 치우므로 **던져서 나가는 경로에서도** 반드시 지워진다.
 *
 * 인물 표시(`hasFace`)는 여기서 요구하지 않는다 — 자료를 모으는 일 자체를 막지 않고,
 * 실제로 위험해지는 자리(menu-b 조립)에서 막는다. 화면은 올릴 때부터 물어본다.
 */
router.post('/assets', assetUpload.array('files'), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const kind = uploadKind(req);
    if (!files.length) return res.status(400).json({ error: '올린 파일이 없습니다' });

    const sourceUrl = field(req, 'sourceUrl');
    if (!sourceUrl) {
      // 「직접제작」은 상수에서 온다 — 손으로 적으면 값이 바뀔 때 이 안내만 옛말을 한다
      return res.status(400).json({
        error: '출처 URL이 필요합니다 — 받아온 페이지 주소를 넣으세요 '
          + `(직접 만든 것이면 「${SELF_MADE}」이라고 적습니다)`,
      });
    }
    assertSourceAllowed(sourceUrl);
    const hasFace = parseHasFace(field(req, 'hasFace'));

    /*
      원래 파일명을 제목으로 남긴다 — 저장 파일명은 슬러그라 「01 삐삑.mp3」가
      「01-.mp3」처럼 남을 수 있고, 그러면 목록에서 뭘 넣었는지 알아볼 수 없다.

      **덧칠을 먼저 쓰고 파일을 옮긴다.** 옮기다 실패하면 파일 없는 덧칠이 남는데 그건
      목록에 안 뜬다(파일시스템이 진실이다). 반대로 하면 출처 없는 파일이 자료실에 뜬다.

      🔴 **그 둘을 락 안에서 한 쌍으로 묶는다.** 대기 자리 이름을 유일하게 만들어도
      기록(`setAssetMeta`)과 파일(`commitUpload`)은 여전히 두 번의 await라, 같은 이름을
      동시에 올리면 그 사이에 다른 요청이 끼어 **파일은 A · 기록은 B**가 될 수 있다.
      그러면 얼굴 있는 파일에 「인물 없음」이 붙고 게이트는 기록만 보므로 통과시킨다.
      락 키는 `local.json`이다 — 그 파일을 읽고 쓰는 것도 이 쌍의 일부다
      (`setAssetMeta`는 스스로 락을 안 잡으므로 중첩 교착이 없다).
    */
    const added = await withFileLock(assetPaths.localState(), async () => {
      const ids: string[] = [];
      /*
        한 요청 안에서 최종 이름이 겹치면 뒤엣것에 `_2`를 붙인다 — 사용자는 파일 **둘**을
        고른 것이라 하나가 조용히 사라지면 안 된다. 요청 사이의 「같은 이름 = 갱신」은
        예전 그대로다(다시 올려 고치는 흐름이 그걸로 돈다).
      */
      const taken = new Set<string>();
      for (const f of files) {
        const wanted = assetFileNameOf(f);
        const ext = path.extname(wanted);
        const stem = path.basename(wanted, ext);
        let file = wanted;
        for (let n = 2; taken.has(file); n++) file = `${stem}_${n}${ext}`;
        taken.add(file);

        const id = assetId('local', kind, file);
        await setAssetMeta(id, {
          title: titleFromFile(originalName(f)),
          sourceUrl,
          license: field(req, 'license'),
          // 받은 날짜를 안 적으면 올린 날로 본다 — 사이트가 라이선스를 바꿨을 때 유일한 근거다
          downloadedAt: field(req, 'downloadedAt') ?? new Date().toISOString(),
          hasFace,
          transformNote: field(req, 'note'),
        });
        await commitUpload(f.path, kind, file);
        ids.push(id);
      }
      return ids;
    });
    res.json({ added, items: await listAssets({ kind }) });
  } finally {
    await discardUploads(files.map((f) => f.path));
  }
});

const metaBody = z.object({
  title: z.string().max(120).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  // 빈 문자열은 「지우기」다 (`setAssetMeta`)
  sourceUrl: z.string().max(500).optional(),
  license: z.string().max(120).optional(),
  downloadedAt: z.string().max(40).optional(),
  hasFace: z.boolean().optional(),
  transformNote: z.string().max(500).optional(),
});

router.patch('/assets/:id', async (req, res) => {
  const patch = metaBody.parse(req.body ?? {});
  // 비우는 것은 허용한다 — 잘못 적은 출처를 지울 길이 없으면 고칠 수도 없다
  if (patch.sourceUrl?.trim()) assertSourceAllowed(patch.sourceUrl);
  await setAssetMeta(req.params.id, patch);
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

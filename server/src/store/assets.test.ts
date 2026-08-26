import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/*
  작업공간을 임시 폴더로 돌려놓고 부른다 — 실제 workspace를 건드리면 사용자의 자료가
  테스트에 지워진다. `WORKSPACE_ROOT`는 모듈을 처음 부를 때 확정되므로 import보다 먼저 세운다.
*/
const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'assets-test-'));
process.env.SHORTS_WORKSPACE = ROOT;

const {
  listAssets, removeAsset, unhideAsset, setAssetMeta, resolveAssets,
  assetId, parseAssetId, titleFromFile, assetPaths,
} = await import('./assets.js');

async function put(origin: 'shared' | 'local', dir: string, file: string, body = 'x') {
  const d = path.join(ROOT, 'assets', origin, dir);
  await fsp.mkdir(d, { recursive: true });
  await fsp.writeFile(path.join(d, file), body);
}

beforeEach(async () => {
  await fsp.rm(path.join(ROOT, 'assets'), { recursive: true, force: true });
  await fsp.rm(path.join(ROOT, '.trash'), { recursive: true, force: true });
});

afterAll(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
});

describe('자료 id', () => {
  it('id를 파일 자리로 되돌린다', () => {
    expect(parseAssetId(assetId('local', 'sfx', '01-삐삑.mp3'))).toEqual({
      origin: 'local', kind: 'sfx', file: '01-삐삑.mp3',
    });
  });

  /*
    id는 잡 파일과 요청 본문에서 온다. 여기서 안 끊으면 `local:sfx/../../settings.json`
    같은 값으로 작업공간 밖 파일을 지우거나 캡컷 묶음에 담아 내보낼 수 있다.
  */
  it('경로 조작을 막는다', () => {
    expect(parseAssetId('local:sfx/../../settings.json')).toBeNull();
    expect(parseAssetId('local:sfx/a/b.mp3')).toBeNull();
    expect(parseAssetId('other:sfx/a.mp3')).toBeNull();
    expect(parseAssetId('local:모르는폴더/a.mp3')).toBeNull();
  });

  it('파일명 앞의 번호를 떼고 제목을 만든다', () => {
    expect(titleFromFile('01 삐삑.mp3')).toBe('삐삑');
    expect(titleFromFile('20 터지는소리BOOM.WAV')).toBe('터지는소리BOOM');
    expect(titleFromFile('07  띠용.mp3')).toBe('띠용');
    // 번호만 있는 이름은 통째로 남긴다 — 떼면 제목이 빈다
    expect(titleFromFile('123.gif')).toBe('123');
  });

  /*
    짤 파일명은 대개 해시다. 숫자를 무조건 떼면 첫 글자가 먹혀 원본을 찾을 수 없게 된다
    (2026-08-23 실측: `0a0e0e4d8a7f…` → `a0e0e4d8a7f…`).
  */
  it('해시로 된 파일명은 건드리지 않는다', () => {
    expect(titleFromFile('0a0e0e4d8a7f48ddd8fd02eb12ac4b15.jpg'))
      .toBe('0a0e0e4d8a7f48ddd8fd02eb12ac4b15');
    expect(titleFromFile('-4ZDMcKlWuZ11l5yCt_V-lzbDxM.jpeg'))
      .toBe('-4ZDMcKlWuZ11l5yCt_V-lzbDxM');
    expect(titleFromFile('163c5e15e9c4c241e.jpg')).toBe('163c5e15e9c4c241e');
  });
});

describe('자료 목록', () => {
  it('공용과 로컬을 합쳐 보여주고 출처를 표시한다', async () => {
    await put('shared', 'memes', 'a.gif');
    await put('local', 'sfx', 'b.mp3');
    const items = await listAssets();
    expect(items.map((i) => [i.origin, i.kind])).toEqual(
      expect.arrayContaining([['shared', 'meme'], ['local', 'sfx']]),
    );
  });

  /*
    공용 저장소에는 README·LICENSE·library.json이 같이 딸려 온다.
    확장자로 거르지 않으면 그것들이 짤방 칸에 섞여 나온다.
  */
  it('자료가 아닌 파일은 목록에 안 넣는다', async () => {
    await put('shared', 'memes', 'a.gif');
    await put('shared', 'memes', 'README.md');
    const items = await listAssets();
    expect(items.map((i) => i.title)).toEqual(['a']);
  });

  it('종류·검색어로 거른다', async () => {
    await put('local', 'memes', '고양이.gif');
    await put('local', 'sfx', '삐삑.mp3');
    expect((await listAssets({ kind: 'sfx' })).map((i) => i.title)).toEqual(['삐삑']);
    expect((await listAssets({ q: '고양' })).map((i) => i.title)).toEqual(['고양이']);
  });

  it('태그를 붙이면 그 태그로도 찾힌다', async () => {
    await put('local', 'memes', 'a.gif');
    await setAssetMeta(assetId('local', 'meme', 'a.gif'), { tags: ['놀람', '반전'] });
    expect((await listAssets({ q: '반전' })).map((i) => i.title)).toEqual(['a']);
  });
});

describe('출처 기록 (2026-08-26)', () => {
  /*
    🔴 **하위호환.** 이 기능 전에 올린 자료에는 출처가 하나도 없다. 그래도 목록에
    그대로 보여야 한다 — 안 보이면 자료실이 통째로 빈 화면이 되고, 게이트가 아니라
    앱이 고장 난 것으로 보인다. 막는 자리는 조립이지 목록이 아니다.
  */
  it('출처가 없는 옛 자료도 목록에 그대로 나온다', async () => {
    await put('local', 'memes', 'a.gif');
    const [item] = await listAssets();
    expect(item.title).toBe('a');
    expect(item.sourceUrl).toBeUndefined();
    // 🔴 「안 봤음」이 「없음」으로 바뀌면 안 된다 — 기본값 false는 검사를 통째로 무력화한다
    expect(item.hasFace).toBeUndefined();
  });

  /*
    🔴 **zod를 통과한 뒤에도 `undefined`여야 한다** (2026-08-26 검증 지적).

    위 검사는 `meta` 항목이 **아예 없는** 자료를 쓴다 — 그러면 스키마 기본값이 개입할
    자리가 없어서, `hasFace`에 `.default(false)`를 붙여도 초록으로 지나간다(검증자가
    실제로 붙여 588개 전부 통과시켰다). 옛 형식 항목(제목만 있는 덧칠·공용 목록)을
    **스키마에 태워** 「안 봤음」이 살아남는지 보는 것은 여기뿐이다.

    이게 무너지면 아무도 안 본 자료가 「봤고 인물 없음」으로 게이트를 통과한다.
  */
  it('옛 형식 덧칠·공용 목록을 스키마에 태워도 인물 표시는 「안 봤음」으로 남는다', async () => {
    await put('local', 'memes', 'a.gif');
    await put('shared', 'memes', 'b.gif');
    const id = assetId('local', 'meme', 'a.gif');

    // 제목만 있는 옛 덧칠 — `AssetLocalStateSchema`를 그대로 통과한다
    await fsp.writeFile(
      path.join(ROOT, 'assets', 'local.json'),
      JSON.stringify({ hidden: [], meta: { [id]: { title: '옛짤' } } }),
      'utf8',
    );
    // 제목만 있는 옛 공용 목록 — `AssetLibrarySchema` 쪽도 같이 본다
    await fsp.writeFile(
      assetPaths.library(),
      JSON.stringify({ items: [{ file: 'memes/b.gif', title: '공용옛짤' }] }),
      'utf8',
    );

    const items = await listAssets();
    expect(items.map((i) => i.title).sort()).toEqual(['공용옛짤', '옛짤']);
    for (const item of items) {
      expect(item.hasFace).toBeUndefined();
      expect(item.sourceUrl).toBeUndefined();
    }
  });

  it('덧칠한 출처가 목록에 실린다', async () => {
    await put('local', 'memes', 'a.gif');
    const id = assetId('local', 'meme', 'a.gif');
    await setAssetMeta(id, { sourceUrl: 'https://pixabay.com/gifs/1/', hasFace: false });
    const [item] = await listAssets();
    expect(item.sourceUrl).toBe('https://pixabay.com/gifs/1/');
    expect(item.hasFace).toBe(false);
    // 화이트리스트 사이트면 라이선스 이름이 자동으로 붙는다
    expect(item.license).toBe('Pixabay Content License');
  });

  it('빈 문자열은 지우기다 — 잘못 적은 출처를 되돌릴 길이 있어야 한다', async () => {
    await put('local', 'memes', 'a.gif');
    const id = assetId('local', 'meme', 'a.gif');
    await setAssetMeta(id, { sourceUrl: 'https://pixabay.com/gifs/1/' });
    await setAssetMeta(id, { sourceUrl: '' });
    expect((await listAssets())[0].sourceUrl).toBeUndefined();
  });

  /*
    공용 목록(`library.json`)에 출처가 있는 자료에 이 PC에서 **태그만** 달았을 때
    출처가 사라지면 안 된다 — 덧칠은 필드 단위로 겹쳐 쓴다.
  */
  it('공용 목록의 출처 위에 덧칠이 필드 단위로 얹힌다', async () => {
    await put('shared', 'memes', 'a.gif');
    await fsp.writeFile(assetPaths.library(), JSON.stringify({
      items: [{
        file: 'memes/a.gif', title: '공용짤',
        sourceUrl: 'https://pexels.com/photo/1/', license: 'Pexels License', hasFace: false,
      }],
    }), 'utf8');
    const id = assetId('shared', 'meme', 'a.gif');
    await setAssetMeta(id, { tags: ['놀람'] });
    const [item] = await listAssets();
    expect(item.sourceUrl).toBe('https://pexels.com/photo/1/');
    expect(item.tags).toEqual(['놀람']);

    // 이 PC에서 고친 값은 공용 값을 덮는다 (파일은 안 건드린다)
    await setAssetMeta(id, { hasFace: true });
    expect((await listAssets())[0].hasFace).toBe(true);
  });
});

describe('지우기', () => {
  /*
    🔴 공용 자료의 파일을 지우면 다음 동기화에서 되살아나고, 그 사이 git pull이
    로컬 삭제와 부딪혀 동기화 자체가 막힌다. 숨기는 것이 삭제여야 한다.
  */
  it('공용 자료는 파일을 안 지우고 이 PC에서만 숨긴다', async () => {
    await put('shared', 'memes', 'a.gif');
    const id = assetId('shared', 'meme', 'a.gif');

    expect((await removeAsset(id)).how).toBe('hidden');
    expect(await listAssets()).toHaveLength(0);
    // 파일은 그대로 있어야 한다
    await expect(fsp.access(path.join(ROOT, 'assets', 'shared', 'memes', 'a.gif')))
      .resolves.toBeUndefined();

    expect((await listAssets({ includeHidden: true }))[0].hidden).toBe(true);
    await unhideAsset(id);
    expect(await listAssets()).toHaveLength(1);
  });

  it('로컬 자료는 휴지통으로 옮긴다 — 지우지 않는다', async () => {
    await put('local', 'sfx', 'a.mp3');
    expect((await removeAsset(assetId('local', 'sfx', 'a.mp3'))).how).toBe('trashed');
    expect(await listAssets()).toHaveLength(0);
    await expect(fsp.access(path.join(assetPaths.trash(), 'sfx', 'a.mp3')))
      .resolves.toBeUndefined();
  });
});

describe('잡이 담아둔 자료 풀기', () => {
  /*
    잡은 id만 들고 있다. 자료실에서 지운 뒤 캡컷 묶음을 받으면 그 파일이 없는데,
    거기서 터지면 담아둔 것 하나 때문에 묶음 전체를 못 받는다.
  */
  it('없어진 id는 조용히 뺀다', async () => {
    await put('local', 'memes', 'a.gif');
    const ok = assetId('local', 'meme', 'a.gif');
    const gone = assetId('local', 'meme', '없는것.gif');
    expect((await resolveAssets([ok, gone])).map((a) => a.id)).toEqual([ok]);
  });

  it('숨긴 자료도 담아뒀으면 그대로 쓴다', async () => {
    await put('shared', 'memes', 'a.gif');
    const id = assetId('shared', 'meme', 'a.gif');
    await removeAsset(id);
    expect((await resolveAssets([id])).map((a) => a.id)).toEqual([id]);
  });
});

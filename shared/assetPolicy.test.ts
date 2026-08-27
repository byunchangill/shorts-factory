import { describe, it, expect } from 'vitest';
import {
  classifySource, defaultLicense, assetPolicyProblems, assetLogError, usedAssetIds,
  sourceVerdictMessage, sceneImageSubjects,
  transformSummary, assetLedgerRows, assetLedgerCsv, assetSourcingRules,
  ASSET_SOURCE_WHITELIST, ASSET_SOURCE_BLACKLIST, SELF_MADE, AI_GENERATED,
  type AssetSubject,
} from './assetPolicy.js';

/** 통과하는 자료 하나 — 검사마다 한 군데씩만 망가뜨려 본다 */
function ok(patch: Partial<AssetSubject> = {}): AssetSubject {
  return {
    id: 'local:memes/cat.gif',
    title: '놀란 고양이',
    sourceUrl: 'https://pixabay.com/gifs/cat-123/',
    license: 'Pixabay Content License',
    downloadedAt: '2026-08-26T00:00:00.000Z',
    hasFace: false,
    ...patch,
  };
}

describe('출처 URL 판정', () => {
  it('화이트리스트 사이트를 알아본다', () => {
    const v = classifySource('https://pixabay.com/photos/x-1/');
    expect(v.kind).toBe('allowed');
    expect(defaultLicense('https://pixabay.com/photos/x-1/')).toBe('Pixabay Content License');
  });

  it('하위 도메인·www도 같은 사이트로 본다 — CDN 주소로 복사해 오는 일이 흔하다', () => {
    expect(classifySource('https://cdn.pixabay.com/x.jpg').kind).toBe('allowed');
    expect(classifySource('https://www.pexels.com/video/1/').kind).toBe('allowed');
  });

  /** 「pixabay.com.evil.example」이 픽사베이로 통과하면 화이트리스트가 무의미해진다 */
  it('이름만 비슷한 도메인은 통과시키지 않는다', () => {
    const v = classifySource('https://pixabay.com.evil.example/x');
    expect(v.kind).toBe('unknown');
  });

  it('블랙리스트는 사유와 함께 막는다', () => {
    const v = classifySource('https://www.pinterest.com/pin/1/');
    expect(v.kind).toBe('blocked');
    if (v.kind === 'blocked') expect(v.entry.reason).toContain('재배포');
  });

  it('블랙리스트가 화이트리스트보다 먼저다 — 겹치는 날이 오면 막는 쪽이 이겨야 한다', () => {
    // 목록 순서에 기대지 않는다는 것을 문서화한다 (현재는 겹치는 항목이 없다)
    const hosts = new Set(ASSET_SOURCE_WHITELIST.map((e) => e.host));
    expect(ASSET_SOURCE_BLACKLIST.some((e) => hosts.has(e.host))).toBe(false);
  });

  it('프로토콜이 없어도 읽는다 — 주소창에서 복사하면 흔히 빠진다', () => {
    expect(classifySource('pexels.com/photo/1').kind).toBe('allowed');
  });

  it('주소가 아닌 글자는 invalid — 「나중에」 같은 메모가 출처로 들어가는 것을 막는다', () => {
    expect(classifySource('나중에 적을게요').kind).toBe('invalid');
    expect(classifySource('javascript:alert(1)').kind).toBe('invalid');
  });

  it('직접 만든 것은 URL 없이도 기록된다', () => {
    expect(classifySource(SELF_MADE).kind).toBe('self');
    expect(defaultLicense(SELF_MADE)).toBe('자체 제작');
  });

  /*
    🔴 정책이 「인물이 필요하면 AI로 만든 그림을 쓰라」고 말한다. 그 그림에는 받아온
    페이지가 없으므로, AI 생성이 일급 출처가 아니면 **시키는 대로 한 사람이 막힌다**.
  */
  it('AI로 만든 그림도 URL 없이 기록된다 — 정책이 권하는 방법이다', () => {
    expect(classifySource(AI_GENERATED).kind).toBe('ai');
    expect(sourceVerdictMessage(classifySource(AI_GENERATED))).toBeNull();
    expect(assetPolicyProblems(ok({ sourceUrl: AI_GENERATED, license: '' }))).toEqual([]);
  });

  it('AI 생성과 직접 제작을 갈라 둔다 — 대장에서 뜻이 다르다', () => {
    expect(classifySource(AI_GENERATED).kind).not.toBe(classifySource(SELF_MADE).kind);
    expect(defaultLicense(AI_GENERATED)).not.toBe(defaultLicense(SELF_MADE));
  });

  /** 상수를 안 쓰고 비슷한 말을 적으면 통과하지 않는다 — 값이 하나여야 한다 */
  it('「AI 생성」처럼 비슷하게 적은 것은 통과하지 않는다', () => {
    expect(classifySource('AI 생성').kind).toBe('invalid');
    expect(classifySource('ai생성').kind).toBe('invalid');
  });

  it('비어 있으면 missing — invalid와 구분한다 (사유 문구가 다르다)', () => {
    expect(classifySource('').kind).toBe('missing');
    expect(classifySource(undefined).kind).toBe('missing');
  });
});

describe('자료 하나의 정책 위반', () => {
  it('다 갖춘 자료는 통과한다', () => {
    expect(assetPolicyProblems(ok())).toEqual([]);
  });

  it('출처가 없으면 걸린다', () => {
    expect(assetPolicyProblems(ok({ sourceUrl: undefined }))[0]).toContain('출처 URL');
  });

  /**
   * 🔴 `hasFace: undefined`는 「인물 없음」이 아니라 「아무도 안 봤음」이다.
   * 여기가 무너지면 기존 자료 전부가 검사 없이 통과한다 — 게이트를 넣은 이유가 사라진다.
   */
  it('인물 표시가 없으면 걸린다 — 미표시는 「없음」이 아니다', () => {
    expect(assetPolicyProblems(ok({ hasFace: undefined }))[0]).toContain('인물 포함 여부');
  });

  it('인물이 있으면 채우는 게 아니라 바꾸라고 말한다', () => {
    const why = assetPolicyProblems(ok({ hasFace: true }));
    expect(why.join(' ')).toContain('초상권');
    expect(why.join(' ')).toContain('바꾸세요');
  });

  it('화이트리스트 밖이라도 라이선스를 적었으면 통과한다', () => {
    const subject = ok({ sourceUrl: 'https://example.com/a', license: 'CC BY 4.0' });
    expect(assetPolicyProblems(subject)).toEqual([]);
  });

  it('화이트리스트 밖이고 라이선스도 없으면 걸린다', () => {
    const why = assetPolicyProblems(ok({ sourceUrl: 'https://example.com/a', license: '' }));
    expect(why[0]).toContain('example.com');
  });

  it('블랙리스트는 라이선스를 적어도 못 푼다 — 적는 것으로 뚫리면 목록이 장식이 된다', () => {
    const why = assetPolicyProblems(ok({
      sourceUrl: 'https://fmkorea.com/1', license: '내가 확인함',
    }));
    expect(why[0]).toContain('에펨코리아');
  });
});

describe('조립 게이트 (양방향)', () => {
  it('출처가 갖춰지면 통과한다 — 정상 입력이 막히면 게이트가 아니라 장애다', () => {
    expect(assetLogError('menu-b', [ok(), ok({ id: 'x', sourceUrl: SELF_MADE })])).toBeNull();
  });

  it('자료가 하나도 없으면 통과한다 (검사할 것이 없다)', () => {
    expect(assetLogError('menu-b', [])).toBeNull();
  });

  it('출처가 모자라면 막는다', () => {
    const msg = assetLogError('menu-b', [ok({ sourceUrl: undefined })]);
    expect(msg).toContain('조립을 멈췄습니다');
    expect(msg).toContain('놀란 고양이');
  });

  /**
   * 🔴 `cutPlanError`의 「다시 눌러도 같습니다」와 **반대**여야 한다.
   * 저건 앱 결함이고 이건 사용자가 고칠 수 있는 것이라, 안내가 갈 곳을 가리켜야 한다.
   */
  it('안내가 「채우고 다시 하세요」다 — 고칠 수 있는 것이기 때문이다', () => {
    const msg = assetLogError('menu-b', [ok({ hasFace: undefined })]) ?? '';
    expect(msg).toContain('편집 재료');
    expect(msg).toContain('다시 조립하세요');
    expect(msg).not.toContain('다시 눌러도 같');
  });

  /*
    🔴 **이 게이트가 씬 이미지도 본다** (2026-08-26). 예전에는 안내가 「씬 이미지는 아직
    출처를 기록하지 않습니다」라고 스스로 말했다 — 그 문장이 없어졌는지가 아니라
    **실제로 막는지**를 본다.
  */
  it('씬 이미지도 막는다 — 스톡 인물이 들어올 자리가 정확히 거기다', () => {
    const msg = assetLogError('menu-b', [
      { id: 'scene:s01', title: '씬 s01 이미지', where: 'scene', hasFace: false },
    ]) ?? '';
    expect(msg).toContain('씬 s01 이미지');
    expect(msg).toContain('출처 URL');
  });

  /** 고치는 자리가 다르다 — 씬 이미지에는 출처를 적는 화면이 아예 없다 */
  it('씬 이미지는 「요청서를 다시 받으라」고, 자료실 자료는 「화면에서 채우라」고 한다', () => {
    const scene = assetLogError('menu-b', [
      { id: 'scene:s01', title: '씬 s01 이미지', where: 'scene', hasFace: false },
    ]) ?? '';
    expect(scene).toContain('요청서');
    expect(scene).toContain(AI_GENERATED);
    expect(scene).not.toContain('「편집 재료」 화면');

    const lib = assetLogError('menu-b', [ok({ sourceUrl: undefined })]) ?? '';
    expect(lib).toContain('「편집 재료」 화면');
    expect(lib).not.toContain('요청서');
  });

  /** 둘 다 걸리면 두 안내가 같이 나와야 한다 — 하나만 고치고 또 막히면 안 된다 */
  it('자료실과 씬 이미지가 같이 걸리면 고칠 곳을 둘 다 말한다', () => {
    const msg = assetLogError('menu-b', [
      ok({ sourceUrl: undefined }),
      { id: 'scene:s01', title: '씬 s01 이미지', where: 'scene', hasFace: false },
    ]) ?? '';
    expect(msg).toContain('「편집 재료」 화면');
    expect(msg).toContain('요청서');
    expect(msg).toContain('2개');
  });

  /**
   * 🔴 옛 대본의 `imageRef`는 경로 문자열이라 출처가 없다. 승격이 출처를 지어내지 않으므로
   * 여기서 걸려야 한다 — 「기록이 없다」가 「기록이 있다」로 바뀌면 게이트가 죽는다.
   */
  it('출처 없는 씬 이미지(옛 대본에서 승격된 것)는 통과하지 않는다', () => {
    const msg = assetLogError('menu-b',
      sceneImageSubjects([{ sceneId: 's01', imageRef: { file: 'a/b/s01.png' } }])) ?? '';
    expect(msg).toContain('씬 s01 이미지');
    expect(msg).toContain('옛 대본');
  });

  it('걸린 자료를 전부 보여준다 — 하나씩 고치고 다시 돌리게 하지 않는다', () => {
    const msg = assetLogError('menu-b', [
      ok({ id: 'a', title: '가', sourceUrl: undefined }),
      ok({ id: 'b', title: '나', hasFace: true }),
    ]) ?? '';
    expect(msg).toContain('가');
    expect(msg).toContain('나');
    expect(msg).toContain('2개');
  });

  /**
   * 해외영상 짜집기는 `job.sources[]`에 이미 라이선스가 붙고 rights-confirm 게이트가 막는다.
   * 여기까지 걸면 같은 뜻의 게이트가 둘이 된다.
   */
  it('해외영상 짜집기에는 안 걸린다', () => {
    expect(assetLogError('menu-a', [ok({ sourceUrl: undefined, hasFace: undefined })])).toBeNull();
  });
});

describe('이 편이 쓰는 자료 목록', () => {
  it('잡에 담은 것과 씬이 가리키는 것을 합치고 중복을 없앤다', () => {
    const ids = usedAssetIds(['local:memes/a.gif'], [
      { memeId: 'local:memes/a.gif', sfxId: 'local:sfx/b.mp3' },
      { memeId: 'shared:memes/c.png' },
      {},
    ]);
    expect(ids).toEqual(['local:memes/a.gif', 'local:sfx/b.mp3', 'shared:memes/c.png']);
  });

  it('아무것도 없으면 빈 배열', () => {
    expect(usedAssetIds([], [{}])).toEqual([]);
  });

  it('씬 이미지가 없는 대본에서는 아무것도 안 나온다', () => {
    expect(sceneImageSubjects([{ sceneId: 's01' }, { sceneId: 's02' }])).toEqual([]);
  });

  /** 출처 5필드가 **그대로** 넘어가야 한다 — 한 칸이라도 흘리면 대장이 조용히 빈다 */
  it('씬 이미지의 출처 5필드를 그대로 옮긴다', () => {
    const [s] = sceneImageSubjects([{
      sceneId: 's02',
      imageRef: {
        file: 'menu-b/제품/jobs/j1/scenes/s02_v1.png',
        sourceUrl: AI_GENERATED,
        license: '어떤 모델',
        downloadedAt: '2026-08-26',
        hasFace: false,
        transformNote: '메모',
      },
    }]);
    expect(s).toEqual({
      id: 'scene:s02',
      title: '씬 s02 이미지',
      where: 'scene',
      sourceUrl: AI_GENERATED,
      license: '어떤 모델',
      downloadedAt: '2026-08-26',
      hasFace: false,
      transformNote: '메모',
    });
  });

  /** 🔴 `hasFace`가 `false`로 뭉개지면 아무도 안 본 그림이 통과한다 */
  it('표시하지 않은 인물 여부는 undefined로 남는다', () => {
    const [s] = sceneImageSubjects([{ sceneId: 's01', imageRef: { file: 'x.png' } }]);
    expect(s.hasFace).toBeUndefined();
  });
});

describe('출처 대장', () => {
  /** 🔴 사람이 적는 값이 아니라 설정에서 계산한 값이다 */
  it('변형은 설정에서 계산한다', () => {
    expect(transformSummary({ mirror: true, zoom: 1.08, grade: 'eq=saturation=1.1' }))
      .toBe('좌우반전 · 확대 1.08배 · 그레이딩(eq=saturation=1.1)');
    expect(transformSummary({ mirror: false, zoom: 1, grade: '' })).toBe('없음');
  });

  it('인물 미표시가 「없음」으로 뭉개지지 않는다', () => {
    const rows = assetLedgerRows([
      ok({ hasFace: undefined }), ok({ hasFace: false }), ok({ hasFace: true }),
    ], '없음');
    expect(rows.map((r) => r.hasFace)).toEqual(['미표시', '없음', '있음']);
  });

  it('라이선스가 비면 화이트리스트 기본값이 대장에 들어간다', () => {
    const [row] = assetLedgerRows([ok({ license: '' })], '없음');
    expect(row.license).toBe('Pixabay Content License');
  });

  it('제목에 쉼표가 있어도 칸이 안 밀린다', () => {
    const csv = assetLedgerCsv(assetLedgerRows([ok({ title: '고양이, 놀람' })], '없음'));
    expect(csv).toContain('"고양이, 놀람"');
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });

  /** 엑셀은 BOM이 없으면 UTF-8 한글을 깨뜨린다 — 이 파일을 여는 도구가 엑셀이다 */
  it('BOM으로 시작한다', () => {
    expect(assetLedgerCsv([]).startsWith('﻿')).toBe(true);
  });

  /*
    🔴 엑셀은 `= + - @`로 시작하는 칸을 **수식으로 읽는다.** 메모 칸 안내가
    「예: 최신순 정렬 · 인기 상위 20개 제외」인데 사용자가 습관대로 「- 최신순 정렬」이라고
    적으면 그 칸이 `#NAME?`이 된다 — BOM까지 붙여 엑셀용으로 만든 파일이라 여기서 깨지면
    대장을 만든 값이 없다.
  */
  it('- 로 시작하는 메모가 엑셀 수식이 되지 않는다', () => {
    const csv = assetLedgerCsv(assetLedgerRows(
      [ok({ transformNote: '- 최신순 정렬 · 상위 20개 제외' })], '없음'));
    expect(csv).toContain("'- 최신순 정렬");
    expect(csv).not.toMatch(/,- 최신순/);
  });

  it('= + @ 로 시작하는 칸도 막는다', () => {
    for (const note of ['=HYPERLINK("x")', '+1', '@sum']) {
      const csv = assetLedgerCsv(assetLedgerRows([ok({ transformNote: note })], '없음'));
      expect(csv).toContain(`'${note.startsWith('=') ? '=HYPERLINK' : note}`);
    }
  });

  /*
    캡컷 갈래는 출처 없는 자료도 그대로 나간다(게이트는 웹 자동 조립 한 곳뿐이다).
    빈 칸은 「신고할 것이 없음」으로 읽히므로 「안 적었음」과 갈라 말해야 한다.
  */
  it('출처를 안 적은 자료는 빈 칸이 아니라 「미기록」이다', () => {
    const [row] = assetLedgerRows([ok({ sourceUrl: undefined, license: '' })], '없음');
    expect(row.sourceUrl).toBe('미기록');
    expect(row.license).toBe('미기록');
  });
});

describe('사유 문구는 한 곳에서 온다', () => {
  /*
    🔴 판정만 상수로 모으고 **문장을 자리마다 손으로 적었더니 곧바로 어긋났다** —
    같은 블랙리스트 사유가 「받은 것은」과 「받은 자료는」으로 갈렸다 (2026-08-26 리뷰).
    업로드 400(`assertSourceAllowed`)·자료실 경고(`assetPolicyProblems`)·화면의 실시간
    판정이 전부 이 함수를 부른다. 여기서 고정한다.
  */
  it('막히는 자료의 사유가 판정 문구와 글자까지 같다', () => {
    const url = 'https://fmkorea.com/1';
    const why = sourceVerdictMessage(classifySource(url));
    expect(assetPolicyProblems(ok({ sourceUrl: url }))).toContain(why);
  });

  it('통과하는 출처에는 사유가 없다', () => {
    expect(sourceVerdictMessage(classifySource('https://pixabay.com/x'))).toBeNull();
    expect(sourceVerdictMessage(classifySource(SELF_MADE))).toBeNull();
  });

  /** 사람이 적은 원문을 되비쳐야 무엇을 고칠지 안다 */
  it('주소가 아니면 적은 값을 그대로 보여준다', () => {
    expect(sourceVerdictMessage(classifySource('나중에'))).toContain('"나중에"');
  });

  /** 「목록에 없으면 안전하다」로 읽히면 화이트리스트가 반대로 작동한다 */
  it('화이트리스트 밖 사유가 「써도 되는 것은 아니다」까지 말한다', () => {
    const why = sourceVerdictMessage(classifySource('https://example.com/a')) ?? '';
    expect(why).toContain('써도 되는 것은 아닙니다');
  });
});

describe('요청서 문구', () => {
  it('화이트리스트·블랙리스트를 상수에서 만든다 — 목록을 늘리면 문구도 같이 바뀐다', () => {
    const text = assetSourcingRules();
    for (const e of ASSET_SOURCE_WHITELIST) expect(text).toContain(e.host);
    for (const e of ASSET_SOURCE_BLACKLIST) expect(text).toContain(e.host);
  });
});

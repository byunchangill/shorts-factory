import { describe, it, expect } from 'vitest';
import { SettingsSchema, ScriptSchema, JobSchema, AssetSchema } from '@shared/types';
import { planCapcut } from './capcut.js';

/**
 * 캡컷 재료 묶음에 **출처 대장이 같이 들어가는가** (2026-08-26).
 *
 * 조립 게이트(`assetLogError`)는 「조립은 두 갈래다」 중 **웹 자동 조립 한 갈래에만** 걸린다.
 * 캡컷 갈래는 막지 않기로 했으므로(사람이 편집기에서 직접 고르고 바꾸는 길이다) 대신
 * 재료와 대장이 **같이** 나가야 한다 — 안 그러면 발행 뒤 무엇을 어디서 받아 썼는지
 * 되짚을 근거가 한쪽에만 남는다.
 */

const settings = SettingsSchema.parse({ mirror: true, zoom: 1.2, grade: 'eq=saturation=1.1' });
const job = JobSchema.parse({
  id: 'j1', projectId: 'p', menu: 'menu-b', title: '1편',
  createdAt: '2026-08-26T00:00:00.000Z', state: 'review',
});
const script = ScriptSchema.parse({
  version: 1, title: '서랍 정리함',
  scenes: [{ sceneId: 's01', narration: '한 문장.', subtitle: '한 문장' }],
});
const base = {
  settings, job, productName: '정리함', jobDir: 'C:/nowhere', script, timings: [], clips: [],
};

const asset = (over: Record<string, unknown> = {}) => AssetSchema.parse({
  id: 'local:memes/a.gif', kind: 'meme', origin: 'local',
  file: 'assets/local/memes/a.gif', url: '/media/x', title: '놀란 고양이',
  sourceUrl: 'https://pixabay.com/gifs/1/', hasFace: false, ...over,
});

function ledgerOf(assets: ReturnType<typeof asset>[]): string | undefined {
  return planCapcut({ ...base, assets }).find((i) => i.name.endsWith('에셋출처.csv'))?.text;
}

describe('캡컷 묶음의 출처 대장', () => {
  it('담아둔 재료가 있으면 대장이 같이 들어간다', () => {
    const csv = ledgerOf([asset()]);
    expect(csv).toBeDefined();
    expect(csv).toContain('https://pixabay.com/gifs/1/');
  });

  it('담은 재료가 없으면 안 만든다 — 신고할 것이 없다', () => {
    expect(ledgerOf([])).toBeUndefined();
  });

  /*
    🔴 캡컷 재료는 **반전·그레이딩·확대가 안 걸린 원본**이고 그 작업을 편집기에서 사람이 한다.
    앱 설정값을 적으면 그 자체가 거짓말이다 — 「손으로 적은 기록은 반드시 어긋난다」를
    피하려고 계산한 값인데, 계산해서 틀리면 더 나쁘다.
  */
  it('변형 칸이 앱 설정값을 말하지 않는다 (편집은 캡컷에서 한다)', () => {
    const csv = ledgerOf([asset()]) ?? '';
    expect(csv).toContain('캡컷에서 직접');
    expect(csv).not.toContain('좌우반전');
  });

  /*
    캡컷 갈래는 출처 없는 자료도 그대로 나간다. 빈 칸은 「신고할 것이 없음」으로 읽히므로
    「안 적었음」과 갈라 말해야 한다.
  */
  it('출처가 없는 자료는 「미기록」으로 나간다', () => {
    const csv = ledgerOf([asset({ sourceUrl: undefined, license: undefined })]) ?? '';
    expect(csv).toContain('미기록');
  });

  it('대장은 업로드킷 폴더에 들어간다 — 편집이 끝나면 바로 올릴 자리다', () => {
    const item = planCapcut({ ...base, assets: [asset()] })
      .find((i) => i.name.endsWith('에셋출처.csv'));
    expect(item!.name.startsWith('업로드킷/')).toBe(true);
  });
});

/*
  🔴 **없는 폴더를 설명하면 안 된다** (2026-08-27 검증 실측).

  씬 이미지로 만든 편은 `sceneVideo()`가 늘 `null`이라 `01_영상/`이 통째로 안 생기는데,
  안내문은 「`01_영상` — 씬 순서대로」라고 **있다고 적어 뒀다.** 사용자는 영상이 든 줄 알고
  풀었다가 소리만 있는 것을 본다 — 「안 담긴다」보다 **「담겼다고 안내한다」가 더 나쁘다.**
*/
describe('이미지로 만든 편의 캡컷 묶음', () => {
  const imageScript = ScriptSchema.parse({
    version: 1, title: '서랍 정리함',
    scenes: [
      { sceneId: 'i01', narration: '한 문장.', subtitle: '한 문장',
        imageRef: { file: 'menu-b/p/jobs/j1/scenes/i01_v1.png', sourceUrl: 'AI생성', hasFace: false } },
      { sceneId: 'i02', narration: '두 문장.', subtitle: '두 문장',
        imageRef: { file: 'menu-b/p/jobs/j1/scenes/i02_v1.png', sourceUrl: 'AI생성', hasFace: false } },
    ],
  });
  const items = () => planCapcut({ ...base, script: imageScript });
  const readme = () => items().find((i) => i.name === '읽어보세요.md')!.text!;

  it('영상이 하나도 안 담기는 편이다 (전제 확인)', () => {
    expect(items().some((i) => i.name.startsWith('01_영상/'))).toBe(false);
  });

  it('없는 01_영상 폴더를 설명하지 않는다', () => {
    expect(readme()).not.toContain('`01_영상`');
  });

  it('왜 비었는지와 어디서 받는지를 말한다', () => {
    const text = readme();
    expect(text).toContain('영상 재료가 없습니다');
    expect(text).toContain('씬 이미지 2장');
    expect(text).toContain('이미지'); // 「제품 폴더로 내보내기」의 이미지 폴더
  });

  /*
    묶음에 안 담겨도 **대장에는 실린다** — 그 편이 실제로 그 그림으로 나가기 때문이다.
    담긴 것만 신고하면 이미지 편에는 대장이 아예 안 붙어, 출처를 다 적어 놓고도 기록이 사라진다.
  */
  it('묶음에 안 담긴 씬 이미지도 대장에는 실린다', () => {
    const csv = planCapcut({
      ...base, script: imageScript,
      ledger: [
        { id: 'scene:i01', title: '씬 i01 이미지', where: 'scene', sourceUrl: 'AI생성', hasFace: false },
        { id: 'scene:i02', title: '씬 i02 이미지', where: 'scene', sourceUrl: 'AI생성', hasFace: false },
      ],
    }).find((i) => i.name.endsWith('에셋출처.csv'))?.text;
    expect(csv).toBeDefined();
    expect(csv).toContain('scene:i01');
    expect(csv).toContain('AI생성');
  });

  /** 클립으로 만든 편은 예전 그대로 — 안내문이 영상 폴더를 계속 설명해야 한다 */
  it('영상이 담기는 편에서는 01_영상 안내가 그대로다', () => {
    const clip = { id: 'c01', sourceId: 's01', frames: [], sceneTimes: [], zones: [],
      cleanVersions: [], segments: [] } as never;
    const withClip = ScriptSchema.parse({
      version: 1, title: 't',
      scenes: [{ sceneId: 's01', narration: 'a', subtitle: 'a', clipRef: { clipId: 'c01' } }],
    });
    const text = planCapcut({ ...base, script: withClip, clips: [clip] })
      .find((i) => i.name === '읽어보세요.md')!.text!;
    expect(text).toContain('`01_영상`');
  });
});

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

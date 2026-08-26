import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillBody } from './projects.js';
import { SettingsSchema } from '@shared/types';

/** 지침과 앱이 같은 배속을 말해야 한다 — 숫자를 박아 두면 이 파일만 옛 값으로 남는다 */
const RATE = SettingsSchema.parse({}).speechRate;

const SKILL = fileURLToPath(
  new URL('../../../.claude/skills/temcasting-v33/SKILL.md', import.meta.url));

describe('skillBody', () => {
  it('앞머리(name/description)를 떼고 본문만 남긴다', () => {
    const raw = '---\nname: x\ndescription: y\n---\n\n# 제목\n\n내용\n';
    expect(skillBody(raw)).toBe('# 제목\n\n내용');
  });

  it('줄바꿈이 CRLF여도 뗀다 — 윈도우에서 편집하면 이렇게 저장된다', () => {
    const raw = '---\r\nname: x\r\n---\r\n\r\n# 제목\r\n';
    expect(skillBody(raw).startsWith('#')).toBe(true);
  });

  it('앞머리가 없으면 그대로 쓴다', () => {
    expect(skillBody('# 그냥 지침\n\n내용')).toBe('# 그냥 지침\n\n내용');
  });

  it('본문 안의 --- 구분선은 건드리지 않는다', () => {
    const raw = '---\nname: x\n---\n\n# 제목\n\n---\n\n## 다음 절\n';
    expect(skillBody(raw)).toContain('---\n\n## 다음 절');
  });
});

describe('해외영상 짜집기 기본 대본 스킬', () => {
  it('저장소에 들어 있다 — 어느 PC에서 받아도 같은 지침으로 시작해야 한다', async () => {
    await expect(fsp.access(SKILL)).resolves.toBeUndefined();
  });

  /*
    지침은 **본문 하나만** 요청서에 실린다 (`readAllGuidelines`가 script.md만 읽는다).
    옛 스킬은 `references/block-structure.md`에 블록 규칙을 두고 본문에서 "그 파일을
    읽어라"라고 시켰는데, 파일을 못 여는 실행 경로(API 자동·복사 붙여넣기)에서는
    그 지시가 허공을 가리킨다. 스킬은 스스로 완결돼야 한다.
  */
  it('바깥 파일을 읽으라고 시키지 않는다 — 요청서에는 본문만 실린다', async () => {
    const body = skillBody(await fsp.readFile(SKILL, 'utf8'));
    expect(body).not.toMatch(/references\//);
  });

  it('본문만 뽑아도 지침 구실을 한다 (앞머리를 뗀 뒤 내용이 남는다)', async () => {
    const body = skillBody(await fsp.readFile(SKILL, 'utf8'));
    expect(body.startsWith('---')).toBe(false);
    expect(body.length).toBeGreaterThan(500);
  });

  /*
    지침과 앱이 다른 숫자를 말하면 요청서 하나에 모순된 지시가 실린다.
    스킬이 기준이므로 앱의 목표 시간이 스킬 문구와 맞아야 한다.
  */
  it('스킬이 말하는 초 수와 앱의 목표가 어긋나지 않는다', async () => {
    const body = skillBody(await fsp.readFile(SKILL, 'utf8'));
    const { TARGET_SEC_BY_MENU } = await import('@shared/constants');
    const t = TARGET_SEC_BY_MENU['menu-a'];
    expect(body).toContain(`${t.min}~${t.max}초`);
    expect(body).toContain(`${t.max}초를 넘기지 않는다`);
  });

  /*
    이 지침은 요청서에 통째로 실려 AI에게 간다. 요청서 경로에서 쓸 곳은 `result/` 하나뿐인데
    스킬이 다른 경로를 시키면 결과가 반영되지 않는다 (서버는 result/의 .done만 본다).
  */
  it('요청서로 실행할 때는 result/에만 쓰라고 말한다', async () => {
    const body = skillBody(await fsp.readFile(SKILL, 'utf8'));
    expect(body).toContain('`result/`에만');
    expect(body).toContain('result/.done');
    // 상태 파일은 서버 전용이다 — 스킬이 로그 파일을 쓰면 안 된다
    expect(body).toContain('건너뛴다');
  });

  /*
    음성 합성이 씬 단위로 돈다. 씬에 두 문장이 들어 있으면 뒷문장이 잘려 나가는데,
    소리가 안 나는 게 아니라 **짧게 끝나서** 조용히 지나간다. 대본에서 막는 것이 유일한 방어다.
  */
  it('씬 하나에 한 문장 규칙이 들어 있다', async () => {
    const body = skillBody(await fsp.readFile(SKILL, 'utf8'));
    expect(body).toContain('씬 하나에 문장 하나');
  });

  /*
    스킬은 초를 글자 수로 환산해 스스로 검산한다. 그 환산표가 앱의 계산과 달라지면
    요청서와 지침이 서로 다른 분량을 말하게 된다 — 이 리포가 이미 겪은 사고다.
  */
  it('스킬의 분량 환산표가 앱의 계산과 같다', async () => {
    const body = skillBody(await fsp.readFile(SKILL, 'utf8'));
    const { syllableBudget, TARGET_SEC_BY_MENU } = await import('@shared/constants');
    const b = syllableBudget(RATE, 'menu-a');
    const t = TARGET_SEC_BY_MENU['menu-a'];
    expect(body).toContain(`${t.recommended}초 (기본) | 약 ${b.recommended}음절`);
    expect(body).toContain(`**${b.max}음절을 넘지 않는다**`);
  });
});

const SKILL_B = fileURLToPath(
  new URL('../../../.claude/skills/ssul-shopping/SKILL.md', import.meta.url));

describe('제품정보리뷰 기본 대본 스킬', () => {
  it('저장소에 들어 있다 — 어느 PC에서 받아도 같은 지침으로 시작해야 한다', async () => {
    await expect(fsp.access(SKILL_B)).resolves.toBeUndefined();
  });

  it('바깥 파일을 읽으라고 시키지 않는다 — 요청서에는 본문만 실린다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    expect(body).not.toMatch(/references\//);
  });

  it('본문만 뽑아도 지침 구실을 한다 (앞머리를 뗀 뒤 내용이 남는다)', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    expect(body.startsWith('---')).toBe(false);
    expect(body.length).toBeGreaterThan(500);
  });

  it('스킬이 말하는 초 수와 앱의 목표가 어긋나지 않는다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    const { TARGET_SEC_BY_MENU } = await import('@shared/constants');
    const t = TARGET_SEC_BY_MENU['menu-b'];
    expect(body).toContain(`${t.min}~${t.max}초`);
    expect(body).toContain(`${t.max}초를 넘기지 않는다`);
  });

  it('스킬의 분량 환산표가 앱의 계산과 같다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    const { syllableBudget, TARGET_SEC_BY_MENU } = await import('@shared/constants');
    const b = syllableBudget(RATE, 'menu-b');
    const t = TARGET_SEC_BY_MENU['menu-b'];
    expect(body).toContain(`${t.recommended}초 (기본) | 약 ${b.recommended}음절`);
    expect(body).toContain(`**${b.max}음절을 넘지 않는다**`);
    expect(body).toContain(`${b.min}~${b.max}`);
  });

  it('요청서로 실행할 때는 result/에만 쓰라고 말한다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    expect(body).toContain('`result/`에만');
    expect(body).toContain('result/.done');
    expect(body).toContain('건너뛴다');
  });

  it('씬 하나에 한 문장 규칙이 들어 있다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    expect(body).toContain('씬 하나에 문장 하나');
  });

  /*
    썰형 가이드를 그대로 옮기면 「~라고 하더라」가 근거 없는 효능 주장의 방패가 된다.
    이 채널이 이미 세워둔 방어선(단점 씬·과장 금지)이 스킬 안에 남아 있어야 한다.
  */
  it('단점 씬과 지어내기 금지가 살아 있다 — 썰형이 덮어쓰면 안 되는 자리다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    expect(body).toContain('isDownside');
    expect(body).toContain('제품 자료에 없는 수치·사양을 지어내지 않는다');
  });

  /*
    에셋 소싱 정책은 `shared/assetPolicy.ts`가 단일 출처다. 스킬 `.md`는 산문이라 상수를
    읽지 못하므로 **여기서 대조한다** — 목록을 늘려 놓고 스킬만 옛 값을 말하면, 게이트는
    통과시키는데 지시는 막는(또는 그 반대인) 상태가 조용히 생긴다.
    분량 환산표를 대조하는 위 검사와 같은 장치다.
  */
  it('스킬의 소싱 목록이 정책 상수와 같다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    const { ASSET_SOURCE_WHITELIST, ASSET_SOURCE_BLACKLIST, SELF_MADE } =
      await import('@shared/assetPolicy');
    for (const e of ASSET_SOURCE_WHITELIST) expect(body).toContain(e.host);
    for (const e of ASSET_SOURCE_BLACKLIST) expect(body).toContain(e.host);
    expect(body).toContain(SELF_MADE);
  });

  /*
    스킬이 말해야 하는 것은 목록만이 아니다 — 이 정책의 핵심은 인물이고,
    「앱이 얼굴을 찾아주지 않는다」를 안 적으면 표시 없이 올려 놓고 조립에서 막힌다.
  */
  it('인물 규칙과 「표시가 없으면 막힌다」가 스킬에 있다', async () => {
    const body = skillBody(await fsp.readFile(SKILL_B, 'utf8'));
    expect(body).toContain('초상권');
    expect(body).toContain('표시가 없으면 막힌다');
  });
});

import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillBody } from './projects.js';

const SKILL = fileURLToPath(
  new URL('../../../.claude/skills/shorts-direct-script/SKILL.md', import.meta.url));

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
    const { charBudget, TARGET_SEC_BY_MENU } = await import('@shared/constants');
    const b = charBudget(1.25, 'menu-a');
    const t = TARGET_SEC_BY_MENU['menu-a'];
    expect(body).toContain(`${t.recommended}초 (기본) | 약 ${b.recommended}자`);
    expect(body).toContain(`**${b.max}자를 넘지 않는다**`);
  });
});

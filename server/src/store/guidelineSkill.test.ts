import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillBody } from './projects.js';

const SKILL = fileURLToPath(
  new URL('../../../.claude/skills/temcasting-shorts/SKILL.md', import.meta.url));

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

  it('참조 파일도 함께 들어 있다 (Claude Code 경로가 읽는다)', async () => {
    const dir = path.join(path.dirname(SKILL), 'references');
    const files = await fsp.readdir(dir);
    expect(files).toContain('block-structure.md');
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
});

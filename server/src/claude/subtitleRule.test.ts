import { describe, it, expect } from 'vitest';
import { subtitleCharsPerLine } from '@shared/constants';

/*
  자막 규칙은 요청서 문구(MENU_B_RULES)에 실려 대본 쓰는 AI에게 전달된다.
  한 줄 글자 수는 **글자 크기에서 계산**되므로 문구에 숫자를 박아두면 안 된다 —
  설정에서 크기를 키운 뒤에도 옛 값을 지시해 화면 밖으로 나가는 줄바꿈이 나온다.
*/
describe('자막 한 줄 글자 수', () => {
  it('글자 크기가 커지면 한 줄 글자 수가 준다', () => {
    expect(subtitleCharsPerLine(118)).toBeGreaterThan(subtitleCharsPerLine(160));
  });

  it('기본 크기(118)에서 13자다 — 요청서와 조립이 같은 값을 쓴다', () => {
    expect(subtitleCharsPerLine(118)).toBe(13);
  });

  it('아무리 커도 최소 4자는 보장한다', () => {
    expect(subtitleCharsPerLine(999)).toBeGreaterThanOrEqual(4);
  });
});

/*
  요청서는 **자기완결 문서**다. 파일을 못 여는 경로(API 자동 실행·복사 붙여넣기)에서는
  「script 패킷의 규칙을 참고하라」는 지시가 허공을 가리킨다.
  수정(revision) 요청서도 규칙 본문을 통째로 실어야 한다.
*/
describe('수정 요청서 자기완결성', () => {
  it('revision 규칙이 script 규칙과 같다 (두 메뉴 모두)', async () => {
    const mod = await import('./packets.js');
    const src = await import('node:fs/promises')
      .then((fs) => fs.readFile(new URL('./packets.ts', import.meta.url), 'utf8'));
    // 「~을 동일하게 적용한다」 식의 가리키기만 하는 문구가 남아 있으면 안 된다
    expect(src).not.toMatch(/revision: '- script 패킷의/);
    expect(mod).toBeTruthy();
  });
});

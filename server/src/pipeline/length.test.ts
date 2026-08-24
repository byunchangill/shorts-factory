import { describe, it, expect } from 'vitest';
import { lengthTolerance, sceneLengthError, finalLengthError } from './assemble.js';

/*
  `-shortest`가 어긋난 길이를 **가린다.** 짧은 쪽에 맞춰 조용히 잘라내므로 끝문장이
  통째로 날아가도 파일은 멀쩡히 나온다. 그래서 렌더 전에 재서 막는다.
*/
describe('lengthTolerance', () => {
  it('짧아지는 쪽은 조각을 쪼개도 안 헐거워진다 — 반올림은 짧아지지 않는다', () => {
    expect(lengthTolerance(12).under).toBe(lengthTolerance(1).under);
  });

  it('길어지는 쪽만 조각 수를 따라간다 — 조각마다 한 프레임씩 올려서 잘린다', () => {
    expect(lengthTolerance(12).over).toBeGreaterThan(lengthTolerance(1).over);
  });

  it('0을 줘도 조각 하나로 친다 — 오차가 0이 되면 멀쩡한 편이 막힌다', () => {
    expect(lengthTolerance(0)).toEqual(lengthTolerance(1));
  });

  it('짧아지는 쪽이 한 프레임보다 빡빡하다 — 여기가 헐거우면 잘림이 새어 나간다', () => {
    expect(lengthTolerance(30).under).toBeLessThan(1 / 30);
  });
});

describe('sceneLengthError', () => {
  it('프레임 경계 반올림은 통과시킨다 — 그건 고장이 아니다', () => {
    expect(sceneLengthError('s1', 5.03, 5, 1)).toBeNull();
  });

  it('🔴 반대로 0.03초라도 짧으면 막는다 — 반올림으로는 짧아질 수 없다', () => {
    expect(sceneLengthError('s1', 4.97, 5, 1)).not.toBeNull();
  });

  it('소재가 모자라 짧게 끝나면 막는다 — 제일 흔한 원인이다', () => {
    const err = sceneLengthError('s3', 2.1, 5.4, 3);
    expect(err).toContain('씬 s3');
    expect(err).toContain('쓸 장면을 더 고르거나');
  });

  it('사유에 두 길이를 다 적는다 — 화면만 봐서는 원인을 못 짚는다', () => {
    const err = sceneLengthError('s3', 2.1, 5.4, 3)!;
    expect(err).toContain('2.10초');
    expect(err).toContain('5.40초');
  });

  it('영상이 더 긴 경우도 막는다 — 방향만 다르지 같은 어긋남이다', () => {
    expect(sceneLengthError('s2', 6, 4, 1)).toContain('나레이션보다 깁니다');
  });

  it('한 프레임 길어진 것은 통과 — 실측상 반올림은 늘 이 방향이다', () => {
    expect(sceneLengthError('s1', 2.0667, 2.06, 1)).toBeNull();
  });

  it('컷을 쪼갠 만큼 길어지는 쪽만 더 봐준다', () => {
    expect(sceneLengthError('s1', 22.35, 22, 12)).toBeNull();
    expect(sceneLengthError('s1', 22.35, 22, 1)).not.toBeNull();
  });

  it('🔴 조각을 쪼개도 짧아지는 쪽은 안 봐준다 — 씬마다 조금씩 잘린 것이 쌓인다', () => {
    // 하네스가 씬마다 0.06초씩 잘린 것을 열 씬 흘려보내 0.6초가 됐다
    expect(sceneLengthError('s1', 2.0, 2.06, 12)).not.toBeNull();
  });
});

describe('finalLengthError', () => {
  it('셋이 같으면 통과 — 반올림 몫은 늘 길어지는 쪽이다', () => {
    expect(finalLengthError(22, 22.31, 22.01, 12)).toBeNull();
  });

  it('영상만 짧아도 막는다 — `-shortest`가 나레이션 끝을 잘라낸다', () => {
    expect(finalLengthError(22, 19, 22, 4)).toContain('영상 19.00초');
  });

  it('나레이션만 짧아도 막는다 — 마지막 화면이 무음으로 남는다', () => {
    expect(finalLengthError(22, 22, 19, 4)).toContain('나레이션 19.00초');
  });

  it('계획 길이를 같이 적는다 — 자막 시각이 그 기준이라 같이 밀린다', () => {
    expect(finalLengthError(22, 19, 22, 4)).toContain('계획 22.00초');
  });
});

import { describe, it, expect } from 'vitest';
import { stripFences, extractJson, splitByFileHeaders, parseResultFiles } from './extract.js';

describe('stripFences', () => {
  it('json 펜스 제거', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('언어 표기 없는 펜스도 제거', () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('펜스가 없으면 그대로', () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe('extractJson', () => {
  it('순수 JSON 파싱', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('펜스로 감싼 JSON', () => {
    expect(extractJson('```json\n{"scenes":[{"sceneId":"s01"}]}\n```')).toEqual({
      scenes: [{ sceneId: 's01' }],
    });
  });

  it('설명문이 앞뒤로 붙어도 추출', () => {
    const text = '요청하신 대본입니다.\n\n{"title":"테스트","scenes":[]}\n\n확인해 주세요.';
    expect(extractJson(text)).toEqual({ title: '테스트', scenes: [] });
  });

  it('문자열 안의 중괄호에 속지 않음', () => {
    const text = 'AI 답변: {"narration":"이건 {중괄호} 입니다","n":1} 끝';
    expect(extractJson(text)).toEqual({ narration: '이건 {중괄호} 입니다', n: 1 });
  });

  it('이스케이프된 따옴표 처리', () => {
    const text = '{"subtitle":"그는 \\"안녕\\"이라 했다"}';
    expect(extractJson(text)).toEqual({ subtitle: '그는 "안녕"이라 했다' });
  });

  it('중첩 객체', () => {
    const text = '설명\n{"a":{"b":{"c":[1,2,{"d":3}]}}}\n끝';
    expect(extractJson(text)).toEqual({ a: { b: { c: [1, 2, { d: 3 }] } } });
  });

  it('배열 최상위', () => {
    expect(extractJson('결과: [{"sceneId":"s01"}]')).toEqual([{ sceneId: 's01' }]);
  });

  it('JSON이 없으면 에러', () => {
    expect(() => extractJson('죄송합니다. 처리할 수 없습니다.')).toThrow();
  });

  it('잘린 JSON은 에러', () => {
    expect(() => extractJson('{"a":1, "b": {"c"')).toThrow(/완결/);
  });
});

describe('splitByFileHeaders', () => {
  it('단일 파일은 전체 반환', () => {
    expect(splitByFileHeaders('아무 내용', ['script.json'])).toEqual({ 'script.json': '아무 내용' });
  });

  it('여러 파일을 헤더로 분할', () => {
    const text = '### product.json\n{"name":"충전기"}\n\n### script.json\n{"scenes":[]}';
    const out = splitByFileHeaders(text, ['product.json', 'script.json']);
    expect(out['product.json']).toContain('충전기');
    expect(out['product.json']).not.toContain('scenes');
    expect(out['script.json']).toContain('scenes');
  });

  it('result/ 접두사 헤더도 인식', () => {
    const text = '## result/a.json\n{"a":1}\n## result/b.json\n{"b":2}';
    const out = splitByFileHeaders(text, ['a.json', 'b.json']);
    expect(out['a.json']).toContain('"a":1');
    expect(out['b.json']).toContain('"b":2');
  });
});

describe('parseResultFiles', () => {
  it('JSON 산출물 정규화', () => {
    const { files, errors } = parseResultFiles('```json\n{"name":"충전기"}\n```', [
      { file: 'product.json', schema: 'product' },
    ]);
    expect(errors).toEqual([]);
    expect(JSON.parse(files['product.json'])).toEqual({ name: '충전기' });
  });

  it('markdown 산출물은 텍스트 유지', () => {
    const { files } = parseResultFiles('## 제목 후보\n- 하나\n- 둘', [
      { file: 'upload-kit.md', schema: 'markdown' },
    ]);
    expect(files['upload-kit.md']).toContain('제목 후보');
  });

  it('파싱 실패는 에러로 수집', () => {
    const { files, errors } = parseResultFiles('JSON 아님', [
      { file: 'script.json', schema: 'script' },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('script.json');
    expect(files['script.json']).toBeUndefined();
  });
});

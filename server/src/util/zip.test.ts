import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { readZip, safeEntryPath, extractZip } from './zip.js';

/**
 * 고정 데이터는 파이썬 zipfile로 만든 진짜 ZIP이다 —
 * 우리 리더를 우리 라이터로 검사하면 둘 다 틀려도 통과한다.
 */
const NORMAL = Buffer.from(
  'UEsDBBQAAAgIANO9Cl3b59KDDwAAALQAAAAaAAAA7IOB7IS47Y6Y7J207KeAL+qwgOqyqS50eHQzttSxNDB4M3uC8dBhAABQSwMEFAAACAAA070KXf1Q3SILAAAACwAAAB0AAADsg4HshLjtjpjsnbTsp4Av7IKs7JaR7ZGcLnR4dFcyNXhENDB4SDgwUEsDBBQAAAAAANO9Cl05nPsGBAAAAAQAAAAPAAAAX19NQUNPU1gvLl9qdW5ranVua1BLAwQUAAAIAADTvQpdAAAAAAAAAAAAAAAACgAAAOu5iO2PtOuNlC9QSwECFAMUAAAICADTvQpd2+fSgw8AAAC0AAAAGgAAAAAAAAAAAAAAgAEAAAAA7IOB7IS47Y6Y7J207KeAL+qwgOqyqS50eHRQSwECFAMUAAAIAADTvQpd/VDdIgsAAAALAAAAHQAAAAAAAAAAAAAAgAFHAAAA7IOB7IS47Y6Y7J207KeAL+yCrOyWke2RnC50eHRQSwECFAMUAAAAAADTvQpdOZz7BgQAAAAEAAAADwAAAAAAAAAAAAAAgAGNAAAAX19NQUNPU1gvLl9qdW5rUEsBAhQDFAAACAAA070KXQAAAAAAAAAAAAAAAAoAAAAAAAAAAAAQAP1BvgAAAOu5iO2PtOuNlC9QSwUGAAAAAAQABAAIAQAA5gAAAAAA',
  'base64',
);
/** 한글 윈도우 탐색기가 만드는 CP949 파일명 (UTF-8 플래그 없음) */
const CP949 = Buffer.from(
  'UEsDBBQAAAAAANu9Cl3kyHApDQAAAA0AAAAKAAAAsKGw3celLnR4dGNwOTQ5LWNvbnRlbnRQSwECFAMUAAAAAADbvQpd5MhwKQ0AAAANAAAACgAAAAAAAAAAAAAAgAEAAAAAsKGw3celLnR4dFBLBQYAAAAAAQABADgAAAA1AAAAAAA=',
  'base64',
);
/** 상위 폴더로 빠져나가려는 항목 (zip slip) */
const SLIP = Buffer.from(
  'UEsDBBQAAAAAANO9Cl1+UwTZBQAAAAUAAAAOAAAALi4vLi4vZXZpbC50eHRwd25lZFBLAQIUAxQAAAAAANO9Cl1+UwTZBQAAAAUAAAAOAAAAAAAAAAAAAACAAQAAAAAuLi8uLi9ldmlsLnR4dFBLBQYAAAAAAQABADwAAAAxAAAAAAA=',
  'base64',
);

describe('readZip', () => {
  it('deflate와 저장(stored)을 모두 푼다', () => {
    const entries = readZip(NORMAL);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e.data.toString('utf8')]));
    expect(byName['상세페이지/가격.txt']).toBe('39,900원'.repeat(20)); // deflate
    expect(byName['상세페이지/사양표.txt']).toBe('W25xD40xH80'); // stored
  });

  it('폴더 항목은 결과에 넣지 않는다', () => {
    expect(readZip(NORMAL).some((e) => e.name.endsWith('/'))).toBe(false);
  });

  it('CP949 파일명을 한글로 되살린다', () => {
    // UTF-8로 읽으면 "°¡°Ý..." 같은 깨진 이름이 된다
    const entries = readZip(CP949);
    expect(entries[0].name).toBe('가격표.txt');
    expect(entries[0].data.toString('utf8')).toBe('cp949-content');
  });

  it('ZIP이 아니면 명확한 오류', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow('ZIP 형식이 아닙니다');
  });
});

describe('safeEntryPath', () => {
  it('상위 경로 탈출을 막는다', () => {
    expect(safeEntryPath('../../evil.txt')).toBeNull();
    expect(safeEntryPath('a/../../evil.txt')).toBeNull();
    // 백슬래시 구분자도 같이 봐야 한다 (옛 윈도우 압축 도구가 이렇게 만든다)
    expect(safeEntryPath('..\\..\\evil.txt')).toBeNull();
  });

  it('절대경로·드라이브 문자를 벗겨낸다', () => {
    expect(safeEntryPath('/etc/passwd')).toBe('etc/passwd');
    expect(safeEntryPath('C:\\Windows\\x.txt')).toBe('Windows/x.txt');
  });

  it('맥 메타 폴더와 숨김 파일은 버린다', () => {
    expect(safeEntryPath('__MACOSX/._a.png')).toBeNull();
    expect(safeEntryPath('.DS_Store')).toBeNull();
  });

  it('평범한 경로는 그대로', () => {
    expect(safeEntryPath('상세페이지/가격.txt')).toBe('상세페이지/가격.txt');
  });
});

describe('extractZip', () => {
  it('압축 안이 폴더 하나로 묶여 있으면 그 구조를 그대로 쓴다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-'));
    // fallback을 '상세페이지'로 줘도 폴더가 겹치면 안 된다
    const written = await extractZip(NORMAL, dir, '상세페이지');
    expect(written.sort()).toEqual(['상세페이지/가격.txt', '상세페이지/사양표.txt']);
    const body = await fsp.readFile(path.join(dir, '상세페이지/사양표.txt'), 'utf8');
    expect(body).toBe('W25xD40xH80');
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('낱개 파일만 들어 있으면 압축 이름으로 묶는다', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-flat-'));
    const written = await extractZip(CP949, dir, '자료묶음');
    expect(written).toEqual(['자료묶음/가격표.txt']);
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('zip slip 항목은 아무것도 쓰지 않는다', async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-slip-'));
    const dest = path.join(base, 'a', 'b');
    await fsp.mkdir(dest, { recursive: true });
    const written = await extractZip(SLIP, dest, 'x');
    expect(written).toEqual([]);
    expect(await fsp.readdir(base)).toEqual(['a']); // 바깥에 evil.txt가 생기지 않음
    await fsp.rm(base, { recursive: true, force: true });
  });
});

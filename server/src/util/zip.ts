import path from 'node:path';
import fsp from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/**
 * 최소 ZIP 리더.
 *
 * 사용자가 상세페이지 캡처를 압축해서 올리는 경우가 흔한데, 압축 파일을 그대로 두면
 * AI가 열 수 없다 (붙여넣기·API 방식에는 압축 해제 수단이 아예 없다).
 * 스크린샷 묶음 정도를 푸는 것이 목적이라 외부 의존성 없이 zlib만 쓴다.
 *
 * 지원: 저장(0)·deflate(8), UTF-8 및 CP949(한글 윈도우 기본) 파일명
 * 미지원: ZIP64, 암호화 — 만나면 명확한 오류로 끊는다 (조용히 일부만 푸는 것이 더 나쁘다)
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;

/** 한 번에 풀 수 있는 상한 — 잘못된 파일로 디스크를 채우지 않도록 */
const MAX_ENTRIES = 500;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export interface ZipEntry {
  name: string; // 압축 안의 경로 (구분자는 /)
  data: Buffer;
}

/** 파일명 디코딩 — UTF-8 플래그가 없으면 한글 윈도우가 만든 CP949로 본다 */
function decodeName(raw: Buffer, utf8Flag: boolean): string {
  if (utf8Flag) return raw.toString('utf8');
  try {
    return new TextDecoder('euc-kr').decode(raw);
  } catch {
    return raw.toString('utf8'); // ICU가 없는 빌드 — 깨져도 진행은 시킨다
  }
}

/** 중앙 디렉터리 끝(EOCD) 위치 — 주석이 붙을 수 있어 뒤에서부터 찾는다 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP 형식이 아닙니다 (중앙 디렉터리를 찾지 못함)');
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_EOCD_LOCATOR_SIG) {
    throw new Error('ZIP64 형식은 지원하지 않습니다 — 파일을 나눠서 올려주세요');
  }

  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error(`압축 안 파일이 너무 많습니다 (${count}개, 최대 ${MAX_ENTRIES}개)`);
  let ptr = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== CD_SIG) throw new Error('중앙 디렉터리가 손상되었습니다');
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = decodeName(buf.subarray(ptr + 46, ptr + 46 + nameLen), (flags & 0x800) !== 0);
    ptr += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error('암호가 걸린 압축 파일은 풀 수 없습니다');
    if (name.endsWith('/')) continue; // 디렉터리 항목

    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw new Error('압축 해제 용량이 너무 큽니다 (500MB 초과)');

    // 지역 헤더의 가변 길이 필드를 건너뛰어야 실제 데이터 위치가 나온다
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`항목이 손상되었습니다: ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`지원하지 않는 압축 방식입니다 (method ${method}): ${name}`);

    entries.push({ name: name.replace(/\\/g, '/'), data });
  }
  return entries;
}

/**
 * 압축 안 파일명을 대상 폴더 밖으로 나가지 못하게 정리한다.
 * `../`나 절대경로가 든 항목(zip slip)은 버린다 — 압축 파일 하나로
 * 작업공간 바깥을 덮어쓸 수 있으면 안 된다.
 */
export function safeEntryPath(name: string): string | null {
  // 백슬래시를 먼저 통일한다 — `..\..\evil` 형태(옛 윈도우 압축 도구)가
  // 슬래시만 검사하면 한 덩어리로 보여 탈출 검사를 그냥 통과한다
  const clean = name.replace(/\\/g, '/').replace(/^([a-zA-Z]:)?\/+/, '');
  const parts = clean.split('/').filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  if (!parts.length) return null;
  // 맥에서 압축하면 따라오는 메타 폴더·숨김 파일은 자료가 아니다
  if (parts[0] === '__MACOSX' || parts.some((p) => p.startsWith('.'))) return null;
  return parts.join('/');
}

/**
 * 압축을 rootDir 아래에 푼다.
 *
 * 압축 안이 이미 폴더 하나로 묶여 있으면(대부분의 압축이 그렇다) 그 구조를 그대로 쓴다 —
 * 여기서 또 폴더를 만들면 `상세페이지/상세페이지/가격.txt`처럼 겹친다.
 * 반대로 파일이 낱개로 흩어져 있으면 `fallbackDir`로 묶어 다른 자료와 섞이지 않게 한다.
 *
 * @returns 실제로 쓴 파일의 rootDir 기준 상대경로
 */
export async function extractZip(
  buf: Buffer,
  rootDir: string,
  fallbackDir: string,
): Promise<string[]> {
  const entries = readZip(buf)
    .map((e) => ({ ...e, rel: safeEntryPath(e.name) }))
    .filter((e): e is ZipEntry & { rel: string } => !!e.rel);

  const tops = new Set(entries.map((e) => e.rel.split('/')[0]));
  const alreadyGrouped = entries.every((e) => e.rel.includes('/')) && tops.size === 1;
  const prefix = alreadyGrouped ? '' : fallbackDir;

  const written: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.rel}` : entry.rel;
    const out = path.join(rootDir, rel);
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, entry.data);
    written.push(rel);
  }
  return written;
}

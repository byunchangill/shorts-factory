import path from 'node:path';
import fsp from 'node:fs/promises';
import { RESULT_SCHEMAS } from '@shared/types';
import type { AiProvider, PacketMode } from '@shared/constants';
import { loadSettings } from '../store/workspace.js';
import { readPacket, writePacket, resolvePacketDir } from '../claude/packets.js';
import { ingestPacketResult } from '../claude/resultWatcher.js';
import { runProvider } from './providers.js';
import { parseResultFiles } from './extract.js';
import { broadcast } from '../sse.js';

/** 요청서 폴더의 request.md 원문 — 어떤 AI에 넣어도 되는 자기완결 프롬프트 */
export async function readRequestPrompt(packetId: string): Promise<string> {
  const dir = resolvePacketDir(packetId);
  if (!dir) throw new Error(`요청서 없음: ${packetId}`);
  return fsp.readFile(path.join(dir, 'request.md'), 'utf8');
}

/** 산출물을 result/에 쓰고 .done 마커 생성 → resultWatcher가 감지해 검증·반영한다 */
async function writeResultFiles(
  packetId: string,
  files: Record<string, string>,
  mode: PacketMode,
  provider?: AiProvider,
): Promise<void> {
  const dir = resolvePacketDir(packetId);
  if (!dir) throw new Error(`요청서 없음: ${packetId}`);
  const resultDir = path.join(dir, 'result');
  await fsp.mkdir(resultDir, { recursive: true });

  for (const [file, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(resultDir, file), content, 'utf8');
  }

  const packet = await readPacket(packetId);
  if (packet) {
    packet.executionMode = mode;
    packet.provider = provider;
    await writePacket(packet);
  }

  // .done은 반드시 마지막 — 외부 도구(Claude Code)와 동일한 완료 신호를 남긴다
  await fsp.writeFile(path.join(resultDir, '.done'), '', 'utf8');

  // 서버가 직접 쓴 결과는 워처를 기다릴 필요가 없다. 즉시 반영해
  // 파일 감지 타이밍에 의존하지 않게 한다 (워처가 나중에 같은 패킷을 봐도 무시된다).
  await ingestPacketResult(packetId);
}

/** 스키마 위반을 미리 잡아 재프롬프트에 쓸 오류 메시지를 만든다 */
function validate(files: Record<string, string>, resultSpec: Array<{ file: string; schema: string }>): string[] {
  const errors: string[] = [];
  for (const spec of resultSpec) {
    if (spec.schema === 'markdown') continue;
    const raw = files[spec.file];
    if (raw === undefined) {
      errors.push(`${spec.file} 누락`);
      continue;
    }
    const schema = RESULT_SCHEMAS[spec.schema];
    if (!schema) continue;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      errors.push(
        `${spec.file}: ` +
          parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')} — ${i.message}`).join('; '),
      );
    }
  }
  return errors;
}

/**
 * ② API 자동 실행: 서버가 LLM을 직접 호출해 산출물을 만든다.
 * 스키마가 어긋나면 오류 목록을 붙여 1회 재요청한다.
 */
export async function runPacketWithApi(packetId: string, provider: AiProvider): Promise<void> {
  const packet = await readPacket(packetId);
  if (!packet) throw new Error(`요청서 없음: ${packetId}`);
  if (packet.status !== 'waiting') throw new Error('대기 상태의 요청서만 실행할 수 있습니다');

  const settings = await loadSettings();
  const requestMd = await readRequestPrompt(packetId);
  const basePrompt = `${requestMd}

---
[출력 형식 지시]
파일을 만들 수 없는 환경이므로, 산출물 내용을 이 대화의 응답 본문에 그대로 출력하세요.
${packet.resultSpec.map((s) => `- \`${s.file}\`: ${s.schema === 'markdown' ? '마크다운 본문' : '유효한 JSON'}`).join('\n')}
${packet.resultSpec.length > 1 ? '각 산출물 앞에 `### 파일명` 헤더를 붙여 구분하세요.' : ''}
JSON은 주석 없이 파싱 가능한 형태여야 하며, 설명 문장은 최소화하세요.`;

  broadcast('packet.running', { packetId, provider });

  let prompt = basePrompt;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await runProvider(provider, { prompt, settings });
    const { files, errors: parseErrors } = parseResultFiles(response, packet.resultSpec);
    const schemaErrors = parseErrors.length ? parseErrors : validate(files, packet.resultSpec);

    const fresh = await readPacket(packetId);
    if (fresh) {
      fresh.attempts = attempt;
      await writePacket(fresh);
    }

    if (schemaErrors.length === 0) {
      await writeResultFiles(packetId, files, 'api', provider);
      return;
    }

    lastErrors = schemaErrors;
    if (attempt === 1) {
      prompt = `${basePrompt}

---
[이전 응답의 오류 — 아래를 고쳐 다시 출력하세요]
${schemaErrors.map((e) => `- ${e}`).join('\n')}`;
      broadcast('packet.retry', { packetId, provider, errors: schemaErrors });
    } else if (Object.keys(files).length > 0) {
      // 두 번째도 실패하면 받은 내용을 그대로 저장해 UI에서 오류와 함께 확인하게 한다
      await writeResultFiles(packetId, files, 'api', provider);
      return;
    }
  }

  throw new Error(`AI 응답이 형식에 맞지 않습니다: ${lastErrors.join(' / ')}`);
}

/**
 * ③ 수동 붙여넣기: 사용자가 아무 AI 챗에서 받은 응답을 그대로 넣는다.
 * 파일별로 따로 넣었으면 그대로 쓰고, 통짜 텍스트면 파일 헤더로 분리한다.
 */
export async function applyPastedResult(
  packetId: string,
  input: { raw?: string; files?: Record<string, string> },
): Promise<{ errors: string[] }> {
  const packet = await readPacket(packetId);
  if (!packet) throw new Error(`요청서 없음: ${packetId}`);
  if (packet.status !== 'waiting') throw new Error('대기 상태의 요청서만 반영할 수 있습니다');

  let files: Record<string, string>;
  let errors: string[];

  if (input.files && Object.keys(input.files).length > 0) {
    const merged: Record<string, string> = {};
    const collected: string[] = [];
    for (const spec of packet.resultSpec) {
      const text = input.files[spec.file];
      if (text === undefined || !text.trim()) {
        collected.push(`${spec.file} 내용이 비어 있습니다`);
        continue;
      }
      const one = parseResultFiles(text, [spec]);
      Object.assign(merged, one.files);
      collected.push(...one.errors);
    }
    files = merged;
    errors = collected;
  } else {
    const parsed = parseResultFiles(input.raw ?? '', packet.resultSpec);
    files = parsed.files;
    errors = parsed.errors;
  }

  if (Object.keys(files).length === 0) {
    return { errors: errors.length ? errors : ['붙여넣은 내용에서 산출물을 찾지 못했습니다'] };
  }

  await writeResultFiles(packetId, files, 'manual');
  return { errors };
}

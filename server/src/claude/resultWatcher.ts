import path from 'node:path';
import fsp from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { RESULT_SCHEMAS, ScriptSchema, ProductSchema, FormatSchema, type Script } from '@shared/types';
import { packetMenu, scriptRuleErrors } from './scriptRules.js';
import { WORKSPACE_ROOT } from '../store/workspace.js';
import { readJson, exists } from '../util/fsx.js';
import { listAllPackets, readPacket, writePacket, resolvePacketDir } from './packets.js';
import { resolveJob, writeScriptVersion, logJobEvent, mutateJob } from '../store/jobs.js';
import { writeProduct } from '../store/projects.js';
import { saveFormat } from '../store/formats.js';
import { broadcast } from '../sse.js';

let watcher: FSWatcher | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

/** 워처가 이벤트를 놓쳐도 결과가 반드시 반영되도록 하는 안전망 주기 */
const SWEEP_INTERVAL_MS = 5_000;

/** 워처가 들어갈 필요가 없는 무거운 폴더 — 영상·프레임·음성은 감시 대상이 아니다 */
const HEAVY_DIRS = new Set([
  'sources', 'output', 'clips', 'frames', 'voice', 'subtitles', 'cache', 'product',
]);

/**
 * 감시 제외 판정. **작업공간 기준 상대경로**를 받는다 —
 * 절대경로로 판정하면 작업공간을 `.../voice/` 같은 폴더에 둔 사용자의 감시가 통째로 꺼진다.
 *
 * 워처가 볼 것은 `requests/{packetId}/result/.done` 하나뿐인데, 기본 설정은
 * 작업공간 전체를 훑는다. 그래서 두 가지가 걸린다:
 *
 * 1. `writeJsonAtomic`의 임시 파일(`job.json.tmp-…`)까지 감시 대상이 된다.
 *    chokidar의 awaitWriteFinish가 이 파일을 붙잡고 있는 동안 rename을 하면
 *    윈도우가 EPERM으로 거절한다 (조립 중 job.json 갱신이 실제로 이걸로 실패했다).
 * 2. 영상·프레임 폴더까지 감시하면 파일 수가 폭증해 감시 비용만 커진다.
 */
export function isWatchIgnored(relPath: string): boolean {
  if (/\.tmp-[\d-]+$/.test(relPath)) return true;
  return relPath.split(/[\\/]/).some((seg) => HEAVY_DIRS.has(seg));
}

/**
 * requests/{packetId}/result/.done 파일 생성을 감지 → 결과 검증 → 반영.
 * Claude Code는 result/에만 쓰고, 상태 파일(packet.json/job.json)은 서버만 쓴다.
 */
export function startResultWatcher(): void {
  watcher = chokidar.watch(WORKSPACE_ROOT, {
    ignoreInitial: true,
    depth: 10,
    ignored: (p) => isWatchIgnored(path.relative(WORKSPACE_ROOT, p)),
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });
  watcher.on('add', (filePath) => {
    // requests/{packetId}/result/.done 만 처리
    if (path.basename(filePath) === '.done' && path.basename(path.dirname(filePath)) === 'result') {
      const packetDir = path.dirname(path.dirname(filePath));
      void ingestPacketResult(path.basename(packetDir)).catch((e) => {
        console.error('[resultWatcher] ingest 실패:', e);
      });
    }
  });
}

export async function stopResultWatcher(): Promise<void> {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  await watcher?.close();
  watcher = null;
}

/**
 * 대기 중인데 .done이 이미 있는 패킷을 처리한다.
 * - 부팅 시 1회: 서버가 꺼진 사이 도착한 결과 수습
 * - 이후 주기 실행: 파일 워처가 이벤트를 놓쳐도 결과가 결국 반영되게 하는 안전망
 *   (대기 상태 패킷만 훑으므로 비용이 거의 없다)
 */
export async function catchUpPendingResults(): Promise<void> {
  const packets = await listAllPackets();
  for (const p of packets) {
    if (p.status !== 'waiting') continue;
    const dir = resolvePacketDir(p.id);
    if (dir && (await exists(path.join(dir, 'result', '.done')))) {
      await ingestPacketResult(p.id);
    }
  }
}

export function startResultSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void catchUpPendingResults().catch((e) => {
      console.error('[resultSweep]', e instanceof Error ? e.message : e);
    });
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export async function ingestPacketResult(packetId: string): Promise<void> {
  const packet = await readPacket(packetId);
  if (!packet || packet.status !== 'waiting') return;
  const dir = resolvePacketDir(packetId);
  if (!dir) return;

  const errors: string[] = [];
  for (const spec of packet.resultSpec) {
    const filePath = path.join(dir, 'result', spec.file);
    if (!(await exists(filePath))) {
      errors.push(`누락: result/${spec.file}`);
      continue;
    }
    if (spec.schema === 'markdown') continue;
    const raw = await readJson<unknown>(filePath);
    if (raw === null) {
      errors.push(`JSON 파싱 실패: result/${spec.file}`);
      continue;
    }
    const schema = RESULT_SCHEMAS[spec.schema];
    if (schema) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        errors.push(
          `스키마 불일치 result/${spec.file}: ` +
            parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      } else if (spec.schema === 'script') {
        // 스키마는 맞지만 메뉴 규칙을 어긴 경우 (제품정보리뷰의 단점 씬 등)
        errors.push(...scriptRuleErrors(parsed.data as Script, packetMenu(packet)));
      }
    }
  }

  packet.status = 'received';
  packet.receivedAt = new Date().toISOString();
  packet.validationErrors = errors;
  await writePacket(packet);
  broadcast('packet.received', { packetId, kind: packet.kind, errors });

  if (errors.length > 0) return; // 오류는 UI에 보여주고 자동 반영은 하지 않음

  // 자동 반영 (수락 전에도 데이터는 미리 반영하고, 상태 전진은 수락 시점에)
  await applyResult(packetId);
}

/** 검증 통과한 결과를 실제 데이터로 반영 */
async function applyResult(packetId: string): Promise<void> {
  const packet = await readPacket(packetId);
  const dir = resolvePacketDir(packetId);
  if (!packet || !dir) return;

  const resultPath = (f: string) => path.join(dir, 'result', f);

  if (packet.kind === 'product-extract' && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    const raw = await readJson<unknown>(resultPath('product.json'));
    const product = ProductSchema.parse(raw);
    await writeProduct(ref.menu, ref.projectId, product);
    await logJobEvent(ref, { type: 'product.extracted', packetId });
  }

  if ((packet.kind === 'script' || packet.kind === 'revision') && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    const raw = await readJson<unknown>(resultPath('script.json'));
    const script = ScriptSchema.omit({ version: true }).parse(
      typeof raw === 'object' && raw !== null ? { ...(raw as object) } : raw,
    );
    const version = await writeScriptVersion(ref, script);
    await logJobEvent(ref, { type: 'script.received', packetId, version });
  }

  if (packet.kind === 'format-create') {
    const raw = await readJson<unknown>(resultPath('format.json'));
    const parsed = FormatSchema.partial({ id: true, createdAt: true }).parse(raw);
    const saved = await saveFormat({ ...parsed, id: packet.formatId ?? undefined });
    broadcast('format.saved', { formatId: saved.id });
  }

  if (packet.kind === 'scene-images' && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    // scenes.json + 이미지 파일은 result/에 그대로 두고, 잡 이벤트만 기록.
    // 조립 시 imageRef는 requests/{pid}/result/ 경로를 그대로 참조한다.
    await logJobEvent(ref, { type: 'scenes.received', packetId });
  }

  if (packet.kind === 'upload-kit' && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    const src = resultPath('upload-kit.md');
    // dir = .../jobs/{jobId}/requests/{packetId} → 잡 루트는 두 단계 위
    const jobDir = path.dirname(path.dirname(dir));
    await fsp.copyFile(src, path.join(jobDir, 'output', 'upload-kit.md'));
    await mutateJob(ref, (j) => {
      j.output.uploadKitReady = true;
    });
    await logJobEvent(ref, { type: 'uploadkit.received', packetId });
  }
}

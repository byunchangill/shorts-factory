import path from 'node:path';
import fsp from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import { RESULT_SCHEMAS, ScriptSchema, ProductSchema, FormatSchema } from '@shared/types';
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

/**
 * requests/{packetId}/result/.done 파일 생성을 감지 → 결과 검증 → 반영.
 * Claude Code는 result/에만 쓰고, 상태 파일(packet.json/job.json)은 서버만 쓴다.
 */
export function startResultWatcher(): void {
  watcher = chokidar.watch(WORKSPACE_ROOT, {
    ignoreInitial: true,
    depth: 10,
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

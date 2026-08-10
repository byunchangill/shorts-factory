import { Router } from 'express';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import { PACKET_KINDS, AI_PROVIDERS } from '@shared/constants';
import * as packets from '../claude/packets.js';
import { resolveJob, transition, readJob } from '../store/jobs.js';
import { getFormat } from '../store/formats.js';
import { getProject } from '../store/projects.js';
import { availableProviders } from '../ai/providers.js';
import { runPacketWithApi, applyPastedResult } from '../ai/packetRunner.js';
import { runPacketQuality } from '../ai/qualityRunner.js';
import { broadcast } from '../sse.js';

const router = Router();

/** UI가 실행 방식(API 자동)의 선택 가능 여부를 판단하는 데 사용 */
router.get('/ai/providers', async (_req, res) => {
  res.json(await availableProviders());
});

router.get('/packets', async (_req, res) => {
  res.json(await packets.listAllPackets());
});

router.get('/packets/:pkid', async (req, res) => {
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  const dir = packets.resolvePacketDir(req.params.pkid)!;
  let requestMd = '';
  try {
    requestMd = await fsp.readFile(path.join(dir, 'request.md'), 'utf8');
  } catch { /* 없으면 빈 값 */ }
  res.json({ ...packet, requestMd, commands: packets.packetCommands(packet) });
});

router.get('/packets/:pkid/result', async (req, res) => {
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  const dir = packets.resolvePacketDir(req.params.pkid)!;
  const out: Record<string, unknown> = {};
  for (const spec of packet.resultSpec) {
    try {
      const raw = await fsp.readFile(path.join(dir, 'result', spec.file), 'utf8');
      out[spec.file] = spec.schema === 'markdown' ? raw : JSON.parse(raw);
    } catch { /* 파일 없음 */ }
  }
  res.json(out);
});

/** 잡에 요청서 발행 */
router.post('/jobs/:jid/packets', async (req, res) => {
  const body = z.object({
    kind: z.enum(PACKET_KINDS),
    revisionNote: z.string().optional(),
    previousPacketId: z.string().optional(),
  }).parse(req.body);
  const ref = resolveJob(req.params.jid);
  if (!ref) return res.status(404).json({ error: '잡 없음' });

  // menu-b 대본 요청서에는 포맷 정보를 포함
  let formatId: string | undefined;
  if (ref.menu === 'menu-b') {
    const project = await getProject(ref.menu, ref.projectId);
    formatId = project?.formatId;
  }

  const packet = await packets.createPacket({
    kind: body.kind,
    jobRef: ref,
    formatId,
    revisionNote: body.revisionNote,
    previousPacketId: body.previousPacketId,
  });

  // 대본 요청서 발행 시 잡 상태를 scripting으로
  const job = await readJob(ref);
  if (job && (body.kind === 'script' || body.kind === 'revision')) {
    if (job.state === 'cleaning' || job.state === 'format_selected' || job.state === 'script_approved') {
      await transition(ref, 'scripting', 'server');
    }
  }
  res.status(201).json({ ...packet, commands: packets.packetCommands(packet) });
});

/** 포맷 생성 요청서 (잡 없이 발행) */
router.post('/formats/packets', async (req, res) => {
  const body = z.object({
    wizardAnswers: z.record(z.string()),
    formatId: z.string().optional(), // 기존 포맷 개선 시
  }).parse(req.body);
  if (body.formatId && !(await getFormat(body.formatId))) {
    return res.status(404).json({ error: '포맷 없음' });
  }
  const packet = await packets.createPacket({
    kind: 'format-create',
    formatId: body.formatId,
    wizardAnswers: body.wizardAnswers,
  });
  res.status(201).json({ ...packet, commands: packets.packetCommands(packet) });
});

/**
 * ② API 자동 실행 — 서버가 LLM을 호출해 산출물을 만든다 (비동기, 결과는 SSE).
 * mode=fast: 1회 호출 / mode=quality: 리서치 → 대본 → 검수 → 재작성 다단계
 */
router.post('/packets/:pkid/run', async (req, res) => {
  const body = z.object({
    provider: z.enum(AI_PROVIDERS),
    mode: z.enum(['fast', 'quality']).default('fast'),
  }).parse(req.body);
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  if (packet.status !== 'waiting') return res.status(400).json({ error: '대기 상태가 아님' });

  res.json({ started: true, mode: body.mode });
  try {
    if (body.mode === 'quality') {
      await runPacketQuality(req.params.pkid, body.provider);
    } else {
      await runPacketWithApi(req.params.pkid, body.provider);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    broadcast('packet.failed', { packetId: req.params.pkid, error: msg });
  }
});

/** ③ 수동 붙여넣기 — 아무 AI 챗에서 받은 응답을 반영 */
router.post('/packets/:pkid/paste', async (req, res) => {
  const body = z.object({
    raw: z.string().optional(),
    files: z.record(z.string()).optional(),
  }).parse(req.body);
  const result = await applyPastedResult(req.params.pkid, body);
  res.json(result);
});

router.post('/packets/:pkid/accept', async (req, res) => {
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  if (packet.status !== 'received') return res.status(400).json({ error: '수신 상태가 아님' });
  packet.status = 'accepted';
  packet.decidedAt = new Date().toISOString();
  await packets.writePacket(packet);
  res.json(packet);
});

router.post('/packets/:pkid/reject', async (req, res) => {
  const body = z.object({ note: z.string().min(1) }).parse(req.body);
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  if (packet.status !== 'received') return res.status(400).json({ error: '수신 상태가 아님' });
  packet.status = 'rejected';
  packet.rejectNote = body.note;
  packet.decidedAt = new Date().toISOString();
  await packets.writePacket(packet);

  // 대본류는 자동으로 revision 요청서 발행
  let revision = null;
  if ((packet.kind === 'script' || packet.kind === 'revision') && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (ref) {
      revision = await packets.createPacket({
        kind: 'revision',
        jobRef: ref,
        revisionNote: body.note,
        previousPacketId: packet.id,
      });
    }
  }
  res.json({ packet, revision });
});

export default router;

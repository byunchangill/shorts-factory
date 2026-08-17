import { asyncRouter } from '../util/asyncRouter.js';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import { PACKET_KINDS, AI_PROVIDERS } from '@shared/constants';
import * as packets from '../claude/packets.js';
import { resolveJob, transition, readJob } from '../store/jobs.js';
import { getFormat } from '../store/formats.js';
import { getProject, listProductFiles } from '../store/projects.js';
import { availableProviders } from '../ai/providers.js';
import { runPacketWithApi, applyPastedResult } from '../ai/packetRunner.js';
import { runPacketQuality } from '../ai/qualityRunner.js';
import { runPacketWithCli, claudeCliAvailable } from '../claude/cliRunner.js';
import { broadcast } from '../sse.js';

const router = asyncRouter();

/** UI가 실행 방식(API 자동)의 선택 가능 여부를 판단하는 데 사용 */
router.get('/ai/providers', async (_req, res) => {
  res.json(await availableProviders());
});

/** 「지금 실행」(구독 사용량)을 쓸 수 있는지 — Claude Code CLI가 자리에 있는가 */
router.get('/ai/cli', async (_req, res) => {
  res.json({ available: await claudeCliAvailable() });
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

  // 제품정보 추출은 첨부 자료를 읽는 작업이다. 자료가 없으면 AI가 할 수 있는 일이
  // 지어내는 것뿐이라, 아예 발행하지 않는다 (검증 규칙 1번이 "지어내지 않는다"이다)
  if (body.kind === 'product-extract') {
    const files = await listProductFiles(ref);
    if (!files.length) {
      return res.status(400).json({
        error:
          '첨부된 제품 자료가 없습니다. 이 영상 작업 화면의 "제품자료"에서 ' +
          '쿠팡 상세페이지 캡처나 텍스트를 먼저 올리세요 — 자료 없이 발행하면 ' +
          'AI가 제품 정보를 지어낼 수밖에 없습니다.',
      });
    }
  }

  // menu-b 대본 요청서에는 포맷 정보를 포함
  let formatId: string | undefined;
  if (ref.menu === 'menu-b') {
    const project = await getProject(ref.menu, ref.projectId);
    formatId = project?.formatId;
  }

  // 같은 종류로 대기 중인 요청서는 치운다 — 다시 발행할 때마다 쌓이면
  // 어느 것을 실행해야 하는지 알 수 없다 (재발행 = 최신 소재로 갱신한다는 뜻).
  // 치운 번호는 다시 쓰인다. 결과가 온 요청서는 남으므로 그 번호는 풀리지 않고,
  // revision의 previousPacketId가 엉뚱한 요청서를 가리킬 일도 없다
  const discarded = await packets.discardPendingPackets(ref.jobId, body.kind);

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
  res.status(201).json({ ...packet, commands: packets.packetCommands(packet), discarded });
});

/** 요청서 취소 — 대기 중인 것만. 결과가 온 요청서는 대본의 출처 기록이라 남긴다 */
router.delete('/packets/:pkid', async (req, res) => {
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  if (packet.status !== 'waiting' && packet.status !== 'draft') {
    return res.status(400).json({ error: '결과가 도착한 요청서는 취소할 수 없습니다' });
  }
  await packets.deletePacket(req.params.pkid);
  res.json({ ok: true });
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

/**
 * ②-2 Claude Code CLI 직접 실행 — 구독(Pro/Max) 사용량으로 돈다.
 *
 * 명령을 복사해 터미널에 붙여넣던 단계를 없앤다. 결과는 여기서 읽지 않는다 —
 * CLI가 `result/.done`을 만들면 기존 파일 감시가 잡아 검증·반영까지 같은 길로 간다.
 */
router.post('/packets/:pkid/run-cli', async (req, res) => {
  const body = z.object({ mode: z.enum(['fast', 'quality']).default('fast') }).parse(req.body ?? {});
  const packet = await packets.readPacket(req.params.pkid);
  if (!packet) return res.status(404).json({ error: '패킷 없음' });
  if (packet.status !== 'waiting') return res.status(400).json({ error: '대기 상태가 아님' });
  if (!(await claudeCliAvailable())) {
    return res.status(400).json({
      error: 'Claude Code CLI를 찾지 못했습니다 — 설치 후 서버를 다시 시작하세요',
    });
  }

  res.json({ started: true, mode: body.mode }); // 즉시 응답, 진행은 SSE
  // 백그라운드 작업에는 반드시 catch — 없으면 로컬 서버가 통째로 죽는다
  void runPacketWithCli(packet, body.mode, (line) =>
    broadcast('packet.progress', { packetId: packet.id, line }))
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      broadcast('packet.failed', { packetId: packet.id, error: msg });
    });
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

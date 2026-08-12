/**
 * 샘플 데이터 심기.
 *
 * `workspace/`는 깃에 올라가지 않으므로 새 PC에서 앱을 켜면 화면이 전부 비어 있다.
 * 볼 것이 없으면 테스트도 안 되므로, `samples/`의 실제 영상·나레이션으로
 * 프로젝트 하나를 만들어 둔다. 인터넷도 API 키도 필요 없다.
 *
 * 기본은 **영상 분석 단계까지만** 만든다 — 그 뒤 존 편집·대본·컷 선택·음성·조립은
 * 사용자가 직접 밟아야 파이프라인을 처음부터 끝까지 시험할 수 있다.
 * 화면만 빠르게 채워보고 싶으면 --full로 음성 단계까지 미리 채운다.
 *
 * 실행: npm run seed            (분석 단계까지 · 이미 있으면 건드리지 않음)
 *       npm run seed -- --full  (대본·음성까지 미리 채움)
 *       npm run seed -- --force (지우고 다시 만듦)
 *
 * 도구가 없으면 없는 만큼만 건너뛴다 — ffmpeg 없이도 프로젝트·잡까지는 만들어져
 * 화면 대부분을 볼 수 있다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseSrt } from './srt.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SAMPLE_DIR = path.join(REPO_ROOT, 'samples', 'kitchen-shelf');
const API = 'http://127.0.0.1:4310/api';
const FORCE = process.argv.includes('--force');
/** 대본·음성까지 미리 채울지 — 기본은 분석 단계에서 멈춰 사용자가 직접 밟게 한다 */
const FULL = process.argv.includes('--full');

const CATEGORY = '생활용품';
const MENU = 'menu-a';

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const ok = (s: string) => console.log(`  ${C.green('✔')} ${s}`);
const skip = (s: string) => console.log(`  ${C.yellow('⊘')} ${C.dim(s)}`);

// ── HTTP ──────────────────────────────────────────────────────────

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}
const get = <T>(u: string) => req<T>('GET', u);
const post = <T>(u: string, b?: unknown) => req<T>('POST', u, b);
const del = <T>(u: string) => req<T>('DELETE', u);

async function waitFor<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v !== null && v !== undefined) return v;
    } catch { /* 아직 준비 안 됨 */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`대기 시간 초과: ${what}`);
}

// ── 자막(SRT) → 씬 ────────────────────────────────────────────────

/**
 * 자막을 화면에 맞게 줄인 문구.
 * 나레이션을 그대로 쓰면 화면에서 잘리므로 앞 문장만 남긴다.
 */
function shortSubtitle(text: string): string {
  const first = text.split(/(?<=[.?!])\s/)[0] ?? text;
  return first.length <= 18 ? first : `${first.slice(0, 17)}…`;
}

// ── 서버 ──────────────────────────────────────────────────────────

let spawned: ChildProcess | null = null;

async function ensureServer(): Promise<'attached' | 'spawned'> {
  const alive = await fetch(`${API}/settings`).then((r) => r.ok).catch(() => false);
  if (alive) return 'attached';

  spawned = spawn(process.execPath, [TSX_BIN, 'src/index.ts'], {
    cwd: path.join(REPO_ROOT, 'server'),
    stdio: 'ignore',
    detached: true,
  });
  await waitFor('API 응답', async () => {
    const r = await fetch(`${API}/settings`).catch(() => null);
    return r?.ok ? true : null;
  }, 60_000);
  return 'spawned';
}

function stopServer(): void {
  if (!spawned?.pid) return;
  try { process.kill(-spawned.pid, 'SIGTERM'); } catch { /* 이미 죽음 */ }
  spawned = null;
}

// ── 본체 ──────────────────────────────────────────────────────────

interface JobView { id: string; state: string; sources: Array<{ id: string; origin: string }> }
interface ClipView { id: string; probe?: { duration: number }; frames: Array<{ t: number }> }

async function main(): Promise<void> {
  console.log(C.bold('\n샘플 데이터 심기\n'));

  const cues = parseSrt(await fsp.readFile(path.join(SAMPLE_DIR, 'narration.srt'), 'utf8'));
  if (!cues.length) throw new Error('narration.srt에서 자막을 읽지 못했습니다');

  // --force는 서버를 띄우기 전에 지운다 — 실행 중인 서버가 있으면 잡 인덱스에
  // 지워진 잡이 남지만(다음 재시작에 정리된다) 화면과 데이터는 깨끗하다
  const projectDir = path.join(REPO_ROOT, 'workspace', MENU, CATEGORY);
  const existed = await fsp.stat(projectDir).then(() => true).catch(() => false);
  if (existed && !FORCE) {
    console.log(`이미 있습니다: ${MENU}/${CATEGORY}`);
    console.log(C.dim('다시 만들려면: npm run seed -- --force\n'));
    return;
  }
  if (existed) {
    await fsp.rm(projectDir, { recursive: true, force: true });
    ok('기존 샘플 카테고리 삭제 (--force)');
  }

  const mode = await ensureServer();
  ok(mode === 'attached' ? '실행 중인 서버에 연결' : '서버를 직접 띄움 (끝나면 종료)');

  // 도구 상태에 따라 어디까지 할 수 있는지 먼저 정한다.
  // refresh=1로 다시 확인한다 — seed는 서버가 막 뜬 직후에 물어보는데, 그때가
  // 부팅이 붐벼 프로세스 실행이 한 번 실패한 결과가 캐시에 남아 있을 확률이 가장 높다
  // (실제로 ffmpeg이 멀쩡한데 "없음"으로 읽고 분석을 건너뛰었다)
  const doctor = await get<{ tools: Array<{ name: string; available: boolean }> }>(
    '/system/doctor?refresh=1');
  const has = (n: string) => doctor.tools.find((t) => t.name === n)?.available ?? false;
  const canMedia = has('ffmpeg') && has('ffprobe');
  if (!canMedia) skip('ffmpeg/ffprobe 없음 — 클립 분석·프레임·음성은 건너뜁니다 (화면 확인은 가능)');

  // ① 프로젝트 + 잡 + 소재 첨부
  // 화면의 "샘플 사용하기" 버튼과 **같은 서버 기능**을 쓴다 — 두 경로가 갈리면 한쪽만 낡는다
  const created = await post<{ job: JobView; attached: number }>(
    '/projects/sample', { category: CATEGORY });
  const job = created.job;
  ok(`샘플 작업 생성 — ${MENU}/${CATEGORY} / ${job.id} · 영상 ${created.attached}개 첨부`);

  let clips: ClipView[] = [];
  if (canMedia) {
    clips = await waitFor('클립 분석', async () => {
      const list = await get<ClipView[]>(`/jobs/${job.id}/clips`);
      return list.length === created.attached && list.every((c) => c.probe && c.frames.length) ? list : null;
    }, 180_000);
    const frames = clips.reduce((s, c) => s + c.frames.length, 0);
    ok(`클립 분석·프레임 추출 — ${clips.length}클립 · 프레임 ${frames}장`);
  }

  if (!FULL) {
    const state = (await get<JobView>(`/jobs/${job.id}`)).state;
    console.log(`\n${C.bold('완료')} — ${MENU}/${CATEGORY} / ${job.id} (${state})`);
    console.log(C.dim('  npm run dev → http://localhost:5173 에서 존 편집부터 직접 진행하세요.'));
    console.log(C.dim('  대본·음성까지 미리 채우려면: npm run seed -- --force --full'));
    console.log('');
    return;
  }

  // ④ 대본 — 자막을 씬으로 옮기고, 클립을 고르게 나눠 붙인다
  const scenes = cues.map((cue, i) => {
    const clip = clips[i % Math.max(1, clips.length)];
    const scene: Record<string, unknown> = {
      sceneId: `s${String(i + 1).padStart(2, '0')}`,
      narration: cue.text,
      subtitle: shortSubtitle(cue.text),
      durationHint: Math.round((cue.end - cue.start) * 10) / 10,
    };
    if (clip?.probe) {
      // 클립 길이 안에서 자막 길이만큼 잘라 쓴다 (구간이 클립을 넘으면 조립이 깨진다)
      const span = Math.min(cue.end - cue.start, clip.probe.duration);
      const start = Math.min(1, Math.max(0, clip.probe.duration - span));
      scene.clipRef = {
        clipId: clip.id,
        suggestedSegment: { in: +start.toFixed(2), out: +(start + span).toFixed(2) },
      };
    }
    return scene;
  });

  const packet = await post<{ id: string }>(`/jobs/${job.id}/packets`, { kind: 'script' });
  await post(`/packets/${packet.id}/paste`, {
    raw: `\`\`\`json\n${JSON.stringify({ title: '70kg 버티는 주방 선반', scenes, notes: '샘플 데이터' }, null, 2)}\n\`\`\``,
  });
  await waitFor('대본 반영', async () => {
    const d = await get<{ status: string; validationErrors: string[] }>(`/packets/${packet.id}`);
    if (d.status !== 'received') return null;
    if (d.validationErrors.length) throw new Error(d.validationErrors.join(', '));
    return d;
  }, 60_000);
  await post(`/packets/${packet.id}/accept`);
  await post(`/jobs/${job.id}/script/approve`);
  ok(`대본 ${scenes.length}씬 반영·승인 (${cues.at(-1)!.end.toFixed(1)}초 분량)`);

  // ⑤ 음성 — 나레이션 mp3를 자막 구간대로 잘라 씬별로 붙인다
  if (canMedia) {
    const tmp = path.join(REPO_ROOT, 'workspace', '_tmp_audio');
    await fsp.mkdir(tmp, { recursive: true });
    const src = path.join(SAMPLE_DIR, 'narration.mp3');
    for (const [i, cue] of cues.entries()) {
      const out = path.join(tmp, `seed-s${i + 1}.mp3`);
      await runFfmpeg([
        '-y', '-ss', String(cue.start), '-to', String(cue.end), '-i', src, '-c', 'copy', out,
      ]);
      const buf = await fsp.readFile(out).catch(() => null);
      if (!buf?.length) continue; // 오디오 끝을 넘어선 구간은 비어 나온다
      const vfd = new FormData();
      vfd.append('sceneId', `s${String(i + 1).padStart(2, '0')}`);
      vfd.append('file', new Blob([buf], { type: 'audio/mpeg' }), `s${i + 1}.mp3`);
      const r = await fetch(`${API}/jobs/${job.id}/voice/upload`, { method: 'POST', body: vfd });
      if (!r.ok) throw new Error(`음성 첨부 실패: ${r.status} ${await r.text()}`);
    }
    await fsp.rm(tmp, { recursive: true, force: true });
    ok(`씬별 음성 첨부 — 나레이션을 자막 구간대로 분할`);

    await post(`/jobs/${job.id}/tts`, {});
    const timingPath = path.join(projectDir, 'jobs', job.id, 'voice', 'timing.json');
    const timings = await waitFor('타이밍 생성', async () => {
      const t = await fsp.readFile(timingPath, 'utf8').catch(() => null);
      const parsed = t ? (JSON.parse(t) as Array<{ duration: number }>) : null;
      return parsed?.length ? parsed : null;
    }, 120_000);
    const total = timings.reduce((s, t) => s + t.duration, 0);
    ok(`타이밍 생성 — ${timings.length}씬 · 총 ${total.toFixed(1)}초`);
  }

  const state = (await get<JobView>(`/jobs/${job.id}`)).state;
  console.log(`\n${C.bold('완료')} — ${MENU}/${CATEGORY} / ${job.id} (${state})`);
  console.log(C.dim('  npm run dev → http://localhost:5173 에서 확인하세요.'));
  if (canMedia) {
    console.log(C.dim('  조립까지 해보려면 잡 화면에서 "사용 권리 확인" 후 최종 조립을 누르세요.'));
  }
  console.log('');
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', () => resolve()); // 구간이 오디오 밖이면 실패하는데, 그건 위에서 걸러낸다
  });
}

main()
  .then(() => { stopServer(); process.exit(0); })
  .catch((e) => {
    console.error(`\n\x1b[31m실패:\x1b[0m ${e instanceof Error ? e.message : String(e)}\n`);
    stopServer();
    process.exit(1);
  });

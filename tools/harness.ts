/**
 * 엔드투엔드 파이프라인 하네스.
 *
 * 실제 미디어 도구(yt-dlp/ffmpeg)와 실제 API를 그대로 써서 파이프라인 전 구간을 돌린다.
 * 유튜브에서 남의 영상을 받지 않고, ffmpeg로 만든 합성 영상(가짜 워터마크·자막 포함)을
 * 로컬 HTTP로 서빙해 다운로드 큐가 실제로 동작하는지까지 검증한다.
 *
 * 실행: npm run harness            (격리된 임시 workspace 사용, 끝나면 삭제)
 *       npm run harness -- --keep  (산출물 확인용으로 남겨둠)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const API = 'http://127.0.0.1:4310/api';
const MEDIA_PORT = 4399;
const KEEP = process.argv.includes('--keep');

// ── 출력 유틸 ─────────────────────────────────────────────────────

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface StepResult { name: string; ok: boolean; ms: number; detail: string; skipped?: boolean }
const results: StepResult[] = [];
let stepNo = 0;

async function step(name: string, fn: () => Promise<string>): Promise<void> {
  stepNo++;
  const label = `${String(stepNo).padStart(2, '0')}. ${name}`;
  process.stdout.write(`${label} ${C.dim('…')}`);
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms, detail });
    process.stdout.write(`\r${label} ${C.green('✔')} ${C.dim(`${ms}ms · ${detail}`)}\n`);
  } catch (e) {
    const ms = Date.now() - t0;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, ms, detail });
    process.stdout.write(`\r${label} ${C.red('✘')} ${C.red(detail)}\n`);
    throw new HarnessFailure(name);
  }
}

async function softStep(name: string, fn: () => Promise<string>): Promise<boolean> {
  stepNo++;
  const label = `${String(stepNo).padStart(2, '0')}. ${name}`;
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms, detail });
    console.log(`${label} ${C.green('✔')} ${C.dim(`${ms}ms · ${detail}`)}`);
    return true;
  } catch (e) {
    const ms = Date.now() - t0;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: true, ms, detail: `건너뜀 — ${detail}`, skipped: true });
    console.log(`${label} ${C.yellow('⊘')} ${C.dim(`건너뜀 — ${detail}`)}`);
    return false;
  }
}

class HarnessFailure extends Error {}

/**
 * 폴링을 즉시 중단시키는 오류.
 * 서버가 이미 실패를 기록했다면 더 기다려봐야 타임아웃까지 버티는 시간만 낭비된다.
 */
class ProbeAbort extends Error {}

/** 서버가 죽었을 때 원인을 바로 보여주기 위한 로그 꼬리 */
async function tailServerLog(lines = 12): Promise<string> {
  if (!serverLog) return '(로그 없음)';
  const text = await fsp.readFile(serverLog, 'utf8').catch(() => '');
  return text.trim().split('\n').slice(-lines).join('\n      ') || '(로그 비어 있음)';
}

/**
 * 잡 이벤트 로그(events.ndjson)에서 실패 기록을 찾는다.
 * 파이프라인 실패는 잡 상태를 바꾸지 않고 이벤트로만 남으므로,
 * 이걸 보지 않으면 "완료 대기"가 타임아웃까지 계속 돈다.
 */
async function jobFailure(...types: string[]): Promise<string | null> {
  if (!jobDir) return null;
  const text = await fsp.readFile(path.join(jobDir, 'events.ndjson'), 'utf8').catch(() => '');
  const lines = text.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    try {
      const e = JSON.parse(lines[i]) as { type?: string; error?: string };
      if (e.type && types.includes(e.type)) return e.error || '(사유 미기록)';
    } catch { /* 기록 중이라 잘린 줄 — 무시 */ }
  }
  return null;
}

/** 실패 이벤트가 있으면 폴링을 즉시 끊는다 */
async function abortIfFailed(...types: string[]): Promise<void> {
  const err = await jobFailure(...types);
  if (err) throw new ProbeAbort(`${types[0]} — ${err}\n      서버 로그:\n      ${await tailServerLog(20)}`);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** 샘플 원본의 지문 — "샘플 사용하기"가 원본을 옮기거나 지우지 않는지 확인용 */
async function sampleHashes(): Promise<Map<string, string>> {
  const dir = path.join(REPO_ROOT, 'samples', 'kitchen-shelf');
  const out = new Map<string, string>();
  for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
    const buf = await fsp.readFile(path.join(dir, name));
    out.set(name, createHash('sha1').update(buf).digest('hex'));
  }
  return out;
}

// ── HTTP 헬퍼 ─────────────────────────────────────────────────────

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `${method} ${url} → ${r.status}`;
    try {
      const j = JSON.parse(text);
      msg += `: ${j.error ?? text.slice(0, 160)}`;
    } catch { msg += `: ${text.slice(0, 160)}`; }
    throw new Error(msg);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

const get = <T>(url: string) => req<T>('GET', url);
const post = <T>(url: string, body?: unknown) => req<T>('POST', url, body);
const put = <T>(url: string, body: unknown) => req<T>('PUT', url, body);
const del = <T>(url: string) => req<T>('DELETE', url);

/** 조건이 참이 될 때까지 폴링. 비동기 파이프라인 단계 대기용 */
async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null>,
  timeoutMs = 120_000,
  intervalMs = 800,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (serverDied) throw new Error(`${serverDied} — ${await tailServerLog()}`);
    try {
      const v = await probe();
      if (v !== null && v !== undefined) return v;
    } catch (e) {
      if (e instanceof ProbeAbort) throw e; // 재시도해도 소용없는 실패
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`대기 시간 초과: ${what}${lastErr ? ` (마지막 오류: ${lastErr})` : ''}`);
}

// ── 외부 프로세스 ─────────────────────────────────────────────────

function runCmd(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} 종료 코드 ${code}`)));
  });
}

// ── 합성 소재 생성 ────────────────────────────────────────────────

/** 제품자료 압축 첨부 검증용 — 파이썬 zipfile로 만든 진짜 zip (상세페이지/가격.txt, 사양표.txt) */
const PRODUCT_ZIP = Buffer.from(
  'UEsDBBQAAAgIANO9Cl3b59KDDwAAALQAAAAaAAAA7IOB7IS47Y6Y7J207KeAL+qwgOqyqS50eHQzttSxNDB4M3uC8dBhAABQSwMEFAAACAAA070KXf1Q3SILAAAACwAAAB0AAADsg4HshLjtjpjsnbTsp4Av7IKs7JaR7ZGcLnR4dFcyNXhENDB4SDgwUEsDBBQAAAAAANO9Cl05nPsGBAAAAAQAAAAPAAAAX19NQUNPU1gvLl9qdW5ranVua1BLAwQUAAAIAADTvQpdAAAAAAAAAAAAAAAACgAAAOu5iO2PtOuNlC9QSwECFAMUAAAICADTvQpd2+fSgw8AAAC0AAAAGgAAAAAAAAAAAAAAgAEAAAAA7IOB7IS47Y6Y7J207KeAL+qwgOqyqS50eHRQSwECFAMUAAAIAADTvQpd/VDdIgsAAAALAAAAHQAAAAAAAAAAAAAAgAFHAAAA7IOB7IS47Y6Y7J207KeAL+yCrOyWke2RnC50eHRQSwECFAMUAAAAAADTvQpdOZz7BgQAAAAEAAAADwAAAAAAAAAAAAAAgAGNAAAAX19NQUNPU1gvLl9qdW5rUEsBAhQDFAAACAAA070KXQAAAAAAAAAAAAAAAAoAAAAAAAAAAAAQAP1BvgAAAOu5iO2PtOuNlC9QSwUGAAAAAAQABAAIAQAA5gAAAAAA',
  'base64',
);

const W = 640;
const H = 360;
const WM = { x: 470, y: 12, w: 150, h: 44 }; // 우상단 가짜 워터마크
const SUB = { x: 0, y: H - 56, w: W, h: 56 }; // 하단 가짜 자막띠

/**
 * testsrc2 위에 워터마크·자막 영역을 상자로 그려 넣은 합성 영상.
 * 실제 유튜브 영상을 받지 않고도 존 편집 → 제거 파이프라인을 검증할 수 있다.
 */
async function makeSyntheticVideo(outPath: string, seconds: number, seed: number): Promise<void> {
  const vf = [
    `hue=h=${seed * 60}`, // 클립마다 색을 달리해 육안으로 구분되게
    `drawbox=x=${WM.x}:y=${WM.y}:w=${WM.w}:h=${WM.h}:color=white@0.85:t=fill`,
    `drawbox=x=${SUB.x}:y=${SUB.y}:w=${SUB.w}:h=${SUB.h}:color=black@0.8:t=fill`,
    `drawbox=x=40:y=${SUB.y + 16}:w=${W - 80}:h=24:color=yellow@0.9:t=fill`,
  ].join(',');
  await runCmd('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${300 + seed * 110}:duration=${seconds}`,
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-shortest',
    outPath,
  ]);
}

/** 씬 음성 대용 무음 mp3 (파일 첨부 경로 검증용 — 타입캐스트는 실제 키가 필요하다) */
async function makeSilentAudio(outPath: string, seconds: number): Promise<void> {
  await runCmd('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=mono:sample_rate=24000`,
    '-t', String(seconds), '-c:a', 'libmp3lame', '-q:a', '9',
    outPath,
  ]);
}

// ── 타입 ──────────────────────────────────────────────────────────

interface JobView {
  id: string; state: string; progress: number; downloading: boolean;
  sources: Array<{
    id: string; url: string; origin: 'url' | 'file';
    status: string; error?: string; filePath?: string;
  }>;
  script: { currentVersion: number; approved: boolean };
  sceneVoiceFiles: Record<string, string>;
  output: { currentVersion?: number };
  exportedAt?: string;
}
interface ClipView {
  id: string; sourceId: string;
  probe?: { width: number; height: number; duration: number };
  frames: Array<{ file: string; t: number; recommended: boolean }>;
  zones: unknown[];
  segments: Array<{ id: string; in: number; out: number; note: string; used: boolean }>;
  cleanVersions: Array<{ v: number; tier: number; filePath: string }>;
  currentCleanVersion?: number;
  selectedVideo?: string;
  selectedUrl?: string;
}
interface PacketView {
  id: string; kind: string; status: string; executionMode?: string; validationErrors: string[];
  requestMd: string; resultSpec: Array<{ file: string; schema: string }>;
}

// ── 메인 ──────────────────────────────────────────────────────────

let server: ChildProcess | null = null;
let mediaServer: http.Server | null = null;
let workspace = '';
let exportRoot = '';
let serverLog = '';
let serverDied = '';
let jobDir = ''; // 잡 폴더 절대경로 — 실패 이벤트 조기 감지에 쓴다
let timingsTotal = 0; // 나레이션 총 길이 — 카드 삽입 검증 기준
let keptFrameTimes: number[] = []; // 지우고 남긴 장면 시각 — 요청서·컷 구간 검증에 쓴다

async function main(): Promise<void> {
  console.log(C.bold('\n🏭 쇼핑쇼츠 팩토리 — 엔드투엔드 하네스\n'));

  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'shorts-harness-'));
  workspace = path.join(tmpBase, 'workspace');
  exportRoot = path.join(tmpBase, '내보내기');
  const mediaDir = path.join(tmpBase, 'media');
  await fsp.mkdir(mediaDir, { recursive: true });

  console.log(C.dim(`작업공간: ${workspace}`));
  console.log(C.dim(`내보내기: ${exportRoot}\n`));

  // ── 준비 ──
  await step('도구 확인 (ffmpeg / ffprobe / yt-dlp)', async () => {
    // ffmpeg 계열은 -version (하이픈 1개), yt-dlp는 --version
    const checks: Array<[string, string]> = [
      ['ffmpeg', '-version'], ['ffprobe', '-version'], ['yt-dlp', '--version'],
    ];
    for (const [bin, flag] of checks) {
      await runCmd(bin, [flag]).catch(() => {
        throw new Error(`${bin} 없음 — README의 설치 안내를 따르세요`);
      });
    }
    return '3개 모두 사용 가능';
  });

  await step('합성 소재 영상 생성 (워터마크·자막 포함)', async () => {
    await makeSyntheticVideo(path.join(mediaDir, 'clip1.mp4'), 8, 1);
    await makeSyntheticVideo(path.join(mediaDir, 'clip2.mp4'), 6, 2);
    return `2편 (${W}x${H}, 8s + 6s)`;
  });

  await step('로컬 소재 서버 기동', async () => {
    mediaServer = http.createServer((rq, rs) => {
      const name = path.basename(rq.url ?? '');
      const file = path.join(mediaDir, name);
      fsp.readFile(file).then(
        (buf) => {
          rs.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length });
          rs.end(buf);
        },
        () => { rs.writeHead(404); rs.end(); },
      );
    });
    await new Promise<void>((r) => mediaServer!.listen(MEDIA_PORT, '127.0.0.1', r));
    return `http://127.0.0.1:${MEDIA_PORT}`;
  });

  await step('API 서버 기동 (격리 작업공간)', async () => {
    // 이미 다른 서버가 떠 있으면 그쪽에 붙어 엉뚱한 작업공간을 검사하게 되므로 먼저 막는다
    const occupied = await fetch(`${API}/settings`).then((r) => r.ok).catch(() => false);
    assert(!occupied,
      '포트 4310이 이미 사용 중입니다. 실행 중인 서버(npm run dev 등)를 끄고 다시 시도하세요');

    serverLog = path.join(tmpBase, 'server.log');
    const logFd = await fsp.open(serverLog, 'w');
    server = spawn(process.execPath, [TSX_BIN, 'src/index.ts'], {
      cwd: path.join(REPO_ROOT, 'server'),
      env: { ...process.env, SHORTS_WORKSPACE: workspace },
      stdio: ['ignore', logFd.fd, logFd.fd],
      detached: true, // 자식까지 한 번에 종료하기 위해 프로세스 그룹 분리
    });
    await logFd.close();
    server.on('exit', (code) => {
      if (code !== 0 && code !== null) serverDied = `API 서버가 종료됨 (코드 ${code})`;
    });
    await waitFor('API 응답', async () => {
      const r = await fetch(`${API}/settings`).catch(() => null);
      return r?.ok ? true : null;
    }, 60_000, 500);
    return 'http://127.0.0.1:4310';
  });

  await step('doctor — 필수 도구를 실제로 인식하는지', async () => {
    // 도구가 설치돼 있어도 버전 확인 인자가 틀리면 미설치로 오판된다
    // (ffmpeg는 -version, yt-dlp는 --version). 실제로 발생했던 버그다.
    const report = await get<{
      ok: boolean;
      tools: Array<{ name: string; required: boolean; available: boolean; version?: string }>;
    }>('/system/doctor');
    const missing = report.tools.filter((t) => t.required && !t.available).map((t) => t.name);
    assert(missing.length === 0, `필수 도구 미인식: ${missing.join(', ')}`);
    assert(report.ok, 'doctor가 ok=false를 반환');
    const named = report.tools.filter((t) => t.required && t.version).length;
    return `필수 ${report.tools.filter((t) => t.required).length}종 인식 (버전 확인 ${named}종)`;
  });

  await step('설정 — 내보내기 경로 · 프레임 레이아웃 · 카드 삽입', async () => {
    const s = await get<Record<string, unknown>>('/settings');
    await put('/settings', {
      ...s, exportRoot, exportOnDone: true, burnSubtitles: true,
      layout: 'framed', insertCards: true, cardDurationSec: 1.5, frameTitle: '하네스채널',
    });
    const after = await get<{ exportRoot: string; layout: string; insertCards: boolean }>('/settings');
    assert(after.exportRoot === exportRoot, '내보내기 경로가 저장되지 않음');
    assert(after.layout === 'framed', '레이아웃 설정이 저장되지 않음');
    assert(after.insertCards, '카드 삽입 설정이 저장되지 않음');
    return `${exportRoot} · framed · 카드 ON`;
  });

  // ── 프로젝트 / 지침 / 잡 ──
  const productName = '테스트충전기';
  await step('프로젝트 생성 + 기본 지침 확인', async () => {
    await post('/projects', { menu: 'menu-a', title: productName });
    const g = await get<{ content: string }>(
      `/projects/menu-a/${encodeURIComponent(productName)}/guidelines/script.md`);
    assert(g.content.includes('대본 지침'), '기본 대본 지침이 생성되지 않음');
    return `${productName} (지침 3종 자동 생성)`;
  });

  await step('지침 수정 저장', async () => {
    const content = '# 대본 지침\n\n- 하네스 검증용 지침\n- 총 낭독 20초 내외\n';
    await put(`/projects/menu-a/${encodeURIComponent(productName)}/guidelines/script.md`, { content });
    const g = await get<{ content: string }>(
      `/projects/menu-a/${encodeURIComponent(productName)}/guidelines/script.md`);
    assert(g.content.includes('하네스 검증용'), '지침이 저장되지 않음');
    return '대본 지침 갱신됨';
  });

  const job = await step2<JobView>('영상 작업 생성', async () => {
    const j = await post<JobView>(`/projects/menu-a/${encodeURIComponent(productName)}/jobs`, { title: '1편' });
    assert(j.state === 'draft', `초기 상태가 draft가 아님: ${j.state}`);
    return [j, `${j.id} (draft)`];
  });
  const jid = job.id;
  jobDir = path.join(workspace, 'menu-a', productName, 'jobs', jid);

  // ── 다운로드 ──
  await step('소스 URL 등록 (draft → collecting)', async () => {
    const v = await put<JobView>(`/jobs/${jid}/sources`, {
      urls: [
        `http://127.0.0.1:${MEDIA_PORT}/clip1.mp4`,
        `http://127.0.0.1:${MEDIA_PORT}/clip2.mp4`,
      ],
    });
    assert(v.sources.length === 2, `소스 2개가 아님: ${v.sources.length}`);
    assert(v.state === 'collecting', `상태 전이 실패: ${v.state}`);
    return '2건 등록, collecting';
  });

  await step('yt-dlp 다운로드 실행', async () => {
    await post(`/jobs/${jid}/download/start`);
    const v = await waitFor('다운로드 완료', async () => {
      await abortIfFailed('download.failed');
      const j = await get<JobView>(`/jobs/${jid}`);
      const failed = j.sources.filter((s) => s.status === 'failed');
      if (failed.length) throw new ProbeAbort(`다운로드 실패: ${failed[0].error}`);
      return j.sources.every((s) => s.status === 'downloaded') ? j : null;
    });
    assert(v.sources.every((s) => s.filePath), '다운로드 파일 경로가 기록되지 않음');
    return '2건 다운로드 완료';
  });

  await step('실패한 소스 삭제', async () => {
    // 영상이 아닌 주소(쇼핑몰 상세페이지 등)를 넣으면 yt-dlp가 실패한다 — 지울 수 있어야 한다
    const bad = `http://127.0.0.1:${MEDIA_PORT}/not-a-video.html`;
    const added = await put<JobView>(`/jobs/${jid}/sources`, { urls: [bad] });
    const badId = added.sources.find((s) => s.url === bad)!.id;
    // 앞 다운로드가 아직 돌고 있으면 시작 요청이 무시된다 (이중 실행 방지)
    await waitFor('다운로드 큐 idle', async () => {
      const j = await get<JobView>(`/jobs/${jid}`);
      return j.downloading ? null : true;
    }, 30_000);
    await post(`/jobs/${jid}/download/start`);
    await waitFor('실패 확정', async () => {
      const j = await get<JobView>(`/jobs/${jid}`);
      return j.sources.find((s) => s.id === badId)?.status === 'failed' ? true : null;
    }, 60_000);

    const after = await del<JobView>(`/jobs/${jid}/sources/${badId}`);
    assert(!after.sources.some((s) => s.id === badId), '삭제 후에도 소스가 남아 있음');
    assert(after.sources.length === 2, `남은 소스 수가 다름: ${after.sources.length}`);
    // 남은 소스가 다 받아졌으면 다음 단계로 넘어가야 한다 (안 그러면 화면에 갇힌다)
    assert(after.state === 'cleaning', `삭제 후 단계가 전진하지 않음: ${after.state}`);
    return `실패 → 삭제 → 목록에서 제거 · ${after.state}로 전진`;
  });

  await step('이미 받아둔 영상 파일 첨부', async () => {
    const fd = new FormData();
    const buf = await fsp.readFile(path.join(mediaDir, 'clip1.mp4'));
    fd.append('files', new Blob([buf], { type: 'video/mp4' }), '내가받은영상.mp4');
    const r = await fetch(`${API}/jobs/${jid}/sources/upload`, { method: 'POST', body: fd });
    const text = await r.text(); // 본문은 한 번만 읽을 수 있다
    assert(r.ok, `첨부 실패: ${r.status} ${text}`);
    const j = JSON.parse(text) as JobView;

    const attached = j.sources.find((s) => s.origin === 'file');
    assert(!!attached, '첨부 소스가 등록되지 않음');
    assert(attached!.status === 'downloaded', `첨부 소스 상태가 다름: ${attached!.status}`);
    assert(attached!.url === '내가받은영상.mp4', `한글 파일명이 깨짐: ${attached!.url}`);
    assert(!!attached!.filePath, '첨부 파일 경로가 기록되지 않음');

    // 다운로드 소스와 똑같이 probe·프레임·클립이 만들어져야 한다
    const clipId = attached!.id.replace(/^s/, 'c');
    const withClip = await waitFor('첨부 클립 생성', async () => {
      const c = await get<ClipView[]>(`/jobs/${jid}/clips`);
      const mine = c.find((x) => x.id === clipId);
      return mine?.probe && mine.frames.length > 0 ? mine : null;
    }, 60_000);
    assert(withClip.probe!.width === W, `첨부 클립 해상도 이상: ${withClip.probe!.width}`);

    // 첨부를 취소하면 소스·파일·클립이 함께 사라져야 한다
    await del<JobView>(`/jobs/${jid}/sources/${attached!.id}`);
    const clipsAfter = await get<ClipView[]>(`/jobs/${jid}/clips`);
    assert(clipsAfter.length === 2, `삭제 후 클립 수가 다름: ${clipsAfter.length}`);
    return `첨부 → 클립 생성(${withClip.frames.length}프레임) → 삭제 시 클립까지 정리`;
  });

  const clips = await step2<ClipView[]>('클립 자동 생성 · 분석(ffprobe) · 프레임 추출', async () => {
    const list = await waitFor('클립 생성', async () => {
      const c = await get<ClipView[]>(`/jobs/${jid}/clips`);
      return c.length === 2 && c.every((x) => x.probe && x.frames.length > 0) ? c : null;
    }, 60_000);
    const c0 = list[0];
    assert(c0.probe!.width === W && c0.probe!.height === H,
      `해상도 불일치: ${c0.probe!.width}x${c0.probe!.height}`);
    assert(c0.probe!.duration > 5, `길이 이상: ${c0.probe!.duration}`);
    // 영상 전 구간을 훑을 수 있어야 한다 — 8초 클립이면 1초 간격으로 8장 안팎
    assert(c0.frames.length >= Math.floor(c0.probe!.duration) - 1,
      `프레임이 영상 길이를 못 덮음: ${c0.frames.length}장 / ${c0.probe!.duration}초`);
    assert(c0.frames.every((f) => f.t >= 0 && f.t <= c0.probe!.duration),
      '프레임 시각이 영상 길이를 벗어남');
    // 시각이 순서대로 증가해야 화면 순서와 영상 순서가 일치한다
    assert(c0.frames.every((f, i) => i === 0 || f.t > c0.frames[i - 1].t), '프레임 시각이 순서대로가 아님');
    return [list, `2클립 · ${c0.probe!.width}x${c0.probe!.height} · 프레임 ${c0.frames.length}장(${c0.probe!.duration.toFixed(0)}초)`];
  });

  await step('전체 프레임 불러오기 — 프레임 적은 클립 갱신', async () => {
    // 프레임이 몇 장 없는 예전 클립을 흉내 내기 위해 먼저 여러 장 지운다
    const cid = clips[1].id;
    const stale = clips[1].frames.slice(0, 2).map((f) => f.file);
    const thinned = await del<ClipView>(
      `/jobs/${jid}/clips/${cid}/frames?${stale.map((f) => `file=${encodeURIComponent(f)}`).join('&')}`);
    assert(thinned.frames.length === clips[1].frames.length - 2,
      `다중 삭제 반영 안 됨: ${thinned.frames.length}`);

    await post(`/jobs/${jid}/clips/${cid}/frames/reextract`);
    const back = await waitFor('프레임 재추출', async () => {
      await abortIfFailed('clip.frames_failed');
      const c = (await get<ClipView[]>(`/jobs/${jid}/clips`)).find((x) => x.id === cid)!;
      return c.frames.length > thinned.frames.length ? c : null;
    }, 120_000);

    assert(back.frames.length >= clips[1].frames.length, `되살아난 장수가 부족: ${back.frames.length}`);
    assert(back.frames.every((f) => f.t >= 0), '재추출 프레임에 시각이 없음');
    // 실제 이미지 파일이 디스크에 있어야 존 편집기가 그림을 띄운다
    for (const f of back.frames.slice(0, 3)) {
      const st = await fsp.stat(path.join(workspace, f.file));
      assert(st.size > 500, `프레임 파일이 비었음: ${f.file}`);
    }
    return `2장 삭제 → 전체 ${back.frames.length}장 복원`;
  });

  await step('안 쓸 프레임 삭제 — 남은 것이 대본 소재', async () => {
    const cid = clips[0].id;
    const before = clips[0].frames.length;

    // 앞 2장만 남기고 나머지를 한 번에 지운다 (여러 장 정리를 왕복 없이)
    const victims = clips[0].frames.slice(2);
    const after = await del<ClipView>(
      `/jobs/${jid}/clips/${cid}/frames?${victims.map((f) => `file=${encodeURIComponent(f.file)}`).join('&')}`);
    assert(after.frames.length === 2, `삭제 반영 안 됨: ${after.frames.length}`);

    // 지운 프레임은 디스크에서도 사라져야 한다 (용량과 요청서 소재 둘 다에 영향)
    for (const v of victims.slice(0, 3)) {
      const alive = await fsp.stat(path.join(workspace, v.file)).then(() => true, () => false);
      assert(!alive, `프레임 파일이 디스크에 남아 있음: ${v.file}`);
    }

    // 전부 지우려 하면 막아야 한다 — 존을 그릴 화면이 없어진다
    const wipe = await fetch(
      `${API}/jobs/${jid}/clips/${cid}/frames?${after.frames.map((f) => `file=${encodeURIComponent(f.file)}`).join('&')}`,
      { method: 'DELETE' },
    );
    assert(wipe.status === 400, `전체 삭제가 막히지 않음: ${wipe.status}`);

    keptFrameTimes = after.frames.map((f) => f.t);
    return `${before}장 → ${after.frames.length}장 남김 (${keptFrameTimes.map((t) => t.toFixed(1)).join('·')}초) · 전체 삭제는 차단`;
  });

  // ── 자막/워터마크 제거 ──
  await step('제거 영역(존) 저장 — delogo + crop', async () => {
    for (const clip of clips) {
      await put(`/jobs/${jid}/clips/${clip.id}/zones`, {
        zones: [
          { id: 'z1', kind: 'logo', x: WM.x, y: WM.y, w: WM.w, h: WM.h, method: 'delogo' },
          { id: 'z2', kind: 'subtitle', x: SUB.x, y: SUB.y, w: SUB.w, h: SUB.h, method: 'crop' },
        ],
      });
    }
    const after = await get<ClipView[]>(`/jobs/${jid}/clips`);
    assert(after.every((c) => c.zones.length === 2), '존이 저장되지 않음');
    return '클립당 2개 (워터마크 보간 + 자막띠 크롭)';
  });

  await step('1차 제거 실행 (ffmpeg filtergraph)', async () => {
    for (const clip of clips) await post(`/jobs/${jid}/clips/${clip.id}/clean`, { tier: 1 });
    const done = await waitFor('정리본 생성', async () => {
      await abortIfFailed('clip.clean_failed');
      const c = await get<ClipView[]>(`/jobs/${jid}/clips`);
      return c.every((x) => x.currentCleanVersion) ? c : null;
    }, 180_000);
    for (const c of done) {
      const v = c.cleanVersions.find((x) => x.v === c.currentCleanVersion)!;
      const stat = await fsp.stat(v.filePath);
      assert(stat.size > 1000, `정리본이 비어 있음: ${v.filePath}`);
    }
    return `2건 clean_v1.mp4 생성 (평균 ${Math.round(
      (await Promise.all(done.map(async (c) =>
        (await fsp.stat(c.cleanVersions.at(-1)!.filePath)).size))).reduce((a, b) => a + b, 0) / done.length / 1024,
    )}KB)`;
  });

  await step('영상 재생성 — 존 전파 · 고른 구간만 · 무음 · 대본으로 전진', async () => {
    // 존이 없는 클립에 첫 클립의 존이 옮겨 붙는지 본다 (해상도가 같으니 좌표도 같아야 한다)
    const bare = clips[1];
    await put(`/jobs/${jid}/clips/${bare.id}/zones`, { zones: [] });

    await post(`/jobs/${jid}/regenerate`, { zonesFrom: clips[0].id });
    const done = await waitFor('재생성 완료', async () => {
      await abortIfFailed('clips.regenerate_failed');
      const j = await get<JobView>(`/jobs/${jid}`);
      return j.state === 'scripting' ? j : null;
    }, 180_000);
    assert(done.state === 'scripting', `대본 단계로 넘어가지 않음: ${done.state}`);

    const after = await get<ClipView[]>(`/jobs/${jid}/clips`);
    assert(after.every((c) => c.segments.length > 0), '컷 구간이 채워지지 않음');
    assert(after.find((c) => c.id === bare.id)!.zones.length === 2,
      '존이 없는 클립에 존이 옮겨지지 않음');

    for (const c of after) {
      assert(!!c.selectedVideo, `${c.id}: 결과 영상이 없음`);
      const stat = await fsp.stat(c.selectedVideo!);
      assert(stat.size > 1000, `${c.id}: 결과 영상이 비어 있음`);
      const probe = await probeJson(c.selectedVideo!);
      /*
        길이가 고른 구간의 합과 같아야 한다. "원본보다 짧다"로는 부족하다 —
        프레임을 하나도 안 지운 클립은 원본 전체가 정답이라 그 검사는 통과해버린다.
      */
      const dur = Number(probe.format.duration);
      const want = c.segments.filter((s) => s.used).reduce((a, s) => a + (s.out - s.in), 0);
      assert(Math.abs(dur - want) < 0.5,
        `${c.id}: 고른 구간은 ${want.toFixed(1)}초인데 결과는 ${dur.toFixed(1)}초`);
      // 소리가 남으면 남의 영상 배경음이 그대로 들린다
      assert(!probe.streams.some((s) => s.codec_type === 'audio'), `${c.id}: 소리가 남아 있음`);
    }
    return `${after.length}건 · 존 전파 · 무음 · ${after[0].segments.length}컷`;
  });

  // ── 대본 (요청서 왕복: 수동 붙여넣기 = 키 없이 검증 가능) ──
  await step('제품자료 없이 제품정보 추출 요청 시 차단', async () => {
    // 자료가 없으면 AI가 할 수 있는 일은 지어내는 것뿐이다 — 발행 자체를 막아야 한다
    const r = await fetch(`${API}/jobs/${jid}/packets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'product-extract' }),
    });
    assert(r.status === 400, `차단되지 않음 (status ${r.status})`);
    const body = await r.json();
    assert(String(body.error).includes('제품자료'), `안내 문구가 다름: ${body.error}`);
    return '400 + 첨부 위치 안내';
  });

  await step('제품자료 압축파일 첨부 → 자동 해제 → 요청서 발행', async () => {
    // 파이썬 zipfile로 만든 진짜 zip (한글 경로 + deflate/stored 혼합)
    const fd = new FormData();
    fd.append('files', new Blob([PRODUCT_ZIP], { type: 'application/zip' }), '상세페이지.zip');
    const up = await fetch(
      `${API}/projects/menu-a/${encodeURIComponent(productName)}/product/files`,
      { method: 'POST', body: fd },
    );
    const upBody = await up.text();
    assert(up.ok, `업로드 실패: ${up.status} ${upBody}`);
    const { errors } = JSON.parse(upBody) as { uploaded: string[]; errors: string[] };
    assert(errors.length === 0, `압축 해제 오류: ${errors.join(', ')}`);

    // 하위 폴더까지 훑어야 요청서에 경로가 실린다
    const listed = await get<{ files: Array<{ name: string }> }>(
      `/projects/menu-a/${encodeURIComponent(productName)}/product`);
    const names = listed.files.map((f) => f.name);
    assert(names.includes('상세페이지/가격.txt'), `해제된 파일이 목록에 없음: ${names.join(', ')}`);
    assert(!names.some((n) => n.endsWith('.zip')), '압축 파일이 그대로 남아 있음');

    // 자료가 생겼으니 이제 발행돼야 하고, 요청서에 그 경로가 실려야 한다
    const p = await post<{ id: string }>(`/jobs/${jid}/packets`, { kind: 'product-extract' });
    const d = await get<PacketView>(`/packets/${p.id}`);
    assert(d.requestMd.includes('상세페이지/가격.txt'), '요청서에 첨부 경로가 없음');
    return `zip → ${names.length}개 파일 · ${p.id} 발행`;
  });

  const packetId = await step2<string>('대본 요청서 발행', async () => {
    const p = await post<{ id: string }>(`/jobs/${jid}/packets`, { kind: 'script' });
    const d = await get<PacketView>(`/packets/${p.id}`);
    assert(d.requestMd.includes('하네스 검증용'), '요청서에 지침이 포함되지 않음');
    assert(d.requestMd.includes(clips[0].id), '요청서에 소재 현황이 포함되지 않음');
    assert(d.requestMd.includes('어떤 AI로도'), '요청서가 AI 중립 문구가 아님');
    // 남긴 장면이 그대로 소재로 넘어가야 한다 (지운 장면으로 대본이 써지면 안 된다)
    for (const t of keptFrameTimes) {
      assert(d.requestMd.includes(`${t.toFixed(1)}초`),
        `요청서에 남은 프레임 ${t.toFixed(1)}초가 없음`);
    }
    assert(d.requestMd.includes('남겨둔 장면'), '요청서에 소재 안내가 없음');

    // 다시 발행하면 대기 중이던 것은 치워져야 한다 (안 그러면 화면이 대기 카드로 도배된다)
    const again = await post<{ id: string; discarded: number }>(`/jobs/${jid}/packets`, { kind: 'script' });
    assert(again.discarded === 1, `이전 대기 요청서가 정리되지 않음: ${again.discarded}`);
    const waiting = (await get<PacketView[]>('/packets'))
      .filter((x) => x.status === 'waiting' && x.kind === 'script');
    // 치운 번호는 다시 쓰이므로 id가 아니라 "대기 중 몇 건인가"로 확인한다
    assert(waiting.length === 1, `대기 중 대본 요청서가 ${waiting.length}건 (1건이어야 함)`);

    return [again.id, `${again.id} · 지침·남은 소재 ${keptFrameTimes.length}장 · 재발행 시 이전 대기건 정리`];
  });

  const scenes = [
    { sceneId: 's01', narration: '이 충전기 정말 쓸 만할까요?', subtitle: '3만원의 실력',
      clipRef: { clipId: clips[0].id, suggestedSegment: { in: 1, out: 4 } } },
    { sceneId: 's02', narration: '직접 테스트해 봤습니다.', subtitle: '실사용 테스트',
      clipRef: { clipId: clips[1].id, suggestedSegment: { in: 0.5, out: 3 } } },
  ];

  await step('요청서 결과 반영 — 수동 붙여넣기 경로', async () => {
    const aiReply = `요청하신 대본입니다.\n\n\`\`\`json\n${JSON.stringify(
      { title: '3만원 충전기 실화', scenes, notes: '하네스' }, null, 2)}\n\`\`\`\n\n확인 부탁드립니다.`;
    const r = await post<{ errors: string[] }>(`/packets/${packetId}/paste`, { raw: aiReply });
    assert(r.errors.length === 0, `검증 오류: ${r.errors.join(', ')}`);
    const p = await waitFor('결과 수신', async () => {
      const d = await get<PacketView>(`/packets/${packetId}`);
      return d.status === 'received' ? d : null;
    }, 30_000);
    assert(p.validationErrors.length === 0, `스키마 오류: ${p.validationErrors.join(', ')}`);
    assert(p.executionMode === 'manual', `실행 방식 기록 오류: ${p.executionMode}`);
    const j = await get<JobView>(`/jobs/${jid}`);
    assert(j.script.currentVersion === 1, '대본 버전이 반영되지 않음');
    return '설명문 섞인 응답에서 JSON 추출 → script_v1 반영';
  });

  await step('요청서 수락 + 대본 승인 (다음 단계 자동 전진)', async () => {
    await post(`/packets/${packetId}/accept`);
    const j = await post<JobView>(`/jobs/${jid}/script/approve`);
    assert(j.script.approved, '대본이 승인되지 않음');
    // 승인 후 컷 선택 단계로 넘어가야 한다 (script_approved에 멈추면 음성 단계가 막힌다)
    assert(j.state === 'trimming', `승인 후 상태가 trimming이 아님: ${j.state}`);
    return `승인 → ${j.state}`;
  });

  // ── 컷 선택 ──
  await step('남은 프레임 → 컷 구간 후보 생성', async () => {
    const cid = clips[0].id;
    const r = await post<ClipView>(`/jobs/${jid}/clips/${cid}/segments/from-frames`);
    assert(r.segments.length > 0, '구간이 만들어지지 않음');
    // 남긴 시각이 어느 구간엔가 들어 있어야 한다
    for (const t of keptFrameTimes) {
      assert(r.segments.some((s) => t >= s.in && t <= s.out),
        `남은 시각 ${t}초가 어느 구간에도 포함되지 않음`);
    }
    assert(r.segments.every((s) => s.in < s.out), '구간이 뒤집힘');
    assert(r.segments.every((s) => s.in >= 0), '구간 시작이 음수');
    return `${keptFrameTimes.length}장 → ${r.segments.length}구간`;
  });

  await step('컷 구간 저장', async () => {
    for (const [i, clip] of clips.entries()) {
      const seg = scenes[i].clipRef.suggestedSegment;
      await put(`/jobs/${jid}/clips/${clip.id}/segments`, {
        segments: [{ id: `g${i + 1}`, in: seg.in, out: seg.out, note: `씬 ${i + 1}`, used: true }],
      });
    }
    const after = await get<ClipView[]>(`/jobs/${jid}/clips`);
    assert(after.every((c) => c.segments.length === 1), '컷 구간이 저장되지 않음');
    return '클립당 1구간';
  });

  await step('연속 노출 경고 — 상한 초과 구간 감지', async () => {
    const clip = clips[0];
    const r = await put<{ warnings: Array<{ type: string; message: string; segments: unknown[] }> }>(
      `/jobs/${jid}/clips/${clip.id}/segments`,
      { segments: [{ id: 'long', in: 0, out: 7, note: '너무 긴 구간', used: true }] },
    );
    assert(r.warnings?.length === 1, '경고가 나오지 않음');
    assert(r.warnings[0].type === 'exposure', `경고 종류가 다름: ${r.warnings[0].type}`);
    // 원래 구간으로 되돌린다
    const seg = scenes[0].clipRef.suggestedSegment;
    const back = await put<{ warnings: unknown[] }>(`/jobs/${jid}/clips/${clip.id}/segments`, {
      segments: [{ id: 'g1', in: seg.in, out: seg.out, note: '씬 1', used: true }],
    });
    assert(back.warnings.length === 0, '정상 구간인데 경고가 남음');
    return '7초 구간 → 경고, 3초 이내 → 정상';
  });

  // ── 음성 ──
  // 실패할 합성을 먼저 걸어두면 백그라운드 작업이 남아 뒤 단계와 얽히므로,
  // CLI로 가용성을 먼저 확인한 뒤 경로를 고른다.
  const timingPath = path.join(workspace, 'menu-a', productName, 'jobs', jid, 'voice', 'timing.json');
  const readTiming = async () => {
    const t = await fsp.readFile(timingPath, 'utf8').catch(() => null);
    return t ? JSON.parse(t) : null;
  };

  await step('음성 첨부 없이 실행하면 차단되는지 확인', async () => {
    const r = await fetch(`${API}/jobs/${jid}/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert(r.status === 400, `차단되지 않음 (status ${r.status})`);
    const body = await r.json();
    assert(String(body.error).includes('첨부') || String(body.error).includes('캐릭터'),
      `차단 사유가 다름: ${body.error}`);
    return '캐릭터·첨부 모두 없으면 400';
  });

  {
    // 타입캐스트는 실제 API 키가 필요하므로, 하네스는 파일 첨부 경로를 검증한다.
    // (키가 있으면 UI의 캐릭터 선택·미리듣기로 확인)
    await step('씬별 음성 파일 첨부', async () => {
      const tmpAudio = path.join(workspace, '_tmp_audio');
      await fsp.mkdir(tmpAudio, { recursive: true });
      for (const [i, scene] of scenes.entries()) {
        const f = path.join(tmpAudio, `s${i + 1}.mp3`);
        await makeSilentAudio(f, 3);
        const fd = new FormData();
        fd.append('sceneId', scene.sceneId);
        fd.append('file', new Blob([await fsp.readFile(f)], { type: 'audio/mpeg' }), `s${i + 1}.mp3`);
        const r = await fetch(`${API}/jobs/${jid}/voice/upload`, { method: 'POST', body: fd });
        assert(r.ok, `업로드 실패: ${r.status} ${await r.text()}`);
      }
      const j = await get<JobView>(`/jobs/${jid}`);
      assert(Object.keys(j.sceneVoiceFiles).length === scenes.length, '첨부 매핑이 기록되지 않음');
      return `${scenes.length}씬 첨부 (첨부 우선 규칙 검증)`;
    });

    await step('첨부 파일로 타이밍 생성', async () => {
      await post(`/jobs/${jid}/tts`, {});
      const timings = await waitFor('타이밍 생성', async () => {
        await abortIfFailed('tts.failed');
        return readTiming();
      }, 60_000);
      assert(Array.isArray(timings) && timings.length === scenes.length,
        `타이밍 씬 수 불일치: ${timings.length}`);
      assert(timings.every((t: { source: string }) => t.source === 'file'),
        '첨부 파일이 우선 사용되지 않음');
      timingsTotal = timings.reduce((s: number, t: { duration: number }) => s + t.duration, 0);
      return `${timings.length}씬 · 총 ${timingsTotal.toFixed(1)}초 · 전부 file 소스`;
    });
  }

  // ── 저작권 게이트 ──
  await step('저작권 게이트 — 미확인 시 조립 차단', async () => {
    const r = await fetch(`${API}/jobs/${jid}/assemble`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert(r.status === 400, `차단되지 않음 (status ${r.status})`);
    const body = await r.json();
    assert(String(body.error).includes('권리'), `차단 사유가 다름: ${body.error}`);
    await post(`/jobs/${jid}/rights-confirm`, { confirmed: true });
    return '차단 확인 후 권리 확인 처리';
  });

  // ── 조립 ──
  await step('최종 조립 (9:16 · 자막 번인 · 공시문구)', async () => {
    await post(`/jobs/${jid}/assemble`, {});
    const j = await waitFor('조립 완료', async () => {
      await abortIfFailed('assemble.failed');
      const v = await get<JobView>(`/jobs/${jid}`);
      if (v.state === 'failed') throw new ProbeAbort('조립 실패 상태');
      return v.output.currentVersion ? v : null;
    }, 300_000);
    const finalPath = path.join(jobDir, 'output', `final_v${j.output.currentVersion}.mp4`);
    const stat = await fsp.stat(finalPath);
    assert(stat.size > 10_000, `최종 영상이 너무 작음: ${stat.size} bytes`);

    const probe = await probeJson(finalPath);
    const v = probe.streams.find((s) => s.codec_type === 'video')!;
    assert(v.width === 1080 && v.height === 1920, `9:16이 아님: ${v.width}x${v.height}`);
    const hasAudio = probe.streams.some((s) => s.codec_type === 'audio');
    assert(hasAudio, '오디오 트랙 없음');

    const srt = await fsp.readFile(
      path.join(workspace, 'menu-a', productName, 'jobs', jid, 'subtitles', 'final.srt'), 'utf8');
    assert(srt.includes('쿠팡 파트너스'), '공시문구가 자막에 없음');

    // 카드가 들어가면 나레이션 총합보다 길어야 한다. 그런데도 오디오가 잘리면 싱크가 깨진 것이다.
    const narrationTotal = timingsTotal;
    const videoDur = Number(probe.format.duration);
    assert(videoDur > narrationTotal + 0.5,
      `카드가 삽입되지 않았거나 길이가 이상함 (영상 ${videoDur.toFixed(1)}초 ≤ 나레이션 ${narrationTotal.toFixed(1)}초)`);
    const audioDur = await streamDuration(finalPath, 'a');
    assert(Math.abs(audioDur - videoDur) < 1.0,
      `오디오·영상 길이 불일치 — 싱크 깨짐 (영상 ${videoDur.toFixed(1)}초, 오디오 ${audioDur.toFixed(1)}초)`);

    const cardCount = Math.round((videoDur - narrationTotal) / 1.5);
    return `${v.width}x${v.height} · ${videoDur.toFixed(1)}초 (카드 약 ${cardCount}장 포함) · ${Math.round(stat.size / 1024)}KB`;
  });

  await step('바이럴 발굴 — 키 없으면 차단 · 보관함 왕복', async () => {
    // 키가 없는데 조용히 빈 목록을 주면 사용자는 "터진 영상이 없구나"로 오해한다
    const r = await fetch(`${API}/viral/discover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: ['주방 수납'] }),
    });
    assert(r.status === 400, `키 없이 발굴이 차단되지 않음 (status ${r.status})`);
    assert(String((await r.json()).error).includes('API 키'), '안내 문구에 키 언급이 없음');

    // 보관함은 유튜브 키 없이도 동작해야 한다 (저장된 항목을 보는 기능이므로)
    const item = {
      video: {
        videoId: 'vh1', title: '주방 틈새 정리', channelId: 'ch1', channelTitle: '살림채널',
        publishedAt: new Date(Date.now() - 3 * 86400_000).toISOString(), thumbnail: '',
        viewCount: 2_260_000, likeCount: 0, commentCount: 0, durationSec: 42,
        url: 'https://www.youtube.com/watch?v=vh1',
      },
      source: 'youtube', keywords: ['주방 수납'], subscriberCount: 4200,
      viewsPerDay: 753_333, outlierRatio: 538.1, ageDays: 3,
      discoveredAt: new Date().toISOString(), note: '',
    };
    await post('/viral/board', item);
    await post('/viral/board', item); // 같은 영상을 두 번 담아도 하나여야 한다
    const board = await get<Array<{ video: { videoId: string } }>>('/viral/board');
    assert(board.length === 1, `보관함 중복: ${board.length}건`);

    const after = await del<unknown[]>(`/viral/board/${item.video.videoId}`);
    assert(after.length === 0, '보관 해제가 반영되지 않음');
    return '키 없음 400 · 보관 중복 방지 · 해제 확인';
  });

  // ── 샘플 소재로 시작 (새 PC에서 처음 눌러보는 경로) ──
  await step('샘플 사용하기 — 분석 단계까지 · 원본 보존', async () => {
    const before = await sampleHashes();
    assert(before.size > 0, 'samples/kitchen-shelf에 소재가 없음');

    const info = await get<{ available: boolean }>('/projects/sample');
    assert(info.available, '샘플 소재를 인식하지 못함');

    // 폴더는 카테고리, 샘플은 그 안의 영상 작업 하나다
    const category = '샘플카테고리';
    await post('/projects', { menu: 'menu-a', title: category });
    const r = await post<{ job: JobView; attached: number }>(
      `/projects/menu-a/${encodeURIComponent(category)}/jobs/sample`, {});
    assert(r.attached >= 4, `첨부된 소재가 부족함: ${r.attached}`);

    // 분석은 배경에서 돈다 — 요청은 바로 끝나고 클립이 나중에 채워진다
    assert(r.job.state !== 'cleaning', `분석을 기다리느라 요청이 늦게 끝남: ${r.job.state}`);

    // 분석까지만 가야 한다 — 대본이 미리 채워져 있으면 처음부터 시험할 수 없다
    const sj = await waitFor('샘플 클립 분석', async () => {
      const clips = await get<ClipView[]>(`/jobs/${r.job.id}/clips`);
      if (clips.length !== r.attached || !clips.every((c) => c.probe && c.frames.length)) return null;
      const v = await get<JobView>(`/jobs/${r.job.id}`);
      return v.state === 'cleaning' ? v : null;
    }, 180_000);
    assert(sj.script.currentVersion === 0, '샘플에 대본이 미리 채워져 있음');

    // 원본을 옮겨버리면 다음 사람이 샘플을 못 쓴다
    const after = await sampleHashes();
    for (const [name, hash] of before) {
      assert(after.get(name) === hash, `샘플 원본이 변경됨: ${name}`);
    }

    // 같은 카테고리에 또 만들어도 앞의 작업을 덮지 않는다
    const again = await post<{ job: JobView }>(
      `/projects/menu-a/${encodeURIComponent(category)}/jobs/sample`, {});
    assert(again.job.id !== r.job.id, `샘플 작업 id가 겹침: ${again.job.id}`);

    // 없는 카테고리에는 만들 수 없어야 한다 (엉뚱한 폴더가 생기면 안 된다)
    const orphan = await fetch(`${API}/projects/menu-a/없는카테고리/jobs/sample`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert(orphan.status === 404, `없는 카테고리에 만들어짐: ${orphan.status}`);

    return `${r.attached}개 소재 · ${sj.state}까지 · 원본 ${before.size}개 무결 · 카테고리 안에 여러 편`;
  });

  // ── 제품정보리뷰(menu-b) 전용 규칙 ──
  // 메뉴 A는 별도 지침을 따로 세우기로 해서, 이 규칙들이 A로 새지 않는지도 같이 본다
  await step('제품정보리뷰 — 짧은 분량 · 단점 씬 게이트 · 시리즈 예고', async () => {
    const bProduct = '테스트세제통';

    // 제품정보리뷰의 포맷은 잡이 아니라 **카테고리**에 붙는다. 포맷 없는 카테고리는
    // 잡을 만들 수 없어야 한다 — 만들어지면 draft에 갇히고 거기서 나갈 경로가 없다
    await post('/projects', { menu: 'menu-b', title: '포맷없는카테고리' });
    const noFormat = await fetch(`${API}/projects/menu-b/${encodeURIComponent('포맷없는카테고리')}/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '1편' }),
    });
    assert(noFormat.status === 400, `포맷 없는 카테고리에 잡이 만들어짐: ${noFormat.status}`);

    await put('/formats/harness-format', {
      name: '하네스 포맷',
      structure: {
        hook: '질문으로 연다',
        beats: [{ name: '문제', purpose: '공감', secondsHint: 4 }],
        cta: '링크는 설명란에',
      },
      tone: { persona: '살림 잘하는 이웃', speechLevel: '해요체' },
      sceneTemplate: {
        layout: '제품 중앙', imageStylePrompt: '밝은 주방', subtitleStyle: '하단 굵게', transition: '컷',
      },
      branding: { channelName: '하네스 채널' },
    });
    await post('/projects', { menu: 'menu-b', title: bProduct, formatId: 'harness-format' });
    const bJob = await post<JobView>(
      `/projects/menu-b/${encodeURIComponent(bProduct)}/jobs`, { title: '1편' });
    // 포맷이 카테고리에 있으니 draft에 머무르지 않고 바로 다음 단계로 간다
    assert(bJob.state === 'format_selected', `menu-b 잡이 draft에 갇힘: ${bJob.state}`);

    // ① 요청서가 menu-b 기준(22초·162자)과 단점 씬 규칙을 담아야 한다
    const p1 = await post<{ id: string }>(`/jobs/${bJob.id}/packets`, { kind: 'script' });
    const req = await get<PacketView>(`/packets/${p1.id}`);
    assert(req.requestMd.includes('26초 이내'), 'menu-b 목표 시간이 요청서에 없음');
    assert(req.requestMd.includes('162자'), `menu-b 분량 상한이 반영되지 않음`);
    assert(!req.requestMd.includes('187자'), 'menu-a 분량 상한이 새어 들어옴');
    assert(req.requestMd.includes('isDownside'), '단점 씬 규칙이 요청서에 없음');

    // ② 단점 씬이 없으면 반려 — 대본이 반영되면 안 된다
    const noDownside = {
      title: '세제통 정리',
      scenes: [
        { sceneId: 's01', narration: '싱크대 세제통 아직도 그냥 두세요?', subtitle: '아직도?', imagePrompt: 'sink' },
        { sceneId: 's02', narration: '여기 꽂기만 하면 한 손으로 됩니다.', subtitle: '한 손', imagePrompt: 'pump' },
      ],
    };
    await post<{ errors: string[] }>(`/packets/${p1.id}/paste`,
      { raw: `\`\`\`json\n${JSON.stringify(noDownside)}\n\`\`\`` });
    const rejected = await waitFor('단점 씬 누락 검증', async () => {
      const d = await get<PacketView>(`/packets/${p1.id}`);
      return d.status === 'received' ? d : null;
    }, 30_000);
    assert(rejected.validationErrors.some((e) => e.includes('단점 씬')),
      `단점 씬 누락이 걸러지지 않음: ${rejected.validationErrors.join(', ')}`);
    const stillEmpty = await get<JobView>(`/jobs/${bJob.id}`);
    assert(stillEmpty.script.currentVersion === 0,
      `반려된 대본이 반영됨: v${stillEmpty.script.currentVersion}`);

    // ③ 단점 씬을 넣으면 통과
    const p2 = await post<{ id: string }>(`/jobs/${bJob.id}/packets`, { kind: 'script' });
    const withDownside = {
      ...noDownside,
      scenes: [
        ...noDownside.scenes,
        { sceneId: 's03', narration: '대신 스테인리스라 지문은 묻습니다.', subtitle: '지문은 묻어요', imagePrompt: 'steel', isDownside: true },
      ],
    };
    const r2 = await post<{ errors: string[] }>(`/packets/${p2.id}/paste`,
      { raw: `\`\`\`json\n${JSON.stringify(withDownside)}\n\`\`\`` });
    assert(r2.errors.length === 0, `단점 씬이 있는데 반려됨: ${r2.errors.join(', ')}`);
    const applied = await waitFor('menu-b 대본 반영', async () => {
      const j = await get<JobView>(`/jobs/${bJob.id}`);
      return j.script.currentVersion === 1 ? j : null;
    }, 30_000);
    assert(applied.script.currentVersion === 1, '단점 씬을 넣은 대본이 반영되지 않음');

    // ④ 업로드 킷 요청서에 시리즈 회차와 해시태그 상한이 들어가야 한다
    await post<JobView>(`/projects/menu-b/${encodeURIComponent(bProduct)}/jobs`, { title: '2편' });
    const kit = await post<{ id: string }>(`/jobs/${bJob.id}/packets`, { kind: 'upload-kit' });
    const kitReq = await get<PacketView>(`/packets/${kit.id}`);
    assert(kitReq.requestMd.includes('1번째 편'), '시리즈 회차가 요청서에 없음');
    assert(kitReq.requestMd.includes('3~5개'), '해시태그 상한이 요청서에 없음');
    assert(kitReq.requestMd.includes('다음 편 예고'), '다음 편 예고 지시가 요청서에 없음');

    // ⑤ 같은 규칙이 menu-a로 새지 않아야 한다 (메뉴 A는 별도 지침 예정)
    const aPacket = await post<{ id: string }>(`/jobs/${jid}/packets`, { kind: 'script' });
    const aReq = await get<PacketView>(`/packets/${aPacket.id}`);
    // 규칙 문장으로 본다 — 이전 대본이 문맥으로 실리면 isDownside 키 자체는 등장할 수 있다
    assert(!aReq.requestMd.includes('단점 씬 1개 필수'), '단점 씬 규칙이 menu-a 요청서에 새어 들어감');
    assert(aReq.requestMd.includes('187자'), 'menu-a 분량 기준이 바뀜');
    assert(aReq.requestMd.includes('30초 이내'), 'menu-a 목표 시간이 바뀜');

    return '22초 기준 · 단점 씬 없으면 반려 · 회차/해시태그 안내 · menu-a 미적용';
  });

  // ── 요청서 파일 직접 처리 경로 (파일 접근이 가능한 AI = Claude Code) ──
  await step('요청서 파일 감시 — result/.done 감지 → 자동 반영', async () => {
    const p = await post<{ id: string }>(`/jobs/${jid}/packets`, { kind: 'upload-kit' });
    const resultDir = path.join(jobDir, 'requests', p.id, 'result');
    await fsp.mkdir(resultDir, { recursive: true });
    await fsp.writeFile(
      path.join(resultDir, 'upload-kit.md'),
      '# 업로드 킷\n\n## 제목 후보 (5개)\n1. 3만원 충전기 실화\n\n## 설명\n' +
      '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.\n\n' +
      '## 해시태그\n#충전기\n\n## 썸네일 문구\n3만원의 실력\n',
      'utf8',
    );
    // AI는 산출물을 다 쓴 뒤 마지막에 .done을 만든다 — 서버는 이걸 보고 검증·반영한다
    const t0 = Date.now();
    await fsp.writeFile(path.join(resultDir, '.done'), '', 'utf8');
    const d = await waitFor('결과 감지', async () => {
      const v = await get<PacketView>(`/packets/${p.id}`);
      return v.status === 'received' ? v : null;
    }, 12_000, 200);
    const sec = (Date.now() - t0) / 1000;
    assert(d.validationErrors.length === 0, `검증 오류: ${d.validationErrors.join(', ')}`);
    // 5초 스윕이 안전망으로 잡아주긴 하지만, 그건 워처가 죽었다는 뜻이다.
    // 여기서 통과시키면 워처가 통째로 빠져도 아무도 모른다
    assert(sec < 4, `스윕 폴백으로 반영됨 (${sec.toFixed(1)}초) — 파일 워처가 감지하지 못했다`);
    return `${sec.toFixed(1)}초 만에 반영 (파일 워처)`;
  });

  // ── 완료 + 내보내기 ──
  await step('완료 처리 → 제품 폴더 자동 내보내기', async () => {
    await post(`/jobs/${jid}/transition`, { to: 'done' });
    const dir = path.join(exportRoot, productName);
    await waitFor('내보내기 완료', async () => {
      await abortIfFailed('export.failed');
      const j = await get<JobView>(`/jobs/${jid}`);
      return j.exportedAt ? j : null;
    }, 120_000);

    const finalDir = path.join(dir, '최종영상');
    const finals = await fsp.readdir(finalDir);
    assert(finals.length >= 1, '최종영상 폴더가 비어 있음');
    assert(finals[0].startsWith(productName), `파일명에 제품명이 없음: ${finals[0]}`);

    for (const sub of ['최종영상', '영상', '음성', '대본']) {
      const files = await fsp.readdir(path.join(dir, sub)).catch(() => []);
      assert(files.length > 0, `${sub} 폴더가 비어 있음`);
    }
    const scriptFiles = await fsp.readdir(path.join(dir, '대본'));
    const md = scriptFiles.find((f) => f.endsWith('.md'))!;
    const mdBody = await fsp.readFile(path.join(dir, '대본', md), 'utf8');
    assert(mdBody.includes('쿠팡 파트너스'), '대본에 공시문구 없음');
    assert(mdBody.includes(scenes[0].narration), '대본 내용 불일치');

    const all = await countFiles(dir);
    return `${dir} · ${all}개 파일`;
  });

  // ── 상태 파일 무결성 ──
  await step('상태 파일 · 감사 로그 무결성', async () => {
    const jobJson = JSON.parse(await fsp.readFile(path.join(jobDir, 'job.json'), 'utf8'));
    assert(jobJson.state === 'done', `최종 상태가 done이 아님: ${jobJson.state}`);
    const history: string[] = jobJson.stateHistory.map((h: { state: string }) => h.state);
    for (const expected of ['collecting', 'downloading', 'cleaning', 'scripting', 'voicing', 'assembling', 'review', 'done']) {
      assert(history.includes(expected), `상태 이력에 ${expected} 누락`);
    }
    const events = (await fsp.readFile(path.join(jobDir, 'events.ndjson'), 'utf8'))
      .trim().split('\n').map((l) => JSON.parse(l));
    const types = new Set(events.map((e) => e.type));
    for (const t of ['job.created', 'source.downloaded', 'clip.cleaned', 'script.approved', 'export.done']) {
      assert(types.has(t), `감사 로그에 ${t} 누락`);
    }
    return `상태 ${history.length}단계 · 이벤트 ${events.length}건`;
  });

  await step('요청서 스캔 복원 확인 (재부팅 대비)', async () => {
    const packets = await get<Array<{ id: string; status: string }>>('/packets');
    assert(packets.some((p) => p.id === packetId && p.status === 'accepted'),
      '요청서 인덱스에서 패킷을 찾지 못함');
    return `${packets.length}건 인덱싱됨`;
  });

  // ── 삭제 ──
  // 지금까지 만든 잡은 그대로 두고(--keep으로 열어볼 산출물이다) 버릴 카테고리를 따로 만들어 지운다
  await step('작업·카테고리 삭제 — 휴지통 이동 · 인덱스 정리', async () => {
    const doomed = await post<{ id: string }>('/projects', { menu: 'menu-a', title: '삭제-시험' });
    const job = await post<{ id: string }>(`/projects/menu-a/${doomed.id}/jobs`, { title: '지울편' });
    const packet = await post<{ id: string }>(`/jobs/${job.id}/packets`, { kind: 'script' });

    const jobResult = await del<{ trashed: string }>(`/jobs/${job.id}`);
    // 지운 것이 아니라 옮긴 것이다 — 되돌릴 수 있어야 한다
    const movedJob = path.join(workspace, jobResult.trashed, 'job.json');
    assert(await exists(movedJob), `휴지통에 job.json이 없음: ${jobResult.trashed}`);
    assert(!(await exists(path.join(workspace, 'menu-a', doomed.id, 'jobs', job.id))),
      '원래 자리에 잡 폴더가 남아 있음');

    // 인덱스에서도 빠져야 한다 — 남으면 사라진 폴더를 가리키는 잡·요청서가 화면에 뜬다
    const gone = await fetch(`${API}/jobs/${job.id}`);
    assert(gone.status === 404, `삭제한 잡이 아직 열린다: ${gone.status}`);
    const packets = await get<Array<{ id: string }>>('/packets');
    assert(!packets.some((p) => p.id === packet.id), '삭제한 잡의 요청서가 인덱스에 남음');

    const projResult = await del<{ trashed: string; jobs: number }>(`/projects/menu-a/${doomed.id}`);
    const list = await get<Array<{ id: string }>>('/projects?menu=menu-a');
    assert(!list.some((p) => p.id === doomed.id), '삭제한 카테고리가 목록에 남음');
    assert(await exists(path.join(workspace, projResult.trashed, 'project.json')),
      '카테고리가 휴지통으로 옮겨지지 않음');
    // 작업공간 밖을 가리키는 이름은 400으로 막힌다 (재귀 삭제·이동이 상위로 새면 안 된다).
    // fetch는 `%2e%2e`를 URL 규격대로 정리해 보내므로 여기서는 원시 요청으로 찔러야 한다
    const escape = await rawStatus('DELETE', '/api/projects/menu-a/%2E%2E');
    assert(escape === 400, `상위 경로 삭제가 막히지 않음: ${escape}`);
    assert(await exists(path.join(workspace, 'menu-a')), 'menu-a 폴더가 사라짐');

    return `잡·카테고리 → .trash 이동 · 404 확인 · 상위 경로 차단`;
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 경로를 손대지 않고 그대로 보내는 요청 — fetch가 정리해버리는 `%2E%2E` 같은 값 확인용 */
function rawStatus(method: string, rawPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 4310, method, path: rawPath }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    r.on('error', reject);
    r.end();
  });
}

// step()과 달리 값을 함께 돌려주는 변형
async function step2<T>(name: string, fn: () => Promise<[T, string]>): Promise<T> {
  let value!: T;
  await step(name, async () => {
    const [v, detail] = await fn();
    value = v;
    return detail;
  });
  return value;
}

async function probeJson(file: string): Promise<{
  streams: Array<{ codec_type: string; width?: number; height?: number }>;
  format: { duration: string };
}> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', file]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`ffprobe 종료 ${code}`)));
    p.on('error', reject);
  });
}

/** 특정 스트림(v/a)의 길이 — 오디오·영상 싱크 검증용 */
async function streamDuration(file: string, kind: 'v' | 'a'): Promise<number> {
  const probe = await probeJson(file);
  const s = probe.streams.find((x) => x.codec_type === (kind === 'v' ? 'video' : 'audio'));
  if (!s) return 0;
  // 스트림에 duration이 없으면 컨테이너 길이로 대체
  return Number((s as { duration?: string }).duration ?? probe.format.duration);
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

/** @param keepFiles 실패 시 true — 서버 로그·중간 산출물을 남겨 원인을 볼 수 있게 한다 */
async function cleanup(keepFiles: boolean): Promise<void> {
  // 서버를 확실히 정리한다. 남아 있으면 다음 실행이 낡은 작업공간을 가리키는
  // 이 서버에 붙어버려 원인 파악이 어려운 실패가 난다.
  if (server?.pid) {
    const pid = server.pid;
    const exited = new Promise<void>((r) => server!.once('exit', () => r()));
    try { process.kill(-pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    const timeout = new Promise<void>((r) => setTimeout(r, 3000));
    await Promise.race([exited, timeout]);
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 이미 종료됨 */ }
  }
  mediaServer?.close();
  await new Promise((r) => setTimeout(r, 200));
  if (!KEEP && !keepFiles && workspace) {
    await fsp.rm(path.dirname(workspace), { recursive: true, force: true }).catch(() => {});
  }
}

async function report(): Promise<boolean> {
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  const total = results.reduce((s, r) => s + r.ms, 0);
  console.log(C.bold('\n── 결과 ──'));
  console.log(`  통과 ${C.green(String(results.length - failed.length))} · 실패 ${
    failed.length ? C.red(String(failed.length)) : '0'} · 건너뜀 ${skipped.length} · ${(total / 1000).toFixed(1)}초`);
  if (failed.length) {
    console.log(C.red('\n실패한 단계:'));
    for (const f of failed) console.log(`  ✘ ${f.name}\n    ${f.detail}`);
    // 실패 원인은 대개 서버 쪽 스택에 있다. 파일을 열어보라고 안내만 하지 말고 바로 보여준다
    if (serverLog) {
      console.log(C.dim('\n  서버 로그 (마지막 25줄):'));
      console.log(C.dim(`      ${await tailServerLog(25)}`));
      console.log(C.dim(`\n  전체 로그: ${serverLog}`));
    }
  }
  if (KEEP || failed.length) {
    console.log(C.dim(`\n산출물 보존됨: ${path.dirname(workspace)}`));
  }
  console.log();
  return failed.length === 0;
}

main()
  .then(async () => {
    const ok = await report();
    await cleanup(!ok);
    process.exit(ok ? 0 : 1);
  })
  .catch(async (e) => {
    if (!(e instanceof HarnessFailure)) {
      console.error(C.red(`\n하네스 오류: ${e instanceof Error ? e.stack : String(e)}`));
    }
    await report();
    await cleanup(true);
    process.exit(1);
  });

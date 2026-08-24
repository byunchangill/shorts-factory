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
import { readZip } from '../server/src/util/zip.js';
import type { SceneCutPlan } from '../server/src/pipeline/assemble.js';
import { syllableBudget, TARGET_SEC_BY_MENU } from '../shared/constants.js';

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
let eventsSeen = 0;

/**
 * 여기까지의 이벤트는 본 것으로 친다.
 * **일부러 실패시키는 단계**(훅 게이트 차단 확인) 다음에 부른다 — 안 부르면 그 실패가
 * 로그에 남아 뒤따르는 단계가 남의 실패를 제 것으로 읽고 죽는다.
 */
async function markEventsSeen(): Promise<void> {
  if (!jobDir) return;
  const text = await fsp.readFile(path.join(jobDir, 'events.ndjson'), 'utf8').catch(() => '');
  eventsSeen = text.trim() ? text.trim().split('\n').length : 0;
}

async function jobFailure(...types: string[]): Promise<string | null> {
  if (!jobDir) return null;
  const text = await fsp.readFile(path.join(jobDir, 'events.ndjson'), 'utf8').catch(() => '');
  const lines = text.trim().split('\n');
  for (let i = lines.length - 1; i >= eventsSeen; i--) {
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

/**
 * **다른 잡**의 실패를 확인하고 폴링을 끊는다.
 *
 * `abortIfFailed`는 모듈 전역 `jobDir`(= menu-a 잡)의 파일을 읽으므로 다른 잡에 쓰면
 * 남의 이벤트를 제 것으로 읽는다. 잡 id를 받는 쪽은 API로 묻는다.
 *
 * 🔴 **보는 범위가 다르다.** `abortIfFailed`는 `markEventsSeen()` 워터마크 **뒤부터**
 * 보지만 이쪽은 **잡 생애 전체**를 본다. 그래서 이 잡에 「일부러 실패시키는」 단계가
 * 생기면, 그 뒤의 폴링이 낡은 실패에 영원히 걸린다 — 그런 단계를 넣을 거면
 * 워터마크를 여기에도 들여야 한다.
 */
async function abortIfJobFailed(jid: string, ...types: string[]): Promise<void> {
  const events = await get<Array<{ type: string; error?: string }>>(`/jobs/${jid}/events`);
  const bad = events.find((e) => types.includes(e.type));
  if (!bad) return;
  throw new ProbeAbort(
    `${bad.type} — ${bad.error ?? '(사유 미기록)'}\n      서버 로그:\n      ${await tailServerLog(20)}`);
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

  // 글자 검출기는 선택 설치다 — 깔린 기계에서만 자동 검출을 검사한다 (CI에는 없다)
  let hasOcr = false;
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
    hasOcr = report.tools.some((t) => t.name.startsWith('글자 검출') && t.available);
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
  await step('프로젝트 생성 + 기본 지침 = 대본 스킬', async () => {
    await post('/projects', { menu: 'menu-a', title: productName });
    const g = await get<{ content: string }>(
      `/projects/menu-a/${encodeURIComponent(productName)}/guidelines/script.md`);

    /*
      문구가 아니라 배선을 본다 — 저장소의 스킬 본문이 그대로 깔려야 한다.
      제목 같은 문구로 검사하면 스킬을 고칠 때마다 하네스가 깨진다.
    */
    const raw = await fsp.readFile(
      path.join(REPO_ROOT, '.claude/skills/temcasting-v33/SKILL.md'), 'utf8');
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    assert(g.content.trim() === body,
      `기본 대본 지침이 스킬과 다름 (지침 ${g.content.length}자 / 스킬 ${body.length}자)`);
    return `${productName} · 지침 3종 · 대본은 스킬 ${body.split('\n').length}줄`;
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
    /*
      앞 다운로드가 아직 돌고 있으면 시작 요청이 무시된다 (이중 실행 방지).

      🔴 **소스가 「받음」이 된 뒤에도 큐는 한참 더 돈다** — `downloadOne`이 받은 뒤에
      프레임 추출과 **글자 검출(OCR)**까지 이어서 하기 때문이다. 앞 단계는 상태만 보고
      통과하므로 여기서 그 뒷일을 기다리게 된다.

      상한이 30초였을 때, 글자 검출기가 **깔려 있는** PC에서만 이 단계가 터졌다
      (2026-08-23 실측). 검출기가 없으면 그 대목을 건너뛰어 몇 초 만에 끝나서,
      도구를 다 갖춘 PC일수록 하네스가 실패하는 뒤집힌 상황이었다.
    */
    await waitFor('다운로드 큐 idle', async () => {
      const j = await get<JobView>(`/jobs/${jid}`);
      return j.downloading ? null : true;
    }, 240_000);
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
    /*
      글자 자리는 **받는 김에** 찾는다. 예전에는 「영상 재생성」을 눌러야 찾았고, 그래서
      장면을 고르는 화면이 지울 자리를 모른 채 열렸다. 합성 소재에는 자막을 구워 넣으므로
      검출기가 깔린 기계에서는 여기서 이미 존이 있어야 한다.
    */
    if (hasOcr) {
      assert(list.some((c) => c.zones.length > 0),
        '다운로드 직후에 글자 자리가 하나도 안 잡혔다 (검출기는 설치돼 있음)');
    }
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

  await step('영상 재생성 — 존 채우기 · 고른 구간만 · 무음 · 대본으로 전진', async () => {
    /*
      존이 없는 클립이 어떻게 채워지는지 본다. 글자 검출기가 깔려 있으면 스스로 찾고,
      없으면 다른 클립의 존을 옮겨 쓴다. CI에는 검출기가 없으므로 둘 다 통과해야 한다 —
      합성 영상에는 글자가 없어서, 검출기가 있으면 존 0개가 정답이다.
    */
    const bare = clips[1];
    await put(`/jobs/${jid}/clips/${bare.id}/zones`, { zones: [] });

    const started = await post<{ autoDetect: boolean }>(`/jobs/${jid}/regenerate`, { zonesFrom: clips[0].id });
    const done = await waitFor('재생성 완료', async () => {
      await abortIfFailed('clips.regenerate_failed');
      const j = await get<JobView>(`/jobs/${jid}`);
      return j.state === 'scripting' ? j : null;
    }, 180_000);
    assert(done.state === 'scripting', `대본 단계로 넘어가지 않음: ${done.state}`);

    const after = await get<ClipView[]>(`/jobs/${jid}/clips`);
    assert(after.every((c) => c.segments.length > 0), '컷 구간이 채워지지 않음');
    const bareClip = after.find((c) => c.id === bare.id)!;
    const bareZones = bareClip.zones as Array<{ x: number; y: number; w: number; h: number }>;
    if (started.autoDetect) {
      /*
        합성 영상에는 testsrc2가 좌상단에 타임코드(`00:00:00.467`)를 찍는다. 그게 정답지다 —
        검출기는 그 자리를 찾아야 하고, 화면을 통째로 덮어서는 안 된다. 넓은 존을 만드는
        회귀가 제일 위험하다: 자막이 아니라 영상 자체를 뭉갠 채로 조용히 지나간다.
      */
      assert(bareZones.length > 0, '화면의 글자(타임코드)를 찾지 못함');
      const found = bareZones.some((z) => z.x < 150 && z.y < 60);
      assert(found, `좌상단 타임코드를 못 찾음: ${JSON.stringify(bareZones)}`);
      const frame = W * H;
      for (const z of bareZones) {
        assert((z.w * z.h) / frame < 0.3,
          `존 하나가 화면의 ${Math.round((z.w * z.h) / frame * 100)}%를 덮음 — 영상을 뭉갠다`);
      }
    } else {
      assert(bareZones.length === 2, '존이 없는 클립에 다른 클립의 존이 옮겨지지 않음');
    }

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
    return `${after.length}건 · ${started.autoDetect ? '자동 검출' : '존 전파'} · 무음 · ${after[0].segments.length}컷`;
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
    // 제품자료는 카테고리가 아니라 **영상 작업**에 붙는다
    const up = await fetch(`${API}/jobs/${jid}/product/files`, { method: 'POST', body: fd });
    const upBody = await up.text();
    assert(up.ok, `업로드 실패: ${up.status} ${upBody}`);
    const { errors } = JSON.parse(upBody) as { uploaded: string[]; errors: string[] };
    assert(errors.length === 0, `압축 해제 오류: ${errors.join(', ')}`);

    // 하위 폴더까지 훑어야 요청서에 경로가 실린다
    const listed = await get<{ files: Array<{ name: string }> }>(`/jobs/${jid}/product`);
    const names = listed.files.map((f) => f.name);
    assert(names.includes('상세페이지/가격.txt'), `해제된 파일이 목록에 없음: ${names.join(', ')}`);
    assert(!names.some((n) => n.endsWith('.zip')), '압축 파일이 그대로 남아 있음');

    // 자료가 생겼으니 이제 발행돼야 하고, 요청서에 그 경로가 실려야 한다
    const p = await post<{ id: string }>(`/jobs/${jid}/packets`, { kind: 'product-extract' });
    const d = await get<PacketView>(`/packets/${p.id}`);
    assert(d.requestMd.includes('상세페이지/가격.txt'), '요청서에 첨부 경로가 없음');

    /*
      같은 카테고리의 **다른 작업**에는 이 자료가 보이면 안 된다. 영상 한 편이 제품 하나인데
      카테고리에 붙여두면 두 번째 편이 첫 편의 제품자료로 대본을 쓰게 된다.
    */
    const other = await post<JobView>(
      `/projects/menu-a/${encodeURIComponent(productName)}/jobs`, { title: '자료격리확인' });
    const otherFiles = await get<{ files: Array<{ name: string }> }>(`/jobs/${other.id}/product`);
    assert(otherFiles.files.length === 0,
      `다른 작업에 제품자료가 새어 들어감: ${otherFiles.files.map((f) => f.name).join(', ')}`);
    const blocked = await fetch(`${API}/jobs/${other.id}/packets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'product-extract' }),
    });
    assert(blocked.status === 400, `자료 없는 작업에서 발행이 막히지 않음: ${blocked.status}`);
    await del(`/jobs/${other.id}`);

    return `zip → ${names.length}개 파일 · ${p.id} 발행 · 다른 작업과 격리됨`;
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

  /*
    교리 v3.3을 지키는 대본이어야 서버가 받아준다 (2026-08-21 이식).
    음성 = 자막, 씬마다 block 표시, 2인칭 질문형·스펙 숫자 금지, 어미를 번갈아 놓기.
    **여기가 교리 게이트의 실전 통과 증거다** — 단위 테스트는 함수를 부르지만
    이 대본은 요청서 → 검증 → 반영 → 조립까지 실제 경로를 다 지나간다.
  */
  const NARRATION: Array<[string, string]> = [
    ['hook', '나가실 때 원상 복구해 주세요'],
    ['loss', '집주인 한마디에 심장이 철렁했습니다'],
    ['loss', '견적을 받아 보니 삼십만 원이더라고요'],
    ['source', '인테리어 하는 형한테 물어봤는데'],
    ['product', '타공 없이 벽에 딱 붙는 선반이거든요'],
    ['product', '뗄 때 자국이 하나도 없더라고요'],
    ['product', '무거운 걸 올려도 끄떡없길래'],
    ['product', '세탁실이랑 현관에도 하나씩 붙였네요'],
    ['closing', '전세 사시는 분들 미리 챙겨 두세요'],
    ['closing', '멘탈 지켜 주는 물건이었어요'],
  ];
  const scenes = NARRATION.map(([block, text], i) => ({
    sceneId: `s${String(i + 1).padStart(2, '0')}`,
    narration: text,
    subtitle: text, // 음성 = 자막
    block,
    clipRef: {
      clipId: clips[i % clips.length].id,
      suggestedSegment: { in: 0.5, out: 2.5 },
    },
  }));

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
    /*
      요청서가 「받음」이 되는 것과 잡에 대본 버전이 박히는 것은 **다른 쓰기**다.
      상태만 기다리고 곧바로 잡을 읽으면 그 사이에 걸려 간헐적으로 터진다
      (실측: 4번 중 2번). 검사하는 값을 그대로 기다린다.
    */
    const j = await waitFor('대본 버전 반영', async () => {
      const v = await get<JobView>(`/jobs/${jid}`);
      return v.script.currentVersion === 1 ? v : null;
    }, 30_000);
    return '설명문 섞인 응답에서 JSON 추출 → script_v1 반영';
  });

  await step('요청서 수락 + 대본 승인 (다음 단계 자동 전진)', async () => {
    await post(`/packets/${packetId}/accept`);
    const j = await post<JobView>(`/jobs/${jid}/script/approve`);
    assert(j.script.approved, '대본이 승인되지 않음');
    // 승인 후 곧장 음성이다 — 쓸 구간은 장면 고르기에서 이미 정해졌으므로 컷 선택 단계가 없다
    assert(j.state === 'voicing', `승인 후 상태가 voicing이 아님: ${j.state}`);
    return `승인 → ${j.state}`;
  });

  /*
    컷 구간 API는 남아 있다 — 없앤 것은 「컷 선택」이라는 **단계**지 구간 자체가 아니다.
    구간은 장면 고르기에서 만들어지고 조립이 그걸 그대로 쓴다.
  */
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
        await makeSilentAudio(f, 2);
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

  /*
    훅 화면 변화량 게이트 — 첫 0.5초가 멈춰 있으면 렌더 전에 막는다.
    합성 소재는 거의 정지 화면이라 여기서 반드시 걸려야 한다. 걸린 것을 확인한 뒤에야
    임계를 0으로 내려 조립을 진행한다 — 게이트가 조용히 꺼져 있으면 이 단계가 통과해 버린다.
  */
  await step('훅 변화량 게이트 — 멈춘 첫 컷은 렌더 전에 막는다', async () => {
    await post(`/jobs/${jid}/assemble`, {});
    const failure = await waitFor('게이트 차단', async () => {
      const events = await get<Array<{ type: string; error?: string }>>(`/jobs/${jid}/events`);
      return events.find((e) => e.type === 'assemble.failed') ?? null;
    }, 60_000);
    assert(String(failure.error).includes('훅 화면 변화량'),
      `다른 이유로 실패함: ${failure.error}`);

    const s = await get<Record<string, unknown>>('/settings');
    await put('/settings', { ...s, hookMotionMin: 0 });
    await markEventsSeen(); // 이 실패는 의도한 것이다 — 다음 단계가 물려받으면 안 된다
    return '정지 화면 차단 확인 → 임계 0으로 내리고 진행';
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

    /*
      해외영상 짜집기에는 **텍스트 카드를 넣지 않는다** (2026-08-21 교리 v3.3 이식).
      「말하지 않을 것은 화면에도 없다」가 첫 규칙이라, 무음 구간에 글자만 띄우는 카드는
      음성=자막을 깬다. 그래서 영상 길이가 나레이션 총합과 **같아야** 한다 —
      설정에서 카드를 켜 뒀는데도(위 설정 단계) 안 들어가는 것이 정상이다.
    */
    const narrationTotal = timingsTotal;
    const videoDur = Number(probe.format.duration);
    assert(Math.abs(videoDur - narrationTotal) < 1.0,
      `카드가 새어 들어갔거나 싱크가 깨짐 (영상 ${videoDur.toFixed(1)}초 / 나레이션 ${narrationTotal.toFixed(1)}초)`);
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
  // (아래 조립 시나리오가 같은 카테고리를 이어 쓴다 — 포맷이 카테고리에 붙어서다)
  const bProduct = '테스트세제통';
  /** 아래 조립 시나리오의 타이밍 파일 — 음성 단계와 조립 단계가 같이 본다 */
  const readMenuBTimings = async (bJid: string) => {
    const file = path.join(workspace, 'menu-b', bProduct, 'jobs', bJid, 'voice', 'timing.json');
    const raw = await fsp.readFile(file, 'utf8').catch(() => null);
    return raw ? (JSON.parse(raw) as Array<{ duration: number; source: string }>) : null;
  };

  await step('제품정보리뷰 — 짧은 분량 · 단점 씬 게이트 · 시리즈 예고', async () => {
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

    /*
      메뉴마다 **다른 대본 스킬**이 깔린다 (`MENU_SKILL`).
      제품정보리뷰는 썰형 교리 v1, 해외영상 짜집기는 템캐스팅 v3.3이다 —
      두 포맷은 말투가 정반대라(반말 커뮤니티체 ↔ 존댓말 서사) 섞이면 대본이 흔들린다.
    */
    const bGuide = await get<{ content: string }>(
      `/projects/menu-b/${encodeURIComponent(bProduct)}/guidelines/script.md`);
    assert(!bGuide.content.includes('템캐스팅'),
      'menu-a 대본 스킬이 제품정보리뷰 지침으로 새어 들어옴');
    assert(bGuide.content.includes('썰형'), 'menu-b 기본 대본 스킬이 깔리지 않음');
    assert(bGuide.content.includes('isDownside'),
      '제품정보리뷰 지침에 단점 씬 규칙이 없음 — 코드가 강제하는 규칙이라 지침에도 있어야 한다');

    /*
      ① 요청서가 menu-b 기준(26초)과 그 메뉴의 분량, 단점 씬 규칙을 담아야 한다.

      **글자 수를 여기에 박지 않는다** — 낭독 배속(`settings.speechRate`)이 바뀌면 같이
      움직이는 값이라, 박아 두면 배속을 조정할 때마다 하네스가 엉뚱하게 터진다.
      확인해야 할 것은 「메뉴에 맞는 분량이 실렸는가」다.
    */
    const { speechRate } = await get<{ speechRate: number }>('/settings');
    const bBudget = syllableBudget(speechRate, 'menu-b');
    const aBudget = syllableBudget(speechRate, 'menu-a');
    const p1 = await post<{ id: string }>(`/jobs/${bJob.id}/packets`, { kind: 'script' });
    const req = await get<PacketView>(`/packets/${p1.id}`);
    assert(req.requestMd.includes('26초'), 'menu-b 목표 시간이 요청서에 없음');
    assert(req.requestMd.includes(`${bBudget.max}음절`), 'menu-b 분량 상한이 반영되지 않음');
    assert(!req.requestMd.includes(`${aBudget.max}음절`), 'menu-a 분량 상한이 새어 들어옴');
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
    // 여기도 숫자를 박지 않는다 — 배속이 바뀌면 같이 움직이는 값이다
    const { speechRate: rate } = await get<{ speechRate: number }>('/settings');
    assert(aReq.requestMd.includes(`${syllableBudget(rate, 'menu-a').max}음절`), 'menu-a 분량 기준이 바뀜');
    assert(aReq.requestMd.includes(`${TARGET_SEC_BY_MENU['menu-a'].max}초`), 'menu-a 목표 시간이 바뀜');
    // 교리 v3.3이 요청서에 실려야 한다 (2026-08-21 이식)
    assert(aReq.requestMd.includes('음성 = 자막'), 'menu-a 교리 규칙이 요청서에 없음');

    return '22초 기준 · 단점 씬 없으면 반려 · 회차/해시태그 안내 · menu-a 미적용';
  });

  /*
    ── 제품정보리뷰 조립 (2026-08-24) ──

    위 단계는 **규칙**만 본다 — 대본 반영에서 끝나서, 2026-08-23에 만든 것들이
    E2E로 안 덮였다: 컷 쪼개기(`planCuts`) · 덤 소재 글자 검사(`hasVisibleText`) ·
    띠 레이아웃(`banded`) · menu-b 조립 경로 전체.

    그래서 같은 카테고리에 잡을 하나 더 만들어 **소재 → 대본 → 음성 → 조립**까지 밟는다.
  */
  const bAsm = await step2<{
    jid: string; clips: ClipView[]; maxCut: number; sceneSec: number;
  }>('제품정보리뷰 — 영상 소재 3건 첨부 · 덤 소재 판정 고정', async () => {
    /*
      상한을 하네스에 박지 않는다 — 조립이 쓰는 값과 같은 곳에서 읽는다.
      나레이션이 상한보다 길어야 쪼개진다. **상한의 2.5배**로 잡으면 상한이 바뀌어도
      늘 3컷이고, 정확히 배수인 경계(쪼갤지 말지가 뒤집히는 자리)에 걸리지 않는다.
    */
    const { maxClipExposureSec: maxCut } = await get<{ maxClipExposureSec: number }>('/settings');
    assert(maxCut > 0, '연속 노출 상한이 꺼져 있다 — 켠 채로 돌아야 컷 쪼개기가 검사된다');
    const sceneSec = maxCut * 2.5;

    const j = await post<JobView>(
      `/projects/menu-b/${encodeURIComponent(bProduct)}/jobs`, { title: '조립편' });
    // 소재를 넣기 시작하는 단계가 메뉴마다 다르다 (`sourceEntryState`)
    assert(j.state === 'format_selected', `menu-b 잡 진입 상태가 다름: ${j.state}`);

    // 소재 3건 — ① 대본이 고를 것 ② 컷을 채울 덤 ③ 글자가 남아 빠져야 할 것
    const fd = new FormData();
    for (const i of [0, 1, 2]) {
      const f = path.join(mediaDir, `b${i + 1}.mp4`);
      await makeSyntheticVideo(f, sceneSec, 3 + i);
      fd.append('files', new Blob([await fsp.readFile(f)], { type: 'video/mp4' }), `제품소재${i + 1}.mp4`);
    }
    const r = await fetch(`${API}/jobs/${j.id}/sources/upload`, { method: 'POST', body: fd });
    const text = await r.text(); // 본문은 한 번만 읽을 수 있다
    assert(r.ok, `소재 첨부 실패: ${r.status} ${text}`);
    const after = JSON.parse(text) as JobView;
    assert(after.sources.length === 3, `소재가 3건이 아님: ${after.sources.length}`);
    // 여기서 안 넘어가면 소재는 들어갔는데 단계는 그대로인 잡이 남는다
    assert(after.state === 'cleaning', `소재를 넣었는데 단계가 전진하지 않음: ${after.state}`);

    const clips = await get<ClipView[]>(`/jobs/${j.id}/clips`);
    assert(clips.length === 3, `클립이 3개가 아님: ${clips.length}`);
    assert(clips.every((c) => c.probe && c.frames.length > 0),
      '첨부 소재가 분석되지 않음 (probe·프레임)');

    /*
      🔴 **존을 우리가 정해 넣는다.** 덤 소재를 고를 때 `hasVisibleText`가 존을 보는데,
      합성 소재의 자막 띠는 **글자 검출기가 깔린 기계에서만** 존으로 잡힌다 — 그대로 두면
      이 단계가 PC마다 다른 것을 검사하게 된다 (CI에는 검출기가 없다).

      앞 둘은 비워서 쓸 수 있는 소재로, 세 번째에만 **띠가 못 가리는 화면 한가운데**에
      넣어 빠져야 하는 소재로 만든다. 그러면 정답이 「소재 2개」로 고정된다.
    */
    for (const c of clips.slice(0, 2)) {
      await put(`/jobs/${j.id}/clips/${c.id}/zones`, { zones: [] });
    }
    await put(`/jobs/${j.id}/clips/${clips[2].id}/zones`, {
      zones: [{
        id: 'z1', kind: 'subtitle', method: 'crop',
        x: 40, y: Math.round(H * 0.4), w: W - 80, h: Math.round(H * 0.15),
      }],
    });
    const zoned = await get<ClipView[]>(`/jobs/${j.id}/clips`);
    assert(zoned.slice(0, 2).every((c) => c.zones.length === 0), '덤 소재의 존이 비워지지 않음');
    assert(zoned[2].zones.length === 1, '글자 남은 소재의 존이 저장되지 않음');

    return [
      { jid: j.id, clips: zoned, maxCut, sceneSec },
      `3건 · ${sceneSec.toFixed(1)}초씩 · ${after.state} · 존 고정(0/0/1)`,
    ];
  });

  // 씬 4개 — 썰형 5씬 구조를 줄인 것이고, 단점 씬 1개는 menu-b 필수 요건이다
  const bScenes = [
    { text: '예전에 자취방 싱크대에서 세제통 넘어뜨린 적 있거든', downside: false },
    { text: '그때 커뮤니티에서 벽에 붙이는 통을 알게 됐는데', downside: false },
    { text: '한 손으로 눌러 쓰니까 설거지 흐름이 안 끊기더라', downside: false },
    { text: '대신 스테인리스라 지문은 진짜 잘 묻는다고들 하더라', downside: true },
  ];

  await step('제품정보리뷰 — 대본에 clipRef · 승인(scening) · 씬별 음성 첨부', async () => {
    const { jid: bJid, clips, sceneSec } = bAsm;

    /*
      **서버가 clipRef를 붙여주지 않는다.** 요청서에 소재 현황이 실리고 그걸 보고 AI가 적는다
      (2026-08-23: menu-a 전용으로 묶여 있어 제품리뷰 대본에 clipRef가 안 붙었고,
      조립이 「clipRef도 imageRef도 없음」으로 막혔다). 그 배선을 여기서 본다.
    */
    const p = await post<{ id: string }>(`/jobs/${bJid}/packets`, { kind: 'script' });
    const reqDoc = await get<PacketView>(`/packets/${p.id}`);
    assert(reqDoc.requestMd.includes(clips[0].id),
      '제품정보리뷰 요청서에 소재 현황이 없다 — AI가 clipRef를 적을 근거가 없다');

    const scenes = bScenes.map((s, i) => ({
      sceneId: `s${String(i + 1).padStart(2, '0')}`,
      narration: s.text,
      subtitle: s.text,
      isDownside: s.downside,
      // 대본이 고른 클립이 언제나 첫 컷이다. 나머지는 조립이 덤으로 채운다
      clipRef: { clipId: clips[0].id, suggestedSegment: { in: 0.5, out: 2.5 } },
    }));
    const pasted = await post<{ errors: string[] }>(`/packets/${p.id}/paste`, {
      raw: `\`\`\`json\n${JSON.stringify({ title: '벽에 붙이는 세제통', scenes })}\n\`\`\``,
    });
    assert(pasted.errors.length === 0, `대본이 반려됨: ${pasted.errors.join(', ')}`);
    await waitFor('대본 반영', async () => {
      const v = await get<JobView>(`/jobs/${bJid}`);
      return v.script.currentVersion === 1 ? v : null;
    }, 30_000);

    const approved = await post<JobView>(`/jobs/${bJid}/script/approve`);
    // menu-b는 승인 뒤 씬 만들기다 — menu-a의 voicing과 다르다
    assert(approved.state === 'scening', `menu-b 승인 후 단계가 다름: ${approved.state}`);

    // 타입캐스트는 실제 키가 필요하므로 첨부 경로로 간다 (menu-a 단계와 같은 이유)
    const tmpAudio = path.join(workspace, '_tmp_audio_b');
    await fsp.mkdir(tmpAudio, { recursive: true });
    for (const scene of scenes) {
      const f = path.join(tmpAudio, `${scene.sceneId}.mp3`);
      await makeSilentAudio(f, sceneSec);
      const fd = new FormData();
      fd.append('sceneId', scene.sceneId);
      fd.append('file', new Blob([await fsp.readFile(f)], { type: 'audio/mpeg' }), `${scene.sceneId}.mp3`);
      const up = await fetch(`${API}/jobs/${bJid}/voice/upload`, { method: 'POST', body: fd });
      assert(up.ok, `음성 첨부 실패: ${up.status} ${await up.text()}`);
    }

    await post(`/jobs/${bJid}/tts`, {});
    const timings = await waitFor<Array<{ duration: number; source: string }>>(
      '타이밍 생성', async () => {
        await abortIfJobFailed(bJid, 'tts.failed');
        return readMenuBTimings(bJid);
      }, 60_000);
    assert(timings.length === scenes.length, `타이밍 씬 수 불일치: ${timings.length}`);
    assert(timings.every((t) => t.source === 'file'), '첨부 파일이 우선 사용되지 않음');
    const total = timings.reduce((a, t) => a + t.duration, 0);
    return `${scenes.length}씬(단점 1) · clipRef 반영 · ${approved.state} · 나레이션 ${total.toFixed(1)}초`;
  });

  await step('제품정보리뷰 조립 — 씬 하나가 여러 컷 · 총 길이 불변', async () => {
    const { jid: bJid, maxCut } = bAsm;

    /*
      이 시나리오에서 **텍스트 카드를 끈다.** 제품정보리뷰는 카드를 넣는 메뉴라 켜 두면
      영상이 카드 길이만큼 길어지는데, 카드는 **한글 폰트가 있을 때만** 붙는다 —
      길이 검사가 폰트 유무로 갈린다. 여기서 재려는 것은 「컷을 쪼개도 총 길이가
      그대로인가」다. 그 값이 흔들리면 오디오·자막이 통째로 밀린다.

      띠 레이아웃(`banded`)은 제품정보리뷰의 기본값이라 켜고 돈다.

      훅 게이트(0)는 menu-a 단계가 이미 내려놨으니 **중복이다.** 그래도 적어 둔다 —
      앞 단계가 빠지거나 순서가 바뀌면 합성 소재(정지 화면)가 여기서 조용히 걸리는데,
      그때 원인이 「이 시나리오의 전제가 안 적혀 있어서」가 되면 안 된다.
    */
    const s = await get<Record<string, unknown>>('/settings');
    await put('/settings', { ...s, insertCards: false, layout: 'banded', hookMotionMin: 0 });

    await post(`/jobs/${bJid}/assemble`, {});
    const done = await waitFor('조립 완료', async () => {
      await abortIfJobFailed(bJid, 'assemble.failed');
      const v = await get<JobView>(`/jobs/${bJid}`);
      if (v.state === 'failed') throw new ProbeAbort('조립 실패 상태');
      return v.output.currentVersion ? v : null;
    }, 300_000);

    /*
      컷은 `tmp/`에서 렌더되고 이어 붙인 뒤 지워진다 — 남는 신호가 없어서 조립이
      **컷 계획을 감사 로그에 적는다**(`assemble.done`). 출력 영상의 장면 전환으로
      세는 길도 있지만, 합성 소재가 `testsrc2`라 컷 안에서도 화면이 계속 바뀌어
      오검출이 난다.
    */
    const events = await get<Array<{ type: string; cuts?: SceneCutPlan[] }>>(
      `/jobs/${bJid}/events`);
    const plan = events.filter((e) => e.type === 'assemble.done').at(-1)?.cuts ?? [];
    assert(plan.length === bScenes.length,
      `컷 계획이 씬 수만큼 기록되지 않음: ${JSON.stringify(plan)}`);

    const timings = await readMenuBTimings(bJid);
    assert(timings, '타이밍 파일이 사라짐');
    // ① 씬 하나가 여러 컷으로 쪼개졌는가 — 기대 컷 수도 앱과 같은 재료로 계산한다
    for (const [i, item] of plan.entries()) {
      const dur = Math.max(1, timings[i].duration);
      const want = Math.ceil(dur / maxCut);
      assert(item.cuts === want,
        `${item.sceneId}: ${dur.toFixed(1)}초 / 상한 ${maxCut}초면 ${want}컷인데 ${item.cuts}컷`);
      assert(item.cuts > 1, `${item.sceneId}: 씬이 통째로 한 컷이다 — 쪼개기가 안 걸렸다`);
      /*
        덤 소재를 실제로 끌어다 썼는가. 소재는 3건인데 하나는 화면 한가운데에 글자가
        남아 있어 빠져야 한다 — 정답이 2다. 3이면 글자 남은 소재가 새어 들어간 것이고,
        1이면 같은 영상의 뒤 구간만 이어 튼 것이라 화면이 안 바뀐다.
      */
      assert(item.sources === 2,
        `${item.sceneId}: 쓴 소재가 ${item.sources}개 (대본이 고른 1 + 덤 1 = 2여야 한다)`);
      /*
        ②-a 컷을 쪼갠 **계획**이 나레이션 길이를 정확히 채우는가.

        🔴 **결과물만 재면 「길어짐」을 못 잡는다** (2026-08-24 검증에서 뚫렸다).
        최종 먹싱이 `-shortest`라 컷 합이 길어지면 영상 뒤가 조용히 잘려 출력 길이가
        **정확히** 나레이션 길이가 된다 — 컷을 15% 늘려도 아래 ②-b는 0.02초 차로 통과했다.
        화면은 누적으로 밀리고 마지막 씬 뒤는 사라지는데 총 길이만 완벽해 보인다.
        그래서 잘리기 **전**의 값인 계획을 잰다. 짧아지는 쪽은 ②-b가 잡는다.
      */
      assert(Math.abs(item.sec - dur) < 0.05,
        `${item.sceneId}: 컷 합이 ${item.sec.toFixed(2)}초인데 나레이션은 ${dur.toFixed(2)}초 — `
        + '씬 안에서 어긋나면 뒤 씬이 통째로 밀린다 (출력 길이는 -shortest가 가려 준다)');
    }

    // ②-b 렌더 결과의 총 길이 — 계획대로 나왔는가 (짧아지는 쪽이 여기서 드러난다)
    const finalPath = path.join(
      workspace, 'menu-b', bProduct, 'jobs', bJid, 'output', `final_v${done.output.currentVersion}.mp4`);
    const stat = await fsp.stat(finalPath);
    assert(stat.size > 10_000, `최종 영상이 너무 작음: ${stat.size} bytes`);
    const probe = await probeJson(finalPath);
    const v = probe.streams.find((x) => x.codec_type === 'video')!;
    assert(v.width === 1080 && v.height === 1920, `9:16이 아님: ${v.width}x${v.height}`);

    const narrationTotal = timings.reduce((a, t) => a + t.duration, 0);
    const videoDur = Number(probe.format.duration);
    assert(Math.abs(videoDur - narrationTotal) < 1.0,
      `컷을 쪼갠 뒤 총 길이가 달라짐 (영상 ${videoDur.toFixed(1)}초 / 나레이션 ${narrationTotal.toFixed(1)}초)`);
    const audioDur = await streamDuration(finalPath, 'a');
    assert(Math.abs(audioDur - videoDur) < 1.0,
      `오디오·영상 길이 불일치 — 싱크 깨짐 (영상 ${videoDur.toFixed(1)}초, 오디오 ${audioDur.toFixed(1)}초)`);

    const cuts = plan.reduce((a, x) => a + x.cuts, 0);
    const planned = plan.reduce((a, x) => a + x.sec, 0);
    return `${plan.length}씬 → ${cuts}컷 (소재 2종 · 컷 평균 ${(planned / cuts).toFixed(2)}초) · `
      + `계획 ${planned.toFixed(2)}초 = 나레이션 ${narrationTotal.toFixed(2)}초 · `
      + `출력 ${videoDur.toFixed(1)}초`;
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

  /*
    폴더 내보내기는 **이 PC의 폴더**로 복사한다. 브라우저로 쓰는 사람은 그 폴더가 없을 수도
    있고 원하는 것 하나만 받고 싶을 때가 많다. 같은 목록에서 골라 내려보내므로 폴더에 있는
    것과 받은 것이 같아야 한다.
  */
  await step('산출물 따로 내려받기 — 종류별 · 한글 파일명', async () => {
    const one = await fetch(`${API}/jobs/${jid}/download/final`);
    assert(one.status === 200, `최종영상 내려받기 실패: ${one.status}`);
    const name = decodeURIComponent(
      (one.headers.get('content-disposition') ?? '').split("filename*=UTF-8''")[1] ?? '');
    assert(name.endsWith('.mp4'), `하나뿐이면 zip으로 묶지 않는다: ${name}`);
    assert(name.includes(productName), `한글 파일명이 안 실림: ${name}`);

    const many = await fetch(`${API}/jobs/${jid}/download/script`);
    assert(many.status === 200, `대본 내려받기 실패: ${many.status}`);
    const zip = Buffer.from(await many.arrayBuffer());
    // 여럿이면 zip — 압축 프로그램이 열 수 있어야 한다
    assert(zip.subarray(0, 2).toString('latin1') === 'PK', 'zip이 아님');
    const names = readZip(zip).map((e) => e.name);
    assert(names.some((n) => n.endsWith('.md')), `대본 마크다운 없음: ${names.join(', ')}`);
    assert(names.every((n) => n.includes(productName)), `한글 파일명이 깨짐: ${names.join(', ')}`);

    const empty = await fetch(`${API}/jobs/${jid}/download/없는묶음`);
    assert(empty.status === 400 || empty.status === 404, '모르는 묶음인데 200이 나옴');
    return `최종영상 ${name.slice(-24)} · 대본 zip ${names.length}개`;
  });

  /*
    캡컷에는 공식 연동 API가 없다. 사람이 끌어다 놓는 재료를 만들어 주는데,
    **이름이 곧 순서**라 번호가 씬 순서와 어긋나면 타임라인이 뒤섞인다.
  */
  await step('캡컷 재료 묶음 — 이름이 곧 씬 순서', async () => {
    const r = await fetch(`${API}/jobs/${jid}/download/capcut`);
    assert(r.status === 200, `캡컷 묶음 실패: ${r.status}`);
    const names = readZip(Buffer.from(await r.arrayBuffer())).map((e) => e.name);

    const videos = names.filter((n) => n.startsWith('01_영상/')).sort();
    const audios = names.filter((n) => n.startsWith('02_음성/')).sort();
    assert(videos.length === scenes.length, `영상 수가 씬 수와 다름: ${videos.length}/${scenes.length}`);
    assert(audios.length === scenes.length, `음성 수가 씬 수와 다름: ${audios.length}/${scenes.length}`);
    // 영상과 음성이 번호로 짝지어야 편집기에서 트랙이 맞는다
    for (let i = 0; i < videos.length; i++) {
      const n = String(i + 1).padStart(2, '0');
      assert(videos[i].includes(`/${n}_`), `영상 번호가 순서와 다름: ${videos[i]}`);
      assert(audios[i].includes(`/${n}_`), `음성 번호가 순서와 다름: ${audios[i]}`);
    }
    assert(names.some((n) => n === '03_자막/자막.srt'), `자막이 없음: ${names.join(', ')}`);
    assert(names.some((n) => n === '읽어보세요.md'), '안내문이 없음');
    return `${videos.length}씬 · 영상·음성·자막·안내문`;
  });

  /*
    자료실(짤방·효과음)에서 담은 것은 캡컷 묶음에 같이 들어간다.

    씬 폴더와 달리 **번호를 안 붙인다** — 타임라인에 자동으로 얹힐 것이 아니라
    사람이 필요할 때 골라 쓰는 것이라, 번호가 붙으면 씬과 짝인 것처럼 보인다.
  */
  await step('편집 재료 — 자료실에 올려 잡에 담으면 캡컷 묶음에 들어간다', async () => {
    const fd = new FormData();
    fd.append('files', new Blob([Buffer.from('GIF89a')], { type: 'image/gif' }), '놀란 고양이.gif');
    const up = await fetch(`${API}/assets?kind=meme`, { method: 'POST', body: fd });
    const upText = await up.text(); // 본문은 한 번만 읽을 수 있다
    assert(up.ok, `자료 올리기 실패: ${up.status} ${upText}`);
    const { added } = JSON.parse(upText) as { added: string[] };
    assert(added.length === 1, `올린 자료 수가 다름: ${added.length}`);

    const listed = await get<{ items: Array<{ id: string; title: string; origin: string }> }>('/assets');
    const mine = listed.items.find((i) => i.id === added[0]);
    assert(mine?.origin === 'local', '올린 자료가 이 PC 자료로 잡히지 않음');
    // 저장 파일명은 슬러그라도 제목은 원래 이름이 남아야 목록에서 알아본다
    assert(mine!.title === '놀란 고양이', `제목이 원래 이름이 아님: ${mine!.title}`);

    await put(`/jobs/${jid}/assets`, { assets: added });
    const r = await fetch(`${API}/jobs/${jid}/download/capcut`);
    assert(r.status === 200, `캡컷 묶음 실패: ${r.status}`);
    const names = readZip(Buffer.from(await r.arrayBuffer())).map((e) => e.name);
    assert(names.includes('04_짤방/놀란 고양이.gif'),
      `담은 짤방이 묶음에 없음: ${names.filter((n) => n.startsWith('04')).join(', ')}`);

    /*
      담아둔 뒤 자료실에서 지워도 묶음은 나와야 한다 — 담은 것 하나 때문에
      묶음 전체를 못 받으면 안 된다 (`resolveAssets`가 없어진 id를 조용히 뺀다).
    */
    const del = await fetch(`${API}/assets/${encodeURIComponent(added[0])}`, { method: 'DELETE' });
    assert(del.ok, `자료 삭제 실패: ${del.status}`);
    const after = await fetch(`${API}/jobs/${jid}/download/capcut`);
    assert(after.status === 200, `지운 뒤 캡컷 묶음이 깨짐: ${after.status}`);
    const afterNames = readZip(Buffer.from(await after.arrayBuffer())).map((e) => e.name);
    assert(!afterNames.some((n) => n.startsWith('04_짤방/')),
      '자료실에서 지웠는데 묶음에 그대로 들어 있음');
    return '올리기 → 담기 → 묶음 포함 → 지운 뒤에도 묶음 정상';
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

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
    /*
      카드 한 장이 1.5초라 이 검사는 **카드가 샜는지**만 본다. 여기를 조이면 안 된다 —
      `timingsTotal`은 첨부한 mp3의 **컨테이너** 길이 합이고, 실제로 조립에 들어가는
      것은 규격을 맞춰 다시 인코딩한 음성이라 mp3 프레임 패딩만큼(씬당 0.064초) 짧다.
      길이가 맞는지는 아래에서 영상 자신의 오디오 트랙으로 본다.
    */
    assert(Math.abs(videoDur - narrationTotal) < 1.0,
      `카드가 새어 들어갔거나 싱크가 깨짐 (영상 ${videoDur.toFixed(1)}초 / 나레이션 ${narrationTotal.toFixed(1)}초)`);

    /*
      🔴 여기는 **조인다.** 예전엔 1.0초까지 봐줘서 씬마다 0.064초씩 어긋난 것이
      열 씬 쌓여 0.6초가 돼도 통과했다 — `-shortest`가 짧은 쪽에 맞춰 조용히 잘라내
      화면만 봐서는 아무 표가 안 났다 (2026-08-24). 조립의 길이 불변식이 이걸 막으므로
      여기서도 같은 눈으로 봐야 게이트가 실제로 도는지 확인된다.
    */
    const audioDur = await streamDuration(finalPath, 'a');
    assert(Math.abs(audioDur - videoDur) < 0.15,
      `오디오·영상 길이 불일치 — 싱크 깨짐 (영상 ${videoDur.toFixed(3)}초, 오디오 ${audioDur.toFixed(3)}초)`);

    /*
      자막 시각은 조립이 계획한 길이 위에 잡힌다. 그 계획이 실제 음성보다 길면
      자막이 통째로 늦게 뜨는데, 마지막 큐가 영상 밖으로 밀려나야 비로소 눈에 띈다.
      마지막 큐(공시문구)의 끝이 영상 끝을 넘지 않는지로 그 밀림을 잡는다.
    */
    const ends = [...srt.matchAll(/--> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)]
      .map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
    const lastCueEnd = Math.max(...ends);
    assert(lastCueEnd <= videoDur + 0.15,
      `자막이 영상 밖으로 밀렸습니다 — 마지막 큐 ${lastCueEnd.toFixed(3)}초 / 영상 ${videoDur.toFixed(3)}초`);

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
    제품정보리뷰를 **조립까지** 돌린다.

    2026-08-23에 만든 컷 쪼개기(`planCuts`)·덤 소재 글자 검사(`hasVisibleText`)·띠 레이아웃과
    2026-08-25의 인트로 타이틀은 전부 menu-b 전용이라, menu-a만 훑던 하네스가 통째로
    지나쳤다. 단위 테스트와 손으로 돌린 잡으로만 확인되던 자리다.

    🔴 **픽셀을 본다.** 인트로 제목이 띠 제목과 두 번 겹쳐 찍히는 것은 문자열 검사를
    다 통과하고 **렌더해 보고서야** 드러났다. 그래서 여기서는 완성본에서 프레임을 꺼내
    색으로 확인한다.
  */
  /*
    다음 두 단계가 **같은 잡을 나눠 쓴다.** 뒤 단계는 카드만 켜고 다시 조립해 앞 판과
    비교한다 — 같은 대본·같은 음성이어야 「카드가 늘린 만큼만 길어졌다」를 잴 수 있다.
  */
  let bJobId = '';
  let bJobPath = '';
  let bBaseSettings: Record<string, unknown> = {};
  let bMenuSettings: Record<string, unknown> = {};
  let bCardOffDur = 0;
  let bCardOffVersion = 0;

  await step('제품정보리뷰 조립 — 컷 쪼개기 · 덤 소재 · 인트로 타이틀', async () => {
    const product = '테스트정리함';
    const SCENE_SEC = 4; // 상한(2초)의 두 배 — 씬마다 정확히 두 컷으로 갈린다
    const CUT_SEC = 2;
    const INTRO_SEC = 2;

    const base = await get<Record<string, unknown>>('/settings');
    /*
      카드와 자막은 끈다. 이 단계가 보는 것은 **컷 쪼개기와 길이 불변식**인데,
      카드가 끼면 길이가 카드 수만큼 늘어 「총 길이가 안 변했다」를 잴 수 없고,
      자막이 타면 소재 색을 재려는 자리를 글자가 덮는다. 둘 다 menu-a 단계가 이미 본다.
    */
    const menuBSettings = {
      ...base, layout: 'banded', insertCards: false, burnSubtitles: false,
      maxClipExposureSec: CUT_SEC, introTitleSec: INTRO_SEC,
      hookMotionMin: 0, // 합성 소재는 정지 화면에 가까워 늘 걸린다
      mirror: false, zoom: 1, grade: '',
    };
    await put('/settings', menuBSettings);

    await post('/projects', { menu: 'menu-b', title: product, formatId: 'harness-format' });
    const job = await post<JobView>(
      `/projects/menu-b/${encodeURIComponent(product)}/jobs`, { title: '1편' });

    /*
      소재를 **둘** 넣는다. 하나뿐이면 컷 쪼개기가 같은 소재의 뒤 구간만 꺼내 화면이
      안 바뀌고, 덤 소재를 끌어다 쓰는 경로가 통째로 안 돈다.
      두 합성 영상은 색이 다르므로(`hue=h=seed*60`) 컷이 바뀌면 평균색이 바뀐다.
    */
    for (const name of ['clip1.mp4', 'clip2.mp4']) {
      const fd = new FormData();
      fd.append('files', new Blob([await fsp.readFile(path.join(mediaDir, name))],
        { type: 'video/mp4' }), name);
      const r = await fetch(`${API}/jobs/${job.id}/sources/upload`, { method: 'POST', body: fd });
      assert(r.ok, `${name} 첨부 실패: ${r.status} ${await r.text()}`);
    }
    const bClips = await waitFor('menu-b 클립 분석', async () => {
      const c = await get<ClipView[]>(`/jobs/${job.id}/clips`);
      return c.length === 2 && c.every((x) => x.probe && x.frames.length > 0) ? c : null;
    }, 60_000);

    // 대본은 **첫 클립만** 가리킨다. 뒤를 채우는 덤 소재는 조립이 알아서 고른다
    const bScenes = [
      { sceneId: 'b01', narration: '정리함 하나로 서랍이 통째로 바뀐다.', subtitle: '서랍이 바뀐다' },
      { sceneId: 'b02', narration: '칸이 나뉘어 있어 찾는 시간이 준다.', subtitle: '찾는 시간이 준다' },
      { sceneId: 'b03', narration: '대신 높이가 낮아 큰 물건은 안 들어간다.', subtitle: '큰 건 안 들어가요', isDownside: true },
    ].map((sc) => ({ ...sc, clipRef: { clipId: bClips[0].id } }));

    const pkt = await post<{ id: string }>(`/jobs/${job.id}/packets`, { kind: 'script' });
    const pasted = await post<{ errors: string[] }>(`/packets/${pkt.id}/paste`, {
      raw: `\`\`\`json\n${JSON.stringify({ title: '서랍 정리함', scenes: bScenes })}\n\`\`\``,
    });
    assert(pasted.errors.length === 0, `대본 반려됨: ${pasted.errors.join(', ')}`);
    await waitFor('menu-b 대본 반영', async () => {
      const j = await get<JobView>(`/jobs/${job.id}`);
      return j.script.currentVersion === 1 ? j : null;
    }, 30_000);
    await post(`/packets/${pkt.id}/accept`);
    await post<JobView>(`/jobs/${job.id}/script/approve`);

    // 씬마다 상한의 두 배짜리 음성을 붙인다 → 컷이 정확히 둘로 갈려야 한다
    const audioDir = path.join(workspace, '_tmp_audio_b');
    await fsp.mkdir(audioDir, { recursive: true });
    for (const [i, sc] of bScenes.entries()) {
      const f = path.join(audioDir, `b${i + 1}.mp3`);
      await makeSilentAudio(f, SCENE_SEC);
      const fd = new FormData();
      fd.append('sceneId', sc.sceneId);
      fd.append('file', new Blob([await fsp.readFile(f)], { type: 'audio/mpeg' }), `b${i + 1}.mp3`);
      const r = await fetch(`${API}/jobs/${job.id}/voice/upload`, { method: 'POST', body: fd });
      assert(r.ok, `음성 첨부 실패: ${r.status} ${await r.text()}`);
    }
    await post(`/jobs/${job.id}/tts`, {});
    const bJobDir = path.join(workspace, 'menu-b', product, 'jobs', job.id);
    const bTimings = await waitFor('menu-b 타이밍', async () => {
      const t = await fsp.readFile(path.join(bJobDir, 'voice', 'timing.json'), 'utf8')
        .catch(() => null);
      return t ? JSON.parse(t) as Array<{ duration: number }> : null;
    }, 60_000);
    const narrationTotal = bTimings.reduce((n, t) => n + t.duration, 0);

    // 저작권 게이트는 해외영상 짜집기 전용이다 — 여기서 막히면 안 된다
    const done = await assembleAndWait(job.id, bJobDir, 0);

    const finalPath = path.join(bJobDir, 'output', `final_v${done.output.currentVersion}.mp4`);
    const probe = await probeJson(finalPath);
    const videoDur = Number(probe.format.duration);

    /*
      ① **총 길이는 안 바뀐다.** 컷을 쪼개도 나레이션 길이를 정확히 채워야 한다 —
      달라지면 오디오·자막이 통째로 밀리는데 `-shortest`가 그걸 가린다.

      🔴 기준은 **완성본 자신의 오디오 트랙**이다. `timing.json`은 첨부한 mp3의
      **컨테이너** 길이라 실제 소리보다 mp3 프레임 패딩만큼 길다 (실측 4.000 → 4.056초).
      그걸 기준으로 조이면 멀쩡한 편이 걸린다 — 실제로 이 검사를 그렇게 짰다가 걸렸다.
      `timingsTotal` 쪽은 그래서 느슨하게, 큰 사고(카드 유입 등)만 본다.
    */
    const bAudioDur = await streamDuration(finalPath, 'a');
    assert(Math.abs(videoDur - bAudioDur) < 0.15,
      `컷 쪼개기가 길이를 어긋냈다 — 영상 ${videoDur.toFixed(3)}초 / 오디오 ${bAudioDur.toFixed(3)}초`);
    assert(Math.abs(videoDur - narrationTotal) < 1.0,
      `총 길이가 크게 달라졌다 — 영상 ${videoDur.toFixed(2)}초 / 첨부 음성 합 ${narrationTotal.toFixed(2)}초`);

    const topBandH = Math.round(1920 * Number(base.topBandRatio ?? 0.22));
    /*
      🔴 **화면 폭 전체로 평균을 내면 안 된다.** 합성 소재(testsrc2)는 좌우가 보색이라
      전폭 평균이 서로 상쇄돼 늘 회색(126,128,126)으로 나온다 (실측). 한쪽만 잘라서 잰다.
    */
    const strip = `crop=300:120:150:${topBandH + 20}`;

    /*
      ② **컷이 실제로 쪼개졌고, 덤 소재로 갈아탔다.**

      🔴 「1초와 3초의 색이 다르다」로는 못 본다 — 합성 소재(testsrc2)는 저 혼자
      움직여서 컷을 안 쪼개도 그만큼 달라진다. 실제로 그렇게 짰다가, 컷 쪼개기를
      꺼놓고 돌려도 통과하는 것을 보고 알았다(색차 123으로 그냥 지나갔다).

      대신 **컷 경계에서만 생기는 불연속**을 본다. 한 컷 안에서 0.2초는 이 구역이
      전혀 안 변하는데(실측 색차 0), 경계를 넘으면 다른 소재라 확 튄다(실측 199).
      소재가 하나뿐이라 같은 소재의 뒤 구간을 이어 트는 경우엔 경계가 매끄러워
      여기서 안 걸린다 — 그래서 이 검사는 **덤 소재를 실제로 끌어다 썼는지**까지 본다.
    */
    const insideA = await frameStats(finalPath, 1.0, strip);
    const insideB = await frameStats(finalPath, 1.2, strip);
    const insideGap = colorGap(insideA.mean, insideB.mean);
    const beforeCut = await frameStats(finalPath, CUT_SEC - 0.1, strip);
    const afterCut = await frameStats(finalPath, CUT_SEC + 0.1, strip);
    const cutGap = colorGap(beforeCut.mean, afterCut.mean);
    assert(insideGap < 20,
      `컷 안에서 화면이 흔들린다 — 경계 판정의 기준이 무너졌다 (색차 ${insideGap.toFixed(1)})`);
    assert(cutGap > insideGap + 60,
      `${CUT_SEC}초에서 컷이 안 갈렸다 — 씬 하나를 한 소재로 통째로 틀었다`
      + ` (경계 색차 ${cutGap.toFixed(1)} · 컷 안 ${insideGap.toFixed(1)})`);

    /*
      ③ **인트로 제목이 뜨는 동안 띠 제목은 물러난다.** 안 물리면 같은 문구가 가운데와
      띠에 두 번 찍힌다 — 이건 렌더해 봐야만 드러난다. 띠에 글자가 있으면 밝기
      표준편차가 확 오르고, 평평하면 0에 가깝다.
    */
    const bandCrop = `crop=1080:${topBandH}:0:0`;
    const bandDuringIntro = await frameStats(finalPath, INTRO_SEC / 2, bandCrop);
    const bandAfterIntro = await frameStats(finalPath, INTRO_SEC + 1, bandCrop);
    // 실측: 인트로 중 0.2 / 끝난 뒤 65.8 — 사이가 넓어 임계가 흔들릴 여지가 없다
    assert(bandDuringIntro.std < 8,
      `인트로 중에도 띠 제목이 찍혔다 — 같은 문구가 두 번 나온다 (표준편차 ${bandDuringIntro.std.toFixed(1)})`);
    assert(bandAfterIntro.std > bandDuringIntro.std + 10,
      `인트로가 끝났는데 띠 제목이 안 돌아왔다 (${bandDuringIntro.std.toFixed(1)} → ${bandAfterIntro.std.toFixed(1)})`);

    // 다음 단계가 이 잡에 카드만 켜고 다시 조립한다
    bJobId = job.id;
    bJobPath = bJobDir;
    bBaseSettings = base;
    bMenuSettings = menuBSettings;
    bCardOffDur = videoDur;
    bCardOffVersion = done.output.currentVersion!;

    await put('/settings', base); // 뒤 단계가 menu-a 기준으로 돌도록 되돌린다
    return `${bScenes.length}씬 · ${videoDur.toFixed(1)}초 유지 · 컷 경계 ${cutGap.toFixed(0)}(안 ${insideGap.toFixed(0)})`
      + ` · 띠 ${bandDuringIntro.std.toFixed(1)}→${bandAfterIntro.std.toFixed(1)}`;
  });

  /*
    텍스트 카드는 **여기서만 실제로 렌더된다.**

    `renderCard`를 부르는 곳은 조립 한 군데인데, 그동안 하네스의 어느 시나리오도 그
    경로를 안 밟았다 — 해외영상 짜집기는 교리상 카드를 안 넣고(검사도 「샜는지」만 본다),
    제품정보리뷰는 길이를 재려고 일부러 꺼 뒀다. 단위 테스트는 줄바꿈과 후보 선정만 본다.

    🔴 **길이 불변식이 카드를 콕 집어 말하는데 그 문장이 검증된 적이 없었다**
    (`finalLengthError`의 「카드 무음 구간이나 효과음 믹싱이…」). 카드가 끼면 영상은
    카드만큼 길어지고 오디오도 그만큼 무음이 채워져야 하는데, 한쪽만 늘면
    `-shortest`가 조용히 잘라낸다.

    앞 단계와 **같은 잡에 카드만 켜고 다시 조립해** 두 판을 비교한다.
  */
  await step('텍스트 카드 — 실제로 렌더되고, 늘어난 만큼만 길어진다', async () => {
    assert(bJobId, '앞 단계가 잡을 안 넘겼다');
    const cardSec = Number(bMenuSettings.cardDurationSec ?? 1.5);

    await put('/settings', { ...bMenuSettings, insertCards: true });
    const done = await assembleAndWait(bJobId, bJobPath, bCardOffVersion);
    const version = done.output.currentVersion!;
    assert(version > bCardOffVersion,
      `새 판이 안 나왔다 — v${bCardOffVersion} 그대로다`);

    const withCards = path.join(bJobPath, 'output', `final_v${version}.mp4`);
    const dur = Number((await probeJson(withCards)).format.duration);

    /*
      ① **카드 길이만큼만 늘어난다.**

      카드가 몇 장 붙는지는 **다시 계산하지 않는다** — 앱 로직(`i > 0` · 자막 길이)을
      테스트에 두 벌 두는 셈이라 규칙이 바뀌면 같이 어긋난다. 늘어난 시간이
      `cardDurationSec`의 **정수 배**인지만 본다.
    */
    const added = dur - bCardOffDur;
    const cards = Math.round(added / cardSec);
    assert(cards >= 1,
      `카드가 하나도 안 붙었다 — 켜기 전 ${bCardOffDur.toFixed(2)}초 · 켠 뒤 ${dur.toFixed(2)}초`);
    assert(Math.abs(added - cards * cardSec) < 0.2,
      `늘어난 시간이 카드 길이의 배수가 아니다 — ${added.toFixed(3)}초는`
      + ` ${cardSec}초로 안 나눠떨어진다 (카드 ${cards}장이면 ${(cards * cardSec).toFixed(2)}초)`);

    /*
      ② 🔴 **길이 불변식이 카드 무음까지 맞춘다.** 영상만 늘고 오디오가 안 늘면
      `-shortest`가 뒤를 잘라 끝문장이 통째로 날아간다 — 이 검사가 그동안 없었다.
    */
    const audioDur = await streamDuration(withCards, 'a');
    assert(Math.abs(dur - audioDur) < 0.15,
      `카드가 영상만 늘렸다 — 영상 ${dur.toFixed(3)}초 / 오디오 ${audioDur.toFixed(3)}초`);

    /*
      ③ **카드가 실제로 그려졌다** — 무음만 늘어난 게 아니다.

      씬 세 개가 같은 길이라 첫 카드는 `앞판÷3` 지점에서 시작한다. 카드는 어두운
      정지 화면(`#111827`)이고 소재는 형광색 합성 영상이라 밝기로 확실히 갈린다.
    */
    const sceneEnd = bCardOffDur / 3;
    const mid = `crop=1080:600:0:660`; // 카드 글자와 소재가 모두 걸리는 화면 가운데
    const onCard = await frameStats(withCards, sceneEnd + cardSec / 2, mid);
    const onScene = await frameStats(withCards, sceneEnd / 2, mid);
    const lum = (m: [number, number, number]) => 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
    assert(lum(onCard.mean) < lum(onScene.mean) - 40,
      `카드 자리에 카드가 안 보인다 — 무음만 늘어난 것 같다`
      + ` (카드 ${lum(onCard.mean).toFixed(0)} · 소재 ${lum(onScene.mean).toFixed(0)})`);

    await put('/settings', bBaseSettings); // 뒤 단계는 menu-a 기준으로 돈다
    return `카드 ${cards}장 · +${added.toFixed(2)}초 (${cardSec}초×${cards})`
      + ` · 밝기 ${lum(onScene.mean).toFixed(0)}→${lum(onCard.mean).toFixed(0)}`;
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

/**
 * 완성본의 한 프레임에서 **잘라낸 영역**의 색 통계를 낸다.
 *
 * 픽셀을 봐야만 잡히는 것들이 있다 — 컷이 실제로 다른 소재로 바뀌었는지(평균색),
 * 띠에 글자가 들어 있는지(표준편차)는 문자열 검사로는 절대 안 나온다.
 * 실제로 인트로 제목이 띠 제목과 **두 번 겹쳐 찍히는 것**을 렌더해 보고서야 잡았다.
 */
async function frameStats(
  file: string, at: number, crop: string,
): Promise<{ mean: [number, number, number]; std: number }> {
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1',
      '-vf', `${crop},format=rgb24`, '-f', 'rawvideo', '-',
    ]);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.on('close', (code) => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(`ffmpeg 종료 ${code}`)));
    p.on('error', reject);
  });
  if (raw.length < 3) throw new Error(`${at}초 프레임을 못 읽음`);
  const sum = [0, 0, 0];
  for (let i = 0; i + 2 < raw.length; i += 3) {
    sum[0] += raw[i]; sum[1] += raw[i + 1]; sum[2] += raw[i + 2];
  }
  const n = Math.floor(raw.length / 3);
  const mean: [number, number, number] = [sum[0] / n, sum[1] / n, sum[2] / n];
  // 밝기 표준편차 — 평평한 띠는 0에 가깝고, 글자가 들어가면 확 오른다
  let acc = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const y = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
    const my = 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2];
    acc += (y - my) ** 2;
  }
  return { mean, std: Math.sqrt(acc / n) };
}

/**
 * 조립을 돌리고 **새 버전이 나올 때까지** 기다린다.
 *
 * 실패는 잡 상태가 아니라 이벤트로만 남으므로(`assemble.failed`) 그걸 같이 본다 —
 * 안 보면 이미 실패한 조립을 상한까지 기다린다.
 *
 * @param after 이 버전보다 커져야 끝난 것으로 친다. 같은 잡을 다시 조립할 때 쓴다 —
 *              0으로 두면 「버전이 생기기만 하면」이라 **직전 판을 그대로 집어 온다**
 */
async function assembleAndWait(jobId: string, dir: string, after: number): Promise<JobView> {
  await post(`/jobs/${jobId}/assemble`, {});
  return waitFor(`조립 (v${after + 1} 이상)`, async () => {
    const text = await fsp.readFile(path.join(dir, 'events.ndjson'), 'utf8').catch(() => '');
    for (const line of text.trim().split('\n').reverse()) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as { type?: string; error?: string };
        if (e.type === 'assemble.failed') {
          throw new ProbeAbort(`assemble.failed — ${e.error || '(사유 미기록)'}`);
        }
        if (e.type === 'assemble.done') break; // 이번 판이 끝났다 — 그 앞의 옛 실패는 안 본다
      } catch (err) {
        if (err instanceof ProbeAbort) throw err;
        /* 기록 중이라 잘린 줄 */
      }
    }
    const v = await get<JobView>(`/jobs/${jobId}`);
    return (v.output.currentVersion ?? 0) > after ? v : null;
  }, 300_000);
}

/** 두 평균색이 얼마나 다른가 (0~441) */
function colorGap(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
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

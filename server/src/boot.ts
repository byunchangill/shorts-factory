import { initWorkspace } from './store/workspace.js';
import { scanJobs, listJobRefs } from './store/jobs.js';
import { reconcileDownloadState } from './pipeline/downloadQueue.js';
import { scanPackets } from './claude/packets.js';
import { startResultWatcher, startResultSweep, catchUpPendingResults } from './claude/resultWatcher.js';

/**
 * 부팅 상태.
 *
 * 초기화(workspace 스캔·워처·도구 점검)를 app.listen()보다 먼저 끝내려 하면,
 * 그중 하나라도 느리거나 멈출 때 포트가 열리지 않아 웹 UI의 모든 요청이
 * ECONNREFUSED로 실패한다 — 사용자에게는 "앱 전체가 고장난" 것으로 보인다.
 * 그래서 서버는 먼저 포트를 열고, 초기화는 그 뒤에 돌리며, 아직 준비 전이면
 * 503과 함께 이유를 알려준다.
 */
export type BootPhase = 'starting' | 'ready' | 'degraded';

export interface BootStep {
  name: string;
  ms: number;
  error?: string;
}

export interface BootState {
  phase: BootPhase;
  startedAt: string;
  readyAt?: string;
  steps: BootStep[];
}

const state: BootState = {
  phase: 'starting',
  startedAt: new Date().toISOString(),
  steps: [],
};

export function bootState(): BootState {
  return { ...state, steps: [...state.steps] };
}

/** 준비 전에는 API가 빈 인덱스로 잘못된 답을 주지 않도록 막는다 */
export function isReady(): boolean {
  return state.phase !== 'starting';
}

async function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    state.steps.push({ name, ms: Date.now() - t0 });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    state.steps.push({ name, ms: Date.now() - t0, error });
    // 한 단계가 실패해도 서버는 계속 뜬다. 대신 상태를 남겨 화면에서 보이게 한다.
    console.error(`[boot] ${name} 실패:`, e instanceof Error ? (e.stack ?? e.message) : e);
  }
}

/**
 * 다운로드는 끝났는데 다음 단계로 못 넘어간 잡을 풀어준다.
 * 전진은 다운로드 요청의 백그라운드 콜백에서 일어나므로, 그 사이 서버가 재시작되면
 * 소스는 전부 "완료"인데 상태만 `downloading`에 갇힌다. 부팅 때 한 번 훑어 수습한다.
 */
async function recoverStalledDownloads(): Promise<void> {
  let recovered = 0;
  for (const ref of listJobRefs()) {
    try {
      if (await reconcileDownloadState(ref)) {
        recovered++;
        console.log(`[boot] 중단된 다운로드 수습: ${ref.jobId} → 자막/워터마크 제거 단계`);
      }
    } catch (e) {
      console.error(`[boot] ${ref.jobId} 수습 실패:`, e instanceof Error ? e.message : e);
    }
  }
  if (recovered) console.log(`[boot] 멈춰 있던 잡 ${recovered}건을 다음 단계로 전진시켰습니다`);
}

/**
 * workspace 초기화 + 인덱스 재구성 + 요청서 워처 기동.
 * 절대 throw 하지 않는다 — 실패는 부팅 상태에 기록되고 phase가 degraded가 된다.
 */
export async function bootstrap(): Promise<BootState> {
  await step('workspace 초기화', () => initWorkspace());
  await step('잡 인덱스 스캔', () => scanJobs());
  await step('요청서 인덱스 스캔', () => scanPackets());
  await step('요청서 결과 워처', () => startResultWatcher());
  await step('밀린 결과 수습', () => catchUpPendingResults());
  await step('결과 재확인 타이머', () => startResultSweep());
  await step('중단된 다운로드 수습', recoverStalledDownloads);

  const failed = state.steps.filter((s) => s.error);
  state.phase = failed.length ? 'degraded' : 'ready';
  state.readyAt = new Date().toISOString();
  if (failed.length) {
    console.warn(
      `⚠️  부팅 중 ${failed.length}건 실패 — 일부 기능이 동작하지 않을 수 있습니다: ` +
        failed.map((s) => s.name).join(', '),
    );
  }
  return bootState();
}

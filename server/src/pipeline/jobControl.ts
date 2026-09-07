import type { JobRef } from '../store/jobs.js';
import { mutateJob, readJob, listJobRefs } from '../store/jobs.js';

/**
 * 긴 작업의 제어 — 중복 실행 차단 · 취소 · 일시정지 · 중단 감지.
 *
 * **조립은 몇 분이 걸리는데 시작하면 손댈 방법이 없었다.** 두 번 누르면 같은 잡에 렌더가
 * 두 개 붙어 같은 `output/tmp/`에 쓰고 판 번호가 둘 다 올라갔다. 서버가 죽으면 그 잡은
 * `assembling`에 갇힌 채 아무 신호도 없이 남았다 — 다운로드만 부팅 때 수습하고 있었다.
 *
 * ClipFlow(`auto.rs`)가 43줄로 갖춘 것을 옮겨 왔다: `BUSY`/`CANCEL`/`PAUSE` 원자 플래그 +
 * 단계 사이의 `checkpoint()` + 재시작 때 `running`을 `interrupted`로 바꾸는 복구.
 *
 * 🔴 **메모리만으로는 중단 복구가 안 된다.** 이 맵은 프로세스와 함께 죽는다. 그래서
 * 시작할 때 `job.json`에 표식을 남기고(`markRunning`), 부팅이 그 표식을 보고 수습한다
 * (`recoverInterrupted`). 요청서 재반영을 `packet.appliedAt`으로 막는 것과 같은 결이다.
 */

/** 제어 대상 작업. 잡 하나에 하나만 돈다 */
export type JobTask = 'assemble' | 'clean' | 'voice';

export const TASK_LABEL: Record<JobTask, string> = {
  assemble: '조립',
  clean: '자막·워터마크 제거',
  voice: '음성 생성',
};

/** 취소로 끝난 작업. 실패와 구분해야 화면이 「오류」라고 말하지 않는다 */
export class CancelledError extends Error {
  constructor(message = '사용자가 취소했습니다.') {
    super(message);
    this.name = 'CancelledError';
  }
}

interface Running {
  task: JobTask;
  startedAt: number;
  cancel: boolean;
  pause: boolean;
  /** 실제로 멈춰 선 상태인가. 「멈추는 중」과 「멈췄다」는 화면에서 다르게 보여야 한다 */
  paused: boolean;
}

const running = new Map<string, Running>();

export interface JobControlState {
  task: JobTask;
  label: string;
  startedAt: number;
  cancelRequested: boolean;
  pauseRequested: boolean;
  paused: boolean;
}

/** 지금 이 잡에서 도는 작업. 없으면 null */
export function controlState(jobId: string): JobControlState | null {
  const r = running.get(jobId);
  if (!r) return null;
  return {
    task: r.task,
    label: TASK_LABEL[r.task],
    startedAt: r.startedAt,
    cancelRequested: r.cancel,
    pauseRequested: r.pause,
    paused: r.paused,
  };
}

export function isBusy(jobId: string): boolean {
  return running.has(jobId);
}

/**
 * 작업 시작을 잡는다. 이미 돌고 있으면 **던진다.**
 *
 * 🔴 조용히 두 번째를 시작시키면 같은 잡에 렌더가 둘 붙는다 — 실제로 조립 버튼을 두 번
 * 누르면 그렇게 됐다. 요청서 실행이 `inFlight`로 같은 것을 막는 전례가 있다(`cliRunner`).
 */
export function begin(jobId: string, task: JobTask): void {
  const cur = running.get(jobId);
  if (cur) {
    throw new Error(`이미 ${TASK_LABEL[cur.task]}이(가) 실행 중입니다 — 끝나거나 취소한 뒤에 다시 하세요.`);
  }
  running.set(jobId, { task, startedAt: Date.now(), cancel: false, pause: false, paused: false });
}

export function end(jobId: string): void {
  running.delete(jobId);
}

/** 취소 요청. 다음 `checkpoint()`에서 끊긴다 */
export function requestCancel(jobId: string): boolean {
  const r = running.get(jobId);
  if (!r) return false;
  r.cancel = true;
  // 멈춰 있는 작업도 취소로 깨어나야 한다 — 안 그러면 일시정지가 취소를 삼킨다
  r.pause = false;
  return true;
}

/** 일시정지·재개 요청 */
export function requestPause(jobId: string, on: boolean): boolean {
  const r = running.get(jobId);
  if (!r) return false;
  r.pause = on;
  if (!on) r.paused = false;
  return true;
}

/** 멈춰 있는 동안 얼마나 자주 깨어 확인할지 */
const PAUSE_POLL_MS = 150;

/**
 * 단계 사이에서 부르는 검문소.
 *
 * 취소면 던지고, 일시정지면 풀릴 때까지 기다린다. **부르지 않으면 아무 효과가 없다** —
 * 긴 루프(씬마다·컷마다)의 경계에 놓는다. 서브프로세스 하나가 몇 분이면 그 안에서는
 * 못 끊으므로, 조각을 잘게 렌더하는 자리가 곧 반응 속도다.
 */
export async function checkpoint(jobId: string): Promise<void> {
  const r = running.get(jobId);
  if (!r) return; // 제어 밖에서 도는 호출(하네스·테스트)은 그냥 지나간다
  if (r.cancel) throw new CancelledError();
  while (r.pause && !r.cancel) {
    r.paused = true;
    await new Promise((resolve) => setTimeout(resolve, PAUSE_POLL_MS));
  }
  r.paused = false;
  if (r.cancel) throw new CancelledError();
}

/** 이 잡에 넘길 검문소 함수. 파이프라인은 잡 id를 몰라도 된다 */
export function checkpointFor(jobId: string): () => Promise<void> {
  return () => checkpoint(jobId);
}

export function isCancelled(e: unknown): boolean {
  return e instanceof CancelledError;
}

/** 화면·API가 쓰는 요약 (`jobView`에 실린다) */
export function controlSummary(ref: JobRef): JobControlState | null {
  return controlState(ref.jobId);
}

/**
 * 작업을 잡고 디스크에도 표식을 남긴다.
 *
 * 메모리 잠금이 먼저다 — 표식 쓰기(파일 락)를 기다리는 사이 두 번째 요청이 들어오면
 * 둘 다 통과한다. 중복 차단은 동기적으로 끝나야 뜻이 있다.
 */
export async function beginJob(ref: JobRef, task: JobTask): Promise<void> {
  begin(ref.jobId, task);
  try {
    await mutateJob(ref, (j) => {
      j.running = { task, startedAt: new Date().toISOString() };
    });
  } catch (e) {
    // 표식을 못 남겼으면 잠금도 푼다 — 안 그러면 아무도 안 도는 잡이 영원히 「실행 중」이다
    end(ref.jobId);
    throw e;
  }
}

/**
 * 작업을 놓고 표식을 지운다.
 *
 * **던지지 않는다.** 이 함수는 `finally`에서 불리는데, 여기서 던지면 원래 실패 사유가
 * 이 오류에 덮여 사라진다.
 */
export async function endJob(ref: JobRef): Promise<void> {
  end(ref.jobId);
  await mutateJob(ref, (j) => { delete j.running; }).catch((e) => {
    console.error(`[jobControl] ${ref.jobId} 표식 정리 실패:`, e instanceof Error ? e.message : e);
  });
}

/**
 * 부팅 때 중단된 작업을 수습한다.
 *
 * 🔴 **부팅 시점에는 도는 작업이 있을 수 없다** — 그러니 남아 있는 표식은 전부 앱이
 * 죽으면서 끊긴 것이다 (업로드 대기 자리를 비우는 것과 같은 논리).
 *
 * `failed`로 보내는 이유는 그 상태에서 **어느 단계로든 다시 갈 수 있기** 때문이다
 * (`stateMachine`). 조용히 `assembling`에 두면 사용자는 아직 도는 줄 알고 기다린다.
 */
export async function recoverInterrupted(): Promise<number> {
  let recovered = 0;
  for (const ref of listJobRefs()) {
    try {
      const job = await readJob(ref);
      if (!job?.running) continue;
      const label = TASK_LABEL[job.running.task];
      await mutateJob(ref, (j) => {
        delete j.running;
        j.state = 'failed';
        j.error = `앱이 종료되어 ${label}이(가) 중단됐습니다. 원본과 설정을 확인한 뒤 다시 시작하세요.`;
      });
      recovered++;
      console.log(`[boot] 중단된 ${label} 표시: ${ref.jobId}`);
    } catch (e) {
      console.error(`[boot] ${ref.jobId} 중단 수습 실패:`, e instanceof Error ? e.message : e);
    }
  }
  return recovered;
}

/** 테스트용 — 메모리 잠금을 전부 푼다 */
export function resetJobControl(): void {
  running.clear();
}

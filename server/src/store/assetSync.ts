import fsp from 'node:fs/promises';
import path from 'node:path';
import { run, toolFailureMessage } from '../util/exec.js';
import { exists, ensureDir } from '../util/fsx.js';
import { loadSettings } from './workspace.js';
import { getKey } from './secrets.js';
import { assetPaths, readLocalState, writeLocalState } from './assets.js';

/**
 * 공용 자료(짤방·효과음) 받아오기.
 *
 * **관리자가 올리면 모든 PC에 퍼진다**가 요구사항이고, 그 통로가 이 파일이다.
 * 자료는 **별도 저장소**에 둔다 — 이 저장소는 public이라 인터넷 짤·방송 캡처를
 * 여기 커밋하면 저작권이 남은 남의 저작물을 공개 배포하는 셈이 된다.
 *
 * 받는 자리는 `workspace/assets/shared/`다. `workspace/`는 gitignore 대상이라
 * 저장소 안에 저장소가 들어가도 이 리포의 깃이 그것을 보지 않는다.
 */

/** 동기화가 오래 걸려도 서버를 붙잡고 있지 않게 — 22MB 클론이 이보다 오래 걸릴 이유가 없다 */
const SYNC_TIMEOUT_MS = 5 * 60_000;

/**
 * git이 자격증명을 물어보지 못하게 막는다.
 *
 * `run()`은 표준입력을 닫는데, 그것만으로는 부족하다 — 윈도우의 자격증명 관리자는
 * **창을 띄워** 묻기 때문에 서버가 응답 없이 상한까지 매달린다. private 저장소에
 * 토큰 없이 접근하면 물어보지 말고 그냥 실패해야 원인이 화면에 뜬다.
 */
const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
};

export interface SyncStatus {
  configured: boolean;
  repoUrl: string;
  hasToken: boolean;
  /** 받아둔 것이 있는가 (`.git`이 있으면 클론된 것) */
  cloned: boolean;
  syncedAt?: string;
}

export async function syncStatus(): Promise<SyncStatus> {
  const settings = await loadSettings();
  const repoUrl = (settings.assetsRepoUrl ?? '').trim();
  const state = await readLocalState();
  return {
    configured: Boolean(repoUrl),
    repoUrl,
    hasToken: Boolean(await getKey('assetsToken')),
    cloned: await exists(path.join(assetPaths.shared(), '.git')),
    syncedAt: state.syncedAt,
  };
}

/**
 * 토큰을 URL에 심는다 (private 저장소용).
 *
 * 🔴 **이 값은 로그·에러 메시지에 절대 나가면 안 된다.** git이 실패하면 명령줄을 통째로
 * 되돌려주는데 거기에 토큰이 들어 있다 — `maskToken()`으로 반드시 지우고 내보낸다.
 */
function withToken(repoUrl: string, token: string): string {
  if (!token) return repoUrl;
  if (!/^https:\/\//i.test(repoUrl)) return repoUrl; // ssh 주소는 키로 인증한다
  return repoUrl.replace(/^https:\/\//i, `https://x-access-token:${token}@`);
}

/** 메시지에서 토큰을 지운다. 토큰이 안 섞였어도 자격증명 형태는 통째로 가린다 */
export function maskToken(message: string, token: string): string {
  let out = message;
  if (token) out = out.split(token).join('***');
  return out.replace(/https:\/\/[^@\s]+@/gi, 'https://***@');
}

export interface SyncResult {
  /** cloned = 처음 받음, pulled = 갱신함 */
  how: 'cloned' | 'pulled';
  output: string;
}

/**
 * 공용 자료를 받아온다. 처음이면 clone, 이미 있으면 pull.
 *
 * `--ff-only`인 이유: 이 폴더는 **받기만 하는 자리**다. 각 PC에서 로컬 커밋이 생길 일이
 * 없고, 혹시 생겼다면 자동 병합으로 뭉개는 것보다 멈추고 알리는 쪽이 맞다.
 */
export async function syncSharedAssets(): Promise<SyncResult> {
  const settings = await loadSettings();
  const repoUrl = (settings.assetsRepoUrl ?? '').trim();
  if (!repoUrl) {
    throw Object.assign(
      new Error('공용 자료 저장소 주소가 없습니다 — 설정에서 넣어주세요'),
      { status: 400 },
    );
  }
  const token = await getKey('assetsToken');
  const authed = withToken(repoUrl, token);
  const dir = assetPaths.shared();
  const cloned = await exists(path.join(dir, '.git'));

  try {
    if (cloned) {
      const r = await run('git', ['-C', dir, 'pull', '--ff-only'], {
        timeoutMs: SYNC_TIMEOUT_MS, env: GIT_ENV,
      });
      await stampSyncedAt();
      return { how: 'pulled', output: maskToken(String(r.stdout || '갱신 완료'), token) };
    }
    /*
      클론은 **빈 폴더를 요구한다.** 로컬 자료는 형제 폴더(local/)에 있으니 안전하지만,
      앞선 시도가 반쯤 만들어 놓은 폴더가 남아 있을 수 있어 비어 있을 때만 지운다.
    */
    await ensureDir(assetPaths.root());
    if (await exists(dir)) {
      const left = await fsp.readdir(dir).catch(() => [] as string[]);
      if (left.length === 0) await fsp.rmdir(dir).catch(() => {});
      else {
        throw Object.assign(
          new Error(`${dir} 에 이미 파일이 있습니다 — 폴더를 비우고 다시 받아주세요`),
          { status: 409 },
        );
      }
    }
    const r = await run('git', ['clone', '--depth', '1', authed, dir], {
      timeoutMs: SYNC_TIMEOUT_MS, env: GIT_ENV,
    });
    await stampSyncedAt();
    return { how: 'cloned', output: maskToken(String(r.stdout || '받기 완료'), token) };
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw Object.assign(
      new Error(maskToken(toolFailureMessage(e), token)),
      { status: 502 },
    );
  }
}

async function stampSyncedAt(): Promise<void> {
  const state = await readLocalState();
  state.syncedAt = new Date().toISOString();
  await writeLocalState(state);
}

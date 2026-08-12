import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Menu } from '@shared/constants';
import { paths, WORKSPACE_ROOT, toWorkspaceRel } from './workspace.js';
import { ensureDir, exists, listDirs } from '../util/fsx.js';
import { forgetJob, type JobRef } from './jobs.js';
import { forgetPacketsUnder } from '../claude/packets.js';
import { isDownloading } from '../pipeline/downloadQueue.js';
import { broadcast } from '../sse.js';

/**
 * 카테고리·작업 삭제.
 *
 * **지우지 않고 `workspace/.trash/`로 옮긴다.** 카테고리 하나에 원본 영상·정리본·음성·
 * 대본 버전이 전부 들어 있어, 잘못 누른 한 번이 몇 시간치 작업을 되돌릴 수 없게 만든다.
 * 옮기기는 같은 볼륨 안의 rename이라 용량과 무관하게 즉시 끝나고, 되돌리려면 사용자가
 * 폴더를 원래 자리로 옮기면 된다 (그래서 응답에 옮겨진 경로를 실어 보낸다).
 * 정말 지우고 싶으면 `.trash`를 통째로 비우면 된다.
 *
 * 내보내기 폴더(`{exportRoot}/{제품명}/`)는 건드리지 않는다 — 작업공간 밖의
 * 사용자 결과물이고, 삭제 대상은 제작 과정이지 완성본이 아니다.
 */

/** 프로젝트가 아닌 예약 폴더 — 삭제 요청이 와도 카테고리로 취급하지 않는다 */
const RESERVED_DIRS = new Set(['formats', 'templates', '_requests']);

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * 삭제 대상 경로 검증.
 *
 * `:menu/:pid`는 URL에서 그대로 오는 값이라 `..`이 섞이면 재귀 삭제·이동이
 * 작업공간 밖을 건드린다. 부모가 정확히 예상한 폴더인지까지 본다 —
 * 경로 구분자나 상위 이동이 섞이면 그 순간 어긋난다.
 */
function assertChildOf(parent: string, target: string, label: string): void {
  if (path.dirname(path.resolve(target)) !== path.resolve(parent)) {
    throw httpError(400, `잘못된 ${label} 이름입니다`);
  }
  const rel = path.relative(WORKSPACE_ROOT, path.resolve(target));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw httpError(400, `작업공간 밖은 삭제할 수 없습니다: ${label}`);
  }
}

/** 윈도우에서 폴더 안 파일을 다른 프로세스가 잡고 있으면 rename이 잠깐 막힌다 */
const RENAME_RETRY_MS = [50, 150, 400];

async function moveToTrash(src: string, menu: Menu, name: string): Promise<string> {
  const trashDir = path.join(paths.trash(), menu);
  await ensureDir(trashDir);

  // 같은 이름을 같은 초에 두 번 지우는 경우가 있다 (지우고 다시 만들고 또 지우기)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let dest = path.join(trashDir, `${name}--${stamp}`);
  for (let n = 2; await exists(dest); n++) dest = path.join(trashDir, `${name}--${stamp}-${n}`);

  for (let i = 0; ; i++) {
    try {
      await fsp.rename(src, dest);
      return toWorkspaceRel(dest);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (i >= RENAME_RETRY_MS.length || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(code)) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(code)) {
          throw httpError(409, '폴더 안의 파일이 사용 중입니다. 처리(다운로드·조립·미리보기)가 끝난 뒤 다시 시도하세요');
        }
        throw e;
      }
      await new Promise((r) => setTimeout(r, RENAME_RETRY_MS[i]));
    }
  }
}

export interface TrashResult {
  /** 옮겨진 위치 (작업공간 기준 상대경로) — 되돌릴 수 있게 화면에 보여준다 */
  trashed: string;
}

/**
 * 영상 작업 1건 삭제.
 * 소재·클립·대본·요청서·산출물이 한 폴더 안에 있으므로 폴더 하나만 옮기면 된다.
 */
export async function trashJob(ref: JobRef): Promise<TrashResult> {
  // 다운로드 중에 폴더를 옮기면 yt-dlp가 사라진 경로에 계속 쓴다 — 반쯤 받은 파일이
  // 휴지통 밖에 남고, 실패 기록은 이미 사라진 job.json으로 향한다
  if (isDownloading(ref.jobId)) {
    throw httpError(409, '다운로드 중인 작업은 삭제할 수 없습니다. 끝난 뒤 다시 시도하세요');
  }

  const dir = paths.job(ref.menu, ref.projectId, ref.jobId);
  assertChildOf(paths.jobs(ref.menu, ref.projectId), dir, '작업');
  if (!(await exists(dir))) throw httpError(404, '작업 없음');

  const trashed = await moveToTrash(dir, ref.menu, `${ref.projectId}--${ref.jobId}`);
  forgetPacketsUnder(dir);
  forgetJob(ref);
  broadcast('job', { jobId: ref.jobId, state: 'deleted' });
  return { trashed };
}

export interface TrashProjectResult extends TrashResult {
  /** 함께 딸려간 작업 수 — 화면에서 "작업 3개도 함께 삭제됩니다"로 쓴다 */
  jobs: number;
}

/** 카테고리 삭제 — 지침·제품자료·그 안의 모든 작업이 함께 딸려간다 */
export async function trashProject(menu: Menu, projectId: string): Promise<TrashProjectResult> {
  if (RESERVED_DIRS.has(projectId)) throw httpError(400, '삭제할 수 없는 폴더입니다');

  const dir = paths.project(menu, projectId);
  assertChildOf(paths.menu(menu), dir, '카테고리');
  if (!(await exists(paths.projectJson(menu, projectId)))) throw httpError(404, '카테고리 없음');

  const jobIds = await listDirs(paths.jobs(menu, projectId));
  const downloading = jobIds.filter((jobId) => isDownloading(jobId));
  if (downloading.length) {
    throw httpError(409, `다운로드 중인 작업이 있어 삭제할 수 없습니다: ${downloading.join(', ')}`);
  }

  const trashed = await moveToTrash(dir, menu, projectId);
  forgetPacketsUnder(dir);
  for (const jobId of jobIds) forgetJob({ menu, projectId, jobId });
  broadcast('project', { menu, projectId, state: 'deleted' });
  return { trashed, jobs: jobIds.length };
}

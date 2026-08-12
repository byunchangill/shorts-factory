import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Job, Project } from '@shared/types';
import { REPO_ROOT, paths, loadSettings } from './workspace.js';
import { exists, ensureDir } from '../util/fsx.js';
import { createProject, getProject } from './projects.js';
import { createJob, type JobRef } from './jobs.js';
import {
  attachSourceFile, analyzePendingSources, reconcileDownloadState,
} from '../pipeline/downloadQueue.js';
import * as jobs from './jobs.js';

/**
 * 샘플 소재로 작업 폴더 만들기.
 *
 * `workspace/`는 깃에 올라가지 않아 새 PC에서는 볼 것도 눌러볼 것도 없다.
 * 리포에 들어 있는 실제 영상으로 잡 하나를 만들어 **영상 분석 단계부터** 시작하게 한다.
 * 그 뒤 존 편집·대본·컷 선택·음성·조립은 사용자가 직접 밟는다 — 앞질러 채우지 않는다.
 *
 * `samples/`의 원본은 절대 건드리지 않는다. 항상 복사본을 작업 폴더에 넣는다
 * (첨부 처리가 파일을 rename으로 옮기기 때문에, 원본을 그대로 넘기면 사라진다).
 */

export const SAMPLE_DIR = path.join(REPO_ROOT, 'samples', 'kitchen-shelf');

/** 소재 영상 — 파일명이 곧 화면에 보이는 소스 이름이 된다 */
const SAMPLE_CLIPS = ['clip1.mp4', 'clip2.mp4', 'clip3.mp4', 'clip4.mp4'];

/** 나레이션·자막은 음성 단계에서 사용자가 직접 첨부할 수 있게 경로만 알려준다 */
export const SAMPLE_NARRATION = path.join(SAMPLE_DIR, 'narration.mp3');
export const SAMPLE_SRT = path.join(SAMPLE_DIR, 'narration.srt');

export const DEFAULT_SAMPLE_TITLE = '샘플-주방선반';

/** 리포에 샘플이 실제로 들어 있는지 — 없으면 화면에서 버튼을 감춘다 */
export async function sampleAvailable(): Promise<boolean> {
  const checks = await Promise.all(SAMPLE_CLIPS.map((f) => exists(path.join(SAMPLE_DIR, f))));
  return checks.every(Boolean);
}

/** 같은 이름이 있으면 뒤에 번호를 붙인다 — 샘플을 여러 번 만들어 볼 수 있어야 한다 */
async function freeTitle(base: string): Promise<string> {
  if (!(await getProject('menu-a', base))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!(await getProject('menu-a', candidate))) return candidate;
  }
  throw new Error('샘플 폴더 이름을 만들지 못했습니다');
}

export interface SampleResult {
  project: Project;
  job: Job;
  ref: JobRef;
  attached: number;
}

/**
 * 샘플 프로젝트 + 잡을 만들고 소재 영상을 첨부한다.
 * 첨부와 동시에 클립 분석·프레임 추출이 백그라운드로 돌아 "영상 분석" 단계가 된다.
 */
export async function createSampleProject(title?: string): Promise<SampleResult> {
  if (!(await sampleAvailable())) {
    throw Object.assign(
      new Error(`샘플 소재가 없습니다 (${SAMPLE_DIR}). 리포를 다시 받아주세요.`),
      { status: 400 },
    );
  }

  const project = await createProject('menu-a', await freeTitle(title?.trim() || DEFAULT_SAMPLE_TITLE));
  const job = await createJob('menu-a', project.id, '1편');
  const ref: JobRef = { menu: 'menu-a', projectId: project.id, jobId: job.id };

  const settings = await loadSettings();
  const sourcesDir = path.join(paths.job(ref.menu, ref.projectId, ref.jobId), 'sources');
  await ensureDir(sourcesDir);

  let attached = 0;
  try {
    for (const name of SAMPLE_CLIPS) {
      // 첨부 처리가 rename으로 옮기므로 원본이 아니라 복사본을 넘긴다
      const staged = path.join(sourcesDir, `sample-${name}`);
      await fsp.copyFile(path.join(SAMPLE_DIR, name), staged);
      // 분석은 뒤로 미룬다 — 파일당 몇 초씩 걸려서 요청 안에서 다 돌리면,
      // 그 사이 서버가 재시작될 때 소재가 반만 붙은 폴더가 남는다 (실제로 발생)
      await attachSourceFile(settings, ref, staged, name, { analyze: false });
      attached++;
    }
    await jobs.transition(ref, 'collecting', 'server');
  } catch (e) {
    // 반쯤 만들어진 폴더를 남기지 않는다 — 사용자는 지울 방법도 마땅치 않다
    await fsp.rm(paths.project(ref.menu, ref.projectId), { recursive: true, force: true })
      .catch(() => {});
    throw e;
  }

  // 분석은 배경에서 — 화면은 "영상 분석"이 진행되는 것을 그대로 보여준다.
  // 백그라운드 작업에는 반드시 .catch()를 단다 (없으면 로컬 서버가 통째로 죽는다)
  void analyzePendingSources(settings, ref)
    .then(() => reconcileDownloadState(ref))
    .catch((e) => jobs.logJobEvent(ref, { type: 'sample.analyze_failed', error: String(e) }));

  return { project, job: (await jobs.readJob(ref))!, ref, attached };
}

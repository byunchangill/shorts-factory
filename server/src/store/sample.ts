import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Job, Project } from '@shared/types';
import { REPO_ROOT, paths, loadSettings } from './workspace.js';
import { exists, ensureDir } from '../util/fsx.js';
import { createProject, getProject } from './projects.js';
import { createJob, type JobRef } from './jobs.js';
import type { Menu } from '@shared/constants';
import {
  attachSourceFile, analyzePendingSources, reconcileDownloadState,
} from '../pipeline/downloadQueue.js';
import * as jobs from './jobs.js';

/**
 * 샘플 소재로 영상 작업 만들기.
 *
 * `workspace/`는 깃에 올라가지 않아 새 PC에서는 볼 것도 눌러볼 것도 없다.
 * 리포에 들어 있는 실제 영상으로 **영상 작업 하나**를 만들어 분석 단계부터 시작하게 한다.
 * 그 뒤 존 편집·대본·컷 선택·음성·조립은 사용자가 직접 밟는다 — 앞질러 채우지 않는다.
 *
 * 폴더는 카테고리(생활용품 등), 그 안의 잡이 영상 한 편이다. 샘플도 잡 단위다.
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

/** 카테고리를 따로 만들지 않고 심을 때 쓰는 기본 카테고리 (npm run seed) */
export const DEFAULT_SAMPLE_CATEGORY = '생활용품';
/** 샘플 영상 작업의 기본 제목 */
export const DEFAULT_SAMPLE_JOB_TITLE = '샘플 - 주방 선반';

/** 리포에 샘플이 실제로 들어 있는지 — 없으면 화면에서 버튼을 감춘다 */
export async function sampleAvailable(): Promise<boolean> {
  const checks = await Promise.all(SAMPLE_CLIPS.map((f) => exists(path.join(SAMPLE_DIR, f))));
  return checks.every(Boolean);
}

export interface SampleResult {
  job: Job;
  ref: JobRef;
  attached: number;
}

/**
 * 카테고리 안에 샘플 영상 작업을 만들고 소재를 첨부한다.
 * 첨부 직후 클립 분석·프레임 추출이 배경에서 돌아 "영상 분석" 단계로 넘어간다.
 */
export async function createSampleJob(
  menu: Menu,
  projectId: string,
  title?: string,
): Promise<SampleResult> {
  if (!(await sampleAvailable())) {
    throw Object.assign(
      new Error(`샘플 소재가 없습니다 (${SAMPLE_DIR}). 리포를 다시 받아주세요.`),
      { status: 400 },
    );
  }
  if (!(await getProject(menu, projectId))) {
    throw Object.assign(new Error(`카테고리 없음: ${projectId}`), { status: 404 });
  }

  const job = await createJob(menu, projectId, title?.trim() || DEFAULT_SAMPLE_JOB_TITLE);
  const ref: JobRef = { menu, projectId, jobId: job.id };

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
    // 반쯤 만들어진 작업을 남기지 않는다 — 카테고리는 사용자 것이므로 잡만 지운다
    await fsp.rm(paths.job(ref.menu, ref.projectId, ref.jobId), { recursive: true, force: true })
      .catch(() => {});
    throw e;
  }

  // 분석은 배경에서 — 화면은 "영상 분석"이 진행되는 것을 그대로 보여준다.
  // 백그라운드 작업에는 반드시 .catch()를 단다 (없으면 로컬 서버가 통째로 죽는다)
  void analyzePendingSources(settings, ref)
    .then(() => reconcileDownloadState(ref))
    .catch((e) => jobs.logJobEvent(ref, { type: 'sample.analyze_failed', error: String(e) }));

  return { job: (await jobs.readJob(ref))!, ref, attached };
}

/**
 * 카테고리까지 함께 만드는 변형 — `npm run seed`처럼 아무것도 없는 상태에서 쓴다.
 * 카테고리가 이미 있으면 그 안에 작업만 추가한다.
 */
export async function seedSample(
  category = DEFAULT_SAMPLE_CATEGORY,
): Promise<SampleResult & { project: Project }> {
  const existing = await getProject('menu-a', category);
  const project = existing ?? (await createProject('menu-a', category));
  const result = await createSampleJob('menu-a', project.id);
  return { ...result, project };
}

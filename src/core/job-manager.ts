/**
 * Job CRUD + 상태 전이 관리
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, JobStatus, Workspace } from '../types/job.js';
import type { ContentType } from '../types/config.js';
import { canTransition, transition } from './state-machine.js';
import { emitEvent } from './event-emitter.js';
import { ProductionLogger } from './logger.js';

const JOBS_DIR = 'jobs';
const OUTPUT_DIR = 'output';

export class JobManager {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  /**
   * 새 Job 생성
   */
  createJob(keyword: string, contentType: ContentType): Job {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const existing = this.listJobs().filter(j => j.jobId.startsWith(`job_${dateStr}`));
    const seq = String(existing.length + 1).padStart(3, '0');
    const jobId = `job_${dateStr}_${seq}`;

    const needsVideo = contentType !== 'sseoltoon';

    const workspace: Workspace = {
      temp: `${JOBS_DIR}/${jobId}/temp/`,
      approved: `${JOBS_DIR}/${jobId}/approved/`,
      versions: `${JOBS_DIR}/${jobId}/versions/`,
      final: `${OUTPUT_DIR}/${jobId}/`,
    };

    const job: Job = {
      jobId,
      keyword,
      contentType,
      needsVideo,
      selectedReferenceId: null,
      status: 'searching',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      workspace,
    };

    // 디렉토리 생성
    for (const dir of Object.values(workspace)) {
      const fullPath = join(this.projectDir, dir);
      if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true });
      }
    }

    // output 서브 디렉토리 생성
    const outputBase = join(this.projectDir, workspace.final);
    for (const sub of ['final', 'images', 'images/versions', 'videos', 'videos/versions', 'audio', 'script', 'metadata']) {
      const p = join(outputBase, sub);
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }

    this.saveJob(job);

    // ProductionLogger 초기화
    const logger = new ProductionLogger(jobId, keyword, contentType, outputBase);
    logger.addEntry('job_created', { keyword, contentType });

    return job;
  }

  /**
   * Job 상태 전이
   */
  transitionJob(jobId: string, toStatus: JobStatus, eventInfo?: {
    eventType: Parameters<typeof emitEvent>[0]['eventType'];
    actor: Parameters<typeof emitEvent>[0]['actor'];
    targetId?: string;
    reasonCode?: string;
    reasonDetail?: string;
    metadata?: Record<string, unknown>;
  }): Job {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const fromStatus = job.status;
    const newStatus = transition(fromStatus, toStatus);

    job.status = newStatus;
    job.updatedAt = new Date().toISOString();
    this.saveJob(job);

    // 이벤트 발행
    if (eventInfo) {
      emitEvent({
        jobId,
        fromStatus,
        toStatus: newStatus,
        ...eventInfo,
      });
    }

    return job;
  }

  /**
   * Job 조회
   */
  getJob(jobId: string): Job | null {
    const filePath = join(this.projectDir, JOBS_DIR, jobId, 'job.json');
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  /**
   * 전체 Job 목록
   */
  listJobs(): Job[] {
    const jobsPath = join(this.projectDir, JOBS_DIR);
    if (!existsSync(jobsPath)) return [];
    return readdirSync(jobsPath)
      .filter(d => d.startsWith('job_'))
      .map(d => this.getJob(d))
      .filter((j): j is Job => j !== null);
  }

  /**
   * Job 필드 업데이트 (상태 외)
   */
  updateJob(jobId: string, updates: Partial<Pick<Job, 'selectedReferenceId' | 'keyword'>>): Job {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    Object.assign(job, updates);
    job.updatedAt = new Date().toISOString();
    this.saveJob(job);
    return job;
  }

  /**
   * Job 저장
   */
  private saveJob(job: Job): void {
    const dir = join(this.projectDir, JOBS_DIR, job.jobId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'job.json'), JSON.stringify(job, null, 2), 'utf-8');
  }

  /**
   * Job의 output 경로 조합
   */
  getOutputPath(jobId: string, ...segments: string[]): string {
    return join(this.projectDir, OUTPUT_DIR, jobId, ...segments);
  }

  /**
   * Job의 temp 경로 조합
   */
  getTempPath(jobId: string, ...segments: string[]): string {
    return join(this.projectDir, JOBS_DIR, jobId, 'temp', ...segments);
  }
}

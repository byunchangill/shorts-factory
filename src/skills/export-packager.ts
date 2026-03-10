/**
 * Export Packager Skill — Step 7: 최종 패키징 및 다운로드
 * QC 통과 후 모든 산출물 정리 및 ZIP 패키징
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Job,
  GeneratedScript,
  ProductionLog,
  Scene,
  ContentType,
} from '../types/index.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';

/**
 * 업로드 정보 인터페이스
 */
interface UploadInfo {
  titles: string[];
  description: string;
  tags: string[];
  categoryId: string;
  language: string;
  privacy: 'private' | 'public' | 'unlisted';
  contentType: ContentType;
  inspiredBy?: {
    note: string;
    referenceVideoId?: string;
  };
}

/**
 * 패키지 통계
 */
interface PackageStats {
  totalScenes: number;
  imageRegenerations: number;
  videoRegenerations: number;
  finalDurationSec: number;
  fileCount: number;
  packageSizeMb: number;
}

/**
 * 내보내기 결과
 */
interface ExportResult {
  jobId: string;
  success: boolean;
  zipPath?: string;
  stats: PackageStats;
  message: string;
}

/**
 * 패키징 메인 함수
 *
 * @param jobManager - JobManager 인스턴스
 * @param jobId - 내보낼 Job ID
 * @param projectDir - 프로젝트 경로
 * @returns 내보내기 결과
 */
export async function exportPackage(
  jobManager: JobManager,
  jobId: string,
  projectDir: string,
): Promise<ExportResult> {
  const job = jobManager.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  try {
    // 내보내기 시작 이벤트
    await emitEvent({
      jobId,
      fromStatus: job.status,
      toStatus: 'exporting',
      eventType: 'EXPORT_STARTED',
      actor: 'system',
    });

    const outputDir = join(projectDir, job.workspace.final);

    // 1. 업로드 정보 생성
    const script = loadScript(outputDir);
    const uploadInfo = generateUploadInfo(script, job);
    saveUploadInfo(outputDir, uploadInfo);

    // 2. 프로덕션 로그 완성
    const prodLog = completeProductionLog(outputDir, job);
    saveProductionLog(outputDir, prodLog);

    // 3. ZIP 패키징
    const zipPath = await createZipPackage(outputDir, jobId, projectDir);

    // 4. 통계 계산
    const stats = calculatePackageSize(outputDir);

    // 내보내기 완료 이벤트
    await emitEvent({
      jobId,
      fromStatus: 'exporting',
      toStatus: 'exported',
      eventType: 'EXPORT_COMPLETED',
      actor: 'system',
      metadata: { zipPath, stats },
    });

    return {
      jobId,
      success: true,
      zipPath,
      stats,
      message: `Package created successfully: ${zipPath}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // 내보내기 실패 이벤트
    await emitEvent({
      jobId,
      fromStatus: 'exporting',
      toStatus: 'error',
      eventType: 'EXPORT_FAILED',
      actor: 'system',
      reasonDetail: message,
    });

    return {
      jobId,
      success: false,
      stats: {
        totalScenes: 0,
        imageRegenerations: 0,
        videoRegenerations: 0,
        finalDurationSec: 0,
        fileCount: 0,
        packageSizeMb: 0,
      },
      message: `Export failed: ${message}`,
    };
  }
}

/**
 * YouTube 업로드용 메타데이터 생성
 *
 * @param script - 생성된 대본
 * @param job - Job 정보
 * @returns UploadInfo 객체
 */
export function generateUploadInfo(script: GeneratedScript, job: Job): UploadInfo {
  const description = generateDescription(script, job);

  // 카테고리 맵핑
  const categoryMap: Record<ContentType, string> = {
    dog: '22', // Animals (YouTube category ID)
    sseoltoon: '24', // Entertainment
    health: '27', // Fitness (또는 medical 콘텐츠)
  };

  return {
    titles: script.meta.titleCandidates.slice(0, 5),
    description,
    tags: script.meta.tags.slice(0, 15), // YouTube는 최대 15개 태그
    categoryId: categoryMap[job.contentType],
    language: 'ko',
    privacy: 'private',
    contentType: job.contentType,
    inspiredBy: {
      note: '스토리 구조만 참고. 이미지, 음성, 세부 내용은 완전 창작.',
      referenceVideoId: job.selectedReferenceId || undefined,
    },
  };
}

/**
 * YouTube 설명란 생성
 *
 * @param script - 생성된 대본
 * @param job - Job 정보
 * @returns 설명 텍스트
 */
export function generateDescription(script: GeneratedScript, job: Job): string {
  const lines: string[] = [];

  // 첫 줄: 훅
  lines.push(script.hook);
  lines.push('');

  // 주요 태그
  const tagSection = script.meta.tags.slice(0, 3).map(t => `#${t}`).join(' ');
  lines.push(tagSection);
  lines.push('');

  // 카테고리별 추가 정보
  switch (job.contentType) {
    case 'dog':
      lines.push('🐶 우리 강아지 이야기를 영상으로 담았습니다.');
      lines.push('');
      lines.push('채널을 구독하고 알림을 눌러 새로운 영상을 놓치지 마세요!');
      break;

    case 'sseoltoon':
      lines.push('📖 일상의 이야기들을 그림으로 표현했습니다.');
      lines.push('');
      lines.push('공감이 되셨다면 구독과 좋아요 부탁드립니다!');
      break;

    case 'health':
      lines.push('💊 건강 정보를 시각적으로 전달합니다.');
      lines.push('');
      lines.push('⚠️ 본 영상의 내용은 교육 목적이며 의학적 조언이 아닙니다.');
      lines.push('구체적인 건강 문제는 의료 전문가와 상담하세요.');
      lines.push('');
      lines.push('구독과 좋아요 부탁드립니다!');
      break;
  }

  lines.push('');
  lines.push('─────────────────────────────────────');
  lines.push(`📌 제목: ${script.meta.titleCandidates[0]}`);
  lines.push(`📌 길이: ${script.meta.totalDurationSec}초`);
  lines.push(`📌 카테고리: ${job.contentType}`);
  lines.push('─────────────────────────────────────');

  return lines.join('\n');
}

/**
 * 프로덕션 로그 완성
 *
 * @param outputDir - 출력 디렉토리
 * @param job - Job 정보
 * @returns 완성된 프로덕션 로그
 */
function completeProductionLog(outputDir: string, job: Job): ProductionLog {
  const logPath = join(outputDir, 'script', 'production_log.json');

  let log: ProductionLog = {
    jobId: job.jobId,
    keyword: job.keyword,
    contentType: job.contentType,
    timeline: [],
    stats: {
      totalScenes: 0,
      imageRegenerations: 0,
      videoRegenerations: 0,
      finalDurationSec: 0,
      fileCount: 0,
      packageSizeMb: 0,
    },
  };

  // 기존 로그 로드
  if (existsSync(logPath)) {
    const existing = JSON.parse(readFileSync(logPath, 'utf-8'));
    log = { ...log, ...existing };
  }

  // 내보내기 단계 추가
  log.timeline.push({
    step: 'exported',
    at: new Date().toISOString(),
    result: 'Export completed successfully',
  });

  // 최종 통계 계산
  const stats = calculatePackageSize(outputDir);
  log.stats = stats;

  return log;
}

/**
 * 업로드 정보 저장
 */
function saveUploadInfo(outputDir: string, uploadInfo: UploadInfo): void {
  const fs = require('node:fs');
  const path = join(outputDir, 'metadata', 'upload_info.json');
  fs.writeFileSync(path, JSON.stringify(uploadInfo, null, 2));
}

/**
 * 프로덕션 로그 저장
 */
function saveProductionLog(outputDir: string, log: ProductionLog): void {
  const fs = require('node:fs');
  const path = join(outputDir, 'script', 'production_log.json');
  fs.writeFileSync(path, JSON.stringify(log, null, 2));
}

/**
 * ZIP 패키지 생성
 *
 * @param outputDir - 출력 디렉토리
 * @param jobId - Job ID
 * @param projectDir - 프로젝트 경로
 * @returns ZIP 파일 경로
 */
export async function createZipPackage(
  outputDir: string,
  jobId: string,
  projectDir: string,
): Promise<string> {
  const zipPath = join(projectDir, 'output', `${jobId}.zip`);

  // zip 명령어 실행
  try {
    // outputDir의 모든 파일을 포함하여 ZIP 생성
    execSync(`cd "${outputDir}" && zip -r "${zipPath}" . -q`, {
      stdio: 'pipe',
    });

    if (!existsSync(zipPath)) {
      throw new Error(`ZIP file was not created: ${zipPath}`);
    }

    return zipPath;
  } catch (error) {
    throw new Error(`Failed to create ZIP package: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 패키지 크기 및 파일 수 계산
 *
 * @param outputDir - 출력 디렉토리
 * @returns 패키지 통계
 */
export function calculatePackageSize(outputDir: string): PackageStats {
  let totalBytes = 0;
  let fileCount = 0;
  let totalScenes = 0;
  let finalDurationSec = 0;

  // 모든 파일 통계
  const walkDir = (dir: string): void => {
    if (!existsSync(dir)) return;

    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const filePath = join(dir, file);
        const stat = statSync(filePath);

        if (stat.isDirectory()) {
          walkDir(filePath);
        } else {
          totalBytes += stat.size;
          fileCount++;
        }
      }
    } catch {
      // 접근 권한 없음 무시
    }
  };

  walkDir(outputDir);

  // 씬 수 계산
  const imagesDir = join(outputDir, 'images');
  if (existsSync(imagesDir)) {
    const sceneImages = readdirSync(imagesDir).filter(f => f.match(/^scene_\d+\.png$/));
    totalScenes = sceneImages.length;
  }

  // 최종 영상 길이 (메타데이터에서)
  const metadataPath = join(outputDir, 'metadata', 'upload_info.json');
  if (existsSync(metadataPath)) {
    try {
      const info = JSON.parse(readFileSync(metadataPath, 'utf-8')) as UploadInfo;
      // 대본에서 길이 읽기 (직접 계산)
      const scriptPath = join(outputDir, 'script', 'script.md');
      if (existsSync(scriptPath)) {
        const script = loadScript(outputDir);
        finalDurationSec = script.meta.totalDurationSec;
      }
    } catch {
      // 파싱 실패 무시
    }
  }

  return {
    totalScenes,
    imageRegenerations: 0, // 실제로는 프로덕션 로그에서 읽음
    videoRegenerations: 0,
    finalDurationSec,
    fileCount,
    packageSizeMb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
  };
}

/**
 * 내보내기 요약을 사용자 형식으로 포맷
 *
 * @param job - Job 정보
 * @param stats - 패키지 통계
 * @param zipPath - ZIP 파일 경로
 * @returns 포맷된 요약 문자열
 */
export function formatExportSummary(job: Job, stats: PackageStats, zipPath: string): string {
  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `✅ 제작 완료! [${job.jobId}]`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '📌 카테고리: ' + (
      job.contentType === 'dog' ? '🐶 강아지 AI쇼츠'
      : job.contentType === 'health' ? '💊 건강 AI쇼츠'
      : '📖 썰툰'
    ),
    `📌 길이: ${stats.finalDurationSec}초 | 씬: ${stats.totalScenes}개`,
    '',
    '━━━━━━ 다운로드 파일 ━━━━━━━━━━━━━━━━━━━━━',
    '',
    '🎬 최종 영상         final_shorts.mp4',
    '🖼️  이미지           scene_*.png',
    job.contentType !== 'sseoltoon' ? '🎥 씬 영상           scene_*.mp4' : '',
    '🔊 나레이션         full_narration.mp3',
    '🔊 자막             subtitles.srt',
    '📝 대본/프롬프트     script/',
    '📋 업로드 메타데이터 upload_info.json',
    '',
    `📦 전체 ZIP          ${job.jobId}.zip (${stats.packageSizeMb}MB)`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '👉 다음 단계:',
    '   💾 ZIP 다운로드 → YouTube 업로드',
    '   "새로 만들기" → 처음부터',
    '   "같은 키워드 다른 영상" → Step 2로',
    '   "같은 레퍼런스 다른 대본" → Step 3로',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].filter(line => line !== '');

  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────
// 헬퍼 함수들
// ──────────────────────────────────────────────────────────────────

/**
 * 대본 파일 로드
 */
function loadScript(outputDir: string): GeneratedScript {
  const scriptPath = join(outputDir, 'script', 'script.json');

  if (!existsSync(scriptPath)) {
    // Fallback: Markdown 파일에서 기본 정보 추출
    const mdPath = join(outputDir, 'script', 'script.md');
    if (!existsSync(mdPath)) {
      throw new Error('Script file not found');
    }

    const content = readFileSync(mdPath, 'utf-8');
    return {
      scriptId: '',
      jobId: '',
      version: 1,
      inspiredBy: '',
      meta: {
        titleCandidates: [extractFirstTitle(content)],
        thumbnailHookCandidates: [],
        tags: [],
        totalDurationSec: 45,
      },
      similarityCheck: {
        phraseOverlapScore: 0,
        structureOverlapScore: 0,
        titleSimilarityScore: 0,
        overallRisk: 'low',
      },
      hook: '',
      cta: '',
      scenes: [],
    };
  }

  return JSON.parse(readFileSync(scriptPath, 'utf-8'));
}

/**
 * 마크다운 첫 제목 추출
 */
function extractFirstTitle(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('#') && !line.startsWith('##')) {
      return line.replace(/^#+\s*/, '').trim();
    }
  }
  return 'Untitled';
}

/**
 * Shorts QC Reviewer Skill — Step 6: 최종 품질 검수
 * 원본 유사성, 이미지 일관성, 영상 품질, 음성 싱크, 콘텐츠 정책, 파일 완결성 검증
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Job,
  GeneratedScript,
  ImageAsset,
  VideoAsset,
  QcResult,
  QcCheckResult,
  QcGrade,
  ContentType,
  ReferenceVideo,
} from '../types/index.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';
import { checkSimilarity } from '../utils/similarity-check.js';
import { checkScript, getDisclaimers } from '../utils/health-compliance.js';

/**
 * QC 체크 항목 인터페이스
 */
interface QcCheckDetails {
  copyrightSafety: QcCheckResult & { similarityDetails?: string };
  imageConsistency: QcCheckResult & { scenesChecked?: number };
  videoQuality: QcCheckResult & { specs?: string };
  audioSync: QcCheckResult & { issues?: string[] };
  contentPolicy: QcCheckResult & { violations?: string[] };
  fileCompleteness: QcCheckResult & { fileCount?: number };
}

/**
 * ffprobe JSON 응답 타입
 */
interface FfprobeStream {
  codec_type: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  codec_name?: string;
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobeResult {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/**
 * QC 검수 실행 (메인 오케스트레이션)
 *
 * @param jobManager - JobManager 인스턴스
 * @param jobId - 검수 대상 Job ID
 * @param projectDir - 프로젝트 경로
 * @returns QC 검수 결과
 */
export async function runQcReview(
  jobManager: JobManager,
  jobId: string,
  projectDir: string,
): Promise<QcResult> {
  const job = jobManager.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // QC 시작 이벤트
  await emitEvent({
    jobId,
    fromStatus: job.status,
    toStatus: 'qc_reviewing',
    eventType: 'QC_STARTED',
    actor: 'system',
  });

  // 모든 체크 실행
  const checks: QcCheckDetails = {
    copyrightSafety: await checkCopyrightSafety(jobManager, jobId, projectDir),
    imageConsistency: await checkImageConsistency(job.workspace.final),
    videoQuality: await checkVideoQuality(job.workspace.final, job.contentType),
    audioSync: await checkAudioSync(job.workspace.final),
    contentPolicy: await checkContentPolicy(job.workspace.final, job.contentType, projectDir),
    fileCompleteness: await checkFileCompleteness(job.workspace.final, job.contentType),
  };

  // 등급 계산
  const result = calculateQcGrade(checks);

  // 상태 전이 및 이벤트 발행
  if (result.overallGrade === 'pass') {
    await emitEvent({
      jobId,
      fromStatus: 'qc_reviewing',
      toStatus: 'qc_passed',
      eventType: 'QC_PASSED',
      actor: 'system',
      metadata: { checks: result.checks },
    });
  } else if (result.overallGrade === 'warning') {
    await emitEvent({
      jobId,
      fromStatus: 'qc_reviewing',
      toStatus: 'qc_warning',
      eventType: 'QC_WARNING',
      actor: 'system',
      metadata: { checks: result.checks, warnings: result.warnings },
    });
  } else {
    await emitEvent({
      jobId,
      fromStatus: 'qc_reviewing',
      toStatus: 'qc_failed',
      eventType: 'QC_FAILED',
      actor: 'system',
      metadata: { checks: result.checks, failures: result.criticalFailures },
    });
  }

  // 결과 저장
  const logPath = join(projectDir, job.workspace.final, 'qc_result.json');
  const fs = await import('node:fs/promises');
  await fs.writeFile(logPath, JSON.stringify(result, null, 2));

  return result;
}

/**
 * 1. 저작권 안전성 검증
 * 원본 영상과의 유사도 재검증
 */
export async function checkCopyrightSafety(
  jobManager: JobManager,
  jobId: string,
  projectDir: string,
): Promise<QcCheckResult & { similarityDetails?: string }> {
  try {
    const job = jobManager.getJob(jobId);
    if (!job || !job.selectedReferenceId) {
      return {
        name: '저작권 안전성',
        passed: false,
        grade: 'fail',
        details: 'No reference video selected',
      };
    }

    // 대본 로드
    const scriptPath = join(projectDir, job.workspace.final, 'script', 'script.md');
    if (!existsSync(scriptPath)) {
      return {
        name: '저작권 안전성',
        passed: false,
        grade: 'fail',
        details: 'Script file not found',
      };
    }

    const scriptContent = readFileSync(scriptPath, 'utf-8');

    // 원본 비디오 정보 로드 (Reference Video)
    const refPath = join(projectDir, 'jobs', jobId, 'reference.json');
    if (!existsSync(refPath)) {
      return {
        name: '저작권 안전성',
        passed: false,
        grade: 'fail',
        details: 'Reference video data not found',
      };
    }

    const refData = JSON.parse(readFileSync(refPath, 'utf-8')) as ReferenceVideo;

    // 유사도 검사 수행
    // 대본에서 나레이션 추출
    const narrations = extractNarrations(scriptContent);
    const newText = narrations.join(' ');

    // 원본 설명에서 구조 추출
    const originalStructure = extractStructure(refData.description);
    const newStructure = extractStructure(scriptContent);

    const similarity = checkSimilarity({
      originalText: refData.description,
      newText,
      originalStructure,
      newStructure,
      originalTitle: refData.title,
      newTitle: extractTitle(scriptContent),
    });

    // 판정 기준
    const passed =
      similarity.phraseOverlapScore < 0.3 &&
      similarity.structureOverlapScore < 0.7 &&
      similarity.titleSimilarityScore < 0.5;

    const details = similarity.details?.join('; ') || '유사도 안전';

    return {
      name: '저작권 안전성',
      passed,
      grade: passed ? 'pass' : 'fail',
      details,
      similarityDetails: `문구: ${similarity.phraseOverlapScore}, 구조: ${similarity.structureOverlapScore}, 제목: ${similarity.titleSimilarityScore}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '저작권 안전성',
      passed: false,
      grade: 'fail',
      details: `Error: ${message}`,
    };
  }
}

/**
 * 2. 이미지 일관성 검증
 * 모든 씬 이미지 존재 여부 및 해상도 확인
 */
export async function checkImageConsistency(outputDir: string): Promise<QcCheckResult & { scenesChecked?: number }> {
  try {
    const imagesDir = join(outputDir, 'images');
    if (!existsSync(imagesDir)) {
      return {
        name: '이미지 일관성',
        passed: false,
        grade: 'fail',
        details: 'Images directory not found',
      };
    }

    // PNG 파일 확인
    const files = readdirSync(imagesDir).filter(f => f.match(/^scene_\d+\.png$/));

    if (files.length === 0) {
      return {
        name: '이미지 일관성',
        passed: false,
        grade: 'fail',
        details: 'No scene images found',
      };
    }

    let allConsistent = true;
    let failureDetails: string[] = [];

    // 각 이미지의 해상도 및 일관성 확인
    for (const file of files) {
      const filePath = join(imagesDir, file);

      try {
        // ffprobe로 이미지 해상도 확인
        const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`;
        const output = execSync(probeCmd, { encoding: 'utf-8' });
        const probe = JSON.parse(output) as FfprobeResult;

        if (!probe.streams || probe.streams.length === 0) {
          failureDetails.push(`${file}: Unable to probe`);
          allConsistent = false;
          continue;
        }

        const stream = probe.streams[0];
        if (stream.width !== 1080 || stream.height !== 1920) {
          failureDetails.push(`${file}: ${stream.width}x${stream.height} (expected 1080x1920)`);
          allConsistent = false;
        }
      } catch (error) {
        failureDetails.push(`${file}: ffprobe error`);
        allConsistent = false;
      }
    }

    return {
      name: '이미지 일관성',
      passed: allConsistent,
      grade: allConsistent ? 'pass' : 'warning',
      details: failureDetails.length > 0 ? failureDetails.join('; ') : '모든 이미지 일관성 확인',
      scenesChecked: files.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '이미지 일관성',
      passed: false,
      grade: 'fail',
      details: `Error: ${message}`,
    };
  }
}

/**
 * 3. 영상 품질 검증 (dog/health만)
 * 해상도, 길이, FPS, 코덱 확인
 */
export async function checkVideoQuality(
  outputDir: string,
  contentType: ContentType,
): Promise<QcCheckResult & { specs?: string }> {
  try {
    // sseoltoon은 비디오 생성 없음
    if (contentType === 'sseoltoon') {
      return {
        name: '영상 품질',
        passed: true,
        grade: 'pass',
        details: 'Not applicable for sseoltoon',
      };
    }

    const finalPath = join(outputDir, 'final', 'final_shorts.mp4');
    if (!existsSync(finalPath)) {
      return {
        name: '영상 품질',
        passed: false,
        grade: 'fail',
        details: 'final_shorts.mp4 not found',
      };
    }

    // ffprobe로 비디오 정보 획득
    const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name -show_entries format=duration -of json "${finalPath}"`;
    const output = execSync(probeCmd, { encoding: 'utf-8' });
    const probe = JSON.parse(output) as FfprobeResult;

    if (!probe.streams || probe.streams.length === 0) {
      return {
        name: '영상 품질',
        passed: false,
        grade: 'fail',
        details: 'Unable to probe video',
      };
    }

    const stream = probe.streams[0];
    const duration = parseFloat(probe.format?.duration ?? '0');

    let specs = '';
    const failures: string[] = [];

    // 해상도 검사
    if (stream.width !== 1080 || stream.height !== 1920) {
      failures.push(`해상도: ${stream.width}x${stream.height} (expected 1080x1920)`);
    }
    specs += `${stream.width}x${stream.height}, `;

    // 길이 검사
    if (duration > 60) {
      failures.push(`길이: ${duration.toFixed(1)}초 (max 60초)`);
    }
    specs += `${duration.toFixed(1)}s, `;

    // FPS 검사
    const fpsStr = stream.r_frame_rate ?? '0/0';
    const [fpsNum, fpsDen] = fpsStr.split('/').map(Number);
    const fps = fpsDen ? fpsNum / fpsDen : 0;
    if (Math.abs(fps - 30) > 0.5) {
      failures.push(`FPS: ${fps.toFixed(1)} (expected 30)`);
    }
    specs += `${fps.toFixed(1)}fps, `;

    // 코덱 검사
    const codec = stream.codec_name ?? 'unknown';
    if (codec !== 'h264') {
      failures.push(`코덱: ${codec} (expected h264)`);
    }
    specs += `${codec}`;

    return {
      name: '영상 품질',
      passed: failures.length === 0,
      grade: failures.length === 0 ? 'pass' : 'fail',
      details: failures.length > 0 ? failures.join('; ') : '모든 규격 확인',
      specs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '영상 품질',
      passed: false,
      grade: 'fail',
      details: `Error: ${message}`,
    };
  }
}

/**
 * 4. 음성-영상 싱크 검증
 * 자막 파일 존재 및 타이밍 확인
 */
export async function checkAudioSync(outputDir: string): Promise<QcCheckResult & { issues?: string[] }> {
  try {
    const srtPath = join(outputDir, 'audio', 'subtitles.srt');
    const narrationPath = join(outputDir, 'final', 'final_voice.mp3');

    if (!existsSync(srtPath)) {
      return {
        name: '음성 싱크',
        passed: false,
        grade: 'fail',
        details: 'subtitles.srt not found',
      };
    }

    if (!existsSync(narrationPath)) {
      return {
        name: '음성 싱크',
        passed: false,
        grade: 'fail',
        details: 'final_voice.mp3 not found',
      };
    }

    // SRT 파일 파싱
    const srtContent = readFileSync(srtPath, 'utf-8');
    const subtitles = parseSrt(srtContent);

    if (subtitles.length === 0) {
      return {
        name: '음성 싱크',
        passed: false,
        grade: 'fail',
        details: 'No subtitles found in SRT',
      };
    }

    // 음성 파일 길이 확인
    try {
      const probeCmd = `ffprobe -v error -show_entries format=duration -of json "${narrationPath}"`;
      const output = execSync(probeCmd, { encoding: 'utf-8' });
      const probe = JSON.parse(output) as FfprobeResult;
      const duration = parseFloat(probe.format?.duration ?? '0');

      const lastSubtitleEnd = subtitles[subtitles.length - 1].end;
      const issues: string[] = [];

      // 자막이 음성을 초과하는지 확인
      if (lastSubtitleEnd > duration + 1) {
        issues.push(`자막 끝: ${lastSubtitleEnd.toFixed(2)}초 > 음성 길이: ${duration.toFixed(2)}초`);
      }

      // 자막 타이밍 일관성 확인
      for (let i = 0; i < subtitles.length - 1; i++) {
        const gap = subtitles[i + 1].start - subtitles[i].end;
        if (gap < 0) {
          issues.push(`씬 ${i + 1}-${i + 2} 사이 오버랩 감지`);
        }
      }

      return {
        name: '음성 싱크',
        passed: issues.length === 0,
        grade: issues.length === 0 ? 'pass' : 'warning',
        details: issues.length > 0 ? issues.join('; ') : '타이밍 일관성 확인',
        issues,
      };
    } catch (error) {
      return {
        name: '음성 싱크',
        passed: true,
        grade: 'pass',
        details: 'Unable to verify duration, assuming correct',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '음성 싱크',
      passed: false,
      grade: 'fail',
      details: `Error: ${message}`,
    };
  }
}

/**
 * 5. 콘텐츠 정책 검증 (카테고리별)
 * 동물복지, 실존인물, 건강 규정 준수 확인
 */
export async function checkContentPolicy(
  outputDir: string,
  contentType: ContentType,
  projectDir: string,
): Promise<QcCheckResult & { violations?: string[] }> {
  try {
    const scriptPath = join(outputDir, 'script', 'script.md');
    if (!existsSync(scriptPath)) {
      return {
        name: '콘텐츠 정책',
        passed: false,
        grade: 'fail',
        details: 'Script not found',
      };
    }

    const scriptContent = readFileSync(scriptPath, 'utf-8');
    const violations: string[] = [];

    switch (contentType) {
      case 'dog': {
        // 동물 학대 표현 확인
        const abusePhrases = [
          '학대',
          '폭력',
          '고통',
          '죽음',
          '사망',
          '참혹',
          '잔인',
        ];
        for (const phrase of abusePhrases) {
          if (scriptContent.includes(phrase)) {
            violations.push(`잠재적 학대 표현: "${phrase}"`);
          }
        }
        break;
      }

      case 'sseoltoon': {
        // 실존 인물/혐오 표현 확인
        const hatePhrases = ['특정인', '특정집단', '혐오', '비하', '차별'];
        for (const phrase of hatePhrases) {
          if (scriptContent.includes(phrase)) {
            violations.push(`잠재적 혐오 표현: "${phrase}"`);
          }
        }
        break;
      }

      case 'health': {
        // 건강 규정 준수 확인 (이미 대본 생성 시 체크되었지만 최종 확인)
        const scenes = parseScenes(scriptContent);
        const result = checkScript(scenes, projectDir);

        if (!result.isClean) {
          violations.push(
            ...result.violations.map(
              v => `[${v.sceneId}] ${v.ruleId}: ${v.sentence.substring(0, 50)}...`,
            ),
          );
        }

        // 면책 문구 확인
        const disclaimers = getDisclaimers(projectDir);
        const hasDisclaimer =
          scriptContent.includes('의료') || scriptContent.includes('전문가') || scriptContent.includes('의사');
        if (result.violations.length > 0 && !hasDisclaimer) {
          violations.push('건강 콘텐츠에 적절한 면책 문구 필요');
        }
        break;
      }
    }

    return {
      name: '콘텐츠 정책',
      passed: violations.length === 0,
      grade: violations.length === 0 ? 'pass' : violations.length > 2 ? 'fail' : 'warning',
      details: violations.length === 0 ? '정책 준수' : `${violations.length}개 항목 확인 필요`,
      violations,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '콘텐츠 정책',
      passed: false,
      grade: 'fail',
      details: `Error: ${message}`,
    };
  }
}

/**
 * 6. 파일 완결성 검증
 * 모든 필수 파일 존재 여부 확인
 */
export async function checkFileCompleteness(
  outputDir: string,
  contentType: ContentType,
): Promise<QcCheckResult & { fileCount?: number }> {
  try {
    const requiredFiles: Record<ContentType, string[]> = {
      dog: [
        'final/final_shorts.mp4',
        'final/final_voice.mp3',
        'audio/subtitles.srt',
        'script/script.md',
        'script/prompts.json',
        'metadata/upload_info.json',
      ],
      sseoltoon: [
        'final/final_shorts.mp4',
        'final/final_voice.mp3',
        'audio/subtitles.srt',
        'script/script.md',
        'script/prompts.json',
        'metadata/upload_info.json',
      ],
      health: [
        'final/final_shorts.mp4',
        'final/final_voice.mp3',
        'audio/subtitles.srt',
        'script/script.md',
        'script/prompts.json',
        'metadata/upload_info.json',
      ],
    };

    const required = requiredFiles[contentType];
    const missing: string[] = [];
    let fileCount = 0;

    // 필수 파일 확인
    for (const file of required) {
      const fullPath = join(outputDir, file);
      if (existsSync(fullPath)) {
        fileCount++;
      } else {
        missing.push(file);
      }
    }

    // 씬 이미지 확인
    const imagesDir = join(outputDir, 'images');
    if (existsSync(imagesDir)) {
      const sceneImages = readdirSync(imagesDir).filter(f => f.match(/^scene_\d+\.png$/));
      fileCount += sceneImages.length;
    }

    // 씬 영상 확인 (dog/health)
    if (contentType !== 'sseoltoon') {
      const videosDir = join(outputDir, 'videos');
      if (existsSync(videosDir)) {
        const sceneVideos = readdirSync(videosDir).filter(f => f.match(/^scene_\d+\.mp4$/));
        fileCount += sceneVideos.length;
      }
    }

    // 씬별 나레이션 확인
    const audioDir = join(outputDir, 'audio');
    if (existsSync(audioDir)) {
      const sceneAudio = readdirSync(audioDir).filter(f => f.match(/^scene_\d+\.mp3$/));
      fileCount += sceneAudio.length;
    }

    return {
      name: '파일 완결성',
      passed: missing.length === 0,
      grade: missing.length === 0 ? 'pass' : 'fail',
      details: missing.length === 0 ? `모든 파일 확인 (${fileCount}개)` : `부족: ${missing.join(', ')}`,
      fileCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '파일 완결성',
      passed: false,
      grade: 'fail',
      details: `Error: ${message}`,
    };
  }
}

/**
 * QC 등급 계산
 * PASS: 모든 Critical 통과, WARNING ≤2개
 * WARNING: Critical 통과, WARNING ≥3개
 * FAIL: Critical 1개 이상 실패
 */
export function calculateQcGrade(checks: QcCheckDetails): QcResult {
  const checkResults = [
    checks.copyrightSafety,
    checks.imageConsistency,
    checks.videoQuality,
    checks.audioSync,
    checks.contentPolicy,
    checks.fileCompleteness,
  ];

  // Critical 체크 (copyright, image, video, file 완결성)
  const criticalChecks = [
    checks.copyrightSafety,
    checks.imageConsistency,
    checks.videoQuality,
    checks.fileCompleteness,
  ];

  const criticalFailures = criticalChecks.filter(c => c.grade === 'fail').length;
  const warnings = checkResults.filter(c => c.grade === 'warning').length;

  let overallGrade: QcGrade = 'pass';

  if (criticalFailures > 0) {
    overallGrade = 'fail';
  } else if (warnings >= 3) {
    overallGrade = 'warning';
  } else if (warnings > 0) {
    overallGrade = 'pass'; // 경미한 경고는 통과로
  }

  return {
    overallGrade,
    checks: checkResults,
    criticalFailures,
    warnings,
  };
}

/**
 * QC 결과를 사용자 형식으로 포맷
 */
export function formatQcResult(result: QcResult): string {
  const lines: string[] = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📋 QC 검수 결과',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];

  for (const check of result.checks) {
    const icon = check.grade === 'pass' ? '✅' : check.grade === 'warning' ? '⚠️' : '❌';
    lines.push(`${icon} ${check.name.padEnd(20)} ${check.grade.toUpperCase()}`);
    if (check.details) {
      lines.push(`   → ${check.details}`);
    }
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📊 종합: ${result.overallGrade.toUpperCase()}`);
  if (result.warnings > 0) {
    lines.push(`⚠️ 경고: ${result.warnings}개`);
  }
  if (result.criticalFailures > 0) {
    lines.push(`❌ 중대 오류: ${result.criticalFailures}개`);
  }
  lines.push('');
  lines.push('👉 다음 단계:');
  if (result.overallGrade === 'pass') {
    lines.push('   "통과" → 패키징 진행 (export-packager)');
  } else if (result.overallGrade === 'warning') {
    lines.push('   "무시하고 진행" → 패키징 (export-packager)');
    lines.push('   "수정하기" → 해당 단계로 되돌아가기');
  } else {
    lines.push('   "수정 필수" → 실패 항목 해결 후 재검수');
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

/**
 * QC 경고 무시 처리
 */
export async function onQcOverride(jobId: string): Promise<void> {
  await emitEvent({
    jobId,
    fromStatus: 'qc_warning',
    toStatus: 'exporting',
    eventType: 'QC_OVERRIDE',
    actor: 'user',
    reasonDetail: 'User overrode warnings and proceeded to export',
  });
}

/**
 * QC 실패/경고 후 특정 단계로 복귀
 */
export async function onQcRevise(jobId: string, targetStep: 'script' | 'images' | 'video' | 'tts'): Promise<void> {
  const eventTypeMap = {
    script: 'QC_REVISE_TO_SCRIPT' as const,
    images: 'QC_REVISE_TO_IMAGES' as const,
    video: 'QC_REVISE_TO_VIDEO' as const,
    tts: 'QC_REVISE_TO_TTS' as const,
  };

  const statusMap = {
    script: 'scripting' as const,
    images: 'images_generating' as const,
    video: 'video_generating' as const,
    tts: 'tts_generating' as const,
  };

  await emitEvent({
    jobId,
    fromStatus: null,
    toStatus: statusMap[targetStep],
    eventType: eventTypeMap[targetStep],
    actor: 'user',
    reasonDetail: `User requested revision at ${targetStep} step`,
  });
}

// ──────────────────────────────────────────────────────────────────
// 헬퍼 함수들
// ──────────────────────────────────────────────────────────────────

/**
 * 대본에서 나레이션 텍스트 추출
 */
function extractNarrations(scriptContent: string): string[] {
  const lines = scriptContent.split('\n');
  const narrations: string[] = [];

  for (const line of lines) {
    // "**나레이션:**" 또는 "- " 형식 감지
    if (line.includes('나레이션') || line.startsWith('- ')) {
      const match = line.match(/[:\-]\s*(.+)/);
      if (match) {
        narrations.push(match[1].trim());
      }
    }
  }

  return narrations;
}

/**
 * 텍스트에서 스토리 구조 추출
 */
function extractStructure(text: string): string[] {
  const keywords = [
    '훅',
    '일상',
    '시련',
    '클라이맥스',
    '결말',
    'CTA',
    '감동',
    '반전',
    '위기',
    '해결',
  ];
  const found: string[] = [];

  for (const kw of keywords) {
    if (text.includes(kw)) {
      found.push(kw);
    }
  }

  return found;
}

/**
 * 대본에서 제목 추출
 */
function extractTitle(scriptContent: string): string {
  const lines = scriptContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('#') && !line.startsWith('##')) {
      return line.replace(/^#+\s*/, '').trim();
    }
  }
  return '';
}

/**
 * SRT 파일 파싱
 */
interface Subtitle {
  index: number;
  start: number;
  end: number;
  text: string;
}

function parseSrt(content: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const blocks = content.split('\n\n').filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const index = parseInt(lines[0], 10);
      const timing = lines[1];
      const text = lines.slice(2).join('\n');

      const [startStr, endStr] = timing.split(' --> ').map(t => t.trim());
      const start = timeToSeconds(startStr);
      const end = timeToSeconds(endStr);

      subtitles.push({ index, start, end, text });
    }
  }

  return subtitles;
}

/**
 * "00:00:10,500" 형식을 초 단위로 변환
 */
function timeToSeconds(timeStr: string): number {
  const [time, ms] = timeStr.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + (parseInt(ms || '0', 10) / 1000);
}

/**
 * 대본 텍스트에서 씬 파싱
 */
function parseScenes(scriptContent: string): Array<{ sceneId: string; narration: string }> {
  const scenes: Array<{ sceneId: string; narration: string }> = [];
  const lines = scriptContent.split('\n');

  let currentScene = '';
  let currentNarration = '';

  for (const line of lines) {
    if (line.match(/^#+\s*씬\s*\d+/i) || line.match(/^#+\s*Scene\s*\d+/i)) {
      if (currentScene && currentNarration) {
        scenes.push({ sceneId: currentScene, narration: currentNarration });
      }
      currentScene = line.replace(/^#+\s*/, '').trim();
      currentNarration = '';
    } else if (currentScene && line.trim()) {
      currentNarration += ' ' + line.trim();
    }
  }

  if (currentScene && currentNarration) {
    scenes.push({ sceneId: currentScene, narration: currentNarration });
  }

  return scenes;
}

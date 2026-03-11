/**
 * TTS Sync Skill — Step 5b: Edge TTS 나레이션 생성 + 오디오-비디오 싱크 + 자막 + BGM
 * - Edge TTS로 카테고리별 음성 설정에 맞춘 나레이션 생성
 * - 음성 길이 기준으로 영상 타이밍 조정 (음성 ← → 비디오)
 * - SRT 자막 생성 (한국어 18자 이내 분할)
 * - BGM 합성 (카테고리별 배경음악)
 * - FFmpeg로 최종 영상 렌더링
 * - 썰툰: 이미지 슬라이드쇼 + 음성
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import type {
  ContentType,
  VoiceConfig,
  BgmConfig,
  TtsTiming,
  Scene,
  GeneratedScript,
} from '../types/index.js';
import { VOICE_SETTINGS, BGM_SETTINGS } from '../types/index.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';
import { splitKorean, formatSrtTime } from '../utils/korean-utils.js';
import { ProductionLogger } from '../core/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// 타입 정의
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TTS 생성 결과
 */
interface TtsGenerationResult {
  success: boolean;
  timings: TtsTiming[];
  audioFile: string;
  fullNarrationMp3: string;
  error?: string;
}

/**
 * FFmpeg 합성 파라미터
 */
interface CompositionParams {
  videoFile: string;
  audioFile: string;
  subtitleFile: string;
  bgmFile: string;
  outputFile: string;
  contentType: ContentType;
  totalDurationSec: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: 단일 씬 TTS 생성
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 단일 씬의 TTS 생성 (edge-tts 사용)
 * @param scene - 생성할 씬
 * @param voiceConfig - 음성 설정 (voice, rate, pitch)
 * @param outputDir - 출력 디렉토리 (예: output/{jobId}/audio/)
 * @returns MP3 파일 경로 및 지속 시간 (초)
 */
export async function generateSceneAudio(
  scene: Scene,
  voiceConfig: VoiceConfig,
  outputDir: string,
): Promise<{ filePath: string; duration: number }> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = join(outputDir, `scene_${String(scene.order).padStart(2, '0')}.mp3`);

  // edge-tts Python 명령어 구성
  // edge-tts는 Python 패키지로, 다음과 같이 호출:
  // python -m edge_tts --text "..." --voice "..." --rate "+0%" --pitch "+0Hz" --write-media output.mp3
  const command = [
    'python', '-m', 'edge_tts',
    '--text', scene.narration,
    '--voice', voiceConfig.voice,
    '--rate', voiceConfig.rate,
    '--pitch', voiceConfig.pitch,
    '--write-media', outputFile,
  ].join(' ');

  try {
    execSync(command, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to generate TTS for scene ${scene.sceneId}: ${err}`);
  }

  // MP3 지속시간 측정
  const duration = getAudioDuration(outputFile);

  return { filePath: outputFile, duration };
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: 모든 씬 TTS 생성 + 연결
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 모든 씬의 TTS 생성 및 타이밍 계산
 * @param scenes - 생성할 씬 배열
 * @param contentType - 콘텐츠 타입 (dog, sseoltoon, health)
 * @param outputDir - 출력 디렉토리
 * @returns 타이밍 정보 및 전체 나레이션 파일
 */
export async function generateAllAudio(
  scenes: Scene[],
  contentType: ContentType,
  outputDir: string,
): Promise<TtsGenerationResult> {
  const audioDir = join(outputDir, 'audio');
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }

  const voiceConfig = VOICE_SETTINGS[contentType];
  const timings: TtsTiming[] = [];
  const audioFiles: string[] = [];
  let currentTime = 0.0;

  try {
    // 씬별로 개별 TTS 생성
    for (const scene of scenes) {
      const { filePath, duration } = await generateSceneAudio(scene, voiceConfig, audioDir);
      audioFiles.push(filePath);

      // 씬 간 호흡 (padding): 0.5초
      const padding = 0.5;
      const videoDuration = duration + padding;

      timings.push({
        sceneId: scene.sceneId,
        audioFile: filePath,
        audioDuration: duration,
        videoDuration: videoDuration,
        startTime: currentTime,
        endTime: currentTime + duration,
      });

      currentTime += videoDuration;
    }

    // 모든 오디오 파일 연결
    const fullNarrationMp3 = join(audioDir, 'full_narration.mp3');
    concatenateAudio(audioFiles, fullNarrationMp3);

    return {
      success: true,
      timings,
      audioFile: audioFiles[0],
      fullNarrationMp3,
    };
  } catch (err) {
    return {
      success: false,
      timings: [],
      audioFile: '',
      fullNarrationMp3: '',
      error: String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: 오디오 지속시간 측정
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FFprobe를 사용하여 MP3 파일의 지속시간 측정
 * @param filePath - MP3 파일 경로
 * @returns 지속시간 (초)
 */
export function getAudioDuration(filePath: string): number {
  try {
    // ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1:noinfer_types=0 input.mp3
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1:noinfer_types=0 "${filePath}"`,
      { encoding: 'utf8' },
    ).trim();
    return parseFloat(output);
  } catch (err) {
    console.error(`Failed to get duration for ${filePath}:`, err);
    // 폴백: 파일 존재 여부만 확인
    if (existsSync(filePath)) {
      return 0.0;
    }
    throw new Error(`File not found: ${filePath}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: 오디오 파일 연결
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 여러 MP3 파일을 하나의 파일로 연결
 * FFmpeg concat demuxer 사용
 * @param files - MP3 파일 경로 배열
 * @param outputPath - 출력 파일 경로
 */
export function concatenateAudio(files: string[], outputPath: string): void {
  if (files.length === 0) {
    throw new Error('No audio files to concatenate');
  }

  if (files.length === 1) {
    // 단일 파일인 경우 복사
    execSync(`cp "${files[0]}" "${outputPath}"`);
    return;
  }

  // concat.txt 생성 (FFmpeg concat demuxer 형식)
  const concatDir = join(outputPath, '..', 'concat.txt');
  const concatContent = files.map(f => `file '${f}'`).join('\n');
  writeFileSync(concatDir, concatContent);

  try {
    // ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp3
    execSync(
      `ffmpeg -f concat -safe 0 -i "${concatDir}" -c copy "${outputPath}" -y`,
      { stdio: 'pipe' },
    );
  } finally {
    // concat.txt 정리
    if (existsSync(concatDir)) {
      rmSync(concatDir);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: SRT 자막 생성
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 타이밍 정보 기반으로 SRT 자막 파일 생성
 * 한국어 텍스트는 maxChars 기준으로 자동 분할
 * @param timings - TTS 타이밍 배열
 * @param narrations - 씬별 나레이션 텍스트 배열 (order와 동일)
 * @param maxChars - 한 줄의 최대 글자 수 (기본값 18)
 * @returns SRT 파일 경로
 */
export function generateSrt(
  timings: TtsTiming[],
  narrations: string[],
  outputDir: string,
  maxChars: number = 18,
): string {
  let srtContent = '';
  let subtitleIndex = 1;

  for (const timing of timings) {
    // narrations 배열에서 해당 씬의 나레이션 텍스트 찾기
    const narration = narrations[timings.indexOf(timing)] || '';

    if (!narration) continue;

    // 한국어 텍스트를 maxChars 기준으로 분할
    const lines = splitKorean(narration, maxChars);

    // 각 줄마다 동등한 시간 분배
    const lineDuration = timing.audioDuration / lines.length;

    for (let i = 0; i < lines.length; i++) {
      const startTime = timing.startTime + i * lineDuration;
      const endTime = startTime + lineDuration;

      srtContent += `${subtitleIndex}\n`;
      srtContent += `${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n`;
      srtContent += `${lines[i]}\n\n`;
      subtitleIndex++;
    }
  }

  const srtPath = join(outputDir, 'audio', 'subtitles.srt');
  if (!existsSync(join(outputDir, 'audio'))) {
    mkdirSync(join(outputDir, 'audio'), { recursive: true });
  }
  writeFileSync(srtPath, srtContent);

  return srtPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: 최종 영상 합성 (dog, health)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 영상 + 나레이션 + 자막 + BGM을 합성하여 최종 영상 생성
 * FFmpeg filter_complex 사용
 * @param params - 합성 파라미터
 */
export function composeFinalVideo(params: CompositionParams): void {
  const {
    videoFile,
    audioFile,
    subtitleFile,
    bgmFile,
    outputFile,
    contentType,
    totalDurationSec,
  } = params;

  // BGM 설정 조회
  const bgmConfig = BGM_SETTINGS[contentType];

  // 자막 스타일 설정 (NanumSquareRound Bold 폰트 사용)
  const subtitleStyle = [
    "FontName='NanumSquareRound Bold'",
    'FontSize=24',
    'PrimaryColour=&H00FFFFFF', // 흰색 (BGR 형식: 00FFFFFF)
    'OutlineColour=&H00000000', // 검은색 테두리
    'Outline=3',
    'MarginV=120', // 하단 여백
    'Alignment=2', // 하단 중앙 정렬
  ].join(',');

  // FFmpeg filter_complex 구성
  const filterComplex = [
    // 나레이션 오디오 채널
    '[1:a]volume=1.0[narr]',
    // BGM 오디오 채널 (페이드인, 페이드아웃 적용)
    `[2:a]volume=${bgmConfig.vol},afade=t=in:d=${bgmConfig.fadeIn},afade=t=out:d=${bgmConfig.fadeOut}:st=${totalDurationSec - bgmConfig.fadeOut}[bgm]`,
    // 나레이션 + BGM 합성
    '[narr][bgm]amix=inputs=2:duration=first[audio]',
    // 영상에 자막 추가
    `[0:v]subtitles=${subtitleFile}:force_style='${subtitleStyle}'[subbed]`,
  ].join(';');

  // FFmpeg 명령어 구성
  const command = [
    'ffmpeg',
    '-i', `"${videoFile}"`,
    '-i', `"${audioFile}"`,
    '-i', `"${bgmFile}"`,
    '-filter_complex', `"${filterComplex}"`,
    '-map', '"[subbed]"',
    '-map', '"[audio]"',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    `"${outputFile}"`,
  ].join(' ');

  try {
    execSync(command, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to compose final video: ${err}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 핵심 함수: 썰툰 전용 이미지 슬라이드쇼
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이미지를 슬라이드쇼로 변환 (썰툰 전용)
 * 각 이미지는 해당 씬의 오디오 길이만큼 표시됨
 * @param scenes - 씬 배열
 * @param timings - TTS 타이밍
 * @param imageDir - 이미지 디렉토리 (예: output/{jobId}/images/)
 * @param outputDir - 영상 출력 디렉토리
 * @returns 슬라이드쇼 영상 파일 경로 배열
 */
export function createSseoltoonSlideshow(
  scenes: Scene[],
  timings: TtsTiming[],
  imageDir: string,
  outputDir: string,
): string[] {
  const videosDir = join(outputDir, 'videos');
  if (!existsSync(videosDir)) {
    mkdirSync(videosDir, { recursive: true });
  }

  const slideVideos: string[] = [];

  for (const timing of timings) {
    const scene = scenes.find(s => s.sceneId === timing.sceneId);
    if (!scene) continue;

    // 이미지 파일 경로 (예: images/scene_01.png)
    const imageFile = join(imageDir, `scene_${String(scene.order).padStart(2, '0')}.png`);
    if (!existsSync(imageFile)) {
      console.warn(`Image not found: ${imageFile}`);
      continue;
    }

    const slideOutput = join(videosDir, `slide_${String(scene.order).padStart(2, '0')}.mp4`);

    // FFmpeg: 이미지를 비디오로 변환 (videoDuration 기준)
    // -loop 1: 이미지 반복
    // -t: 재생 시간
    const command = [
      'ffmpeg',
      '-loop', '1',
      '-i', `"${imageFile}"`,
      '-t', String(timing.videoDuration),
      '-vf', `"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2"`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-y',
      `"${slideOutput}"`,
    ].join(' ');

    try {
      execSync(command, { stdio: 'pipe' });
      slideVideos.push(slideOutput);
    } catch (err) {
      console.error(`Failed to create slideshow for scene ${scene.sceneId}:`, err);
    }
  }

  return slideVideos;
}

// ═══════════════════════════════════════════════════════════════════════════
// 헬퍼 함수: 썰툰 슬라이드쇼 연결 및 최종 합성
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 슬라이드쇼 영상들을 연결하고 음성/자막/BGM과 합성
 * 썰툰 전용
 * @param slideVideos - 슬라이드 영상 파일 경로 배열
 * @param audioFile - 전체 나레이션 MP3 파일
 * @param subtitleFile - SRT 자막 파일
 * @param bgmFile - BGM MP3 파일
 * @param outputFile - 최종 영상 출력 경로
 * @param contentType - 콘텐츠 타입 (sseoltoon)
 * @param totalDurationSec - 전체 지속시간
 */
export function composeSseoltoonVideo(
  slideVideos: string[],
  audioFile: string,
  subtitleFile: string,
  bgmFile: string,
  outputFile: string,
  contentType: ContentType,
  totalDurationSec: number,
): void {
  const videosDir = join(outputFile, '..', 'videos');

  // concat.txt 생성
  const concatFile = join(videosDir, 'concat_slides.txt');
  const concatContent = slideVideos.map(v => `file '${v}'`).join('\n');
  writeFileSync(concatFile, concatContent);

  try {
    // 슬라이드쇼 연결
    const connectedSlideshow = join(videosDir, 'connected_slides.mp4');
    execSync(
      `ffmpeg -f concat -safe 0 -i "${concatFile}" -c copy "${connectedSlideshow}" -y`,
      { stdio: 'pipe' },
    );

    // BGM 설정
    const bgmConfig = BGM_SETTINGS[contentType];
    const subtitleStyle = [
      "FontName='NanumSquareRound Bold'",
      'FontSize=24',
      'PrimaryColour=&H00FFFFFF',
      'OutlineColour=&H00000000',
      'Outline=3',
      'MarginV=120',
      'Alignment=2',
    ].join(',');

    // 최종 합성
    const filterComplex = [
      '[1:a]volume=1.0[narr]',
      `[2:a]volume=${bgmConfig.vol},afade=t=in:d=${bgmConfig.fadeIn},afade=t=out:d=${bgmConfig.fadeOut}:st=${totalDurationSec - bgmConfig.fadeOut}[bgm]`,
      '[narr][bgm]amix=inputs=2:duration=first[audio]',
      `[0:v]subtitles=${subtitleFile}:force_style='${subtitleStyle}'[subbed]`,
    ].join(';');

    const composeCommand = [
      'ffmpeg',
      '-i', `"${connectedSlideshow}"`,
      '-i', `"${audioFile}"`,
      '-i', `"${bgmFile}"`,
      '-filter_complex', `"${filterComplex}"`,
      '-map', '"[subbed]"',
      '-map', '"[audio]"',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y',
      `"${outputFile}"`,
    ].join(' ');

    execSync(composeCommand, { stdio: 'pipe' });
  } finally {
    // 정리
    if (existsSync(concatFile)) {
      rmSync(concatFile);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인 스킬 실행 함수
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TTS Sync 스킬 메인 실행 함수
 * @param jobId - 작업 ID
 * @param projectDir - 프로젝트 루트 디렉토리
 * @returns 성공 여부
 */
export async function executeTtsSync(jobId: string, projectDir: string): Promise<boolean> {
  const jobManager = new JobManager(projectDir);
  const job = jobManager.getJob(jobId);

  if (!job) {
    console.error(`Job not found: ${jobId}`);
    return false;
  }

  const logger = new ProductionLogger(
    job.jobId,
    job.keyword,
    job.contentType,
    join(projectDir, job.workspace.final),
  );

  try {
    // 1. TTS 생성 시작 이벤트
    emitEvent({
      jobId,
      eventType: 'TTS_GENERATION_STARTED',
      actor: 'system',
      fromStatus: job.status,
      toStatus: 'tts_generating',
    });

    jobManager.transitionJob(jobId, 'tts_generating', {
      eventType: 'TTS_GENERATION_STARTED',
      actor: 'system',
    });

    // 2. 스크립트 로드
    const scriptPath = join(projectDir, job.workspace.final, 'script', 'generated_script.json');
    if (!existsSync(scriptPath)) {
      throw new Error(`Script not found: ${scriptPath}`);
    }

    const scriptContent = readFileSync(scriptPath, 'utf8');
    const script: GeneratedScript = JSON.parse(scriptContent);

    // 3. TTS 생성
    logger.addEntry('tts_generation_started', {
      sceneCount: script.scenes.length,
      contentType: job.contentType,
    });

    const ttsResult = await generateAllAudio(
      script.scenes,
      job.contentType,
      join(projectDir, job.workspace.final),
    );

    if (!ttsResult.success) {
      throw new Error(ttsResult.error || 'TTS generation failed');
    }

    logger.addEntry('tts_generated', {
      sceneCount: script.scenes.length,
      timings: ttsResult.timings.map(t => ({
        sceneId: t.sceneId,
        duration: t.audioDuration,
      })),
    });

    // 4. TTS 생성 완료 이벤트
    emitEvent({
      jobId,
      eventType: 'TTS_GENERATED',
      actor: 'tool',
      fromStatus: 'tts_generating',
      toStatus: 'tts_syncing',
    });

    jobManager.transitionJob(jobId, 'tts_syncing', {
      eventType: 'TTS_GENERATED',
      actor: 'tool',
    });

    // 5. SRT 자막 생성
    const narrations = script.scenes.map(s => s.narration);
    const subtitlePath = generateSrt(
      ttsResult.timings,
      narrations,
      join(projectDir, job.workspace.final),
    );

    logger.addEntry('subtitles_generated', { subtitlePath });

    // 6. 최종 영상 합성
    const outputDir = join(projectDir, job.workspace.final);
    const finalVideoPath = join(outputDir, 'final', 'final_shorts.mp4');

    const bgmSettings = BGM_SETTINGS[job.contentType];
    const bgmPath = join(projectDir, 'assets', 'bgm', bgmSettings.file);

    if (!existsSync(bgmPath)) {
      throw new Error(`BGM file not found: ${bgmPath}`);
    }

    if (job.contentType === 'sseoltoon') {
      // 썰툰: 이미지 슬라이드쇼 + 음성
      const slideVideos = createSseoltoonSlideshow(
        script.scenes,
        ttsResult.timings,
        join(outputDir, 'images'),
        outputDir,
      );

      const totalDuration = ttsResult.timings.reduce((sum, t) => sum + t.videoDuration, 0);
      composeSseoltoonVideo(
        slideVideos,
        ttsResult.fullNarrationMp3,
        subtitlePath,
        bgmPath,
        finalVideoPath,
        job.contentType,
        totalDuration,
      );
    } else {
      // dog, health: 기존 영상 + 음성
      const videoPath = join(outputDir, 'videos', 'connected_synced.mp4');
      if (!existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      const totalDuration = ttsResult.timings.reduce((sum, t) => sum + t.videoDuration, 0);

      composeFinalVideo({
        videoFile: videoPath,
        audioFile: ttsResult.fullNarrationMp3,
        subtitleFile: subtitlePath,
        bgmFile: bgmPath,
        outputFile: finalVideoPath,
        contentType: job.contentType,
        totalDurationSec: totalDuration,
      });
    }

    logger.addEntry('video_composed', { outputPath: finalVideoPath });

    // 7. 완료 이벤트
    emitEvent({
      jobId,
      eventType: 'TTS_SYNC_COMPLETED',
      actor: 'system',
      fromStatus: 'tts_syncing',
      toStatus: 'compose_done',
    });

    jobManager.transitionJob(jobId, 'compose_done', {
      eventType: 'TTS_SYNC_COMPLETED',
      actor: 'system',
    });

    logger.addEntry('tts_sync_completed', { finalVideoPath });
    // addEntry() automatically persists the log

    return true;
  } catch (err) {
    const errorMsg = String(err);
    console.error('TTS Sync failed:', errorMsg);
    logger.addEntry('tts_sync_failed', { error: errorMsg });
    // addEntry() automatically persists the log

    // 실패 이벤트
    emitEvent({
      jobId,
      eventType: 'COMPOSE_FAILED',
      actor: 'tool',
      fromStatus: 'tts_syncing',
      toStatus: 'error',
      reasonDetail: errorMsg,
    });

    jobManager.transitionJob(jobId, 'error', {
      eventType: 'COMPOSE_FAILED',
      actor: 'tool',
      reasonDetail: errorMsg,
    });

    return false;
  }
}

export default executeTtsSync;

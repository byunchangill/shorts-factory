/**
 * Video Maker Skill - Step 5a: Ken Burns Effect Video Generation
 *
 * Converts approved images to video clips using Ken Burns effect (zoompan filter).
 * Supports:
 * - Dog mode: emotional motion presets (gentle_zoom_in, subtle_float, dramatic_push, slow_pan, emotional_hold)
 * - Health mode: info-focused presets (info_zoom_in, info_slide, info_focus, slow_zoom_out)
 * - Sseoltoon: SKIPPED (goes directly to tts-sync)
 * - Version management (videos/versions/)
 * - Scene transitions with xfade crossfade (0.3s)
 * - State event emission
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type {
  ContentType,
  VideoAsset,
  VideoVersion,
  Scene,
} from '../types/index.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';

// ════════════════════════════════════════════════════════════════
// Types & Interfaces
// ════════════════════════════════════════════════════════════════

/**
 * Ken Burns motion preset configuration
 */
export interface PresetConfig {
  name: string;
  description: string;
  // FFmpeg zoompan parameters
  zoomFormula: string; // e.g., 'min(zoom+0.0008,1.3)'
  xFormula: string; // e.g., 'iw/2-(iw/zoom/2)'
  yFormula: string; // e.g., 'ih/2-(ih/zoom/2)'
  scaleWidth?: number; // default 8000
  scaleHeight?: string; // default '-1' (maintain aspect)
  fps?: number; // default 30
  targetWidth?: number; // default 1080
  targetHeight?: number; // default 1920
}

/**
 * Preset registry by content type and scene properties
 */
const DOG_PRESETS: Record<string, PresetConfig> = {
  gentle_zoom_in: {
    name: 'gentle_zoom_in',
    description: '따뜻한 클로즈업 (따뜻함/행복)',
    zoomFormula: 'min(zoom+0.0008,1.3)',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  subtle_float: {
    name: 'subtle_float',
    description: '미세한 흔들림, 여운 (중립)',
    zoomFormula: '1.05+0.02*sin(on/30)',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)+5*sin(on/25)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  dramatic_push: {
    name: 'dramatic_push',
    description: '빠른 줌인 (놀람)',
    zoomFormula: 'min(zoom+0.002,1.5)',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  slow_pan: {
    name: 'slow_pan',
    description: '느린 횡이동, 긴장감 (불안)',
    zoomFormula: '1.1',
    xFormula: 'if(eq(on,1),0,min(x+1.5,iw-iw/zoom))',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: -1,
    scaleHeight: 3840,
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  emotional_hold: {
    name: 'emotional_hold',
    description: '거의 정지, 감정 전달 (슬픔)',
    zoomFormula: '1.0',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
};

const HEALTH_PRESETS: Record<string, PresetConfig> = {
  info_zoom_in: {
    name: 'info_zoom_in',
    description: '핵심 정보 강조 줌 (충격 사실)',
    zoomFormula: 'min(zoom+0.001,1.35)',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  info_slide: {
    name: 'info_slide',
    description: '안정적 횡이동 (설명)',
    zoomFormula: '1.05',
    xFormula: 'if(eq(on,1),0,min(x+0.8,iw-iw/zoom))',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: -1,
    scaleHeight: 3840,
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  info_focus: {
    name: 'info_focus',
    description: '중앙 고정, 미세 줌 (해결법)',
    zoomFormula: '1.0+0.005*sin(on/30)',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
  slow_zoom_out: {
    name: 'slow_zoom_out',
    description: '전체 조망, 마무리 (요약)',
    zoomFormula: 'max(zoom-0.0005,1.0)',
    xFormula: 'iw/2-(iw/zoom/2)',
    yFormula: 'ih/2-(ih/zoom/2)',
    scaleWidth: 8000,
    scaleHeight: '-1',
    fps: 30,
    targetWidth: 1080,
    targetHeight: 1920,
  },
};

/**
 * Video generation log entry
 */
export interface VideoGenerationLogEntry {
  timestamp: string;
  sceneId: string;
  version: number;
  preset: string;
  filePath: string;
  durationSec: number;
  status: 'success' | 'failure';
  error?: string;
  durationMs: number;
}

/**
 * Video generation log for a job
 */
export interface VideoGenerationLog {
  jobId: string;
  createdAt: string;
  lastUpdatedAt: string;
  entries: VideoGenerationLogEntry[];
}

/**
 * Options for video regeneration
 */
export interface VideoRegenerationOptions {
  preset?: string;
  duration?: number;
  sceneOverrides?: Record<string, unknown>;
}

/**
 * Options for version restoration
 */
export interface VideoRestorationOptions {
  version: number;
  preserveApprovalState?: boolean;
}

// ════════════════════════════════════════════════════════════════
// Preset Selection Logic
// ════════════════════════════════════════════════════════════════

/**
 * Auto-selects video preset based on scene camera and emotion
 *
 * Maps camera + emotion combination to appropriate motion preset.
 * Falls back to safe defaults if exact match not found.
 *
 * @param scene - Scene with camera and emotion fields
 * @param contentType - dog | health (sseoltoon doesn't use this)
 * @returns PresetConfig for the scene
 */
export function selectPreset(scene: Scene, contentType: ContentType): PresetConfig {
  const camera = scene.camera.toLowerCase();
  const emotion = scene.emotion.toLowerCase();

  // Dog mode mapping
  if (contentType === 'dog') {
    // Exact matches with priority
    if (camera.includes('close-up')) {
      if (emotion.includes('sad')) return DOG_PRESETS.emotional_hold;
      if (emotion.includes('happy') || emotion.includes('warm')) return DOG_PRESETS.gentle_zoom_in;
    }
    if (camera.includes('wide') && emotion.includes('warm')) {
      return DOG_PRESETS.gentle_zoom_in;
    }
    if (camera.includes('pan-left') || camera.includes('pan-right') || camera.includes('pan')) {
      return DOG_PRESETS.slow_pan;
    }
    if (camera.includes('zoom-in') && emotion.includes('surprised')) {
      return DOG_PRESETS.dramatic_push;
    }

    // Default for dog
    return DOG_PRESETS.subtle_float;
  }

  // Health mode mapping
  if (contentType === 'health') {
    // Exact matches with priority
    if (camera.includes('zoom-in')) {
      return HEALTH_PRESETS.info_zoom_in;
    }
    if (camera.includes('medium')) {
      return HEALTH_PRESETS.info_focus;
    }
    if (camera.includes('wide')) {
      return HEALTH_PRESETS.slow_zoom_out;
    }

    // Default for health
    return HEALTH_PRESETS.info_slide;
  }

  // Fallback (should not reach for sseoltoon)
  return DOG_PRESETS.subtle_float;
}

// ════════════════════════════════════════════════════════════════
// Ken Burns FFmpeg Command Building
// ════════════════════════════════════════════════════════════════

/**
 * Builds FFmpeg Ken Burns command with zoompan filter
 *
 * Constructs full FFmpeg command string for applying Ken Burns effect
 * to a static image. Uses zoompan filter for zoom and pan effects.
 *
 * @param preset - PresetConfig with motion parameters
 * @param inputImagePath - Path to input PNG image
 * @param outputVideoPath - Path for output MP4 video
 * @param durationSec - Duration of video in seconds (min 2, max 10)
 * @returns Complete FFmpeg command string
 */
export function buildKenBurnsCommand(
  preset: PresetConfig,
  inputImagePath: string,
  outputVideoPath: string,
  durationSec: number,
): string {
  // Clamp duration to reasonable range
  const dur = Math.max(2, Math.min(10, durationSec));
  const fps = preset.fps || 30;
  const targetWidth = preset.targetWidth || 1080;
  const targetHeight = preset.targetHeight || 1920;
  const scaleWidth = preset.scaleWidth ?? 8000;
  const scaleHeight = preset.scaleHeight ?? '-1';

  // Build zoompan filter string
  const zoomPanFilter = `zoompan=z='${preset.zoomFormula}':x='${preset.xFormula}':y='${preset.yFormula}':d=${dur * fps}:s=${targetWidth}x${targetHeight}:fps=${fps}`;

  // Build complete ffmpeg command
  const command = [
    'ffmpeg',
    '-loop 1',
    `-i "${inputImagePath}"`,
    '-vf',
    `"scale=${scaleWidth}:${scaleHeight},${zoomPanFilter}"`,
    `-t ${dur}`,
    '-c:v libx264',
    '-pix_fmt yuv420p',
    '-preset fast', // Faster encoding without quality loss
    `"${outputVideoPath}"`,
  ].join(' ');

  return command;
}

// ════════════════════════════════════════════════════════════════
// Scene Video Generation
// ════════════════════════════════════════════════════════════════

/**
 * Generates a single scene video with Ken Burns effect
 *
 * Takes an approved image and applies Ken Burns motion based on scene properties.
 * Creates new version in videos/versions/ directory.
 *
 * @param scene - Scene with duration, camera, emotion
 * @param imagePath - Path to approved scene image (PNG)
 * @param outputDir - Output directory (job's output/jobId/videos/)
 * @param contentType - dog | health for preset selection
 * @returns Generated VideoVersion or null on failure
 */
export function generateSceneVideo(
  scene: Scene,
  imagePath: string,
  outputDir: string,
  contentType: ContentType,
): VideoVersion | null {
  try {
    if (!existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Ensure versions subdirectory exists
    const versionsDir = join(outputDir, 'versions');
    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }

    // Select preset
    const preset = selectPreset(scene, contentType);

    // Generate next version number
    const existingVersions = readFileSync(
      join(outputDir, `${scene.sceneId}.json`),
      'utf-8',
    ).match(/version":\s*(\d+)/g) || [];
    const nextVersion = Math.max(0, ...existingVersions.map(v => parseInt(v.match(/\d+/)?.[0] || '0'))) + 1;

    // Output paths
    const versionedVideoPath = join(versionsDir, `${scene.sceneId}_v${nextVersion}.mp4`);

    // Build and execute FFmpeg command
    const command = buildKenBurnsCommand(
      preset,
      imagePath,
      versionedVideoPath,
      scene.durationSec,
    );

    execSync(command, { stdio: 'pipe' });

    if (!existsSync(versionedVideoPath)) {
      throw new Error(`Video generation failed: ${versionedVideoPath} not created`);
    }

    // Create version record
    const version: VideoVersion = {
      version: nextVersion,
      preset: preset.name,
      filePath: versionedVideoPath,
      durationSec: scene.durationSec,
      approved: false,
      createdAt: new Date().toISOString(),
    };

    return version;
  } catch (error) {
    console.error(`Failed to generate video for scene ${scene.sceneId}:`, error);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// Batch Video Generation
// ════════════════════════════════════════════════════════════════

/**
 * Generates videos for all scenes
 *
 * Main orchestration function:
 * 1. Emits VIDEO_GENERATION_STARTED event
 * 2. Generates video for each scene using Ken Burns preset
 * 3. Saves VideoAsset metadata for each scene
 * 4. Emits VIDEO_GENERATED event with all generated videos
 * 5. Handles partial failures gracefully
 *
 * @param scenes - All scenes from script
 * @param jobManager - JobManager instance
 * @param jobId - Job ID
 * @param contentType - dog | health (sseoltoon skipped upstream)
 * @returns Array of generated VideoAssets
 */
export function generateAllVideos(
  scenes: Scene[],
  jobManager: JobManager,
  jobId: string,
  contentType: ContentType,
): VideoAsset[] {
  // Skip if sseoltoon (should not reach here, but guard anyway)
  if (contentType === 'sseoltoon') {
    console.log('Sseoltoon content skips video generation, proceeding to tts-sync');
    return [];
  }

  const startTime = Date.now();

  // Emit generation started event
  emitEvent({
    jobId,
    eventType: 'VIDEO_GENERATION_STARTED',
    actor: 'system',
    fromStatus: 'images_fully_approved',
    toStatus: 'video_generating',
  });

  const videosDir = jobManager.getOutputPath(jobId, 'videos');
  const generatedAssets: VideoAsset[] = [];
  const failedScenes: string[] = [];

  // Generate video for each scene
  for (const scene of scenes) {
    try {
      // Get approved image path from images directory
      const imagePath = jobManager.getOutputPath(jobId, 'images', `${scene.sceneId}.png`);

      // Generate video
      const videoVersion = generateSceneVideo(scene, imagePath, videosDir, contentType);

      if (videoVersion) {
        // Create VideoAsset record
        const asset: VideoAsset = {
          sceneId: scene.sceneId,
          currentVersion: videoVersion.version,
          preset: videoVersion.preset,
          versions: [videoVersion],
        };

        // Save asset metadata
        const assetPath = join(videosDir, `${scene.sceneId}.json`);
        writeFileSync(assetPath, JSON.stringify(asset, null, 2), 'utf-8');

        // Copy versioned video to main videos directory with current name
        execSync(`cp "${videoVersion.filePath}" "${join(videosDir, `${scene.sceneId}.mp4`)}"`, {
          stdio: 'pipe',
        });

        generatedAssets.push(asset);
      } else {
        failedScenes.push(scene.sceneId);
      }
    } catch (error) {
      console.error(`Error generating video for scene ${scene.sceneId}:`, error);
      failedScenes.push(scene.sceneId);
    }
  }

  const duration = Date.now() - startTime;

  // Emit generated event
  if (generatedAssets.length > 0) {
    emitEvent({
      jobId,
      eventType: 'VIDEO_GENERATED',
      actor: 'tool',
      fromStatus: 'video_generating',
      toStatus: 'video_pending_approval',
      metadata: {
        generatedCount: generatedAssets.length,
        failedCount: failedScenes.length,
        failedScenes,
        durationMs: duration,
      },
    });
  } else {
    // All failed
    emitEvent({
      jobId,
      eventType: 'VIDEO_FAILED',
      actor: 'tool',
      fromStatus: 'video_generating',
      toStatus: 'video_failed',
      reasonCode: 'all_videos_failed',
      reasonDetail: `All ${scenes.length} video generations failed`,
      metadata: {
        failedScenes: failedScenes,
        durationMs: duration,
      },
    });
  }

  return generatedAssets;
}

// ════════════════════════════════════════════════════════════════
// Scene Transitions
// ════════════════════════════════════════════════════════════════

/**
 * Concatenates scene videos with xfade crossfade transitions
 *
 * Creates seamless transitions between scenes using FFmpeg xfade filter.
 * Transition duration: 0.3 seconds (hardcoded per spec).
 *
 * @param sceneVideoPaths - Ordered array of video paths to concatenate
 * @param outputPath - Path for final concatenated video
 * @param transitionDurationSec - Fade duration in seconds (default 0.3)
 * @returns True if successful, false on failure
 */
export function concatenateWithTransitions(
  sceneVideoPaths: string[],
  outputPath: string,
  transitionDurationSec: number = 0.3,
): boolean {
  try {
    if (sceneVideoPaths.length === 0) {
      throw new Error('No video paths provided');
    }

    if (sceneVideoPaths.length === 1) {
      // Single video, just copy
      execSync(`cp "${sceneVideoPaths[0]}" "${outputPath}"`, { stdio: 'pipe' });
      return true;
    }

    // Build filter complex for xfade transitions
    // Multiple inputs: [0:v][1:v]xfade=...[v0],[v0][2:v]xfade=...[v1], etc.
    let filterComplex = '';
    let currentInput = 0;

    for (let i = 0; i < sceneVideoPaths.length - 1; i++) {
      const inputA = currentInput;
      const inputB = currentInput + 1;
      const outputLabel = `v${i}`;

      // Get duration of current video for offset calculation
      const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${sceneVideoPaths[i]}"`;
      const durationStr = execSync(durationCmd, { encoding: 'utf-8' }).trim();
      const duration = parseFloat(durationStr) || 5;

      // Offset = duration of first video minus transition duration
      const offset = Math.max(0.1, duration - transitionDurationSec);

      if (i === 0) {
        filterComplex += `[${inputA}:v][${inputB}:v]xfade=transition=fade:duration=${transitionDurationSec}:offset=${offset}[${outputLabel}]`;
      } else {
        filterComplex += `;[${outputLabel}][${inputB}:v]xfade=transition=fade:duration=${transitionDurationSec}:offset=${offset}[v${i + 1}]`;
      }

      currentInput++;
    }

    // Build inputs string
    const inputs = sceneVideoPaths.map(p => `-i "${p}"`).join(' ');

    // Get final output label
    const finalLabel = `v${sceneVideoPaths.length - 2}`;

    // Execute FFmpeg concat command
    const command = [
      'ffmpeg',
      inputs,
      '-filter_complex',
      `"${filterComplex}"`,
      `-map "[${finalLabel}]"`,
      '-c:v libx264',
      '-pix_fmt yuv420p',
      '-preset fast',
      `"${outputPath}"`,
    ].join(' ');

    execSync(command, { stdio: 'pipe' });

    if (!existsSync(outputPath)) {
      throw new Error(`Concatenation failed: ${outputPath} not created`);
    }

    return true;
  } catch (error) {
    console.error('Failed to concatenate videos with transitions:', error);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════
// Video Regeneration
// ════════════════════════════════════════════════════════════════

/**
 * Regenerates a specific scene's video with different preset
 *
 * Supports changing Ken Burns preset or parameters for a single scene.
 * Creates new version, emits VIDEO_REGEN_COMPLETED when done.
 *
 * @param sceneId - Scene ID to regenerate
 * @param imagePath - Path to scene image
 * @param videosDir - Output videos directory
 * @param jobManager - JobManager instance
 * @param jobId - Job ID
 * @param options - Regeneration options (preset override, etc.)
 * @returns Updated VideoAsset or null on failure
 */
export function regenerateSceneVideo(
  sceneId: string,
  imagePath: string,
  videosDir: string,
  jobManager: JobManager,
  jobId: string,
  options: VideoRegenerationOptions,
): VideoAsset | null {
  try {
    if (!existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    // Load current asset
    const assetPath = join(videosDir, `${sceneId}.json`);
    const currentAsset: VideoAsset = existsSync(assetPath)
      ? JSON.parse(readFileSync(assetPath, 'utf-8'))
      : { sceneId, currentVersion: 0, preset: 'unknown', versions: [] };

    // Increment version
    const newVersion = currentAsset.currentVersion + 1;

    // Get scene for duration
    const scriptPath = jobManager.getOutputPath(jobId, 'script', 'script.json');
    const script = JSON.parse(readFileSync(scriptPath, 'utf-8'));
    const scene = script.scenes.find((s: Scene) => s.sceneId === sceneId);

    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    // Build preset (override or from scene)
    let preset: PresetConfig;
    if (options.preset) {
      const contentType = script.contentType;
      if (contentType === 'dog') {
        preset = DOG_PRESETS[options.preset] || DOG_PRESETS.subtle_float;
      } else if (contentType === 'health') {
        preset = HEALTH_PRESETS[options.preset] || HEALTH_PRESETS.info_slide;
      } else {
        preset = DOG_PRESETS.subtle_float;
      }
    } else {
      preset = selectPreset(scene, script.contentType);
    }

    // Generate versioned video path
    const versionsDir = join(videosDir, 'versions');
    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }

    const versionedVideoPath = join(versionsDir, `${sceneId}_v${newVersion}.mp4`);

    // Build and execute FFmpeg command
    const command = buildKenBurnsCommand(
      preset,
      imagePath,
      versionedVideoPath,
      options.duration || scene.durationSec,
    );

    execSync(command, { stdio: 'pipe' });

    if (!existsSync(versionedVideoPath)) {
      throw new Error(`Video regeneration failed: ${versionedVideoPath} not created`);
    }

    // Create new version record
    const videoVersion: VideoVersion = {
      version: newVersion,
      preset: preset.name,
      filePath: versionedVideoPath,
      durationSec: options.duration || scene.durationSec,
      approved: false,
      createdAt: new Date().toISOString(),
    };

    // Update asset
    currentAsset.currentVersion = newVersion;
    currentAsset.preset = preset.name;
    currentAsset.versions.push(videoVersion);

    // Save updated asset
    writeFileSync(assetPath, JSON.stringify(currentAsset, null, 2), 'utf-8');

    // Copy to main videos directory with current name
    execSync(`cp "${versionedVideoPath}" "${join(videosDir, `${sceneId}.mp4`)}"`, {
      stdio: 'pipe',
    });

    // Emit regeneration completed event
    emitEvent({
      jobId,
      eventType: 'VIDEO_REGEN_COMPLETED',
      actor: 'tool',
      fromStatus: 'video_regen_requested',
      toStatus: 'video_pending_approval',
      targetId: sceneId,
      metadata: {
        newVersion,
        preset: preset.name,
        durationMs: Date.now() - Date.now(),
      },
    });

    return currentAsset;
  } catch (error) {
    console.error(`Failed to regenerate video for scene ${sceneId}:`, error);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// Version Restoration
// ════════════════════════════════════════════════════════════════

/**
 * Restores a previous video version as current
 *
 * Allows user to revert to earlier Ken Burns preset or parameters.
 *
 * @param sceneId - Scene ID to restore
 * @param version - Version number to restore to
 * @param videosDir - Output videos directory
 * @param jobManager - JobManager instance
 * @param jobId - Job ID
 * @param options - Restoration options
 * @returns Updated VideoAsset or null on failure
 */
export function restoreVideoVersion(
  sceneId: string,
  version: number,
  videosDir: string,
  jobManager: JobManager,
  jobId: string,
  options?: VideoRestorationOptions,
): VideoAsset | null {
  try {
    const assetPath = join(videosDir, `${sceneId}.json`);
    if (!existsSync(assetPath)) {
      throw new Error(`Asset not found: ${assetPath}`);
    }

    const asset: VideoAsset = JSON.parse(readFileSync(assetPath, 'utf-8'));
    const targetVersion = asset.versions.find(v => v.version === version);

    if (!targetVersion) {
      throw new Error(`Version ${version} not found for scene ${sceneId}`);
    }

    if (!existsSync(targetVersion.filePath)) {
      throw new Error(`Version file not found: ${targetVersion.filePath}`);
    }

    // Update current version
    asset.currentVersion = version;
    asset.preset = targetVersion.preset;

    // Copy version file to main videos directory
    execSync(`cp "${targetVersion.filePath}" "${join(videosDir, `${sceneId}.mp4`)}"`, {
      stdio: 'pipe',
    });

    // Save updated asset
    writeFileSync(assetPath, JSON.stringify(asset, null, 2), 'utf-8');

    return asset;
  } catch (error) {
    console.error(`Failed to restore video version for scene ${sceneId}:`, error);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// User Presentation
// ════════════════════════════════════════════════════════════════

/**
 * Formats video assets for user presentation
 *
 * Structures VideoAssets into user-friendly format with
 * preview info, version history, and available actions.
 *
 * @param assets - Generated VideoAssets
 * @returns Formatted data structure for UI
 */
export function formatVideosForUser(assets: VideoAsset[]): Record<string, unknown> {
  return {
    total: assets.length,
    videos: assets.map(asset => ({
      sceneId: asset.sceneId,
      currentVersion: asset.currentVersion,
      currentPreset: asset.preset,
      currentFile: asset.versions.find(v => v.version === asset.currentVersion)?.filePath,
      duration: asset.versions.find(v => v.version === asset.currentVersion)?.durationSec,
      approved: asset.versions.find(v => v.version === asset.currentVersion)?.approved,
      versions: asset.versions.map(v => ({
        version: v.version,
        preset: v.preset,
        durationSec: v.durationSec,
        createdAt: v.createdAt,
        approved: v.approved,
      })),
      availablePresets: {
        dog: Object.keys(DOG_PRESETS),
        health: Object.keys(HEALTH_PRESETS),
      },
    })),
    actions: {
      approve: '모두 확정',
      regenerateScene: '씬 번호 재생성 (또는 프리셋 지정: 2번 dramatic_push)',
      restoreVersion: '씬 번호 v버전 복원',
    },
  };
}

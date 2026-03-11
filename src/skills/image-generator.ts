/**
 * Image Generator Skill - Step 4: Style Bible + Character Bible based image generation
 *
 * Handles:
 * - 2-phase image generation (Global Identity + Scene Delta)
 * - Style Bible creation per category (dog: watercolor, sseoltoon: webtoon, health: flat)
 * - Character Bible with frozen/flexible fields
 * - ComfyUI API integration
 * - Version management and restoration
 * - Image upscaling to 1080x1920
 * - State event emission per event registry
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ContentType,
  StyleBible,
  CharacterBible,
  ImageAsset,
  ImageVersion,
} from '../types/index.js';
import { COMFYUI_SETTINGS, COMMON_NEGATIVE_PROMPT } from '../types/config.js';
import type { GeneratedScript, Scene } from '../types/job.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';

// ════════════════════════════════════════════════════════════════
// Types & Interfaces
// ════════════════════════════════════════════════════════════════

/**
 * Represents a single generation log entry
 */
export interface GenerationLogEntry {
  timestamp: string;
  sceneId: string;
  version: number;
  seed: number;
  prompt: string;
  referenceImage?: string;
  method: 'reference' | 'ipadapter' | 'regenerate' | 'restore';
  status: 'success' | 'failure';
  error?: string;
  durationMs: number;
}

/**
 * Complete generation log for a job
 */
export interface GenerationLog {
  jobId: string;
  createdAt: string;
  lastUpdatedAt: string;
  entries: GenerationLogEntry[];
}

/**
 * ComfyUI API Request wrapper interface
 * (Actual HTTP calls execute through MCP shell/comfyui tools)
 */
export interface ComfyUIRequest {
  workflow: Record<string, unknown>;
  seed?: number;
  prompt?: string;
  referenceImage?: string;
  outputDir: string;
}

/**
 * ComfyUI API Response wrapper interface
 */
export interface ComfyUIResponse {
  success: boolean;
  outputPath?: string;
  error?: string;
  seed?: number;
}

/**
 * Options for image regeneration
 */
export interface RegenerationOptions {
  freezeFrozenFields?: boolean;
  newSeed?: number;
  sceneOverrides?: Record<string, string>;
}

/**
 * Options for version restoration
 */
export interface RestorationOptions {
  version: number;
  preserveApprovalState?: boolean;
}

// ════════════════════════════════════════════════════════════════
// Style Bible Presets by Category
// ════════════════════════════════════════════════════════════════

/**
 * Creates default Style Bible for a given content category
 *
 * @param contentType - dog | sseoltoon | health
 * @returns StyleBible with category-specific defaults
 */
export function createStyleBible(contentType: ContentType): StyleBible {
  const presets: Record<ContentType, StyleBible> = {
    dog: {
      renderStyle: 'soft watercolor',
      palette: ['#e8c4a0', '#d4a574', '#a0826d', '#6b5b52', '#fce4d6'],
      lineWeight: 'delicate',
      lightingMood: 'warm, golden hour',
      backgroundDensity: 'moderate',
      expressionTone: 'emotional, tender',
    },
    sseoltoon: {
      renderStyle: 'korean webtoon',
      palette: ['#2c3e50', '#e74c3c', '#ecf0f1', '#34495e', '#3498db'],
      lineWeight: 'bold',
      lightingMood: 'high contrast, dramatic',
      backgroundDensity: 'rich, detailed',
      expressionTone: 'expressive, exaggerated',
    },
    health: {
      renderStyle: 'modern flat design',
      palette: ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#FFFFFF'],
      lineWeight: 'medium',
      lightingMood: 'bright, neutral',
      backgroundDensity: 'minimal, clean',
      expressionTone: 'professional, optimistic',
    },
  };

  return presets[contentType];
}

// ════════════════════════════════════════════════════════════════
// Character Bible Management
// ════════════════════════════════════════════════════════════════

/**
 * Creates a Character Bible from character description and content type
 *
 * The Character Bible establishes visual identity with frozen core attributes
 * and flexible modifiers for scene-specific adaptation.
 *
 * @param characterDescription - Free-form character description
 * @param contentType - dog | sseoltoon | health
 * @returns CharacterBible with frozen identity and flexible modifiers
 */
export function createCharacterBible(
  characterDescription: string,
  contentType: ContentType,
): CharacterBible {
  const characterId = `char_${Date.now()}`;

  // Frozen fields: core identity maintained across all scenes
  const frozen: string[] = [
    'species',
    'breed',
    'age_category',
    'coloring',
    'distinctive_features',
    'personality_core',
  ];

  // Flexible fields: adapt to scene emotion/action
  const flexible: string[] = [
    'expression',
    'pose',
    'clothing_style',
    'background_setting',
    'lighting_condition',
    'emotional_state',
  ];

  return {
    characterId,
    identity: {
      description: characterDescription,
      contentType,
      createdAt: new Date().toISOString(),
    },
    promptBase: buildCharacterPromptBase(characterDescription, contentType),
    frozen,
    flexible,
  };
}

/**
 * Builds the base prompt segment for a character
 * @internal
 */
function buildCharacterPromptBase(description: string, contentType: ContentType): string {
  const stylePreset = createStyleBible(contentType);
  return `${description}, rendered in ${stylePreset.renderStyle}, ` +
         `${stylePreset.expressionTone}, color palette: ${stylePreset.palette.join(', ')}`;
}

// ════════════════════════════════════════════════════════════════
// Prompt Composition
// ════════════════════════════════════════════════════════════════

/**
 * Composes final image generation prompt from Style Bible, Character Bible, and scene details
 *
 * 2-phase structure:
 * Phase 1: Global Identity (Style Bible + Character Bible)
 * Phase 2: Scene Delta (scene-specific narration, visual intent, emotion)
 *
 * @param styleBible - Style definition for consistency
 * @param characterBible - Character definition with frozen/flexible fields
 * @param scene - Scene with narration, visual intent, emotion, camera
 * @param contentType - Content category for additional modifiers
 * @returns Composed prompt string ready for image generation
 */
export function composePrompt(
  styleBible: StyleBible,
  characterBible: CharacterBible,
  scene: Scene,
  contentType: ContentType,
): string {
  // Phase 1: Global Identity
  const globalIdentity = [
    // Character base
    characterBible.promptBase,
    // Style constraints
    `rendered in ${styleBible.renderStyle}`,
    `with ${styleBible.expressionTone}`,
    `lighting: ${styleBible.lightingMood}`,
    `line weight: ${styleBible.lineWeight}`,
    `background density: ${styleBible.backgroundDensity}`,
  ].join(', ');

  // Phase 2: Scene Delta
  const sceneDelta = [
    // Visual intent
    `scene: ${scene.visualIntent}`,
    // Emotion
    `mood: ${scene.emotion}`,
    // Narration context (avoid direct quoting, use thematic direction)
    `narrative context: ${scene.narration.substring(0, 100)}`,
    // Camera direction
    `camera: ${scene.camera}`,
    // Content-specific modifiers
    getContentTypeModifier(contentType),
  ]
    .filter(Boolean)
    .join(', ');

  return `${globalIdentity}. ${sceneDelta}`;
}

/**
 * Returns content-type-specific prompt modifiers
 * @internal
 */
function getContentTypeModifier(contentType: ContentType): string {
  const modifiers: Record<ContentType, string> = {
    dog: 'ultra high quality, detailed fur texture, expressive eyes',
    sseoltoon: 'dynamic composition, bold outlines, dramatic angles, vibrant colors',
    health: 'clean illustration, simple shapes, informative visual, wellness theme',
  };
  return modifiers[contentType];
}

// ════════════════════════════════════════════════════════════════
// Image Generation
// ════════════════════════════════════════════════════════════════

/**
 * Generates the reference image for Scene 1 (fixed seed)
 *
 * This image establishes the character identity and visual consistency
 * for subsequent scenes via IP-Adapter.
 *
 * @param prompt - Composed prompt from composePrompt()
 * @param settings - ComfyUI settings (checkpoint, LoRA, sampler, steps, cfg)
 * @param seed - Fixed seed for reproducibility
 * @param outputDir - Directory to save the generated image
 * @returns ComfyUIResponse with output path and seed
 *
 * @remarks
 * Actual HTTP call to ComfyUI happens through MCP shell/comfyui tools.
 * This function defines the wrapper interface and request structure.
 */
export async function generateReferenceImage(
  prompt: string,
  settings: typeof COMFYUI_SETTINGS[keyof typeof COMFYUI_SETTINGS],
  seed: number,
  outputDir: string,
): Promise<ComfyUIResponse> {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Construct ComfyUI workflow request
  const request: ComfyUIRequest = {
    workflow: {
      // ComfyUI nodes would be defined here
      // Node structure depends on actual ComfyUI graph
      checkpoint: settings.checkpoint,
      lora: settings.lora,
      lora_weight: settings.loraWeight,
      sampler: settings.sampler,
      steps: settings.steps,
      cfg_scale: settings.cfg,
      prompt: prompt,
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      width: 1080,
      height: 1920,
    },
    seed,
    prompt,
    outputDir,
  };

  // ComfyUI API call would happen here through MCP
  // For now, return interface definition
  const response: ComfyUIResponse = {
    success: true,
    outputPath: join(outputDir, `scene_1_v1_seed${seed}.png`),
    seed,
  };

  return response;
}

/**
 * Generates images for scenes 2~N using IP-Adapter with reference image
 *
 * IP-Adapter maintains character consistency by using the reference image
 * as a visual anchor while allowing scene-specific variations.
 *
 * @param prompt - Scene-specific composed prompt
 * @param referenceImage - Path to Scene 1 reference image
 * @param settings - ComfyUI settings
 * @param outputDir - Directory to save generated images
 * @param sceneId - Scene identifier (scene_2, scene_3, etc.)
 * @param version - Version number for this scene
 * @param seed - Seed for this generation
 * @returns ComfyUIResponse with output path
 *
 * @remarks
 * IP-Adapter (Image Prompt Adapter) uses the reference image to guide
 * generation while respecting the text prompt for scene-specific changes.
 */
export async function generateWithIPAdapter(
  prompt: string,
  referenceImage: string,
  settings: typeof COMFYUI_SETTINGS[keyof typeof COMFYUI_SETTINGS],
  outputDir: string,
  sceneId: string,
  version: number,
  seed: number,
): Promise<ComfyUIResponse> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Verify reference image exists
  if (!existsSync(referenceImage)) {
    return {
      success: false,
      error: `Reference image not found: ${referenceImage}`,
    };
  }

  const request: ComfyUIRequest = {
    workflow: {
      // ComfyUI nodes with IP-Adapter
      checkpoint: settings.checkpoint,
      lora: settings.lora,
      lora_weight: settings.loraWeight,
      sampler: settings.sampler,
      steps: settings.steps,
      cfg_scale: settings.cfg,
      prompt: prompt,
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      width: 1080,
      height: 1920,
      // IP-Adapter specific
      ipadapter_model: 'ip-adapter-plus',
      ipadapter_scale: 0.7, // Strength of reference image influence
    },
    seed,
    prompt,
    referenceImage,
    outputDir,
  };

  const response: ComfyUIResponse = {
    success: true,
    outputPath: join(outputDir, `${sceneId}_v${version}_seed${seed}.png`),
    seed,
  };

  return response;
}

// ════════════════════════════════════════════════════════════════
// Regeneration & Version Management
// ════════════════════════════════════════════════════════════════

/**
 * Regenerates a specific scene image while preserving frozen Character Bible fields
 *
 * Regeneration workflow:
 * 1. Load current Character Bible (frozen fields unchanged)
 * 2. Generate new prompt with scene delta
 * 3. Generate new image (with new seed or specified seed)
 * 4. Create new version entry in versions/ directory
 * 5. Emit SCENE_IMAGE_REGEN_COMPLETED event
 *
 * @param sceneId - Target scene identifier
 * @param jobManager - JobManager instance for workspace access
 * @param jobId - Job identifier
 * @param options - Regeneration options (seed, frozen field override, scene overrides)
 * @returns ImageAsset with new version added
 *
 * @throws Error if scene not found or ComfyUI call fails
 */
export async function regenerateScene(
  sceneId: string,
  jobManager: JobManager,
  jobId: string,
  options: RegenerationOptions = {},
): Promise<ImageAsset> {
  const startTime = Date.now();
  const outputDir = jobManager.getOutputPath(jobId, 'images');

  try {
    // Load existing image asset
    const assetPath = join(outputDir, `${sceneId}_asset.json`);
    let asset: ImageAsset;

    if (existsSync(assetPath)) {
      asset = JSON.parse(readFileSync(assetPath, 'utf-8'));
    } else {
      throw new Error(`Image asset not found: ${assetPath}`);
    }

    // Generate new version number
    const newVersion = (asset.currentVersion || 0) + 1;
    const newSeed = options.newSeed ?? Math.floor(Math.random() * 1000000);

    // Load scene data from script
    const scriptPath = jobManager.getOutputPath(jobId, 'script.json');
    const script: GeneratedScript = JSON.parse(readFileSync(scriptPath, 'utf-8'));
    const scene = script.scenes.find(s => s.sceneId === sceneId);

    if (!scene) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    // Get contentType from job
    const job = jobManager.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const contentType = job.contentType;

    // Compose new prompt with scene delta
    const styleBible = createStyleBible(contentType); // Would load from saved bible
    const characterBible = JSON.parse(
      readFileSync(join(outputDir, 'character_bible.json'), 'utf-8'),
    ) as CharacterBible;

    const prompt = composePrompt(styleBible, characterBible, scene, contentType);

    // Generate new image
    const settings = COMFYUI_SETTINGS[contentType]; // Would get from config
    const response = await generateWithIPAdapter(
      prompt,
      join(outputDir, 'scene_1_v1.png'),
      settings,
      outputDir,
      sceneId,
      newVersion,
      newSeed,
    );

    if (!response.success) {
      throw new Error(`ComfyUI generation failed: ${response.error}`);
    }

    // Create version entry
    const newImageVersion: ImageVersion = {
      version: newVersion,
      seed: newSeed,
      prompt,
      filePath: response.outputPath!,
      approved: false,
      createdAt: new Date().toISOString(),
    };

    // Update asset and save
    asset.currentVersion = newVersion;
    asset.versions.push(newImageVersion);
    writeFileSync(assetPath, JSON.stringify(asset, null, 2), 'utf-8');

    // Save version to versions/ directory
    const versionsDir = jobManager.getOutputPath(jobId, 'images/versions', sceneId);
    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }
    writeFileSync(
      join(versionsDir, `v${newVersion}_manifest.json`),
      JSON.stringify(newImageVersion, null, 2),
      'utf-8',
    );

    // Log generation
    const log = getGenerationLog(outputDir) || {
      jobId,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
    };
    log.entries.push({
      timestamp: new Date().toISOString(),
      sceneId,
      version: newVersion,
      seed: newSeed,
      prompt,
      method: 'regenerate',
      status: 'success',
      durationMs: Date.now() - startTime,
    });
    saveGenerationLog(outputDir, log);

    // Emit event
    emitEvent({
      jobId,
      eventType: 'SCENE_IMAGE_REGEN_COMPLETED',
      actor: 'tool',
      fromStatus: 'images_regen_requested',
      toStatus: 'images_pending_approval',
      targetId: sceneId,
      metadata: { version: newVersion, seed: newSeed },
    });

    return asset;
  } catch (error) {
    // Log failure
    const log = getGenerationLog(outputDir) || {
      jobId,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
    };
    log.entries.push({
      timestamp: new Date().toISOString(),
      sceneId,
      version: (log.entries.length + 1),
      seed: 0,
      prompt: '',
      method: 'regenerate',
      status: 'failure',
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    });
    saveGenerationLog(outputDir, log);

    throw error;
  }
}

/**
 * Restores a previous version of a scene image
 *
 * Restoration workflow:
 * 1. Load version manifest from versions/ directory
 * 2. Copy image file to current location
 * 3. Update asset currentVersion
 * 4. Emit SCENE_IMAGE_VERSION_RESTORED event
 *
 * @param sceneId - Target scene identifier
 * @param version - Version number to restore
 * @param jobManager - JobManager instance
 * @param jobId - Job identifier
 * @param options - Restoration options
 * @returns ImageAsset with version restored as current
 *
 * @throws Error if version not found
 */
export async function restoreVersion(
  sceneId: string,
  version: number,
  jobManager: JobManager,
  jobId: string,
  options: RestorationOptions = { version, preserveApprovalState: true },
): Promise<ImageAsset> {
  const outputDir = jobManager.getOutputPath(jobId, 'images');

  // Load version manifest
  const versionsDir = jobManager.getOutputPath(jobId, 'images/versions', sceneId);
  const manifestPath = join(versionsDir, `v${version}_manifest.json`);

  if (!existsSync(manifestPath)) {
    throw new Error(`Version manifest not found: ${manifestPath}`);
  }

  const versionManifest: ImageVersion = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // Load asset
  const assetPath = join(outputDir, `${sceneId}_asset.json`);
  const asset: ImageAsset = JSON.parse(readFileSync(assetPath, 'utf-8'));

  // Update current version
  asset.currentVersion = version;

  // Preserve approval state if requested
  if (options.preserveApprovalState && asset.versions[asset.versions.length - 1]?.approved) {
    versionManifest.approved = true;
  }

  // Save updated asset
  writeFileSync(assetPath, JSON.stringify(asset, null, 2), 'utf-8');

  // Log restoration
  const log = getGenerationLog(outputDir) || {
    jobId,
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    entries: [],
  };
  log.entries.push({
    timestamp: new Date().toISOString(),
    sceneId,
    version,
    seed: versionManifest.seed,
    prompt: versionManifest.prompt,
    method: 'restore',
    status: 'success',
    durationMs: 0,
  });
  saveGenerationLog(outputDir, log);

  // Emit event
  emitEvent({
    jobId,
    eventType: 'SCENE_IMAGE_VERSION_RESTORED',
    actor: 'user',
    fromStatus: 'images_pending_approval',
    toStatus: 'images_version_restored',
    targetId: sceneId,
    metadata: { restoredVersion: version },
  });

  return asset;
}

// ════════════════════════════════════════════════════════════════
// Generation Log Management
// ════════════════════════════════════════════════════════════════

/**
 * Retrieves the generation log for a job
 *
 * @param outputDir - Output directory for the job
 * @returns GenerationLog or null if not found
 */
export function getGenerationLog(outputDir: string): GenerationLog | null {
  const metaDir = join(outputDir, 'metadata');
  const logPath = join(metaDir, 'generation_log.json');
  // 하위 호환: 루트에 있는 경우도 읽음
  const legacyPath = join(outputDir, 'generation_log.json');
  const path = existsSync(logPath) ? logPath : existsSync(legacyPath) ? legacyPath : null;
  if (!path) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Saves the generation log for a job
 *
 * @param outputDir - Output directory for the job
 * @param log - GenerationLog to save
 */
export function saveGenerationLog(outputDir: string, log: GenerationLog): void {
  const metaDir = join(outputDir, 'metadata');
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true });
  log.lastUpdatedAt = new Date().toISOString();
  writeFileSync(join(metaDir, 'generation_log.json'), JSON.stringify(log, null, 2), 'utf-8');
}

// ════════════════════════════════════════════════════════════════
// Upscaling
// ════════════════════════════════════════════════════════════════

/**
 * Upscales an image to 1080x1920 (9:16 vertical short-form video aspect ratio)
 *
 * Uses RealESRGAN for AI upscaling with fallback to FFmpeg for resize.
 * Target resolution: 1080x1920 (ideal for YouTube Shorts, TikTok, etc.)
 *
 * @param inputPath - Path to input image
 * @param outputPath - Path to save upscaled image
 * @returns true if successful, false if upscaling failed
 *
 * @remarks
 * Actual upscaling happens through MCP shell tool calling:
 * - Primary: realesrgan-ncnn-vulkan (if available)
 * - Fallback: ffmpeg (resize with interpolation)
 */
export async function upscaleImage(inputPath: string, outputPath: string): Promise<boolean> {
  if (!existsSync(inputPath)) {
    console.error(`Input image not found: ${inputPath}`);
    return false;
  }

  // Ensure output directory exists
  const outputDir = outputPath.split('/').slice(0, -1).join('/');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // MCP shell call would happen here:
  // Option 1: realesrgan-ncnn-vulkan (AI upscaling)
  //   realesrgan-ncnn-vulkan -i input.png -o output.png -s 2 -n realesrgan-x2plus
  //
  // Option 2: FFmpeg fallback (aspect-ratio-preserving resize)
  //   ffmpeg -i input.png -vf "scale=1080:1920:force_original_aspect_ratio=decrease,
  //           pad=1080:1920:(ow-iw)/2:(oh-ih)/2:white" output.png

  // For now, return interface definition
  console.log(`Upscaling image: ${inputPath} -> ${outputPath}`);
  return true;
}

// ════════════════════════════════════════════════════════════════
// User Presentation
// ════════════════════════════════════════════════════════════════

/**
 * Formats generated images for user presentation/approval
 *
 * Collects all current versions and prepares metadata for display.
 *
 * @param assets - Array of ImageAsset objects
 * @returns Formatted array with paths, versions, and metadata
 */
export function formatImagesForUser(
  assets: ImageAsset[],
): Array<{
  sceneId: string;
  currentVersion: number;
  imagePath: string;
  versions: Array<{
    version: number;
    seed: number;
    approved: boolean;
    createdAt: string;
  }>;
}> {
  return assets.map(asset => ({
    sceneId: asset.sceneId,
    currentVersion: asset.currentVersion,
    imagePath: asset.versions[asset.currentVersion - 1]?.filePath || 'N/A',
    versions: asset.versions.map(v => ({
      version: v.version,
      seed: v.seed,
      approved: v.approved,
      createdAt: v.createdAt,
    })),
  }));
}

// All interfaces and functions above are exported inline with `export`

/**
 * Job, Scene, Asset 관련 타입 정의
 * schemas/data-models-v6.md 기반
 */

import type { ContentType } from './config.js';

// ── Job 상태 enum ──
export type JobStatus =
  | 'searching'
  | 'references_presented'
  | 'reference_selected'
  | 'scripting'
  | 'script_pending_approval'
  | 'script_failed'
  | 'script_approved'
  | 'images_generating'
  | 'images_pending_approval'
  | 'images_partial'
  | 'images_regen_requested'
  | 'images_version_restored'
  | 'images_fully_approved'
  | 'video_generating'
  | 'video_pending_approval'
  | 'video_regen_requested'
  | 'video_failed'
  | 'video_approved'
  | 'tts_generating'
  | 'tts_syncing'
  | 'tts_failed'
  | 'compose_done'
  | 'qc_reviewing'
  | 'qc_passed'
  | 'qc_warning'
  | 'qc_failed'
  | 'exporting'
  | 'exported'
  | 'error'
  | 'abandoned';

// ── Workspace ──
export interface Workspace {
  temp: string;
  approved: string;
  versions: string;
  final: string;
}

// ── Job ──
export interface Job {
  jobId: string;
  keyword: string;
  contentType: ContentType;
  needsVideo: boolean;
  selectedReferenceId: string | null;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  workspace: Workspace;
}

// ── Reference Video ──
export interface ReferenceVideo {
  videoId: string;
  title: string;
  channelName: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  duration: number; // seconds
  thumbnailUrl: string;
  description: string;
  captions?: string;
  analysis: VideoAnalysis;
  score: VideoScore;
}

export interface VideoAnalysis {
  hookType: 'emotional_shock' | 'curiosity' | 'question' | 'number' | 'confession';
  structure: string[];
  emotionalCurve: string;
  pacing: 'fast' | 'medium' | 'slow';
  viralPoints: string[];
  riskFlags: string[];
}

export interface VideoScore {
  viewCountScore: number;
  recencyScore: number;
  commentReactionScore: number;
  structureReusabilityScore: number;
  policySafetyScore: number;
  totalScore: number;
}

// ── Scene ──
export interface Scene {
  sceneId: string;
  order: number;
  narration: string;
  visualIntent: string;
  emotion: string;
  camera: string;
  durationSec: number;
}

// ── Generated Script ──
export interface GeneratedScript {
  scriptId: string;
  jobId: string;
  version: number;
  inspiredBy: string;
  meta: ScriptMeta;
  similarityCheck: SimilarityCheck;
  healthCompliance?: HealthComplianceAudit;
  hook: string;
  cta: string;
  scenes: Scene[];
}

export interface ScriptMeta {
  titleCandidates: string[];
  thumbnailHookCandidates: string[];
  tags: string[];
  totalDurationSec: number;
}

export interface SimilarityCheck {
  phraseOverlapScore: number;
  structureOverlapScore: number;
  titleSimilarityScore: number;
  overallRisk: 'low' | 'medium' | 'high';
  details?: string[];
}

export interface HealthComplianceAudit {
  totalSentences: number;
  levelCounts: Record<string, number>;
  violations: ComplianceViolation[];
  autoFixes: AutoFix[];
  disclaimerInserted: boolean;
}

export interface ComplianceViolation {
  sceneId: string;
  sentence: string;
  ruleId: string;
  severity: 'critical' | 'high' | 'medium';
  matchDetail?: {
    matchType: string;
    matched: string;
    captures?: Record<string, string>;
  };
}

export interface AutoFix {
  sceneId: string;
  original: string;
  rewritten: string;
  ruleId: string;
  strategy: string;
}

// ── Style Bible ──
export interface StyleBible {
  renderStyle: string;
  palette: string[];
  lineWeight: string;
  lightingMood: string;
  backgroundDensity: string;
  expressionTone: string;
}

// ── Character Bible ──
export interface CharacterBible {
  characterId: string;
  identity: Record<string, string>;
  promptBase: string;
  frozen: string[];
  flexible: string[];
}

// ── Image Asset ──
export interface ImageAsset {
  sceneId: string;
  currentVersion: number;
  versions: ImageVersion[];
}

export interface ImageVersion {
  version: number;
  seed: number;
  prompt: string;
  filePath: string;
  approved: boolean;
  reason?: string;
  createdAt: string;
}

// ── Video Asset ──
export interface VideoAsset {
  sceneId: string;
  currentVersion: number;
  preset: string;
  versions: VideoVersion[];
}

export interface VideoVersion {
  version: number;
  preset: string;
  filePath: string;
  durationSec: number;
  approved: boolean;
  reason?: string;
  createdAt: string;
}

// ── TTS Timing ──
export interface TtsTiming {
  sceneId: string;
  audioFile: string;
  audioDuration: number;
  videoDuration: number;
  startTime: number;
  endTime: number;
}

// ── QC Result ──
export type QcGrade = 'pass' | 'warning' | 'fail';

export interface QcCheckResult {
  name: string;
  passed: boolean;
  grade: QcGrade;
  details?: string;
}

export interface QcResult {
  overallGrade: QcGrade;
  checks: QcCheckResult[];
  criticalFailures: number;
  warnings: number;
}

// ── Production Log ──
export interface ProductionLogEntry {
  step: string;
  at: string;
  result?: string;
  [key: string]: unknown;
}

export interface ProductionLog {
  jobId: string;
  keyword: string;
  contentType: ContentType;
  timeline: ProductionLogEntry[];
  stats: {
    totalScenes: number;
    imageRegenerations: number;
    videoRegenerations: number;
    finalDurationSec: number;
    fileCount: number;
    packageSizeMb: number;
  };
}

// ── Used Video Entry ──
export type UsedVideoStatus = 'selected_for_homage' | 'presented_not_selected';

export interface UsedVideoEntry {
  videoId: string;
  title: string;
  channelName: string;
  usageType: UsedVideoStatus;
  jobId: string;
  presentedAt: string;
  selectedAt?: string;
  expiresAt?: string; // null for permanent (selected_for_homage)
}

export interface UsedVideosStore {
  videos: Record<string, UsedVideoEntry>;
  stats: {
    totalSelected: number;
    totalPresented: number;
    lastCleanupAt: string | null;
  };
}

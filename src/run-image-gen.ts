/**
 * 이미지 생성 러너
 *
 * 사용법:
 *   npx tsx src/run-image-gen.ts <jobId> [옵션]
 *
 * Provider 옵션:
 *   --provider=hf           HuggingFace FLUX.1-schnell (무료, 안정적) ← 기본
 *   --provider=pollinations Pollinations.ai (완전 무료, 불안정할 수 있음)
 *   --provider=comfyui      ComfyUI 로컬 (고품질, 로컬 GPU 필요)
 *
 * 기타 옵션:
 *   --model=<모델명>         모델 지정 (provider별 상이)
 *   --scene=scene_01        특정 씬만 생성
 *
 * 예시:
 *   npx tsx src/run-image-gen.ts job_20260310_001 --provider=hf
 *   npx tsx src/run-image-gen.ts job_20260310_001 --provider=pollinations --model=flux
 *   npx tsx src/run-image-gen.ts job_20260310_001 --provider=hf --scene=scene_05
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), 'config', '.env') });

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { JobManager } from './core/job-manager.js';
import { generateAllScenesWithPollinations } from './skills/image-generator-pollinations.js';
import type { PollinationsModel, PollinationsOptions } from './skills/image-generator-pollinations.js';
import { generateAllScenesWithHF } from './skills/image-generator-hf.js';
import type { HFModel, HFOptions } from './skills/image-generator-hf.js';

const PROJECT_DIR = process.cwd();

// ── 인수 파싱 ──
const args = process.argv.slice(2);
const jobId = args.find(a => !a.startsWith('--'));
const provider = (args.find(a => a.startsWith('--provider='))?.split('=')[1] ?? 'hf') as 'hf' | 'pollinations' | 'comfyui';
const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1];
const sceneFilter = args.find(a => a.startsWith('--scene='))?.split('=')[1];

if (!jobId) {
  console.error('사용법: npx tsx src/run-image-gen.ts <jobId> [--provider=hf|pollinations|comfyui] [--model=...] [--scene=scene_01]');
  process.exit(1);
}

const jobManager = new JobManager(PROJECT_DIR);
const job = jobManager.getJob(jobId);
if (!job) {
  console.error(`Job not found: ${jobId}`);
  process.exit(1);
}

// ── HF API 키 확인 (hf provider인 경우) ──
const hfApiKey = process.env.HF_API_KEY ?? '';
if (provider === 'hf' && !hfApiKey) {
  console.error('❌ HF_API_KEY 없음');
  console.error('   1. https://huggingface.co → Settings → Access Tokens → New Token (Read)');
  console.error('   2. config/.env 에 HF_API_KEY=hf_xxxxx 추가');
  process.exit(1);
}

// ── prompts.json 로드 ──
const promptsPath = join(PROJECT_DIR, 'output', jobId, 'script', 'prompts.json');
if (!existsSync(promptsPath)) {
  console.error(`prompts.json 없음: ${promptsPath}`);
  process.exit(1);
}
const promptsData = JSON.parse(readFileSync(promptsPath, 'utf-8'));

// ── Style Bible에서 캐릭터 앵커 로드 (일관성 확보) ──
const styleBiblePath = join(PROJECT_DIR, 'output', jobId, 'script', 'style_bible.json');
let characterAnchor = '';
if (existsSync(styleBiblePath)) {
  const styleBible = JSON.parse(readFileSync(styleBiblePath, 'utf-8'));
  const mc = styleBible?.characterBible?.mainCharacter;
  if (mc?.consistencyKeywords?.length) {
    // 캐릭터 고정 키워드를 강하게 맨 앞에 배치 (일관성 최우선)
    const locked = [
      ...mc.consistencyKeywords,
      `${mc.appearance?.furColor ?? ''}`,
      `${mc.appearance?.eyes ?? ''}`,
      `${mc.appearance?.nose ?? ''}`,
      `${mc.appearance?.ears ?? ''}`,
    ].filter(Boolean).join(', ');
    characterAnchor = `[CHARACTER: ${locked}], `;
    console.log(`✅ 캐릭터 앵커 로드: ${locked.slice(0, 60)}...`);
  }
}

// ── 씬 목록 (캐릭터 앵커 prefix 삽입) ──
let scenes: Array<{ sceneId: string; positivePrompt: string }> = promptsData.scenes.map(
  (s: { sceneId: string; positivePrompt: string }) => ({
    sceneId: s.sceneId,
    positivePrompt: characterAnchor + s.positivePrompt,
  }),
);
if (sceneFilter) {
  scenes = scenes.filter(s => s.sceneId === sceneFilter);
  if (scenes.length === 0) { console.error(`씬 없음: ${sceneFilter}`); process.exit(1); }
}

const outputDir = join(PROJECT_DIR, 'output', jobId, 'images');

const providerLabel = provider === 'hf'
  ? `HuggingFace (${modelArg ?? 'FLUX.1-schnell'})`
  : provider === 'pollinations'
  ? `Pollinations (${modelArg ?? 'flux'})`
  : 'ComfyUI (로컬)';

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 이미지 생성 시작
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Job     : ${jobId}
Provider: ${providerLabel}
씬 수   : ${scenes.length}개
출력    : output/${jobId}/images/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// ── 상태 전이 헬퍼 ──
function startGenerating() {
  const currentJob = jobManager.getJob(jobId!);
  if (currentJob?.status === 'script_approved') {
    jobManager.transitionJob(jobId!, 'images_generating', {
      eventType: 'IMAGES_GENERATION_STARTED',
      actor: 'system',
      reasonDetail: `${providerLabel} 이미지 생성 시작`,
    });
  }
}

function finishGenerating(count: number, total: number) {
  const currentJob = jobManager.getJob(jobId!);
  if (currentJob?.status === 'images_generating') {
    const eventType = count === total ? 'IMAGES_GENERATED' : 'IMAGES_PARTIAL_FAILURE';
    jobManager.transitionJob(jobId!, count === total ? 'images_pending_approval' : 'images_partial', {
      eventType,
      actor: 'tool',
      reasonDetail: `${count}/${total}개 씬 생성 완료`,
    });
  }
}

// ── Provider 분기 ──
if (provider === 'hf') {
  const options: HFOptions = {
    model: (modelArg as HFModel) ?? 'black-forest-labs/FLUX.1-schnell',
    width: 1080,
    height: 1920,
    numInferenceSteps: 4,
    seed: 42,
  };

  startGenerating();
  const assets = await generateAllScenesWithHF(
    jobId, scenes, outputDir, hfApiKey, options,
    (sceneId, index, total) => console.log(`\n[${index}/${total}] ${sceneId}`),
  );

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${assets.length === scenes.length ? '✅' : '⚠️ '} 이미지 생성 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
성공: ${assets.length}/${scenes.length}개
위치: output/${jobId}/images/
`);
  finishGenerating(assets.length, scenes.length);
  console.log('👉 이미지 확인 후 "이미지 승인" 또는 "씬 N 재생성"');

} else if (provider === 'pollinations') {
  const options: PollinationsOptions = {
    model: (modelArg as PollinationsModel) ?? 'flux',
    width: 1080,
    height: 1920,
    seed: 42000,
    nologo: true,
    enhance: false,
  };

  startGenerating();
  const assets = await generateAllScenesWithPollinations(
    jobId, scenes, outputDir, options,
    (sceneId, index, total) => console.log(`\n[${index}/${total}] ${sceneId}`),
  );

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${assets.length === scenes.length ? '✅' : '⚠️ '} 이미지 생성 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
성공: ${assets.length}/${scenes.length}개
위치: output/${jobId}/images/
`);
  finishGenerating(assets.length, scenes.length);
  console.log('👉 이미지 확인 후 "이미지 승인" 또는 "씬 N 재생성"');

} else {
  console.log('⚠️  ComfyUI는 로컬 설치 필요합니다 (http://127.0.0.1:8188)');
  console.log('   실제 생성: --provider=hf 또는 --provider=pollinations');
}

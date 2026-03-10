/**
 * HuggingFace Inference API 이미지 생성 어댑터
 *
 * 모델: black-forest-labs/FLUX.1-schnell (무료, 빠름)
 * 설정: config/.env 에 HF_API_KEY=hf_xxxxx 추가 필요
 * 발급: https://huggingface.co → Settings → Access Tokens → New Token (Read)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import type { ImageAsset, ImageVersion } from '../types/index.js';
import { getGenerationLog, saveGenerationLog } from './image-generator.js';

export type HFModel =
  | 'black-forest-labs/FLUX.1-schnell'   // 빠름, 무료
  | 'black-forest-labs/FLUX.1-dev'       // 고품질, 무료(제한)
  | 'stabilityai/stable-diffusion-xl-base-1.0'; // SDXL

export interface HFOptions {
  model?: HFModel;
  width?: number;
  height?: number;
  numInferenceSteps?: number;
  seed?: number;
}

const DEFAULT_HF_OPTIONS: Required<HFOptions> = {
  model: 'black-forest-labs/FLUX.1-schnell',
  width: 1080,
  height: 1920,
  numInferenceSteps: 4,   // schnell 권장값
  seed: 42,
};

// ── HF Inference API 호출 ──
async function callHFInference(
  apiKey: string,
  model: HFModel,
  prompt: string,
  options: Required<HFOptions>,
  maxRetries = 3,
): Promise<Buffer> {
  const body = JSON.stringify({
    inputs: prompt,
    parameters: {
      width: options.width,
      height: options.height,
      num_inference_steps: options.numInferenceSteps,
      seed: options.seed,
    },
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await new Promise<Buffer>((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'router.huggingface.co',
          path: `/hf-inference/models/${model}`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d: Buffer) => chunks.push(d));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (res.statusCode === 200) {
              resolve(buf);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${buf.toString().slice(0, 200)}`));
            }
          });
        },
      );

      req.setTimeout(120000, () => {
        req.destroy();
        reject(new Error('Request timeout (120s)'));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return result;
  }

  throw new Error('Max retries exceeded');
}

// ── 단일 씬 생성 ──
export async function generateSceneWithHF(
  sceneId: string,
  prompt: string,
  outputDir: string,
  jobId: string,
  apiKey: string,
  version = 1,
  options: HFOptions = {},
): Promise<ImageAsset> {
  const opts = { ...DEFAULT_HF_OPTIONS, ...options };
  const seed = opts.seed + (version - 1) * 100;
  const startTime = Date.now();

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `${sceneId}_v${version}_seed${seed}.png`;
  // 버전별 폴더: images/v1/, v2/, ...
  const versionDir = join(outputDir, `v${version}`);
  if (!existsSync(versionDir)) mkdirSync(versionDir, { recursive: true });
  const filePath = join(versionDir, fileName);
  const currentFilePath = join(outputDir, `${sceneId}.png`);
  // metadata 폴더
  const metaDir = join(outputDir, 'metadata');
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true });

  console.log(`  🎨 ${sceneId} 생성 중... (model: ${opts.model.split('/')[1]}, seed: ${seed})`);

  try {
    const imageBuffer = await callHFInferenceWithRetry(apiKey, opts.model, prompt, { ...opts, seed }, 3);

    // 파일 저장: 버전 폴더 + 현재 파일(root)
    writeFileSync(filePath, imageBuffer);
    writeFileSync(currentFilePath, imageBuffer);

    const durationMs = Date.now() - startTime;
    console.log(`  ✅ ${sceneId} 완료 (${(durationMs / 1000).toFixed(1)}s, ${(imageBuffer.length / 1024).toFixed(0)}KB)`);

    const imageVersion: ImageVersion = {
      version,
      seed,
      prompt,
      filePath: currentFilePath,
      approved: false,
      createdAt: new Date().toISOString(),
    };

    // asset.json → metadata/
    const assetPath = join(metaDir, `${sceneId}_asset.json`);
    // 하위 호환: 루트에 있는 기존 asset.json도 읽음
    const legacyAssetPath = join(outputDir, `${sceneId}_asset.json`);
    const readPath = existsSync(assetPath) ? assetPath : existsSync(legacyAssetPath) ? legacyAssetPath : null;
    let asset: ImageAsset;
    if (readPath) {
      const existing: ImageAsset = JSON.parse(readFileSync(readPath, 'utf-8'));
      existing.currentVersion = version;
      existing.versions.push(imageVersion);
      asset = existing;
    } else {
      asset = { sceneId, currentVersion: version, versions: [imageVersion] };
    }
    writeFileSync(join(metaDir, `${sceneId}_asset.json`), JSON.stringify(asset, null, 2));

    // generation_log
    const log = getGenerationLog(outputDir) ?? {
      jobId, createdAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), entries: [],
    };
    log.entries.push({
      timestamp: new Date().toISOString(), sceneId, version, seed, prompt,
      method: 'reference' as const, status: 'success' as const, durationMs,
    });
    saveGenerationLog(outputDir, log);

    return asset;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const log = getGenerationLog(outputDir) ?? {
      jobId, createdAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), entries: [],
    };
    log.entries.push({
      timestamp: new Date().toISOString(), sceneId, version, seed, prompt,
      method: 'reference' as const, status: 'failure' as const,
      error: (err as Error).message, durationMs,
    });
    saveGenerationLog(outputDir, log);
    throw err;
  }
}

async function callHFInferenceWithRetry(
  apiKey: string,
  model: HFModel,
  prompt: string,
  opts: Required<HFOptions>,
  maxRetries: number,
): Promise<Buffer> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callHFInference(apiKey, model, prompt, opts, 1);
    } catch (err) {
      const msg = (err as Error).message;
      // 모델 로딩 중 (503) → 대기 후 재시도
      if (msg.includes('503') && attempt < maxRetries) {
        console.log(`    ⏳ 모델 로딩 중... 20초 후 재시도 (${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 20000));
      } else if (msg.includes('429') && attempt < maxRetries) {
        console.log(`    ⏳ Rate limit — 15초 후 재시도 (${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 15000));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// ── 전체 씬 일괄 생성 ──
export async function generateAllScenesWithHF(
  jobId: string,
  scenes: Array<{ sceneId: string; positivePrompt: string }>,
  outputDir: string,
  apiKey: string,
  options: HFOptions = {},
  onProgress?: (sceneId: string, index: number, total: number) => void,
): Promise<ImageAsset[]> {
  const assets: ImageAsset[] = [];
  const total = scenes.length;

  for (let i = 0; i < scenes.length; i++) {
    const { sceneId, positivePrompt } = scenes[i];
    onProgress?.(sceneId, i + 1, total);

    const sceneSeed = (options.seed ?? 42) + i * 100;

    try {
      // 기존 asset.json에서 다음 버전 자동 감지 (metadata/ 우선, 루트 하위 호환)
      const metaAsset = join(outputDir, 'metadata', `${sceneId}_asset.json`);
      const rootAsset = join(outputDir, `${sceneId}_asset.json`);
      const assetPath = existsSync(metaAsset) ? metaAsset : existsSync(rootAsset) ? rootAsset : null;
      const nextVersion = assetPath
        ? (JSON.parse(readFileSync(assetPath, 'utf-8')) as ImageAsset).currentVersion + 1
        : 1;

      const asset = await generateSceneWithHF(
        sceneId, positivePrompt, outputDir, jobId, apiKey,
        nextVersion, { ...options, seed: sceneSeed },
      );
      assets.push(asset);

      // 씬 사이 3초 대기
      if (i < scenes.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`  ❌ ${sceneId} 실패: ${(err as Error).message}`);
    }
  }

  return assets;
}

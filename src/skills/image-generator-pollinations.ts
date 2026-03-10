/**
 * Pollinations.ai 이미지 생성 어댑터
 *
 * - 완전 무료, API 키 불필요
 * - Flux 모델 기반
 * - 9:16 (1080x1920) 생성
 * - 씬별 버전 관리 + generation_log 기록
 */

import { existsSync, mkdirSync, writeFileSync, createWriteStream, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import type { ImageAsset, ImageVersion } from '../types/index.js';
import { getGenerationLog, saveGenerationLog } from './image-generator.js';

// ── Pollinations 모델 옵션 ──
// flux   : 기본값, 범용 고품질 (모델 미지정시 자동 사용)
// turbo  : 빠른 생성
// sana   : 고품질 세부 묘사
// zimage : 대안 모델
export type PollinationsModel = 'flux' | 'turbo' | 'sana' | 'zimage';

export interface PollinationsOptions {
  model?: PollinationsModel;
  width?: number;
  height?: number;
  seed?: number;
  enhance?: boolean;   // Pollinations 자동 프롬프트 강화
  nologo?: boolean;    // 워터마크 제거
}

const DEFAULT_OPTIONS: Required<PollinationsOptions> = {
  model: 'flux',
  width: 1080,
  height: 1920,
  seed: Math.floor(Math.random() * 999999),
  enhance: false,
  nologo: true,
};

// ── HTTP 다운로드 유틸 (재시도 포함) ──
async function downloadImage(url: string, destPath: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadImageOnce(url, destPath);
      return;
    } catch (err) {
      const msg = (err as Error).message;
      const is429 = msg.includes('429');
      const is500 = msg.includes('500');

      if ((is429 || is500) && attempt < maxRetries) {
        const waitSec = is429 ? 10 * attempt : 5 * attempt;
        console.log(`    ⏳ ${msg} — ${waitSec}초 후 재시도 (${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      } else {
        throw err;
      }
    }
  }
}

function downloadImageOnce(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      // 리다이렉트 처리
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        const redirectUrl = response.headers.location;
        if (!redirectUrl) return reject(new Error('Redirect without location header'));
        downloadImageOnce(redirectUrl, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        // body 읽어서 버림
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });

    request.on('error', (err) => {
      file.close();
      reject(err);
    });

    request.setTimeout(90000, () => {
      request.destroy();
      reject(new Error('Request timeout (90s)'));
    });
  });
}

// ── 단일 씬 이미지 생성 ──
export async function generateSceneWithPollinations(
  sceneId: string,
  prompt: string,
  outputDir: string,
  jobId: string,
  version: number = 1,
  options: PollinationsOptions = {},
): Promise<ImageAsset> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seed = opts.seed ?? Math.floor(Math.random() * 999999);
  const startTime = Date.now();

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `${sceneId}_v${version}_seed${seed}.png`;
  const filePath = join(outputDir, fileName);
  const currentFileName = `${sceneId}.png`;
  const currentFilePath = join(outputDir, currentFileName);

  // URL 구성
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: String(opts.width),
    height: String(opts.height),
    seed: String(seed),
    model: opts.model,
    enhance: String(opts.enhance),
    nologo: String(opts.nologo),
  });
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}`;

  console.log(`  🎨 ${sceneId} 생성 중... (seed: ${seed}, model: ${opts.model})`);

  try {
    // 버전 파일 저장
    await downloadImage(url, filePath);

    // 현재 버전 복사 (scene_01.png 형식) — API 재호출 없이 파일 복사
    copyFileSync(filePath, currentFilePath);

    const durationMs = Date.now() - startTime;
    console.log(`  ✅ ${sceneId} 완료 (${(durationMs / 1000).toFixed(1)}s)`);

    // 버전 디렉토리 관리
    const versionsDir = join(outputDir, 'versions', sceneId);
    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }

    const imageVersion: ImageVersion = {
      version,
      seed,
      prompt,
      filePath: currentFilePath,
      approved: false,
      createdAt: new Date().toISOString(),
    };

    // versions/ 매니페스트
    writeFileSync(
      join(versionsDir, `v${version}_manifest.json`),
      JSON.stringify(imageVersion, null, 2),
    );

    // asset.json
    const assetPath = join(outputDir, `${sceneId}_asset.json`);
    let asset: ImageAsset;

    if (existsSync(assetPath)) {
      const existing: ImageAsset = JSON.parse(
        (await import('node:fs')).readFileSync(assetPath, 'utf-8'),
      );
      existing.currentVersion = version;
      existing.versions.push(imageVersion);
      asset = existing;
    } else {
      asset = {
        sceneId,
        currentVersion: version,
        versions: [imageVersion],
      };
    }
    writeFileSync(assetPath, JSON.stringify(asset, null, 2));

    // generation_log
    const log = getGenerationLog(outputDir) ?? {
      jobId,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
    };
    log.entries.push({
      timestamp: new Date().toISOString(),
      sceneId,
      version,
      seed,
      prompt,
      method: 'reference' as const,
      status: 'success' as const,
      durationMs,
    });
    saveGenerationLog(outputDir, log);

    return asset;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const log = getGenerationLog(outputDir) ?? {
      jobId,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      entries: [],
    };
    log.entries.push({
      timestamp: new Date().toISOString(),
      sceneId,
      version,
      seed,
      prompt,
      method: 'reference' as const,
      status: 'failure' as const,
      error: (err as Error).message,
      durationMs,
    });
    saveGenerationLog(outputDir, log);
    throw err;
  }
}

// ── 전체 씬 일괄 생성 ──
export async function generateAllScenesWithPollinations(
  jobId: string,
  scenes: Array<{ sceneId: string; positivePrompt: string }>,
  outputDir: string,
  options: PollinationsOptions = {},
  onProgress?: (sceneId: string, index: number, total: number) => void,
): Promise<ImageAsset[]> {
  const assets: ImageAsset[] = [];
  const total = scenes.length;

  for (let i = 0; i < scenes.length; i++) {
    const { sceneId, positivePrompt } = scenes[i];
    onProgress?.(sceneId, i + 1, total);

    // 씬마다 고유 seed (재현성 확보)
    const sceneSeed = (options.seed ?? 42000) + i * 100;

    try {
      // 기존 asset.json에서 다음 버전 자동 감지
      const assetPath = join(outputDir, `${sceneId}_asset.json`);
      const nextVersion = existsSync(assetPath)
        ? (JSON.parse(readFileSync(assetPath, 'utf-8')) as ImageAsset).currentVersion + 1
        : 1;

      const asset = await generateSceneWithPollinations(
        sceneId,
        positivePrompt,
        outputDir,
        jobId,
        nextVersion,
        { ...options, seed: sceneSeed },
      );
      assets.push(asset);

      // API 과부하 방지: 씬 사이 5초 대기
      if (i < scenes.length - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error(`  ❌ ${sceneId} 실패: ${(err as Error).message}`);
      // 실패해도 계속 진행
    }
  }

  return assets;
}

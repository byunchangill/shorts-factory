import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import type { Job, Script, Settings, Clip } from '@shared/types';
import { EXPORT_DIRS, COUPANG_PARTNERS_DISCLOSURE } from '@shared/constants';
import { ensureDir, exists, listFiles } from '../util/fsx.js';
import type { SceneTiming } from './tts.js';

/**
 * 산출물을 workspace 밖의 사용자 폴더로 내보낸다.
 * workspace/는 버전·상태 추적용 내부 저장소로 남고,
 * 실제로 쓰는 파일은 제품명(한글) 폴더 아래 용도별로 정리된다.
 */

/** 설정이 비어 있으면 OS 다운로드 폴더를 기본으로 쓴다 */
export function resolveExportRoot(settings: Settings): string {
  if (settings.exportRoot.trim()) return settings.exportRoot.trim();
  return path.join(os.homedir(), 'Downloads');
}

/** 파일명에 못 쓰는 문자만 제거 — 한글은 그대로 유지한다 */
export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '이름없음';
}

/** {루트}/{제품명}/ — 제품(프로젝트) 단위 폴더 */
export function productDir(settings: Settings, productName: string): string {
  return path.join(resolveExportRoot(settings), safeFileName(productName));
}

/** 같은 제품의 여러 편이 섞이지 않도록 파일명에 잡 제목을 붙인다 */
export function exportFileName(productName: string, jobTitle: string, suffix: string): string {
  return `${safeFileName(productName)}_${safeFileName(jobTitle)}_${suffix}`;
}

/** 이미 있는 파일은 덮어쓰지 않고 _2, _3 을 붙인다 */
async function uniquePath(target: string): Promise<string> {
  if (!(await exists(target))) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${base}_${n}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`파일명 충돌이 너무 많습니다: ${target}`);
}

async function copyTo(src: string, destDir: string, destName: string): Promise<string | null> {
  if (!(await exists(src))) return null;
  await ensureDir(destDir);
  const target = await uniquePath(path.join(destDir, destName));
  await fsp.copyFile(src, target);
  return target;
}

export interface ExportInput {
  settings: Settings;
  job: Job;
  productName: string; // 프로젝트 폴더명 (한글 그대로)
  jobDir: string; // workspace 안의 잡 폴더 절대경로
  script: Script | null;
  timings: SceneTiming[] | null;
  clips: Clip[];
}

export interface ExportResult {
  rootDir: string;
  copied: string[];
  skipped: string[];
}

export async function exportJob(input: ExportInput): Promise<ExportResult> {
  const { settings, job, productName, jobDir, script, timings, clips } = input;
  const root = productDir(settings, productName);
  const copied: string[] = [];
  const skipped: string[] = [];

  const push = (p: string | null, label: string) => {
    if (p) copied.push(p);
    else skipped.push(label);
  };

  // 1) 최종영상 — 별도 폴더
  if (job.output.currentVersion) {
    const src = path.join(jobDir, 'output', `final_v${job.output.currentVersion}.mp4`);
    push(
      await copyTo(
        src,
        path.join(root, EXPORT_DIRS.final),
        exportFileName(productName, job.title, `최종_v${job.output.currentVersion}.mp4`),
      ),
      '최종영상',
    );
  } else {
    skipped.push('최종영상 (아직 조립되지 않음)');
  }

  // 2) 재가공된 영상 (정리본 + 컷 세그먼트)
  for (const clip of clips) {
    if (clip.currentCleanVersion) {
      const clean = clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion);
      if (clean) {
        push(
          await copyTo(
            clean.filePath,
            path.join(root, EXPORT_DIRS.video),
            exportFileName(productName, job.title, `${clip.id}_정리본.mp4`),
          ),
          `${clip.id} 정리본`,
        );
      }
    }
  }

  // 3) 원본 영상 (설정으로 켠 경우에만 — 용량이 큼)
  if (settings.exportIncludeSources) {
    const sourcesDir = path.join(jobDir, 'sources');
    for (const f of await listFiles(sourcesDir)) {
      if (f.endsWith('.json') || f.endsWith('.part')) continue;
      push(
        await copyTo(path.join(sourcesDir, f), path.join(root, EXPORT_DIRS.sources), f),
        `원본 ${f}`,
      );
    }
  }

  // 4) 음성
  const voiceDir = path.join(jobDir, 'voice');
  if (timings) {
    for (const t of timings) {
      push(
        await copyTo(
          path.join(voiceDir, t.audioFile),
          path.join(root, EXPORT_DIRS.audio),
          exportFileName(productName, job.title, t.audioFile),
        ),
        `음성 ${t.audioFile}`,
      );
    }
  }

  // 5) 대본 + 자막
  if (script) {
    const scriptDir = path.join(root, EXPORT_DIRS.script);
    await ensureDir(scriptDir);
    const mdPath = await uniquePath(
      path.join(scriptDir, exportFileName(productName, job.title, `대본_v${script.version}.md`)),
    );
    await fsp.writeFile(mdPath, scriptToMarkdown(script, productName, job.title), 'utf8');
    copied.push(mdPath);

    const jsonPath = await uniquePath(
      path.join(scriptDir, exportFileName(productName, job.title, `대본_v${script.version}.json`)),
    );
    await fsp.writeFile(jsonPath, JSON.stringify(script, null, 2), 'utf8');
    copied.push(jsonPath);
  }
  push(
    await copyTo(
      path.join(jobDir, 'subtitles', 'final.srt'),
      path.join(root, EXPORT_DIRS.script),
      exportFileName(productName, job.title, '자막.srt'),
    ),
    '자막(SRT)',
  );

  // 6) 이미지 (menu-b 씬 이미지)
  const scenesDir = path.join(jobDir, 'scenes');
  if (await exists(scenesDir)) {
    for (const f of await listFiles(scenesDir)) {
      if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
      push(
        await copyTo(path.join(scenesDir, f), path.join(root, EXPORT_DIRS.image), f),
        `이미지 ${f}`,
      );
    }
  }

  // 7) 업로드킷
  push(
    await copyTo(
      path.join(jobDir, 'output', 'upload-kit.md'),
      path.join(root, EXPORT_DIRS.uploadKit),
      exportFileName(productName, job.title, '업로드킷.md'),
    ),
    '업로드킷',
  );

  return { rootDir: root, copied, skipped };
}

/** 사람이 읽는 대본 — 편집·녹음 대본으로 바로 쓸 수 있는 형태 */
export function scriptToMarkdown(script: Script, productName: string, jobTitle: string): string {
  const lines: string[] = [];
  lines.push(`# ${script.title || jobTitle}`);
  lines.push('');
  lines.push(`- 제품: ${productName}`);
  lines.push(`- 작업: ${jobTitle}`);
  lines.push(`- 대본 버전: v${script.version}`);
  lines.push(`- 총 씬: ${script.scenes.length}개`);
  lines.push('');
  for (const [i, scene] of script.scenes.entries()) {
    lines.push(`## 씬 ${i + 1} (${scene.sceneId})`);
    lines.push('');
    lines.push(`**나레이션**: ${scene.narration}`);
    lines.push('');
    lines.push(`**자막**: ${scene.subtitle}`);
    if (scene.clipRef) {
      const seg = scene.clipRef.suggestedSegment;
      lines.push('');
      lines.push(`**소재**: ${scene.clipRef.clipId}${seg ? ` (${seg.in}s ~ ${seg.out}s)` : ''}`);
    }
    if (scene.imagePrompt) {
      lines.push('');
      lines.push(`**이미지 프롬프트**: ${scene.imagePrompt}`);
    }
    lines.push('');
  }
  if (script.notes) {
    lines.push('---');
    lines.push('');
    lines.push(`메모: ${script.notes}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(COUPANG_PARTNERS_DISCLOSURE);
  return lines.join('\n');
}

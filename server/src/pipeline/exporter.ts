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

/** 내보낼 것 하나. `src`가 있으면 복사, 없으면 `text`를 그대로 쓴다 */
export interface ExportItem {
  /** EXPORT_DIRS의 값 — 어느 묶음에 들어가는지 */
  dir: string;
  name: string;
  src?: string;
  text?: string;
  /** 없을 때 사용자에게 보여줄 이름 */
  label: string;
}

/**
 * 무엇을 어느 묶음에 넣을지 **한 곳에서** 정한다.
 *
 * 폴더 내보내기와 웹 다운로드가 같은 목록을 써야 한다 — 갈라두면 화면에서 받은 것과
 * 폴더에 있는 것이 달라진다. 여기서는 목록만 만들고 파일이 실제로 있는지는 보지 않는다
 * (쓰는 쪽이 없는 것을 걸러낸다).
 */
export async function planExport(input: ExportInput): Promise<ExportItem[]> {
  const { settings, job, productName, jobDir, script, timings, clips } = input;
  const named = (suffix: string) => exportFileName(productName, job.title, suffix);
  const items: ExportItem[] = [];

  if (job.output.currentVersion) {
    items.push({
      dir: EXPORT_DIRS.final,
      src: path.join(jobDir, 'output', `final_v${job.output.currentVersion}.mp4`),
      name: named(`최종_v${job.output.currentVersion}.mp4`),
      label: '최종영상',
    });
  }

  for (const clip of clips) {
    const clean = clip.cleanVersions.find((v) => v.v === clip.currentCleanVersion);
    if (clean) {
      items.push({
        dir: EXPORT_DIRS.video,
        src: clean.filePath,
        name: named(`${clip.id}_정리본.mp4`),
        label: `${clip.id} 정리본`,
      });
    }
  }

  for (const t of timings ?? []) {
    items.push({
      dir: EXPORT_DIRS.audio,
      src: path.join(jobDir, 'voice', t.audioFile),
      name: named(t.audioFile),
      label: `음성 ${t.audioFile}`,
    });
  }

  if (script) {
    items.push({
      dir: EXPORT_DIRS.script,
      text: scriptToMarkdown(script, productName, job.title),
      name: named(`대본_v${script.version}.md`),
      label: '대본(마크다운)',
    });
    items.push({
      dir: EXPORT_DIRS.script,
      text: JSON.stringify(script, null, 2),
      name: named(`대본_v${script.version}.json`),
      label: '대본(JSON)',
    });
  }
  items.push({
    dir: EXPORT_DIRS.script,
    src: path.join(jobDir, 'subtitles', 'final.srt'),
    name: named('자막.srt'),
    label: '자막(SRT)',
  });

  items.push({
    dir: EXPORT_DIRS.uploadKit,
    src: path.join(jobDir, 'output', 'upload-kit.md'),
    name: named('업로드킷.md'),
    label: '업로드킷',
  });

  // menu-b 씬 이미지
  const scenesDir = path.join(jobDir, 'scenes');
  if (await exists(scenesDir)) {
    for (const f of await listFiles(scenesDir)) {
      if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
      items.push({ dir: EXPORT_DIRS.image, src: path.join(scenesDir, f), name: f, label: `이미지 ${f}` });
    }
  }

  // 원본은 용량이 커서 설정으로 켠 경우에만
  if (settings.exportIncludeSources) {
    const sourcesDir = path.join(jobDir, 'sources');
    for (const f of await listFiles(sourcesDir)) {
      if (f.endsWith('.json') || f.endsWith('.part')) continue;
      items.push({ dir: EXPORT_DIRS.sources, src: path.join(sourcesDir, f), name: f, label: `원본 ${f}` });
    }
  }
  return items;
}

export async function exportJob(input: ExportInput): Promise<ExportResult> {
  const root = productDir(input.settings, input.productName);
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const item of await planExport(input)) {
    const destDir = path.join(root, item.dir);
    if (item.text !== undefined) {
      await ensureDir(destDir);
      const out = await uniquePath(path.join(destDir, item.name));
      await fsp.writeFile(out, item.text, 'utf8');
      copied.push(out);
      continue;
    }
    const done = await copyTo(item.src!, destDir, item.name);
    if (done) copied.push(done);
    else skipped.push(item.label);
  }

  if (!input.job.output.currentVersion) skipped.push('최종영상 (아직 조립되지 않음)');
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

import path from 'node:path';
import fsp from 'node:fs/promises';
import type { Settings, Clip, Segment, Zone } from '@shared/types';
import { run } from '../util/exec.js';
import { ensureDir } from '../util/fsx.js';
import { toConcatPath } from './assemble.js';
import { getAvailableInpaintProvider } from './inpaint.js';

/**
 * 2차 제거(AI 인페인팅)를 **쓰는 구간에만** 돌린다.
 *
 * 인페인팅은 프레임당 초 단위로 든다 (VSR은 CPU에서 약 2초). 75초 클립을 통째로 넘기면
 * 자막이 4초짜리여도 2,000프레임을 훑어 한 시간이 넘는다. 그래서 **지울 구간만 잘라
 * 넘기고 원래 자리에 다시 이어붙인다.** 시간축이 그대로라 조립이 쓰는 컷 시각이 안 어긋난다.
 *
 * 잘라낸 조각에는 시각을 0부터 다시 매겨 넘긴다 — 조각 안에서의 시각이라야 맞다.
 */

/** 인코딩 규격을 조각마다 똑같이 맞춘다 — 다르면 이어붙일 때 흔들린다 */
const ENCODE = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an'];

/**
 * 자동으로 찾은 글자 자리에 붙일 제거 방식 — **`delogo`다.**
 *
 * 사다리로만 보면 인페인팅이 위다. 그런데 인페인팅은 프레임당 초 단위로 든다(VSR은 CPU에서
 * 약 2초). 자동으로 붙여 놨더니 「영상 재생성」 버튼 하나가 클립당 몇 분짜리가 됐다 —
 * 하네스가 210초에 타임아웃나서 드러났다. **누르는 사람이 예상 못 한 대기를 만들지 않는다.**
 *
 * 그래서 자동은 즉시 끝나는 `delogo`로 두고, 인페인팅은 사용자가 그 존을 골라
 * 「AI 인페인팅」으로 바꿨을 때만 돈다. 그때는 고른 구간만 잘라 돌리므로 값이 예측된다.
 */
export function autoRemovalMethod(): Zone['method'] {
  return 'delogo';
}

export interface Range { t0: number; t1: number }

/**
 * 실제로 인페인팅할 구간.
 *
 * 인페인팅 존이 **고른 구간과 겹치는 부분**만 남긴다. 최종 영상에 안 나오는 자리를
 * 몇십 분 걸려 지우는 것은 손해뿐이다. 겹치거나 맞닿는 구간은 하나로 합친다 —
 * 조각이 잘게 쪼개질수록 이어붙인 자리가 늘어난다.
 */
export function dirtyRanges(zones: Zone[], segments: Segment[], duration: number): Range[] {
  const used = segments.filter((s) => s.used && s.out > s.in);
  const raw: Range[] = [];
  for (const z of zones.filter((z) => z.method === 'inpaint')) {
    const zt0 = z.t0 ?? 0;
    const zt1 = z.t1 ?? duration;
    for (const s of used) {
      const t0 = Math.max(zt0, s.in);
      const t1 = Math.min(zt1, s.out, duration);
      if (t1 - t0 > 0.05) raw.push({ t0, t1 });
    }
  }
  raw.sort((a, b) => a.t0 - b.t0);

  const merged: Range[] = [];
  for (const r of raw) {
    const last = merged.at(-1);
    if (last && r.t0 <= last.t1) last.t1 = Math.max(last.t1, r.t1);
    else merged.push({ ...r });
  }
  return merged;
}

/** 지울 구간 + 그 사이 남는 구간을 시간 순서대로 늘어놓는다 (합치면 원본 길이 그대로) */
export function splitPlan(dirty: Range[], duration: number): Array<Range & { clean: boolean }> {
  const out: Array<Range & { clean: boolean }> = [];
  let cursor = 0;
  for (const r of dirty) {
    if (r.t0 - cursor > 0.05) out.push({ t0: cursor, t1: r.t0, clean: false });
    out.push({ t0: r.t0, t1: r.t1, clean: true });
    cursor = r.t1;
  }
  if (duration - cursor > 0.05) out.push({ t0: cursor, t1: duration, clean: false });
  return out;
}

/**
 * 2차 제거 실행. 도구가 없거나 지울 구간이 없으면 `null`을 돌려 조용히 건너뛴다 —
 * 정리 단계가 통째로 막히면 안 된다.
 */
export async function runTier2Scoped(
  settings: Settings,
  clip: Clip,
  inputVideo: string,
  zones: Zone[],
  outDir: string,
  onProgress?: (line: string) => void,
): Promise<{ version: number; filePath: string; provider: string } | null> {
  if (!clip.probe) return null;
  const dirty = dirtyRanges(zones, clip.segments, clip.probe.duration);
  if (!dirty.length) return null;

  const provider = await getAvailableInpaintProvider();
  if (!provider) {
    onProgress?.('AI 제거 도구가 없어 2차 제거를 건너뜁니다');
    return null;
  }

  const work = path.join(outDir, 'tier2_tmp');
  await fsp.rm(work, { recursive: true, force: true });
  await ensureDir(work);

  const plan = splitPlan(dirty, clip.probe.duration);
  const pieces: string[] = [];
  let cleaned = 0;
  try {
    for (const [i, part] of plan.entries()) {
      const cut = path.join(work, `p${String(i).padStart(3, '0')}.mp4`);
      await run(settings.ffmpegPath, [
        '-y', '-ss', String(part.t0), '-to', String(part.t1), '-i', inputVideo, ...ENCODE, cut,
      ]);
      if (!part.clean) {
        pieces.push(cut);
        continue;
      }
      onProgress?.(`${provider.name}로 ${part.t0.toFixed(1)}~${part.t1.toFixed(1)}초 지우는 중…`);
      const done = path.join(work, `p${String(i).padStart(3, '0')}_clean.mp4`);
      try {
        await provider.run({
          settings,
          // 조각 안에서의 시각으로 옮겨 넘긴다
          clip: { ...clip, probe: { ...clip.probe, duration: part.t1 - part.t0 } },
          inputVideo: cut,
          zones: zones
            .filter((z) => z.method === 'inpaint')
            .map((z) => ({
              ...z,
              t0: Math.max(0, (z.t0 ?? 0) - part.t0),
              t1: Math.min(part.t1 - part.t0, (z.t1 ?? clip.probe!.duration) - part.t0),
            })),
          workDir: path.join(work, `w${i}`),
          outPath: done,
          onProgress,
        });
        pieces.push(done);
        cleaned++;
      } catch (e) {
        /*
          🔴 **한 조각이 실패해도 정리 단계를 죽이지 않는다.**
          제일 흔한 실패는 고장이 아니라 「그 영역에서 글자를 못 찾음」이다 — 반투명 자막을
          VSR 검출기가 놓치거나, 그 구간에는 애초에 글자가 없었던 경우다. 그때 통째로
          던지면 클립 여덟 개짜리 재생성이 첫 조각에서 멈춘다.
          그 조각은 **안 지운 원본으로** 두고 나머지를 계속한다.
        */
        const why = e instanceof Error ? e.message.split(String.fromCharCode(10))[0] : String(e);
        onProgress?.(`${part.t0.toFixed(1)}~${part.t1.toFixed(1)}초는 건너뜁니다 — ${why}`);
        pieces.push(cut);
      }
    }

    // 한 조각도 못 지웠으면 새 버전을 만들지 않는다 — 1차 결과가 그대로 최신본으로 남는다
    if (cleaned === 0) {
      onProgress?.('2차 제거로 지운 구간이 없습니다 — 1차 결과를 그대로 씁니다');
      return null;
    }

    const version = (clip.cleanVersions.at(-1)?.v ?? 0) + 1;
    const outPath = path.join(outDir, `clean_v${version}.mp4`);
    if (pieces.length === 1) {
      await fsp.copyFile(pieces[0], outPath);
    } else {
      const list = path.join(work, 'concat.txt');
      await fsp.writeFile(list, pieces.map((f) => `file '${toConcatPath(f)}'`).join('\n'), 'utf8');
      await run(settings.ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', outPath,
      ]);
    }
    return { version, filePath: outPath, provider: provider.name };
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

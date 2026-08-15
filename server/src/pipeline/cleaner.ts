import path from 'node:path';
import type { Clip, Zone } from '@shared/types';
import type { Settings } from '@shared/types';
import { run } from '../util/exec.js';

export interface ProbeInfo {
  width: number;
  height: number;
}

/**
 * 1차 제거용 ffmpeg filtergraph 빌더 (순수 함수 — 단위 테스트 대상).
 *
 * - crop: 가장자리 자막띠 제거. 존이 상/하단에 붙어 있으면 해당 영역을 잘라낸다.
 * - delogo: 정적 워터마크 영역 보간
 * - boxblur: split → crop → boxblur → overlay 체인으로 영역만 블러
 * - 시간 한정 존은 enable='between(t,t0,t1)'
 *
 * crop은 프레임 전체 좌표계를 바꾸므로 항상 마지막에 적용하고,
 * delogo/boxblur 좌표는 원본 좌표 기준으로 먼저 처리한다.
 */
export function buildCleanFiltergraph(zones: Zone[], probe: ProbeInfo): string {
  const delogoZones = zones.filter((z) => z.method === 'delogo');
  const blurZones = zones.filter((z) => z.method === 'boxblur');
  const cropZones = zones.filter((z) => z.method === 'crop');

  const parts: string[] = [];
  let label = '[0:v]';
  let step = 0;

  const enableExpr = (z: Zone) =>
    z.t0 !== undefined && z.t1 !== undefined ? `:enable='between(t,${z.t0},${z.t1})'` : '';

  // 1) delogo (원본 좌표)
  for (const z of delogoZones) {
    const next = `[v${++step}]`;
    // delogo는 프레임 경계에 닿으면 실패 → 1px 안쪽으로 클램프
    const x = Math.max(1, Math.round(z.x));
    const y = Math.max(1, Math.round(z.y));
    const w = Math.min(Math.round(z.w), probe.width - x - 1);
    const h = Math.min(Math.round(z.h), probe.height - y - 1);
    parts.push(`${label}delogo=x=${x}:y=${y}:w=${w}:h=${h}${enableExpr(z)}${next}`);
    label = next;
  }

  // 2) boxblur 오버레이 체인 (원본 좌표)
  for (const z of blurZones) {
    const x = Math.round(z.x);
    const y = Math.round(z.y);
    const w = Math.round(z.w);
    const h = Math.round(z.h);
    const src = `[b${step}s]`;
    const blurred = `[b${step}b]`;
    const next = `[v${++step}]`;
    parts.push(`${label}split=2[base${step - 1}]${src}`);
    parts.push(`${src}crop=${w}:${h}:${x}:${y},boxblur=luma_radius=12:luma_power=2${blurred}`);
    parts.push(`[base${step - 1}]${blurred}overlay=${x}:${y}${enableExpr(z)}${next}`);
    label = next;
  }

  // 3) crop — 상/하단 자막띠를 잘라내고 원래 해상도로 스케일 복원
  if (cropZones.length > 0) {
    let top = 0;
    let bottom = 0;
    for (const z of cropZones) {
      const zoneCenter = z.y + z.h / 2;
      if (zoneCenter < probe.height / 2) top = Math.max(top, Math.ceil(z.y + z.h));
      else bottom = Math.max(bottom, Math.ceil(probe.height - z.y));
    }
    const newH = probe.height - top - bottom;
    if (newH > probe.height * 0.5) {
      const next = `[v${++step}]`;
      parts.push(`${label}crop=${probe.width}:${newH}:0:${top},scale=${probe.width}:${probe.height}${next}`);
      label = next;
    }
  }

  if (parts.length === 0) return '';
  // 마지막 출력 라벨 제거 (ffmpeg -vf는 최종 라벨 없이 끝나야 함)
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = last.replace(/\[v\d+\]$/, '');
  return parts.join(';');
}

/** 1차 제거 실행 — clean_v{n}.mp4 생성 */
export async function runTier1Clean(
  settings: Settings,
  clip: Clip,
  inputPath: string,
  outDir: string,
  onProgress?: (line: string) => void,
): Promise<{ version: number; filePath: string; params: string }> {
  if (!clip.probe) throw new Error('probe 정보 없음 — 분석을 먼저 실행하세요');
  const zones = clip.zones.filter((z) => z.method !== 'inpaint');
  const graph = buildCleanFiltergraph(zones, clip.probe);
  if (!graph) throw new Error('적용할 존이 없습니다');

  const version = (clip.cleanVersions.at(-1)?.v ?? 0) + 1;
  const outPath = path.join(outDir, `clean_v${version}.mp4`);
  const args = [
    '-y', '-i', inputPath,
    '-vf', graph,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
    // 원본 소리는 버린다 — 나레이션을 따로 붙이고 조립도 `-an`으로 영상만 가져간다.
    // 남겨두면 이 단계 미리보기에서만 남의 영상 소리·배경음악이 들린다
    '-an',
    outPath,
  ];
  await run(settings.ffmpegPath, args, { onStderr: onProgress });
  return { version, filePath: outPath, params: graph };
}

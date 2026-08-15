import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import type { Settings, Zone } from '@shared/types';
import { run, checkTool } from '../util/exec.js';

/**
 * 자막·워터마크 자리 자동 찾기.
 *
 * **가장자리 밀도 같은 어림짐작으로는 못 한다.** 실측해봤다 — 글자와 나무·건물이 똑같이
 * 빽빽하고(전 영역 20~70), "가장자리가 있고 안 움직인다"는 조건은 고정 카메라로 찍은
 * 풍경에도 그대로 들어맞는다. 클립 11개 52구간에서 거의 모든 행이 후보로 나왔다.
 * 그래서 글자를 **글자로 인식하는** 검출기를 쓴다 (rapidocr-onnxruntime, 선택 설치).
 *
 * 인식된 글자 내용은 쓰지 않는다 — 필요한 건 위치와 시각뿐이다.
 */

const SCRIPT = fileURLToPath(new URL('../../../tools/ocr/detect_text.py', import.meta.url));

export interface TextBox { x: number; y: number; w: number; h: number; score: number }
export interface FrameDetection { t: number; boxes: TextBox[] }

/** 검출기가 쓸 만하다고 보는 최소 신뢰도 — 이보다 낮으면 글자가 아닐 가능성이 크다 */
const MIN_SCORE = 0.5;

/** 상자를 이만큼 넓혀 지운다. 글자 획 끝과 그림자가 상자 밖으로 조금 나간다 */
const PAD_PX = 6;

/** 두 상자가 같은 자막이라고 볼 겹침 비율 (작은 쪽 넓이 기준) */
const SAME_ZONE_OVERLAP = 0.3;

/**
 * 쓸 파이썬 찾기. 설정에 적어뒀으면 그것만 쓴다 — 사용자가 가상환경을 지정했는데
 * 서버가 멋대로 다른 파이썬을 고르면 검출기가 없다고 나온다 (iopaint에서 겪은 그 문제).
 * 윈도우 런처(`py`)를 먼저 보는 이유는 `python`이 마이크로소프트 스토어 안내문으로
 * 연결된 빈 껍데기인 경우가 흔해서다.
 */
const PYTHON_CANDIDATES = ['py', 'python', 'python3'];

export async function resolvePython(settings: Settings): Promise<string | null> {
  // 예전 설정 파일에는 이 항목이 아예 없다 — 없다고 도구 점검 전체가 죽으면 안 된다
  const wanted = (settings.pythonPath ?? '').trim();
  for (const bin of wanted ? [wanted] : PYTHON_CANDIDATES) {
    if ((await checkTool(bin, ['--version'])).available) return bin;
  }
  return null;
}

/** 검출기까지 실제로 import 되는지 본다 — 파이썬만 있고 모듈이 없으면 없는 것과 같다 */
export async function ocrAvailable(settings: Settings): Promise<boolean> {
  const python = await resolvePython(settings);
  if (!python) return false;
  const r = await checkTool(python, ['-c', 'import rapidocr_onnxruntime']);
  return r.available;
}

/** 겹치는 넓이 ÷ 작은 쪽 넓이 */
function overlapRatio(a: TextBox, b: TextBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * 프레임별 상자 → 존.
 *
 * 같은 자막이라도 글자 수에 따라 상자가 매 프레임 조금씩 달라진다. 겹치는 것들을 한 덩어리로
 * 묶고 **가장 큰 테두리**를 쓴다 — 프레임마다 다른 상자를 그대로 쓰면 지우다 만 자국이 남는다.
 *
 * 시각은 그 덩어리가 보인 첫 프레임부터 마지막 프레임까지다. 중간에 잠깐 안 잡혀도 이어 붙인다 —
 * 한 프레임 놓쳤다고 구간을 둘로 쪼개면 그 사이에 자막이 그대로 남는다.
 */
export function clusterBoxes(
  detections: FrameDetection[],
  frameStep: number,
  duration: number,
): Zone[] {
  const clusters: Array<{ box: TextBox; times: number[] }> = [];

  for (const { t, boxes } of detections) {
    for (const box of boxes) {
      if (box.score < MIN_SCORE) continue;
      const hit = clusters.find((c) => overlapRatio(c.box, box) >= SAME_ZONE_OVERLAP);
      if (hit) {
        // 테두리를 넓혀 둘 다 덮는다
        const x = Math.min(hit.box.x, box.x);
        const y = Math.min(hit.box.y, box.y);
        hit.box = {
          x, y,
          w: Math.max(hit.box.x + hit.box.w, box.x + box.w) - x,
          h: Math.max(hit.box.y + hit.box.h, box.y + box.h) - y,
          score: Math.max(hit.box.score, box.score),
        };
        hit.times.push(t);
      } else {
        clusters.push({ box: { ...box }, times: [t] });
      }
    }
  }

  return clusters.map((c, i) => {
    const t0 = Math.max(0, Math.min(...c.times) - frameStep);
    const t1 = Math.min(duration, Math.max(...c.times) + frameStep);
    return {
      id: `auto${i + 1}`,
      kind: 'subtitle' as const,
      x: Math.max(0, c.box.x - PAD_PX),
      y: Math.max(0, c.box.y - PAD_PX),
      w: c.box.w + PAD_PX * 2,
      h: c.box.h + PAD_PX * 2,
      // 영상 내내 잡혔으면 구간을 두지 않는다 — 전체 구간이 곧 정답이다
      ...(t0 <= 0 && t1 >= duration ? {} : { t0: Number(t0.toFixed(2)), t1: Number(t1.toFixed(2)) }),
      method: 'delogo' as const,
    };
  });
}

/** 존이 화면 밖으로 나가지 않게 자른다 — ffmpeg 필터가 범위를 넘으면 통째로 실패한다 */
function clampToFrame(zones: Zone[], width: number, height: number): Zone[] {
  return zones
    .map((z) => {
      const x = Math.max(0, Math.min(z.x, width - 1));
      const y = Math.max(0, Math.min(z.y, height - 1));
      return { ...z, x, y, w: Math.min(z.w, width - x), h: Math.min(z.h, height - y) };
    })
    .filter((z) => z.w > 1 && z.h > 1);
}

/**
 * 영상에서 글자가 있는 자리와 시각을 찾는다.
 *
 * @param fps 초당 몇 장을 볼지. 자막은 1~2초 머무르므로 1장/초면 놓치지 않는다
 */
export async function detectTextZones(
  settings: Settings,
  videoPath: string,
  probe: { width: number; height: number; duration: number },
  onProgress?: (line: string) => void,
  fps = 1,
): Promise<Zone[]> {
  const python = await resolvePython(settings);
  if (!python) throw new Error('파이썬을 찾지 못했습니다 — 설정에서 경로를 지정하세요');

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ocr-'));
  try {
    onProgress?.('프레임 뽑는 중…');
    await run(settings.ffmpegPath, [
      '-y', '-i', videoPath, '-vf', `fps=${fps}`, '-q:v', '3',
      path.join(tmpDir, 'f_%04d.jpg'),
    ]);

    const files = (await fsp.readdir(tmpDir)).filter((f) => f.endsWith('.jpg')).sort();
    if (!files.length) return [];

    onProgress?.(`글자 찾는 중… (${files.length}장)`);
    // 프레임마다 프로세스를 띄우면 모델을 매번 올린다 — 한 번 띄우고 경로를 흘려보낸다
    const child = execa(python, [SCRIPT], {
      input: files.map((f) => path.join(tmpDir, f)).join('\n'),
      timeout: 10 * 60_000,
      encoding: 'utf8',
    });
    const { stdout } = await child;

    const detections: FrameDetection[] = [];
    for (const line of String(stdout).split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      const parsed = JSON.parse(line) as { file?: string; boxes?: TextBox[]; fatal?: string };
      if (parsed.fatal) throw new Error(`글자 검출기가 설치되어 있지 않습니다: ${parsed.fatal}`);
      if (!parsed.file) continue;
      // f_0001.jpg = 1번째 장 → (n-1)/fps 초
      const n = Number(path.basename(parsed.file).replace(/\D/g, ''));
      detections.push({ t: (n - 1) / fps, boxes: parsed.boxes ?? [] });
    }

    const zones = clusterBoxes(detections, 1 / fps, probe.duration);
    onProgress?.(`글자 자리 ${zones.length}곳`);
    return clampToFrame(zones, probe.width, probe.height);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

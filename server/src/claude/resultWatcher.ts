import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {
  RESULT_SCHEMAS, ScriptSchema, ProductSchema, FormatSchema, SceneImagesSchema,
  type Script, type SceneImageRef, type Packet,
} from '@shared/types';
import { assetPolicyProblems } from '@shared/assetPolicy';
import { packetMenu, scriptRuleErrors, scriptRuleContext } from './scriptRules.js';
import { WORKSPACE_ROOT, paths, toWorkspaceRel } from '../store/workspace.js';
import { readJson, exists, ensureDir } from '../util/fsx.js';
import { listAllPackets, readPacket, writePacket, resolvePacketDir } from './packets.js';
import {
  resolveJob, readJob, readScript, writeScriptVersion, mutateScript, logJobEvent, mutateJob,
  type JobRef,
} from '../store/jobs.js';
import { writeProduct } from '../store/projects.js';
import { saveFormat } from '../store/formats.js';
import { broadcast } from '../sse.js';

let watcher: fs.FSWatcher | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

/** 워처가 이벤트를 놓쳐도 결과가 반드시 반영되도록 하는 안전망 주기 */
const SWEEP_INTERVAL_MS = 5_000;

/** 워처가 들어갈 필요가 없는 무거운 폴더 — 영상·프레임·음성은 감시 대상이 아니다 */
const HEAVY_DIRS = new Set([
  'sources', 'output', 'clips', 'frames', 'voice', 'subtitles', 'cache', 'product',
  /*
    자료실(짤방·효과음). 공용 자료를 받을 때 git이 수백 개 파일을 한꺼번에 쓰는데,
    요청서와 아무 상관이 없는 이벤트라 통째로 뺀다 — 여기 없는 `.done`을 찾느라
    동기화 한 번에 워처가 수백 번 헛돈다.
  */
  'assets',
  // 삭제한 잡·카테고리가 옮겨지는 곳 (store/remove.ts). 그 안에도 처리 대기 중이던
  // requests/*/result/.done 가 그대로 들어 있어, 감시하면 이미 지운 잡의 결과를 다시 물어온다
  '.trash',
  // 올라오는 자료가 잠깐 머무는 자리 (store/assets.ts의 `assetPaths.staging`).
  // 자료실(`assets`)과 같은 이유로 요청서와 무관하다 — 파일 수십 개를 한 번에 올리면 그만큼 헛돈다
  '.uploads',
]);

/**
 * 감시 제외 판정. **작업공간 기준 상대경로**를 받는다 —
 * 절대경로로 판정하면 작업공간을 `.../voice/` 같은 폴더에 둔 사용자의 감시가 통째로 꺼진다.
 *
 * 워처가 볼 것은 `requests/{packetId}/result/.done` 하나뿐인데 이벤트는 작업공간 전체에서
 * 온다. `writeJsonAtomic`의 임시 파일(`job.json.tmp-…`)과 영상·프레임 같은 무거운 폴더는
 * 여기서 걸러 이벤트 처리 비용을 없앤다. `.trash`는 비용이 아니라 **정확성** 문제다 —
 * 지운 잡의 `result/.done`이 그대로 들어 있어, 보면 이미 지운 잡의 결과를 다시 물어온다.
 */
export function isWatchIgnored(relPath: string): boolean {
  if (/\.tmp-[\d-]+$/.test(relPath)) return true;
  return relPath.split(/[\\/]/).some((seg) => HEAVY_DIRS.has(seg));
}

/**
 * requests/{packetId}/result/.done 파일 생성을 감지 → 결과 검증 → 반영.
 * Claude Code는 result/에만 쓰고, 상태 파일(packet.json/job.json)은 서버만 쓴다.
 *
 * **감시는 stdlib의 재귀 `fs.watch` 하나로 한다. 폴더마다 감시자를 다는 라이브러리를
 * 쓰지 않는다** — 윈도우는 감시 중인 폴더의 **상위** 폴더 이름을 바꾸지 못한다.
 * 그래서 요청서를 한 번이라도 만든 잡은 삭제(=`.trash`로 rename)가 EPERM으로 막혔다.
 * 재귀 감시는 작업공간 루트 하나만 붙잡으므로 그 아래는 자유롭게 옮길 수 있다.
 * (재귀 감시는 node 20.13+ 리눅스·윈도우·맥에서 된다. 없으면 5초 스윕이 대신 맡는다)
 */
export function startResultWatcher(): void {
  try {
    watcher = fs.watch(WORKSPACE_ROOT, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (isWatchIgnored(rel)) return;

      // requests/{packetId}/result/.done 만 처리
      const parts = rel.split(/[\\/]/);
      if (parts.at(-1) !== '.done' || parts.at(-2) !== 'result') return;
      const packetId = parts.at(-3);
      // 삭제도 같은 이벤트로 온다 — 잡을 휴지통으로 옮기면 옮겨지기 **전** 경로로 이벤트가
      // 뜬다. 없는 파일로 반영을 시작하면 "누락"으로 검증 실패 기록이 남는다
      if (!packetId || !fs.existsSync(path.join(WORKSPACE_ROOT, rel))) return;

      void ingestPacketResult(packetId).catch((e) => {
        console.error('[resultWatcher] ingest 실패:', e);
      });
    });
  } catch (e) {
    console.warn('[resultWatcher] 파일 감시를 켤 수 없습니다 — 5초 스윕으로 반영합니다:',
      e instanceof Error ? e.message : e);
  }
}

export async function stopResultWatcher(): Promise<void> {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  watcher?.close();
  watcher = null;
}

/**
 * 대기 중인데 .done이 이미 있는 패킷을 처리한다.
 * - 부팅 시 1회: 서버가 꺼진 사이 도착한 결과 수습
 * - 이후 주기 실행: 파일 워처가 이벤트를 놓쳐도 결과가 결국 반영되게 하는 안전망
 *   (대기 상태 패킷만 훑으므로 비용이 거의 없다)
 */
export async function catchUpPendingResults(): Promise<void> {
  /*
    🔴 **`listAllPackets()` 실패는 일부러 안 감싼다.** 목록을 못 읽으면 훑을 것 자체가 없어
    그 회차는 통째로 무의미하고, 5초 뒤 다음 회차가 다시 온다. 부르는 쪽이 이미 받는다 —
    스윕은 `.catch`로, 부팅은 `step()`으로. 여기서 삼키면 목록이 깨진 것이 아무 데도 안 남는다.
    아래 루프 안의 `.catch`는 뜻이 다르다: **한 건이 터져도 나머지는 훑는다.**
  */
  const packets = await listAllPackets();
  for (const p of packets) {
    if (p.status !== 'waiting') continue;
    const dir = resolvePacketDir(p.id);
    if (dir && (await exists(path.join(dir, 'result', '.done')))) {
      /*
        한 건이 던져도 **나머지 요청서는 계속 훑는다.** 안 감싸면 그 회차의 뒤쪽 요청서가
        통째로 건너뛰어진다 — 5초 뒤에 다시 오므로 결국 반영되긴 하지만, 매번 같은 건에서
        걸리면 그 뒤는 영원히 안 온다. `attachSceneImages`가 실제로 던지는 첫 경로다.
      */
      await ingestPacketResult(p.id).catch((e) => {
        console.error(`[resultSweep] ${p.id} 반영 실패:`, e instanceof Error ? e.message : e);
      });
    }
  }
}

export function startResultSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void catchUpPendingResults().catch((e) => {
      console.error('[resultSweep]', e instanceof Error ? e.message : e);
    });
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

/**
 * 지금 반영 중인 요청서.
 *
 * 🔴 **한 요청서가 두 번 반영되는 것을 막는다.** 서버가 직접 쓴 결과(붙여넣기·API 자동)는
 * `writeResultFiles`가 `.done`을 남긴 **뒤** 곧바로 이 함수를 부르는데, 그 `.done`을 워처도
 * 본다. 아래 `status !== 'waiting'` 검사만으로는 못 막는다 — 둘 다 「받음」을 쓰기 전에
 * 들어와 둘 다 통과하기 때문이다.
 *
 * 그러면 같은 대본이 `script_v1`·`script_v2`로 두 번 저장되고 잡의 현재 버전이 2가 된다
 * (2026-08-23 실측: 하네스가 약 50% 확률로 여기서 걸렸다). 버전이 조용히 하나씩
 * 밀리는 것이라 화면만 봐서는 원인을 짚을 수 없다.
 *
 * 🔴 **진행 중인 것을 그냥 돌려보내지 않고 「같이 기다리게」 한다** (2026-08-27).
 * 예전에는 두 번째 호출이 곧바로 `return`했는데, 그러면 서버가 직접 쓴 결과 경로
 * (`writeResultFiles` → 붙여넣기·API 자동)가 **반영이 끝나기 전에 응답을 돌려준다** —
 * 워처가 먼저 물었으면 라우트는 아직 안 붙은 대본을 보고 성공을 알린다.
 * 같은 프로미스를 돌려주면 반영은 여전히 **한 번만** 돌고, 부르는 쪽은 끝난 뒤에 깨어난다.
 */
const ingesting = new Map<string, Promise<void>>();

export function ingestPacketResult(packetId: string): Promise<void> {
  const running = ingesting.get(packetId);
  if (running) return running;
  const run = ingestOnce(packetId).finally(() => {
    if (ingesting.get(packetId) === run) ingesting.delete(packetId);
  });
  ingesting.set(packetId, run);
  return run;
}

async function ingestOnce(packetId: string): Promise<void> {
  const packet = await readPacket(packetId);
  if (!packet || packet.status !== 'waiting') return;
  const dir = resolvePacketDir(packetId);
  if (!dir) return;

  const errors: string[] = [];
  for (const spec of packet.resultSpec) {
    const filePath = path.join(dir, 'result', spec.file);
    if (!(await exists(filePath))) {
      errors.push(`누락: result/${spec.file}`);
      continue;
    }
    if (spec.schema === 'markdown') continue;
    const raw = await readJson<unknown>(filePath);
    if (raw === null) {
      errors.push(`JSON 파싱 실패: result/${spec.file}`);
      continue;
    }
    const schema = RESULT_SCHEMAS[spec.schema];
    if (schema) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        errors.push(
          `스키마 불일치 result/${spec.file}: ` +
            parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      } else if (spec.schema === 'script') {
        // 스키마는 맞지만 메뉴 규칙을 어긴 경우 (교리 실격·제품정보리뷰의 단점 씬)
        errors.push(...scriptRuleErrors(
          parsed.data as Script,
          packetMenu(packet),
          await scriptRuleContext(packet),
        ));
      }
    }
  }

  /*
    씬 이미지는 파일 하나만 봐서는 검증이 끝나지 않는다 — **대본의 씬과 맞물려야** 하고
    실물이 있으면 출처가 있어야 한다. `scriptRuleErrors`가 대본에 하는 일과 같은 자리다.
    앞선 루프가 이미 스키마에서 걸렀으면 여기서 또 파싱해 사유를 겹쳐 쌓지 않는다.
  */
  let scenePlan: SceneImagePlan | null = null;
  if (packet.kind === 'scene-images' && errors.length === 0) {
    const planned = await planSceneImages(packet, dir);
    errors.push(...planned.errors);
    scenePlan = planned.plan;
  }

  /*
    🔴 **반영을 먼저 하고 「받음」을 나중에 쓴다** (2026-08-27).

    예전에는 순서가 반대였다 — `packet.status = 'received'`를 쓰고 broadcast한 **뒤에**
    데이터를 반영했다. 그런데 `received` + `validationErrors: []`는 **화면과 API가 볼 수 있는
    유일한 신호**다. 그게 반영 완료를 뜻하지 않으면 사용자는 「반영됨·오류 없음」을 보고
    조립을 눌렀다가 「clipRef도 imageRef도 없음」을 만난다 — 방금 반영됐다고 본 것이 왜
    없다는지 알 길이 없다. 이 저장소가 이름 붙인 **「기록이 실물과 갈린다」**가 정확히 이것이다.

    실측(2026-08-27 검증): `.done` 뒤 **11ms**에 「받음」이 나가고 그 뒤에 그림 2장 복사 +
    파일락 + 대본 쓰기가 남았다. 하네스가 3회 중 2회 여기서 걸렸다.

    **반영 실패도 이제 기록에 남는다.** 예전에는 `applyResult`가 던지면 패킷이
    이미 「받음·오류 없음」으로 굳은 뒤라, 붙은 것이 0장인데 화면은 성공이라고 말했고
    스윕도 `status !== 'waiting'`이라 다시 오지 않았다. 문서로만 닫아 두던 구멍이다.
    ⚠️ 대신 **일시적 실패(백신 EPERM 등)도 최종 실패로 굳는다** — 되돌릴 길은 요청서
    재발행이다. 조용히 성공한 척하는 것보다 낫다는 판단이다.
  */
  if (errors.length === 0) {
    if (packet.applyStartedAt) {
      /*
        앞선 시도가 **반영을 시작했는데** 「받음」을 못 남긴 채 끝났다 (패킷 쓰기 실패·
        프로세스 종료). 그때 반영이 끝까지 갔는지 우리는 모른다 — 그래서 **다시 반영하지
        않고**(두 번 반영이 이 저장소가 이미 겪은 사고다) 모른다고 적는다.
      */
      errors.push(
        '앞선 반영 시도가 끝까지 기록되지 않았습니다 — 결과가 실제로 반영됐는지 확인하고, '
        + '안 됐으면 요청서를 다시 발행하세요',
      );
    } else {
      /*
        🔴 **반영을 시작한다는 것을 디스크에 먼저 남긴다.** 이 한 줄이 없으면, 반영에
        성공한 뒤 아래 패킷 쓰기가 실패했을 때 패킷이 `waiting`으로 남아 스윕이 같은 결과를
        **또 반영한다** (대본이 `script_v2`로 조용히 밀린다). `ingesting` 맵은 이 프로세스
        안에서만 유효해서 그걸 못 막는다.
      */
      packet.applyStartedAt = new Date().toISOString();
      await writePacket(packet); // status는 아직 `waiting`이다 — 「받음」은 아래에서 한 번만 나간다
      try {
        // 수락 전에도 데이터는 미리 반영한다 (상태 전진만 수락 시점에)
        await applyResult(packetId, scenePlan);
      } catch (e) {
        errors.push(`결과를 반영하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  packet.status = 'received';
  packet.receivedAt = new Date().toISOString();
  packet.validationErrors = errors;
  await writePacket(packet);
  broadcast('packet.received', { packetId, kind: packet.kind, errors });
}

// ── 씬 이미지 배선 ────────────────────────────────────────────────

/** 이미지 파일로 받아들이는 확장자. 조립이 여는 것은 그림 하나다 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/**
 * 이 이름을 `path.join`에 넣으면 폴더를 벗어나는가.
 *
 * 🔴 **`imageFile`과 `sceneId`가 같은 검사를 받아야 한다.** 둘 다 앱 밖(AI·붙여넣기)에서
 * 와서 **같은 `path.join`**에 들어가는데, 처음에는 `imageFile`만 막았다 — 바로 옆의
 * `sceneId`는 대본에 있기만 하면 통과해서 `../../ESCAPED`가 작업공간 밖에 파일을 만들었다
 * (2026-08-26 리뷰 실측). 검사를 두 벌로 손으로 적으면 이렇게 한쪽만 자란다.
 *
 * 막는 이유는 보안보다 **「기록이 실물과 갈린다」**가 먼저다 — `planExport`는 잡의
 * `scenes/` 폴더만 훑으므로, 그림이 그 밖에 있으면 완성본에는 깔리는데 사용자가 받는
 * 「이미지」 폴더에는 안 나온다. 잡을 지워도(`.trash`로 폴더 이동) 그 그림은 안 따라간다.
 */
function escapesFolder(name: string): boolean {
  return !name || /[\\/]/.test(name) || name.includes('..');
}

/**
 * 검증을 통과한 씬 이미지 반영 계획.
 *
 * 🔴 **`version`을 계획에 못 박는다.** 검증은 「지금 대본」의 씬 이름으로 하고 반영은
 * 조금 뒤에 하는데, 그 사이에 대본이 새 판으로 갈리면 검증한 씬과 붙이는 씬이 달라진다.
 * 판 번호를 들고 다니면 붙이는 대상이 **검증한 바로 그 파일**로 고정된다.
 */
interface SceneImagePlan {
  ref: JobRef;
  version: number;
  /** sceneId → 씬에 박을 값 (원본 파일 절대경로는 따로 들고 옮긴다) */
  images: Array<{ sceneId: string; src: string; ref: Omit<SceneImageRef, 'file'> }>;
}

/**
 * `result/scenes.json`을 읽어 **어느 씬에 무엇을 붙일지**를 정한다. 사유가 있으면 거부한다.
 *
 * 어느 판에 잇는가 — **잡이 지금 가리키는 판**이다. 조립이 여는 것이 그 판이라
 * (`job.script.currentVersion`), 다른 판에 붙이면 이미지가 화면에 안 나오면서
 * 화면에는 「반영됨」이라고 뜬다. 대본이 그 사이 새로 써졌다면 씬 이름이 안 맞아
 * 아래 검사에 걸린다 — **조용히 어긋나는 대신 거부된다.**
 */
async function planSceneImages(
  packet: Packet,
  dir: string,
): Promise<{ errors: string[]; plan: SceneImagePlan | null }> {
  const errors: string[] = [];
  const ref = packet.jobId ? resolveJob(packet.jobId) : null;
  if (!ref) return { errors: ['이 요청서가 가리키는 작업을 찾을 수 없습니다'], plan: null };
  const job = await readJob(ref);
  if (!job) return { errors: ['이 요청서가 가리키는 작업을 찾을 수 없습니다'], plan: null };

  const version = job.script.currentVersion;
  const script = version ? await readScript(ref, version) : null;
  if (!script) {
    return {
      errors: ['대본이 아직 없습니다 — 씬 이미지는 대본의 씬에 붙습니다. 대본을 먼저 받으세요'],
      plan: null,
    };
  }

  const raw = await readJson<unknown>(path.join(dir, 'result', 'scenes.json'));
  const parsed = SceneImagesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: [`스키마 불일치 result/scenes.json: `
        + parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')],
      plan: null,
    };
  }

  const known = new Set(script.scenes.map((s) => s.sceneId));
  const images: SceneImagePlan['images'] = [];
  const seen = new Set<string>();

  for (const entry of parsed.data) {
    /*
      🔴 **없는 씬을 가리키면 거부한다.** 조용히 버리면 사용자는 이미지가 왜 안 붙는지
      모른 채 「반영됨」만 본다 — 이 저장소가 `scriptRuleErrors`에서 고른 것과 같은 태도다.
      대본을 다시 쓴 뒤 옛 요청서 결과가 도착하는 것이 실제로 이 자리를 밟는 길이다.
    */
    if (!known.has(entry.sceneId)) {
      errors.push(
        `대본 v${version}에 없는 씬입니다: "${entry.sceneId}" `
        + `(있는 씬: ${[...known].join(', ')})`,
      );
      continue;
    }
    /*
      🔴 **씬 이름도 파일명이 된다** (`{sceneId}_v{n}.png`). 대본은 앱 밖에서 오고
      `SceneLineSchema.sceneId`는 `z.string()`이라 제한이 없다 — 「대본에 있으니 안전하다」는
      성립하지 않는다. 여기서 막는 이유는 `parseAssetId`가 자료 id에 구분자를 못 넣게 하는
      것과 같다.

      **스키마(`sceneId`)를 좁히지 않은 이유:** 좁히면 그 꼴을 벗어난 대본 파일이 통째로
      안 열려 그 잡이 화면에서도 조립에서도 막힌다 (이 PR의 하위호환 제약과 정면으로 부딪힌다).
      한글 씬 이름을 쓴 대본이 실제로 그렇게 된다. 근본 조이기는 `TODO.md`로 뺐다.
    */
    if (escapesFolder(entry.sceneId)) {
      errors.push(
        `씬 이름에 경로 구분자나 ".."를 쓸 수 없습니다: "${entry.sceneId}" `
        + '— 씬 이름이 그대로 이미지 파일명이 됩니다. 대본의 sceneId를 고치세요',
      );
      continue;
    }
    if (seen.has(entry.sceneId)) {
      errors.push(`씬 ${entry.sceneId}이(가) scenes.json에 두 번 나옵니다 — 어느 쪽을 쓸지 알 수 없습니다`);
      continue;
    }
    seen.add(entry.sceneId);

    // 프롬프트만 낸 항목은 「무엇을 만들지 적은 계획」이다 — 붙일 실물이 없으니 그냥 지나간다
    if (!entry.imageFile) continue;

    // 폴더를 벗어나는 이름은 받지 않는다 — 씬 이름과 **같은 검사**다 (`escapesFolder` 주석)
    const name = entry.imageFile.trim();
    if (escapesFolder(name)) {
      errors.push(`씬 ${entry.sceneId}: imageFile은 result/ 바로 아래 파일명이어야 합니다 ("${entry.imageFile}")`);
      continue;
    }
    if (!IMAGE_EXT.test(name)) {
      errors.push(`씬 ${entry.sceneId}: 그림 파일이 아닙니다 ("${name}") — png·jpg·webp·gif만 됩니다`);
      continue;
    }

    /*
      🔴 **기록이 실물과 갈리는 것을 여기서 막는다.** 없는 파일을 가리키는 `imageRef`를
      적어 두면 화면에는 「이미지 있음」인데 조립이 날것의 ffmpeg 오류로 죽는다 —
      원인이 엉뚱한 데를 가리키는, 이 저장소가 제일 비싸게 배운 모양이다.
    */
    const src = path.join(dir, 'result', name);
    if (!(await exists(src))) {
      errors.push(`씬 ${entry.sceneId}: result/${name} 파일이 없습니다 (scenes.json만 있고 그림이 없습니다)`);
      continue;
    }

    /*
      출처 판정은 **조립 게이트와 같은 함수**다 (`assetPolicyProblems`). 두 자리에서 부르는
      이유는 `assertSourceAllowed`를 POST·PATCH 둘 다에 건 것과 같다 — 한쪽만 막으면
      그쪽을 피해 들어온다. 여기서 막으면 이미지를 만든 AI가 아직 붙어 있을 때 고칠 수 있고,
      조립 게이트는 손으로 고친 대본까지 막는다.
    */
    const source = {
      sourceUrl: entry.sourceUrl,
      license: entry.license,
      downloadedAt: entry.downloadedAt,
      hasFace: entry.hasFace,
      transformNote: entry.transformNote,
    };
    const why = assetPolicyProblems({
      id: `scene:${entry.sceneId}`, title: `씬 ${entry.sceneId} 이미지`, where: 'scene', ...source,
    });
    if (why.length) {
      errors.push(`씬 ${entry.sceneId} 이미지(${name}): ${why.join(' / ')}`);
      continue;
    }

    images.push({ sceneId: entry.sceneId, src, ref: source });
  }

  if (errors.length) return { errors, plan: null };
  return { errors, plan: { ref, version, images } };
}

/**
 * 이미지를 잡 폴더로 옮기고 대본 씬에 잇는다.
 *
 * **요청서 폴더에 두지 않고 `scenes/`로 복사한다.** 업로드 킷이 `output/`으로 복사되는 것과
 * 같은 결이다 — `result/`는 AI의 작업 자리이고, 요청서를 다시 발행하거나 지우면 사라진다.
 * 대본이 가리키는 파일이 그렇게 사라지면 조립이 통째로 막힌다.
 * 내보내기(`planExport`)가 이미 `scenes/`를 보고 있는 것도 여기다.
 *
 * **덮어쓰지 않고 `_v{n}`으로 쌓는다** (작업공간 규칙). 이미지를 다시 받아도 옛 판의
 * 대본이 가리키던 그림은 그 자리에 그대로 남는다.
 *
 * **여기서 던지면 그림은 되돌리고, 사유는 `validationErrors`에 실려 화면에 뜬다**
 * (2026-08-27). 그러려고 `ingestOnce`가 반영을 먼저 하고 「받음」을 나중에 쓴다 —
 * 예전에는 패킷이 먼저 「받음·오류 없음」으로 굳어서, 붙은 것이 0장인데 화면은 성공이라고
 * 말했다. ⚠️ 실패는 **최종**이다(스윕은 `status !== 'waiting'`이라 다시 안 온다).
 * 되돌릴 길은 요청서 재발행이다.
 */
async function attachSceneImages(plan: SceneImagePlan): Promise<string[]> {
  const scenesDir = path.join(paths.job(plan.ref.menu, plan.ref.projectId, plan.ref.jobId), 'scenes');
  await ensureDir(scenesDir);

  const refs = new Map<string, SceneImageRef>();
  const copied: string[] = [];
  const attached: string[] = [];

  /*
    🔴 **불변식: 성공하지 못한 반영은 복사한 그림을 하나도 안 남긴다.**

    아무도 안 가리키는 그림이 `scenes/`에 남으면 내보내기 「이미지」 폴더로 그대로 나간다 —
    쓰지도 않은 그림이 산출물에 섞이는 쪽이 파일 하나 없는 것보다 나쁘다.

    🔴 **그래서 `catch`가 아니라 `finally`다.** `catch`는 **내가 상상한 실패 목록만큼만**
    덮는다. 실제로 두 번 새어 나갔다 — ① 되돌리기를 대본 쓰기 실패 한 갈래에만 걸었더니
    복사 루프 안의 `copyFile` 실패가 빠져나갔고, ② 그걸 `try/catch`로 감쌌더니 이번엔
    `mutateScript`가 `try` **밖**이라 `writeJsonAtomic`의 rename 실패에 두 장이 다 고아로
    남았다 (2026-08-27 리뷰 탐침). `readJson`은 실패를 삼키지만 `writeJsonAtomic`은 던진다.
    실패의 종류를 세는 대신 **「끝까지 갔는가」 하나만** 본다.
  */
  let done = false;
  try {
    for (const img of plan.images) {
      const ext = path.extname(img.src).toLowerCase();
      let n = 1;
      let dest = path.join(scenesDir, `${img.sceneId}_v${n}${ext}`);
      while (await exists(dest)) dest = path.join(scenesDir, `${img.sceneId}_v${++n}${ext}`);
      await fsp.copyFile(img.src, dest);
      // 옮긴 **직후에** 목록에 넣는다 — 뒤에서 던져도 이 장이 되돌리기에 들어간다
      copied.push(dest);
      refs.set(img.sceneId, { file: toWorkspaceRel(dest), ...img.ref });
    }

    const written = await mutateScript(plan.ref, plan.version, (script) => {
      for (const scene of script.scenes) {
        const r = refs.get(scene.sceneId);
        if (!r) continue;
        scene.imageRef = r;
        attached.push(scene.sceneId);
      }
    });
    if (!written) throw new Error(`대본 v${plan.version}을 읽지 못해 씬 이미지를 잇지 못했습니다`);
    done = true;
  } finally {
    if (!done) {
      for (const f of copied) {
        // 되돌리기가 실패해도 원래 예외를 덮지 않는다 — 다만 조용히 넘기면 고아 그림이
        // 「이미지」 폴더로 나간 이유가 아무 데도 안 남는다.
        await fsp.rm(f, { force: true })
          .catch((e) => console.warn(`[scenes] 되돌리기 실패 — 고아 그림이 남았습니다: ${f} (${e})`));
      }
    }
  }

  return attached;
}

/** 검증 통과한 결과를 실제 데이터로 반영 */
async function applyResult(packetId: string, scenePlan: SceneImagePlan | null = null): Promise<void> {
  const packet = await readPacket(packetId);
  const dir = resolvePacketDir(packetId);
  if (!packet || !dir) return;

  const resultPath = (f: string) => path.join(dir, 'result', f);

  if (packet.kind === 'product-extract' && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    const raw = await readJson<unknown>(resultPath('product.json'));
    const product = ProductSchema.parse(raw);
    await writeProduct(ref, product);
    await logJobEvent(ref, { type: 'product.extracted', packetId });
  }

  if ((packet.kind === 'script' || packet.kind === 'revision') && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    const raw = await readJson<unknown>(resultPath('script.json'));
    const script = ScriptSchema.omit({ version: true }).parse(
      typeof raw === 'object' && raw !== null ? { ...(raw as object) } : raw,
    );
    const version = await writeScriptVersion(ref, script);
    await logJobEvent(ref, { type: 'script.received', packetId, version });
  }

  if (packet.kind === 'format-create') {
    const raw = await readJson<unknown>(resultPath('format.json'));
    const parsed = FormatSchema.partial({ id: true, createdAt: true }).parse(raw);
    const saved = await saveFormat({ ...parsed, id: packet.formatId ?? undefined });
    broadcast('format.saved', { formatId: saved.id });
  }

  if (packet.kind === 'scene-images' && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    /*
      `scenePlan`은 검증이 만든 것이다. 프롬프트만 낸 결과(붙일 실물이 없는 경우)에도
      계획은 생기고 `images`가 빈다 — 그때는 대본을 건드리지 않고 기록만 남긴다.
    */
    const attached = scenePlan && scenePlan.images.length
      ? await attachSceneImages(scenePlan)
      : [];
    await logJobEvent(ref, {
      type: 'scenes.received',
      packetId,
      version: scenePlan?.version,
      images: attached.length,
      scenes: attached,
    });
  }

  if (packet.kind === 'upload-kit' && packet.jobId) {
    const ref = resolveJob(packet.jobId);
    if (!ref) return;
    const src = resultPath('upload-kit.md');
    // dir = .../jobs/{jobId}/requests/{packetId} → 잡 루트는 두 단계 위
    const jobDir = path.dirname(path.dirname(dir));
    await fsp.copyFile(src, path.join(jobDir, 'output', 'upload-kit.md'));
    await mutateJob(ref, (j) => {
      j.output.uploadKitReady = true;
    });
    await logJobEvent(ref, { type: 'uploadkit.received', packetId });
  }
}

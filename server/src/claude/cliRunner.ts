import type { Packet } from '@shared/types';
import { run, checkTool } from '../util/exec.js';
import { REPO_ROOT } from '../store/workspace.js';
import { packetSlashCommand } from './packets.js';

/**
 * 요청서를 **Claude Code CLI로 직접** 처리한다.
 *
 * 세 번째 실행 방식이다 — API 자동(종량 과금)도, 복사·붙여넣기(사람이 옮김)도 아니다.
 * 로그인된 Claude Code가 그대로 도므로 **구독(Pro/Max) 사용량**에서 나간다.
 * 예전에는 명령 문자열을 화면에 띄워 사람이 터미널에 붙여넣게 했다 — 그 한 단계를 없앤다.
 *
 * 결과를 여기서 읽지 않는다. CLI가 `result/`에 산출물을 쓰고 `.done`을 만들면
 * 기존 파일 감시가 잡아 검증·반영까지 같은 길로 간다 (요청서 프로토콜의 핵심이다).
 */

/** 설정에 경로를 안 두는 이유는 `resolveBin`이 실행하는 PC에서 찾기 때문이다 */
const CLI_BIN = 'claude';

/**
 * 붙일 수 있는 도구.
 *
 * 읽기는 저장소 전체가 필요하다 — 요청서가 제품 첨부·클립 프레임·지침을 가리킨다.
 * **쓰기는 그 요청서의 `result/` 안으로 못 박는다.** 셸은 아예 안 준다.
 *
 * 🔴 `--permission-mode acceptEdits`를 쓰지 않는다. 그걸 켜면 작업 폴더 안이라는
 * 이유로 **저장소 어디든 쓰게 된다** — 실측에서 CLI가 `tools/`에 제 도우미 스크립트를
 * 만들어 놓고 갔다(2026-08-17). 스킬이 하지 말라고 적어둔 것과 별개로, 막을 수 있으면 막는다.
 */
const READ_TOOLS = ['Read', 'Glob', 'Grep'];

/**
 * 쓰기 허용 범위.
 *
 * 🔴 **`Write(경로)` 규칙은 아무 일도 안 한다.** 파일 권한 검사가 `Edit(경로)`만 보고,
 * 그 하나가 Write·Edit을 통째로 덮는다 (CLI가 경고로 그렇게 알려준다). `Write(...)`만
 * 넘기면 전부 거부되고, 그걸 「점 파일이라 안 걸리나」로 오해하기 딱 좋다.
 * 경로는 cwd(저장소 루트) 기준 상대 글롭이고 한글도 `.done`도 그대로 걸린다 (실측).
 */
function editScope(packet: Packet): string {
  return `Edit(workspace/${packet.dir.replace(/^\/?/, '')}/result/**)`;
}

/**
 * 요청서 하나를 처리하는 시간 상한.
 * 팀 처리(`shorts-content-team`)는 리서치·검수를 거쳐 훨씬 오래 걸린다.
 */
const TIMEOUT_MS = 30 * 60_000;

/** CLI가 자리에 있는지. 없으면 UI에서 이 방식을 못 고르게 한다 */
export async function claudeCliAvailable(): Promise<boolean> {
  return (await checkTool(CLI_BIN, ['--version'])).available;
}

/**
 * 지금 돌고 있는 요청서.
 *
 * 요청서 상태만 보고 막을 수 없다 — `waiting`은 `.done`이 떨어져야 풀리므로,
 * 실행이 도는 20분 내내 「대기」다. 그 사이 버튼을 다시 누르거나 화면을 새로 고치면
 * (버튼 잠금은 그 카드의 화면 상태라 새로고침에 날아간다) **같은 요청서에 CLI가 둘 붙어**
 * 같은 `result/`에 동시에 쓴다. 실제로 그렇게 두 개가 떴다 (2026-08-17).
 */
const inFlight = new Map<string, number>();

export function isRunning(packetId: string): boolean {
  return inFlight.has(packetId);
}

/**
 * 실행이 시작된 시각(ms). 안 돌고 있으면 undefined.
 *
 * 화면을 새로 고치면 「실행 중」이라는 카드 상태가 날아간다 — 서버에 물어 되살리는데,
 * 그때 흐른 시간을 0부터 세면 방금 시작한 것처럼 보인다. 시작 시각을 줘서 제대로 세게 한다.
 */
export function runningSince(packetId: string): number | undefined {
  return inFlight.get(packetId);
}

export function cliArgs(packet: Packet, mode: 'fast' | 'quality'): string[] {
  return [
    '-p', packetSlashCommand(packet, mode),
    /*
      🔴 기본 출력(text)은 **다 끝날 때까지 한 글자도 안 나온다.** 요청서 하나가 몇 분씩
      걸리는데(소재 프레임을 수십 장 열어본다) 그동안 화면이 멈춘 것과 구분이 안 된다 —
      실제로 「5분째 로딩 중」이라는 제보를 받았다. 줄 단위 JSON으로 받아 그때그때 알린다.
      `--verbose`가 있어야 `-p`에서 stream-json이 나온다.
    */
    '--output-format', 'stream-json', '--verbose',
    '--allowedTools', ...READ_TOOLS, editScope(packet),
  ];
}

/**
 * stream-json 한 줄 → 사람이 읽을 진행 상황.
 *
 * 훅·요약·사용량 같은 잡음이 많이 섞여 나오므로 **아는 것만 집어내고 나머지는 버린다.**
 * 모양이 바뀌어도 진행 표시가 조용해질 뿐 실행은 안 깨진다.
 */
export function progressFromEvent(line: string, readCount: () => number):
{ step: string; detail?: string } | null {
  if (!line.startsWith('{')) return null;
  let d: { type?: string; message?: { content?: Array<{ type?: string; name?: string; text?: string }> } };
  try {
    d = JSON.parse(line);
  } catch {
    return null; // 긴 줄이 잘려 들어오는 경우가 있다 — 진행 표시 하나 건너뛰면 그만이다
  }
  if (d.type !== 'assistant') return null;

  for (const c of d.message?.content ?? []) {
    if (c.type === 'tool_use') {
      if (c.name === 'Read') return { step: '자료 읽는 중', detail: `${readCount()}개째` };
      if (c.name === 'Write' || c.name === 'Edit') return { step: '산출물 쓰는 중' };
      return { step: `${c.name} 실행 중` };
    }
    if (c.type === 'text' && c.text?.trim()) {
      return { step: '생각하는 중', detail: c.text.trim().slice(0, 60) };
    }
  }
  return null;
}

export async function runPacketWithCli(
  packet: Packet,
  mode: 'fast' | 'quality',
  onProgress?: (p: { step: string; detail?: string }) => void,
): Promise<void> {
  if (inFlight.has(packet.id)) {
    throw new Error('이 요청서는 이미 실행 중입니다 — 끝날 때까지 기다리세요.');
  }
  inFlight.set(packet.id, Date.now());

  const tail: string[] = [];
  const keep = (line: string) => {
    tail.push(line);
    if (tail.length > 20) tail.shift();
  };
  let reads = 0;
  try {
    await run(CLI_BIN, cliArgs(packet, mode), {
      // 저장소 루트에서 돌려야 스킬(`.claude/skills/`)과 상대경로가 잡힌다
      cwd: REPO_ROOT,
      timeoutMs: TIMEOUT_MS,
      onStdout: (line) => {
        // 실패 메시지에 붙일 꼬리는 원문 그대로 둔다 (JSON 한 줄이 통째로 길다)
        keep(line.slice(0, 300));
        const p = progressFromEvent(line, () => ++reads);
        if (p) onProgress?.(p);
      },
      onStderr: (line) => { keep(line); console.error(`[claude-cli] ${line}`); },
    });
  } catch (e) {
    throw new Error(cliFailureMessage(tail, e));
  } finally {
    inFlight.delete(packet.id);
  }

  /*
    완료 마커(`result/.done`)는 CLI가 직접 찍는다 — 요청서 규약 그대로다. 여기서 대신
    찍으면 이 경로만 규약이 달라지고, 아무것도 안 쓰고 끝난 실행까지 "완료"가 된다.
    빈 채로 끝나면 마커가 없으니 요청서는 대기 상태로 남는다.
  */
}

/**
 * 실패 메시지.
 *
 * 제일 흔한 실패는 고장이 아니라 **로그인이 안 된 것**이다. 종료 코드만 보면
 * 설치 문제처럼 보이는데, 터미널에서 `claude`를 한 번 띄워 로그인하면 끝난다.
 */
export function cliFailureMessage(tail: string[], cause?: unknown): string {
  const all = tail.join('\n');
  const last = tail.slice(-6).join('\n');
  const head = `Claude Code 실행 실패${
    last ? `:\n${last}` : ` (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)})`
  }`;

  if (/not logged in|unauthor|authenticat|\/login|invalid api key/i.test(all)) {
    return `${head}\n`
      + '로그인이 안 된 것으로 보입니다 — 터미널에서 `claude`를 띄워 구독 계정으로 로그인한 뒤 다시 시도하세요.';
  }
  if (/ENOENT|not found|인식할 수 없/i.test(`${all}\n${cause instanceof Error ? cause.message : ''}`)) {
    return `${head}\n`
      + 'Claude Code CLI를 찾지 못했습니다. 설치돼 있으면 서버를 다시 시작해 PATH를 새로 읽게 하세요.';
  }
  if (/usage limit|rate limit|quota/i.test(all)) {
    return `${head}\n`
      + '구독 사용량 한도에 걸린 것으로 보입니다. 한도가 풀린 뒤 다시 시도하거나 "API 자동"으로 처리하세요.';
  }
  return `${head}\n전체 로그는 workspace/logs/server.log (npm run logs)에 있습니다.`;
}

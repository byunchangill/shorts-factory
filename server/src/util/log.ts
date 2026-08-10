import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 서버 로그를 파일에도 남긴다.
 *
 * `npm run dev`는 concurrently → tsx watch → node 로 3중 파이프를 거치는데,
 * 이 경로에서 서버 출력이 통째로 사라져 "아무것도 안 찍히는" 상황이 실제로 있었다.
 * 원인 파악이 불가능해지므로, 콘솔과 별개로 항상 파일에 기록한다.
 * 로그가 없으면 = 프로세스가 우리 코드에 도달조차 못했다는 뜻이라 그 자체로 단서가 된다.
 *
 * 이 모듈은 import 되는 순간 동작한다. index.ts에서 가장 먼저 import 할 것.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));

// store/workspace.ts와 같은 규칙. 여기서 그 모듈을 import 하면 무거운 그래프를 끌고 오므로
// (로그가 필요한 시점보다 늦어진다) 경로만 직접 계산한다.
const WORKSPACE_ROOT = process.env.SHORTS_WORKSPACE
  ? path.resolve(process.env.SHORTS_WORKSPACE)
  : path.resolve(dirname, '../../../workspace');

export const SERVER_LOG_PATH = path.join(WORKSPACE_ROOT, 'logs', 'server.log');

/** 이 크기를 넘으면 새로 시작한다 — 로컬 앱이라 회전까지는 필요 없다 */
const MAX_BYTES = 2 * 1024 * 1024;

let fd: number | null = null;

function openSink(): void {
  try {
    fs.mkdirSync(path.dirname(SERVER_LOG_PATH), { recursive: true });
    const size = fs.statSync(SERVER_LOG_PATH, { throwIfNoEntry: false })?.size ?? 0;
    fd = fs.openSync(SERVER_LOG_PATH, size > MAX_BYTES ? 'w' : 'a');
  } catch {
    // 로그를 못 쓴다고 서버가 안 뜨면 본말전도다
    fd = null;
  }
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function append(level: string, args: unknown[]): void {
  if (fd === null) return;
  try {
    // writeSync — 크래시 직전 마지막 줄이 버퍼에 남아 사라지지 않게 한다
    fs.writeSync(fd, `${new Date().toISOString()} [${level}] ${format(args)}\n`);
  } catch {
    // 무시
  }
}

function patchConsole(): void {
  const levels = ['log', 'warn', 'error'] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      append(level, args);
      original(...args);
    };
  }
}

openSink();
patchConsole();

// 프로세스가 우리 코드까지 왔다는 증거. stderr로 보내 stdout 파이프 문제와 분리한다.
console.error(
  `[startup] node ${process.version} · pid ${process.pid} · platform ${process.platform}\n` +
    `[startup] cwd: ${process.cwd()}\n` +
    `[startup] workspace: ${WORKSPACE_ROOT}\n` +
    `[startup] 로그 파일: ${SERVER_LOG_PATH}`,
);

process.on('exit', (code) => append('exit', [`프로세스 종료 code=${code}`]));

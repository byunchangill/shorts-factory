import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 서버 로그 마지막 N줄 출력 — `npm run logs`
 * 터미널에서 서버 출력이 안 보일 때(파이프를 3중으로 거치는 dev 환경) 원인을 확인하는 통로.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));
const workspace = process.env.SHORTS_WORKSPACE
  ? path.resolve(process.env.SHORTS_WORKSPACE)
  : path.resolve(dirname, '../workspace');
const logPath = path.join(workspace, 'logs', 'server.log');

const lineCount = Number(process.argv[2]) || 80;

if (!fs.existsSync(logPath)) {
  console.error(`로그 파일이 없습니다: ${logPath}`);
  console.error('→ 서버 프로세스가 아직 우리 코드까지 도달하지 못했다는 뜻입니다.');
  console.error('  server 폴더에서 `npx tsx src/index.ts`를 직접 실행해 오류를 확인하세요.');
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');
console.log(`── ${logPath} (마지막 ${lineCount}줄) ──\n`);
console.log(lines.slice(-lineCount).join('\n'));

/**
 * 대본 승인 처리
 * 사용법: npx tsx src/run-script-approve.ts <jobId>
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), 'config', '.env') });

import { onScriptApproved } from './skills/script-creator.js';

const PROJECT_DIR = process.cwd();
const jobId = process.argv[2];

if (!jobId) {
  console.error('사용법: npx tsx src/run-script-approve.ts <jobId>');
  process.exit(1);
}

try {
  onScriptApproved(jobId, PROJECT_DIR);
  console.log(`✅ 대본 승인 완료 → script_approved`);
  console.log(`\n👉 다음 단계: 이미지 생성`);
} catch (err) {
  console.error('승인 실패:', err instanceof Error ? err.message : err);
}

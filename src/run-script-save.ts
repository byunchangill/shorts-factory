/**
 * 생성된 대본을 검증하고 상태 전이
 * 사용법: npx tsx src/run-script-save.ts <jobId> <scriptId>
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), 'config', '.env') });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onScriptGenerated, formatScriptForUser } from './skills/script-creator.js';
import { JobManager } from './core/job-manager.js';

const PROJECT_DIR = process.cwd();
const jobId = process.argv[2];
const scriptId = process.argv[3];

if (!jobId || !scriptId) {
  console.error('사용법: npx tsx src/run-script-save.ts <jobId> <scriptId>');
  process.exit(1);
}

const jobManager = new JobManager(PROJECT_DIR);
const scriptPath = join(PROJECT_DIR, 'jobs', jobId, 'temp', `${scriptId}.json`);
const scriptData = JSON.parse(readFileSync(scriptPath, 'utf-8'));

try {
  // reference_selected → scripting 전이 (아직 안 됐을 경우)
  const job = jobManager.getJob(jobId);
  if (job?.status === 'reference_selected') {
    jobManager.transitionJob(jobId, 'scripting', {
      eventType: 'SCRIPT_GENERATION_STARTED',
      actor: 'system',
      reasonDetail: '대본 생성 완료, 검증 시작',
    });
  }

  const script = await onScriptGenerated(jobId, scriptData, PROJECT_DIR);
  console.log('\n' + formatScriptForUser(script));
  console.log('\n✅ 대본 저장 완료 → script_pending_approval');
  console.log('\n👉 승인: "대본 승인" / 수정: "수정해줘 [내용]"');
} catch (err) {
  console.error('저장 실패:', err instanceof Error ? err.message : err);
}

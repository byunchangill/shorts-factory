/**
 * 레퍼런스 영상 선택 처리
 * 사용법: npx tsx src/run-select.ts <jobId> <videoId>
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), 'config', '.env') });

import { onUserSelect } from './skills/youtube-researcher.js';

const PROJECT_DIR = process.cwd();
const jobId = process.argv[2];
const videoId = process.argv[3];

if (!jobId || !videoId) {
  console.error('사용법: npx tsx src/run-select.ts <jobId> <videoId>');
  process.exit(1);
}

try {
  onUserSelect(videoId, jobId, PROJECT_DIR);
  console.log(`✅ 선택 완료: ${videoId}`);
  console.log(`   Job ${jobId} → reference_selected`);
  console.log(`\n👉 다음 단계: 대본 생성`);
} catch (err) {
  console.error('선택 처리 실패:', err instanceof Error ? err.message : err);
}

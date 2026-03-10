/**
 * YouTube 검색 실행 스크립트
 * 사용법: npx tsx src/run-search.ts <jobId> <keyword>
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';

// config/.env 로드
config({ path: resolve(process.cwd(), 'config', '.env') });

import { searchWithExclusion, formatSearchResults } from './skills/youtube-researcher.js';
import { UsedVideosManager } from './utils/used-videos.js';

const PROJECT_DIR = process.cwd();
const jobId = process.argv[2];
const keyword = process.argv[3];

if (!jobId || !keyword) {
  console.error('사용법: npx tsx src/run-search.ts <jobId> <keyword>');
  process.exit(1);
}

const usedVideos = new UsedVideosManager(PROJECT_DIR);
const excludedCount = usedVideos.getExcludedVideoIds().length;

console.log(`\n🔍 "${keyword}" 검색 시작 (Job: ${jobId})...\n`);

try {
  const results = await searchWithExclusion(keyword, 'dog', jobId, PROJECT_DIR, 5);
  console.log(formatSearchResults(results, keyword, excludedCount));
} catch (err) {
  console.error('검색 실패:', err instanceof Error ? err.message : err);
}

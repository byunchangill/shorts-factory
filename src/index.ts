/**
 * YT Shorts Factory — CLI 진입점
 *
 * Claude Code 환경에서 실행되는 반자동 파이프라인.
 * 사용자가 키워드를 입력하면 7단계 워크플로우를 순차 실행.
 *
 * 사용법: npx tsx src/index.ts [keyword] [contentType]
 * 예시: npx tsx src/index.ts 강아지 dog
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { JobManager } from './core/job-manager.js';
import { onEvent } from './core/event-emitter.js';
import { ProductionLogger } from './core/logger.js';
import type { ContentType } from './types/config.js';
import type { Job } from './types/job.js';

// ── 환경 설정 ──
const PROJECT_DIR = process.env.PROJECT_DIR || resolve(process.cwd());

// ── 이벤트 리스너 (개발 로깅) ──
onEvent((event) => {
  const arrow = event.fromStatus && event.toStatus
    ? `${event.fromStatus} → ${event.toStatus}`
    : '(no state change)';
  console.log(`📡 [${event.eventType}] ${arrow} | actor: ${event.actor}`);
  if (event.reasonDetail) {
    console.log(`   └─ ${event.reasonDetail}`);
  }
});

// ── 콘텐츠 타입 감지 ──
function detectContentType(keyword: string): ContentType {
  const dogKeywords = ['강아지', '개', '반려견', '댕댕이', '멍멍이', 'dog', 'puppy'];
  const sseoltoonKeywords = ['썰', '썰툰', '실화', '레전드', '소름'];
  const healthKeywords = ['건강', '효능', '상식', '영양', '음식', '비타민', '운동'];

  const kw = keyword.toLowerCase();
  if (dogKeywords.some(d => kw.includes(d))) return 'dog';
  if (sseoltoonKeywords.some(s => kw.includes(s))) return 'sseoltoon';
  if (healthKeywords.some(h => kw.includes(h))) return 'health';

  // 기본값
  return 'dog';
}

// ── 워크플로우 단계 표시 ──
function printStep(step: number, name: string, description: string): void {
  console.log(`\n${'━'.repeat(50)}`);
  console.log(`📌 Step ${step}: ${name}`);
  console.log(`   ${description}`);
  console.log(`${'━'.repeat(50)}\n`);
}

// ── 메인 ──
async function main() {
  const args = process.argv.slice(2);
  const keyword = args[0];
  const explicitType = args[1] as ContentType | undefined;

  if (!keyword) {
    console.log(`
${'━'.repeat(50)}
🎬 YT Shorts Factory v0.1.0
${'━'.repeat(50)}

사용법: npx tsx src/index.ts <키워드> [콘텐츠타입]

콘텐츠 타입:
  dog       🐶 강아지 AI쇼츠 (감동, 캐릭터 일관성)
  sseoltoon 📖 썰툰 (훅, 반전, 속도감)
  health    💊 건강 쇼츠 (신뢰, 가독성, 과장 금지)

예시:
  npx tsx src/index.ts 강아지
  npx tsx src/index.ts 썰 sseoltoon
  npx tsx src/index.ts "비타민C 효능" health
${'━'.repeat(50)}
`);
    return;
  }

  // 콘텐츠 타입 결정
  const contentType = explicitType && ['dog', 'sseoltoon', 'health'].includes(explicitType)
    ? explicitType
    : detectContentType(keyword);

  const typeEmoji = { dog: '🐶', sseoltoon: '📖', health: '💊' }[contentType];

  console.log(`
${'━'.repeat(50)}
🎬 YT Shorts Factory
${'━'.repeat(50)}
📌 키워드: ${keyword}
📌 타입: ${typeEmoji} ${contentType}
📌 프로젝트: ${PROJECT_DIR}
${'━'.repeat(50)}
`);

  // .env 확인
  const envPath = resolve(PROJECT_DIR, 'config', '.env');
  if (!existsSync(envPath) && !process.env.YOUTUBE_API_KEY) {
    console.log('⚠️  YOUTUBE_API_KEY가 설정되지 않았습니다.');
    console.log('   config/.env 파일을 생성하거나 환경 변수를 설정하세요.');
    console.log('   (대본 생성 등 API 없이 가능한 단계는 계속 진행 가능)\n');
  }

  // Job 생성
  const jobManager = new JobManager(PROJECT_DIR);
  const job = jobManager.createJob(keyword, contentType);

  console.log(`✅ Job 생성: ${job.jobId}`);
  console.log(`   workspace: ${job.workspace.final}`);

  // 워크플로우 안내
  printWorkflowGuide(job);
}

function printWorkflowGuide(job: Job): void {
  const typeEmoji = { dog: '🐶', sseoltoon: '📖', health: '💊' }[job.contentType];
  const needsVideo = job.needsVideo ? '✅' : '❌ 스킵';

  console.log(`
${'━'.repeat(50)}
📋 워크플로우 가이드 [${job.jobId}]
${'━'.repeat(50)}

[Step 1-2] 🔍 YouTube 검색 + 분석
  → "검색해줘" 또는 "${job.keyword} 검색"

[Step 3] 📝 대본 생성
  → "대본 만들어줘"
  → 확정 / 수정 요청

[Step 4] 🎨 이미지 생성
  → "이미지 생성해줘"
  → 개별 재생성 / 버전 복원

[Step 5a] 🎥 영상화 ${needsVideo}
  → "영상 만들어줘" (${job.contentType === 'sseoltoon' ? '썰툰은 스킵' : 'Ken Burns 효과'})

[Step 5b] 🔊 TTS + 합성
  → "음성 합성해줘"
  → 자막 + BGM 자동 추가

[Step 6] ✅ QC 검수
  → "검수해줘" 또는 "QC"
  → PASS / WARNING / FAIL

[Step 7] 📦 패키징
  → "패키징해줘" 또는 "다운로드"
  → ZIP 파일 생성

${'━'.repeat(50)}
${typeEmoji} 현재 상태: ${job.status}
👉 "검색해줘"로 시작하세요!
${'━'.repeat(50)}
`);
}

// 실행
main().catch(console.error);

// ── Re-exports (라이브러리 사용 시) ──
export { JobManager } from './core/job-manager.js';
export { canTransition, transition, getNextStates } from './core/state-machine.js';
export { emitEvent, onEvent, validateEvent, getEventHistory } from './core/event-emitter.js';
export { ProductionLogger } from './core/logger.js';
export { UsedVideosManager } from './utils/used-videos.js';
export { checkSimilarity } from './utils/similarity-check.js';
export { checkScript, checkSentence, getDisclaimers } from './utils/health-compliance.js';
export { matchExactKeyword, splitKorean, formatSrtTime } from './utils/korean-utils.js';
export * from './types/index.js';

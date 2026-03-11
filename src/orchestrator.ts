/**
 * 메인 파이프라인 오케스트레이터
 *
 * 7단계 워크플로우를 순차 실행하며 사용자 인터랙션 포인트에서 대기.
 * 각 스킬(youtube-researcher, script-creator, image-generator ...)을 호출하고
 * JobManager로 상태를 추적한다.
 *
 * 사용법:
 *   npx tsx src/orchestrator.ts --keyword "강아지" --type dog
 *   npx tsx src/orchestrator.ts --job job_20260311_001 --resume
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { JobManager } from './core/job-manager.js';
import { getRecoveryAdvice, withRetry } from './utils/retry-handler.js';
import type { ContentType } from './types/config.js';
import type { Job } from './types/job.js';

// ── 환경 설정 ──
const PROJECT_DIR = process.env.PROJECT_DIR ?? resolve(process.cwd());

// ── CLI 파서 ──
function parseArgs(argv: string[]): {
  keyword?: string;
  type?: ContentType;
  jobId?: string;
  resume: boolean;
  step?: number;
  dryRun: boolean;
} {
  const args = argv.slice(2);
  const result = {
    resume: false,
    dryRun: false,
  } as ReturnType<typeof parseArgs>;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--keyword': result.keyword = args[++i]; break;
      case '--type':    result.type    = args[++i] as ContentType; break;
      case '--job':     result.jobId   = args[++i]; break;
      case '--resume':  result.resume  = true; break;
      case '--step':    result.step    = parseInt(args[++i], 10); break;
      case '--dry-run': result.dryRun  = true; break;
    }
  }

  return result;
}

// ── 진행 상태 출력 ──
function log(emoji: string, msg: string) {
  const time = new Date().toLocaleTimeString('ko-KR');
  console.log(`[${time}] ${emoji}  ${msg}`);
}
function logStep(n: number, title: string) {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  Step ${n} | ${title}`);
  console.log(`${'═'.repeat(55)}`);
}
function logError(msg: string, err?: Error) {
  console.error(`\n❌  ${msg}`);
  if (err) console.error(`    ${err.message}`);
}

// ── 오케스트레이터 클래스 ──
export class ShortsOrchestrator {
  private jobManager: JobManager;
  private projectDir: string;

  constructor(projectDir: string = PROJECT_DIR) {
    this.projectDir = projectDir;
    this.jobManager = new JobManager(projectDir);
  }

  /**
   * 새 Job 시작
   */
  async start(keyword: string, contentType: ContentType): Promise<Job> {
    log('🎬', `새 Job 시작: "${keyword}" [${contentType}]`);

    const job = this.jobManager.createJob(keyword, contentType);
    log('✅', `Job 생성됨: ${job.jobId}`);
    log('📁', `작업 폴더: ${job.workspace.final}`);

    return job;
  }

  /**
   * 기존 Job 재개 (중단된 지점부터)
   */
  async resume(jobId: string): Promise<Job> {
    const job = this.jobManager.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    log('▶️', `Job 재개: ${jobId} (현재 상태: ${job.status})`);
    return job;
  }

  /**
   * Step 1~2: YouTube 검색 + 레퍼런스 분석
   */
  async runSearch(job: Job): Promise<void> {
    logStep(1, '🔍 YouTube 검색 + 레퍼런스 분석');

    if (!['searching', 'references_presented', 'error'].includes(job.status)) {
      log('⏭️', `현재 상태(${job.status})에서 검색 스텝은 불필요. 스킵.`);
      return;
    }

    log('🔍', `키워드 "${job.keyword}" 로 YouTube 검색 중...`);
    log('⚠️', '이 단계는 youtube-researcher 스킬을 통해 실행됩니다.');
    log('💡', '스킬 호출: "검색해줘" 또는 "youtube 검색"');

    // 실제 구현: youtube-researcher 스킬이 searchYouTube() 함수를 호출
    // 여기서는 상태 전이만 가이드
    log('📋', `다음 단계: 5개 영상 분석 결과 확인 → 레퍼런스 1개 선택`);
  }

  /**
   * Step 3: 대본 생성 + 유사도 검증
   */
  async runScript(job: Job): Promise<void> {
    logStep(3, '📝 오마주 대본 생성');

    const allowed = ['reference_selected', 'scripting', 'script_failed', 'script_pending_approval'];
    if (!allowed.includes(job.status)) {
      log('⏭️', `현재 상태(${job.status})에서 대본 스텝 불필요. 스킵.`);
      return;
    }

    log('📝', '대본 생성 시작...');
    log('⚠️', 'script-creator 스킬을 통해 실행됩니다.');
    log('💡', `프롬프트 템플릿: prompts/script/${job.contentType}_template.md`);
    log('🔍', '생성 후 유사도 검증 자동 수행 (phraseOverlap < 0.3 목표)');

    if (job.contentType === 'health') {
      log('💊', '건강 쇼츠: 컴플라이언스 검증 자동 수행 (checkScript)');
    }
  }

  /**
   * Step 4: 이미지 생성
   */
  async runImageGeneration(job: Job): Promise<void> {
    logStep(4, '🎨 이미지 생성 (Style Bible + Character Bible)');

    const allowed = ['script_approved', 'images_generating', 'images_partial', 'images_pending_approval'];
    if (!allowed.includes(job.status)) {
      log('⏭️', `현재 상태(${job.status})에서 이미지 스텝 불필요. 스킵.`);
      return;
    }

    // Style/Character Bible 확인
    const stylePath = resolve(this.projectDir, `prompts/style_bibles/${job.contentType}_style.json`);
    if (existsSync(stylePath)) {
      log('🎨', `Style Bible 로드됨: prompts/style_bibles/${job.contentType}_style.json`);
    } else {
      log('⚠️', 'Style Bible 파일을 찾을 수 없습니다. prompts/image/style_presets.json 참조');
    }

    const charPath = resolve(this.projectDir, `prompts/character_bibles/${job.contentType}_default.json`);
    if (existsSync(charPath)) {
      log('👤', `Character Bible 로드됨: prompts/character_bibles/${job.contentType}_default.json`);
    }

    // ComfyUI 워크플로우 확인
    const workflowMap: Record<ContentType, string> = {
      dog: 'assets/workflows/dog_style_workflow.json',
      sseoltoon: 'assets/workflows/sseoltoon_workflow.json',
      health: 'assets/workflows/health_infographic_workflow.json',
    };
    const workflowPath = resolve(this.projectDir, workflowMap[job.contentType]);
    if (existsSync(workflowPath)) {
      log('⚙️', `ComfyUI 워크플로우 확인됨: ${workflowMap[job.contentType]}`);
    } else {
      log('❌', 'ComfyUI 워크플로우 파일 없음! assets/workflows/README.md 참조');
    }

    log('⚠️', 'image-generator 스킬을 통해 실행됩니다.');
    log('💡', '씬당 최대 3회 재시도 (retry-handler 적용)');
  }

  /**
   * Step 5a: 영상화 (강아지/건강만)
   */
  async runVideoGeneration(job: Job): Promise<void> {
    logStep(5, '🎥 영상화');

    if (job.contentType === 'sseoltoon') {
      log('⏭️', '썰툰은 영상화 불필요. Step 5b(TTS)로 바로 진행.');
      return;
    }

    const allowed = ['images_fully_approved', 'video_generating', 'video_failed', 'video_pending_approval'];
    if (!allowed.includes(job.status)) {
      log('⏭️', `현재 상태(${job.status})에서 영상 스텝 불필요. 스킵.`);
      return;
    }

    log('🎥', 'Ken Burns 효과로 이미지 → 영상 변환 중...');
    log('⚠️', 'video-maker 스킬을 통해 실행됩니다.');
    log('💡', 'FFmpeg 설치 필요: ffmpeg -version 으로 확인');
  }

  /**
   * Step 5b: TTS + 자막 + BGM 합성
   */
  async runTtsSync(job: Job): Promise<void> {
    logStep(5, '🔊 TTS 나레이션 + 자막 + BGM 합성');

    const allowed = ['images_fully_approved', 'video_approved', 'tts_generating', 'tts_failed'];
    if (!allowed.includes(job.status)) {
      log('⏭️', `현재 상태(${job.status})에서 TTS 스텝 불필요. 스킵.`);
      return;
    }

    // BGM 파일 확인
    const bgmMap: Record<ContentType, string> = {
      dog: 'assets/bgm/emotional-piano.mp3',
      sseoltoon: 'assets/bgm/suspense-beat.mp3',
      health: 'assets/bgm/calm-corporate.mp3',
    };
    const bgmPath = resolve(this.projectDir, bgmMap[job.contentType]);
    if (!existsSync(bgmPath)) {
      log('⚠️', `BGM 파일 없음: ${bgmMap[job.contentType]}`);
      log('📖', '자세한 내용: assets/bgm/README.md');
    } else {
      log('🎵', `BGM 파일 확인됨: ${bgmMap[job.contentType]}`);
    }

    // 폰트 파일 확인
    const fontPath = resolve(this.projectDir, 'assets/fonts/NanumSquareRoundB.ttf');
    if (!existsSync(fontPath)) {
      log('⚠️', '자막 폰트 없음: assets/fonts/NanumSquareRoundB.ttf');
      log('📖', '자세한 내용: assets/fonts/README.md');
    } else {
      log('✅', '자막 폰트 확인됨');
    }

    log('⚠️', 'tts-sync 스킬을 통해 실행됩니다.');
    log('💡', 'edge-tts 설치 필요: pip install edge-tts');
  }

  /**
   * Step 6: QC 검수
   */
  async runQC(job: Job): Promise<void> {
    logStep(6, '✅ QC 검수');

    if (job.status !== 'compose_done' && job.status !== 'qc_reviewing') {
      log('⏭️', `현재 상태(${job.status})에서 QC 불필요. 스킵.`);
      return;
    }

    log('🔍', 'QC 체크 항목:');
    log('  •', '저작권 안전성 (유사도 점수 재검증)');
    log('  •', '이미지 일관성 (씬 간 스타일 통일)');
    log('  •', '영상 규격 (9:16, 60초 이내, 1080p)');
    log('  •', '음성 싱크 (나레이션 ↔ 영상 타이밍)');
    if (job.contentType === 'health') {
      log('  •', '건강 콘텐츠 과장 표현 재검증');
    }
    log('  •', '파일 완결성 (모든 에셋 존재 여부)');
    log('⚠️', 'shorts-qc-reviewer 스킬을 통해 실행됩니다.');
  }

  /**
   * Step 7: 패키징
   */
  async runPackaging(job: Job): Promise<void> {
    logStep(7, '📦 파일 패키징');

    const allowed = ['qc_passed', 'qc_warning', 'exporting'];
    if (!allowed.includes(job.status)) {
      log('⏭️', `현재 상태(${job.status})에서 패키징 불필요. 스킵.`);
      return;
    }

    log('📦', '패키징 산출물:');
    log('  •', 'final/final_shorts.mp4');
    log('  •', 'images/scene_01~08.png');
    log('  •', 'audio/full_narration.mp3 + subtitles.srt');
    log('  •', 'script/script.md + storyboard.json');
    log('  •', 'metadata/title_options.json + description.txt + hashtags.txt');
    log('⚠️', 'export-packager 스킬을 통해 실행됩니다.');
  }

  /**
   * 환경 사전 검사 (프리플라이트)
   */
  async preflightCheck(): Promise<{ passed: boolean; warnings: string[]; errors: string[] }> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // .env 확인
    const envPath = resolve(this.projectDir, 'config', '.env');
    if (!existsSync(envPath) && !process.env.YOUTUBE_API_KEY) {
      warnings.push('config/.env 없음 — YouTube 검색 단계에서 API KEY 필요');
    }

    // 에셋 확인
    const requiredAssets = [
      { path: 'assets/fonts/NanumSquareRoundB.ttf', critical: false, desc: '자막 폰트' },
      { path: 'assets/bgm/emotional-piano.mp3',     critical: false, desc: 'BGM(강아지)' },
      { path: 'assets/bgm/suspense-beat.mp3',       critical: false, desc: 'BGM(썰툰)' },
      { path: 'assets/bgm/calm-corporate.mp3',      critical: false, desc: 'BGM(건강)' },
    ];

    for (const asset of requiredAssets) {
      if (!existsSync(resolve(this.projectDir, asset.path))) {
        const msg = `${asset.path} 없음 — ${asset.desc}`;
        asset.critical ? errors.push(msg) : warnings.push(msg);
      }
    }

    // 컴플라이언스 설정 확인 (필수)
    const compliancePath = resolve(this.projectDir, 'config', 'health_compliance.json');
    if (!existsSync(compliancePath)) {
      errors.push('config/health_compliance.json 없음 — 건강 쇼츠 실행 불가');
    }

    return {
      passed: errors.length === 0,
      warnings,
      errors,
    };
  }

  /**
   * Job 현황 조회
   */
  listJobStatus(): void {
    const jobs = this.jobManager.listJobs();
    if (jobs.length === 0) {
      log('📭', 'Job 없음');
      return;
    }

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${'Job ID'.padEnd(22)} ${'Type'.padEnd(10)} ${'Status'.padEnd(30)} ${'Updated'}`);
    console.log(`${'─'.repeat(70)}`);
    for (const job of jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const typeEmoji = { dog: '🐶', sseoltoon: '📖', health: '💊' }[job.contentType];
      const updated = job.updatedAt.slice(0, 16).replace('T', ' ');
      console.log(
        `  ${job.jobId.padEnd(22)} ${(typeEmoji + ' ' + job.contentType).padEnd(10)} ${job.status.padEnd(30)} ${updated}`,
      );
    }
    console.log(`${'─'.repeat(70)}\n`);
  }
}

// ── 에러 안전 실행 래퍼 ──
async function safeRun<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const advice = getRecoveryAdvice(error);
    logError(`${label} 실패`, error);
    console.error(`   💡 ${advice.userMessage}`);
    if (advice.retryable) {
      console.error(`   🔄 재시도 가능 (${advice.suggestedDelay ?? 0}ms 후)`);
    }
    return null;
  }
}

// ── CLI 진입점 ──
async function main() {
  const opts = parseArgs(process.argv);
  const orchestrator = new ShortsOrchestrator(PROJECT_DIR);

  // 도움말
  if (!opts.keyword && !opts.jobId && !opts.resume) {
    console.log(`
${'═'.repeat(55)}
🎬  Shorts Factory — 오케스트레이터
${'═'.repeat(55)}

사용법:
  npx tsx src/orchestrator.ts --keyword "강아지" --type dog
  npx tsx src/orchestrator.ts --job <jobId> --resume
  npx tsx src/orchestrator.ts --status

옵션:
  --keyword <text>   검색 키워드
  --type <type>      dog | sseoltoon | health
  --job <id>         기존 Job ID
  --resume           중단된 Job 재개
  --step <n>         특정 스텝만 실행 (1~7)
  --dry-run          실제 실행 없이 환경 점검만
  --status           모든 Job 현황 조회
${'═'.repeat(55)}
    `);
    return;
  }

  // 현황 조회
  if (process.argv.includes('--status')) {
    orchestrator.listJobStatus();
    return;
  }

  // 프리플라이트 체크
  log('🔧', '환경 점검 중...');
  const preflight = await safeRun('preflight', () => orchestrator.preflightCheck());
  if (preflight) {
    if (preflight.errors.length > 0) {
      console.error('\n❌  필수 조건 미충족:');
      for (const e of preflight.errors) console.error(`   • ${e}`);
      if (!opts.dryRun) process.exit(1);
    }
    if (preflight.warnings.length > 0) {
      console.warn('\n⚠️   경고:');
      for (const w of preflight.warnings) console.warn(`   • ${w}`);
    }
    if (preflight.passed) {
      log('✅', '환경 점검 통과');
    }
  }

  if (opts.dryRun) {
    log('🔍', '--dry-run 모드: 환경 점검만 완료');
    return;
  }

  // Job 생성 or 재개
  let job: Job | null = null;

  if (opts.jobId && opts.resume) {
    job = await safeRun('resume', () => orchestrator.resume(opts.jobId!));
  } else if (opts.keyword) {
    const type = opts.type ?? detectContentType(opts.keyword);
    job = await safeRun('start', () => orchestrator.start(opts.keyword!, type));
  }

  if (!job) {
    logError('Job을 시작할 수 없습니다.');
    process.exit(1);
  }

  // 스텝별 실행 (--step 없으면 현재 상태부터 안내)
  log('📋', `현재 Job 상태: ${job.status}`);
  log('💡', '각 단계는 해당 스킬을 통해 실행됩니다. 아래 안내에 따라 진행하세요.');

  await safeRun('Step 1-2', () => orchestrator.runSearch(job!));
  await safeRun('Step 3',   () => orchestrator.runScript(job!));
  await safeRun('Step 4',   () => orchestrator.runImageGeneration(job!));
  await safeRun('Step 5a',  () => orchestrator.runVideoGeneration(job!));
  await safeRun('Step 5b',  () => orchestrator.runTtsSync(job!));
  await safeRun('Step 6',   () => orchestrator.runQC(job!));
  await safeRun('Step 7',   () => orchestrator.runPackaging(job!));

  console.log(`\n${'═'.repeat(55)}`);
  log('🎉', `워크플로우 가이드 완료! Job ID: ${job.jobId}`);
  console.log(`${'═'.repeat(55)}\n`);
}

// ── 콘텐츠 타입 자동 감지 ──
function detectContentType(keyword: string): ContentType {
  const kw = keyword.toLowerCase();
  if (['강아지', '개', '반려견', '댕댕이', 'dog'].some(d => kw.includes(d))) return 'dog';
  if (['썰', '썰툰', '실화', '레전드'].some(s => kw.includes(s))) return 'sseoltoon';
  if (['건강', '효능', '비타민', '영양', '운동'].some(h => kw.includes(h))) return 'health';
  return 'dog';
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// ShortsOrchestrator is exported above as `export class`

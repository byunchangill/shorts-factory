import { API_PORT } from '@shared/constants';
import { createApp } from './app.js';
import { initWorkspace } from './store/workspace.js';
import { scanJobs } from './store/jobs.js';
import { scanPackets } from './claude/packets.js';
import { startResultWatcher, startResultSweep, catchUpPendingResults } from './claude/resultWatcher.js';
import { runDoctor } from './doctor.js';

// 백그라운드 작업(다운로드·조립 등)의 예외가 로컬 서버를 통째로 죽이지 않도록 방어
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack ?? err);
});

await initWorkspace();
await scanJobs();
await scanPackets();
startResultWatcher();
await catchUpPendingResults();
startResultSweep();

const doctor = await runDoctor();
for (const t of doctor.tools) {
  const mark = t.available ? '✅' : t.required ? '❌' : '⚠️ ';
  console.log(`${mark} ${t.name}${t.version ? ` (${t.version})` : ''}`);
}
if (!doctor.ok) {
  console.warn('⚠️  필수 도구가 없습니다. `npm run doctor`로 설치 안내를 확인하세요. (서버는 계속 실행됩니다)');
}

const app = createApp();
app.listen(API_PORT, () => {
  console.log(`\n🏭 쇼핑쇼츠 팩토리 API: http://localhost:${API_PORT}`);
  console.log(`   웹 UI: npm run dev 로 함께 실행 시 http://localhost:5173\n`);
});

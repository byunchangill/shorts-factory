import { API_PORT } from '@shared/constants';
import { createApp } from './app.js';
import { bootstrap } from './boot.js';
import { runDoctor } from './doctor.js';

// 백그라운드 작업(다운로드·조립 등)의 예외가 로컬 서버를 통째로 죽이지 않도록 방어
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack ?? err);
});

/**
 * 포트를 가장 먼저 연다.
 * 초기화나 도구 점검을 앞에 두면 그중 하나가 느리거나 멈출 때 포트가 열리지 않고,
 * 웹 UI는 원인 없는 ECONNREFUSED만 잔뜩 뱉는다 (실제로 그렇게 앱 전체가 죽었다).
 */
const app = createApp();
const server = app.listen(API_PORT, () => {
  console.log(`\n🏭 쇼핑쇼츠 팩토리 API: http://localhost:${API_PORT}`);
  console.log(`   웹 UI: npm run dev 로 함께 실행 시 http://localhost:5173\n`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n❌ 포트 ${API_PORT}이(가) 이미 사용 중입니다. ` +
        `이전에 띄운 서버가 남아 있는지 확인하고 종료한 뒤 다시 실행하세요.\n` +
        `   macOS/Linux: lsof -ti:${API_PORT} | xargs kill\n` +
        `   Windows:     netstat -ano | findstr :${API_PORT}  →  taskkill /PID <pid> /F\n`,
    );
  } else {
    console.error(`\n❌ API 서버를 시작하지 못했습니다:`, err.message, '\n');
  }
  process.exit(1);
});

await bootstrap();

// 도구 점검은 외부 프로세스를 띄우므로 서버 기동을 막지 않고 뒤에서 돌린다
void runDoctor({ force: true })
  .then((doctor) => {
    for (const t of doctor.tools) {
      const mark = t.available ? '✅' : t.required ? '❌' : '⚠️ ';
      console.log(`${mark} ${t.name}${t.version ? ` (${t.version})` : ''}`);
    }
    if (!doctor.ok) {
      console.warn('⚠️  필수 도구가 없습니다. `npm run doctor`로 설치 안내를 확인하세요. (서버는 계속 실행됩니다)');
    }
  })
  .catch((e) => console.error('[doctor]', e instanceof Error ? e.message : e));

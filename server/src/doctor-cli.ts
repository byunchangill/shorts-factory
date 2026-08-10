import { runDoctor } from './doctor.js';
import { initWorkspace } from './store/workspace.js';

const report = await (async () => {
  await initWorkspace();
  return runDoctor();
})();

console.log('\n=== 쇼핑쇼츠 팩토리 도구 점검 ===\n');
for (const t of report.tools) {
  const mark = t.available ? '✅' : t.required ? '❌' : '⚠️ ';
  const ver = t.version ? ` (${t.version})` : '';
  console.log(`${mark} ${t.name}${ver}${t.required ? '' : ' [선택]'}`);
  if (!t.available) console.log(`   설치: ${t.installHint}`);
}
console.log(report.ok ? '\n필수 도구 모두 준비됨.\n' : '\n❌ 필수 도구가 없습니다. 위 안내대로 설치하세요.\n');
process.exit(report.ok ? 0 : 1);

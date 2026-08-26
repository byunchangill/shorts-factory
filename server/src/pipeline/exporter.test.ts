import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { SettingsSchema, ScriptSchema, JobSchema, AssetSchema } from '@shared/types';
import { EXPORT_DIRS } from '@shared/constants';
import {
  resolveExportRoot, safeFileName, productDir, exportFileName, scriptToMarkdown, planExport,
} from './exporter.js';

const settings = SettingsSchema.parse({});

describe('exporter 경로 빌더', () => {
  it('exportRoot가 비면 다운로드 폴더', () => {
    expect(resolveExportRoot(settings)).toBe(path.join(os.homedir(), 'Downloads'));
  });

  it('exportRoot 설정 시 그 경로 사용', () => {
    const s = SettingsSchema.parse({ exportRoot: '/home/me/바탕화면' });
    expect(resolveExportRoot(s)).toBe('/home/me/바탕화면');
  });

  it('한글 폴더명 유지', () => {
    expect(safeFileName('무선 충전기')).toBe('무선 충전기');
    // 내보내기 폴더는 사용자가 파일 탐색기로 여는 실제 경로다 —
    // 구분자는 플랫폼을 따라간다 (윈도우는 `\`). 기대값도 path.join으로 만든다
    expect(productDir(SettingsSchema.parse({ exportRoot: '/x' }), '충전기')).toBe(
      path.join('/x', '충전기'),
    );
  });

  it('금지 문자만 제거', () => {
    expect(safeFileName('충전기/고속:최강?')).toBe('충전기고속최강');
    expect(safeFileName('a\\b*c"d<e>f|g')).toBe('abcdefg');
  });

  it('빈 이름은 대체값', () => {
    expect(safeFileName('///')).toBe('이름없음');
    expect(safeFileName('   ')).toBe('이름없음');
  });

  it('파일명에 제품명과 잡 제목이 함께 들어감', () => {
    expect(exportFileName('충전기', '1편 흡입력', '최종_v1.mp4')).toBe('충전기_1편 흡입력_최종_v1.mp4');
  });
});

describe('scriptToMarkdown', () => {
  const script = ScriptSchema.parse({
    version: 2,
    title: '3만원 충전기 실화',
    scenes: [
      {
        sceneId: 's01',
        narration: '이 충전기 진짜 될까요?',
        subtitle: '3만원의 실력',
        clipRef: { clipId: 'c01', suggestedSegment: { in: 1, out: 5 } },
      },
      { sceneId: 's02', narration: '결론은 링크에서.', subtitle: '링크 확인' },
    ],
    notes: '훅 강조',
  });

  it('씬별 나레이션·자막·소재를 포함', () => {
    const md = scriptToMarkdown(script, '충전기', '1편');
    expect(md).toContain('# 3만원 충전기 실화');
    expect(md).toContain('- 제품: 충전기');
    expect(md).toContain('## 씬 1 (s01)');
    expect(md).toContain('이 충전기 진짜 될까요?');
    expect(md).toContain('c01 (1s ~ 5s)');
    expect(md).toContain('## 씬 2 (s02)');
  });

  it('쿠팡파트너스 공시문구를 항상 포함', () => {
    expect(scriptToMarkdown(script, '충전기', '1편')).toContain('쿠팡 파트너스 활동의 일환');
  });
});

/*
  출처 대장은 `planExport`가 정한다 — 폴더 내보내기와 웹 다운로드가 같은 목록을 쓰므로
  여기서 한 번 정하면 둘 다 따라온다.
*/
describe('planExport — 에셋 출처 대장', () => {
  const base = {
    settings: SettingsSchema.parse({ mirror: true, zoom: 1.1, grade: '' }),
    job: JobSchema.parse({
      id: 'j1', projectId: 'p', menu: 'menu-b', title: '1편',
      createdAt: '2026-08-26T00:00:00.000Z', state: 'done',
    }),
    productName: '충전기',
    jobDir: path.join(os.tmpdir(), 'nowhere'),
    script: null,
    timings: null,
    clips: [],
  };
  const asset = AssetSchema.parse({
    id: 'local:memes/a.gif', kind: 'meme', origin: 'local',
    file: 'assets/local/memes/a.gif', url: '/media/x', title: '놀란 고양이',
    sourceUrl: 'https://pixabay.com/gifs/1/', hasFace: false,
  });

  it('쓴 자료가 있으면 업로드킷에 CSV가 들어간다', async () => {
    const items = await planExport({ ...base, assets: [asset] });
    const csv = items.find((i) => i.name.endsWith('에셋출처.csv'));
    expect(csv?.dir).toBe(EXPORT_DIRS.uploadKit);
    expect(csv?.text).toContain('https://pixabay.com/gifs/1/');
    // 🔴 변형은 사람이 적는 값이 아니라 그때 설정에서 계산한 값이다
    expect(csv?.text).toContain('좌우반전 · 확대 1.10배');
  });

  /*
    자료를 안 쓴 편에는 신고할 것이 없다. 빈 대장을 늘 내보내면
    「짤방을 안 썼다」와 「대장을 안 만들었다」가 같은 모양이 된다.
  */
  it('쓴 자료가 없으면 CSV를 안 만든다', async () => {
    const items = await planExport(base);
    expect(items.some((i) => i.name.endsWith('에셋출처.csv'))).toBe(false);
  });
});

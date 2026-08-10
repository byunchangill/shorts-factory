import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { SettingsSchema, ScriptSchema } from '@shared/types';
import { resolveExportRoot, safeFileName, productDir, exportFileName, scriptToMarkdown } from './exporter.js';

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
    expect(productDir(SettingsSchema.parse({ exportRoot: '/x' }), '충전기')).toBe('/x/충전기');
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

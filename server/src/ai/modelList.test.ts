import { describe, it, expect } from 'vitest';
import { parseModels } from './modelList.js';

describe('AI 모델 목록 읽기', () => {
  it('앤트로픽 — id와 표시 이름', () => {
    const out = parseModels('anthropic', {
      data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5' }],
    });
    expect(out).toEqual([{ id: 'claude-opus-5', label: 'Claude Opus 5' }]);
  });

  it('오픈AI — 대화 모델만 남긴다 (임베딩·음성은 요청서에 못 쓴다)', () => {
    const out = parseModels('openai', {
      data: [
        { id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' },
        { id: 'gpt-4o-audio-preview' }, { id: 'o3' }, { id: 'whisper-1' },
      ],
    });
    expect(out.map((m) => m.id)).toEqual(['gpt-4o-mini', 'o3']);
  });

  it('제미나이 — models/ 접두어를 떼고, 생성 가능한 것만', () => {
    const out = parseModels('gemini', {
      models: [
        { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', displayName: '임베딩', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    expect(out).toEqual([{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }]);
  });

  it('모양이 다른 응답이 와도 죽지 않는다', () => {
    expect(parseModels('anthropic', null)).toEqual([]);
    expect(parseModels('gemini', { models: 'nope' })).toEqual([]);
  });
});

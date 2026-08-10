import { describe, it, expect } from 'vitest';
import { parseVoices, DEFAULT_MODEL, AUDIO_EXT, AUDIO_FORMAT, KOREAN } from './typecast.js';

describe('parseVoices', () => {
  // 공식 문서의 응답 예시 (https://typecast.ai/docs/api-reference)
  const official = [
    {
      voice_id: 'tc_62a8975e695ad26f7fb514d1',
      voice_name: 'Olivia',
      model: 'ssfm-v21',
      emotions: ['tonemid', 'toneup', 'normal', 'happy', 'sad', 'angry'],
    },
  ];

  it('문서의 최상위 배열 응답을 파싱', () => {
    const voices = parseVoices(official);
    expect(voices).toHaveLength(1);
    expect(voices[0]).toEqual({
      id: 'tc_62a8975e695ad26f7fb514d1',
      name: 'Olivia',
      model: 'ssfm-v21',
      emotions: ['tonemid', 'toneup', 'normal', 'happy', 'sad', 'angry'],
    });
  });

  it('래핑된 응답도 견딤', () => {
    for (const key of ['voices', 'result', 'items', 'data']) {
      expect(parseVoices({ [key]: official })).toHaveLength(1);
    }
  });

  it('voice_id 없는 항목은 버림', () => {
    expect(parseVoices([{ voice_name: '이름만' }, official[0]])).toHaveLength(1);
  });

  it('emotions 누락 시 빈 배열', () => {
    const voices = parseVoices([{ voice_id: 'tc_1', voice_name: 'A' }]);
    expect(voices[0].emotions).toEqual([]);
    expect(voices[0].model).toBe(DEFAULT_MODEL);
  });

  it('이름 기준 한국어 정렬', () => {
    const voices = parseVoices([
      { voice_id: 'tc_2', voice_name: '하윤' },
      { voice_id: 'tc_1', voice_name: '가온' },
      { voice_id: 'tc_3', voice_name: '나래' },
    ]);
    expect(voices.map((v) => v.name)).toEqual(['가온', '나래', '하윤']);
  });

  it('예상 밖 응답에도 터지지 않음', () => {
    expect(parseVoices(null)).toEqual([]);
    expect(parseVoices({})).toEqual([]);
    expect(parseVoices('문자열')).toEqual([]);
    expect(parseVoices({ voices: '배열 아님' })).toEqual([]);
  });
});

describe('API 상수', () => {
  it('확장자와 요청 포맷이 일치해야 ffprobe가 오작동하지 않는다', () => {
    expect(AUDIO_EXT).toBe(`.${AUDIO_FORMAT}`);
  });

  it('한국어는 ISO-639-3 3자리 코드', () => {
    expect(KOREAN).toBe('kor');
    expect(KOREAN).toHaveLength(3);
  });
});

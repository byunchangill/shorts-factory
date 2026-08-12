import type { AiProvider } from '@shared/constants';
import { loadSettings } from '../store/workspace.js';
import { runProvider } from '../ai/providers.js';
import { extractJson } from '../ai/extract.js';

/**
 * 영상 제목에서 제품을 알아내고 **중국어 검색어**를 만든다.
 *
 * 도우인·샤오홍슈·1688은 한국어로 검색하면 아무것도 안 나온다. 중국어 상품명을
 * 알아야 하는데, 그게 이 기능의 진짜 장벽이다 — "주방 틈새 수납장"이 중국에서는
 * 厨房夹缝置物架다. 사람이 매번 번역기를 왕복하는 대신 AI가 뽑아준다.
 *
 * 이미지가 아니라 제목·설명 텍스트만 쓴다 — 현재 프로바이더 호출은 텍스트 전용이다.
 * 제목이 모호하면 사용자가 직접 검색어를 넣을 수 있게 화면에서 열어둔다.
 */

export interface SourcingKeywords {
  productKo: string;
  productZh: string;
  /** 중국 플랫폼 검색용 — 상품명·별칭·용도 표현을 섞는다 */
  keywordsZh: string[];
  /** 틱톡 등 영어권 검색용 */
  keywordsEn: string[];
  /** 근거가 부족하면 여기에 이유를 적는다 (지어내지 말라는 지시의 출구) */
  note: string;
}

const PROMPT = (title: string, channel: string) => `너는 중국 소싱 담당자다.
아래 한국 쇼츠 영상의 제목을 보고, 영상에 나오는 **제품이 무엇인지** 판단하고
도우인·샤오홍슈·1688에서 그 제품을 찾을 **중국어 검색어**를 만들어라.

영상 제목: ${title}
채널: ${channel}

규칙
- 중국어 검색어는 중국 쇼핑몰에서 실제로 쓰는 표기를 써라 (예: 주방 틈새 수납장 → 厨房夹缝置物架)
- 상품명 하나만 주지 말고, 별칭·용도 표현을 섞어 3~5개를 줘라
- 제목만으로 제품을 특정할 수 없으면 억지로 지어내지 말고 note에 그렇게 적고
  keywordsZh는 넓은 카테고리 수준으로만 줘라
- 설명 없이 JSON만 출력하라

{
  "productKo": "한국어 제품명",
  "productZh": "중국어 제품명",
  "keywordsZh": ["중국어 검색어"],
  "keywordsEn": ["english search term"],
  "note": "판단 근거 또는 불확실한 점"
}`;

export async function suggestKeywords(
  provider: AiProvider,
  input: { title: string; channelTitle?: string },
): Promise<SourcingKeywords> {
  const settings = await loadSettings();
  const raw = await runProvider(provider, {
    prompt: PROMPT(input.title, input.channelTitle ?? ''),
    settings,
    maxTokens: 800,
  });
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`AI 응답에서 JSON을 찾지 못했습니다: ${raw.slice(0, 200)}`);
  }
  const o = parsed as Partial<SourcingKeywords>;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  return {
    productKo: typeof o.productKo === 'string' ? o.productKo : '',
    productZh: typeof o.productZh === 'string' ? o.productZh : '',
    keywordsZh: list(o.keywordsZh),
    keywordsEn: list(o.keywordsEn),
    note: typeof o.note === 'string' ? o.note : '',
  };
}

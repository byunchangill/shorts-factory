---
name: create-format
description: 제품정보리뷰 채널의 고유 포맷(format.json) 설계. 포맷 생성 요청서(kind format-create) 처리나, 사용자가 직접 채널 포맷/구성 설계를 요청할 때 사용.
---

# 고유 포맷 설계 (create-format)

고유 포맷은 제품정보리뷰 채널의 뼈대다: 훅 패턴, 씬 구성(beats), 말투, 이미지 스타일, 브랜딩을 한 번 정의하면 모든 영상이 같은 포맷으로 생산된다.

## 설계 원칙

1. **차별성**: 기존 유명 채널을 그대로 베끼지 않는다. 사용자 답변(컨셉/타깃/톤)에서 고유한 각도를 뽑아낸다.
2. **재현성**: beats는 어떤 제품을 넣어도 같은 구조로 돌아가야 한다. 제품 종속적 비트 금지.
   - 좋은 예: "훅 → 문제 → 해결·스펙 → 반전 디테일 → 단점 → CTA" (제품이 바뀌어도 같은 순서로 돈다)
3. **시간 예산**: beats의 secondsHint 합계는 메뉴 목표 길이에 맞춘다.
   숫자를 여기에 적어두지 않는다 — `shared/constants.ts`의 `TARGET_SEC_BY_MENU`가 유일한 출처이고,
   요청서 "검증 규칙"에 그 값이 박혀 나오므로 **요청서를 우선한다**.
   초만 맞추면 안 된다: `charBudget(speechRate, menu)`로 비트당 글자수를 계산해
   그 비트가 요구하는 문장이 실제로 들어가는지 검산하라. 짧은 메뉴에서는 비트를 늘릴수록
   비트당 글자가 문장이 안 되는 지점이 먼저 온다.
4. **일관성 장치**: `sceneTemplate.imageStylePrompt`는 모든 씬 이미지의 공통 접두어가 되므로, 화풍·팔레트·조명을 구체적으로 명시한다.
5. **금칙어**: tone.bannedWords에 과장 표현("무조건", "100%", "기적")을 기본 포함한다.
   단, 이 목록은 부분 문자열로 매칭될 수 있다 — 흔한 어절에 걸리는 단어("제발"→"문제발생")는 오탐을 만든다.
6. **메뉴 규칙과 충돌 금지**: format.json은 대본 요청서에 **원문 그대로** 실린다
   (`server/src/claude/packets.ts`의 `## 3-1. 고유 포맷`). 같은 request.md에 `MENU_B_RULES`도 함께 실리므로,
   포맷이 그와 반대되는 지시를 담으면 대본가가 충돌하는 두 지시를 받고 그 대본은 계속 반려된다.
   포맷을 쓰기 전에 `MENU_B_RULES`(packets.ts)와 `scriptRules.ts`를 읽고 대조하라.
   (실제 사례: 단점 비트에 "그래도 괜찮은 조건을 붙인다"라고 썼는데
   `MENU_B_RULES.script`는 "단점 뒤에 그걸 덮는 마무리를 붙이지 않는다"였다.)

## 산출물

FormatSchema(shared/types.ts)를 따르는 format.json. 요청서로 들어온 경우 `result/format.json`에 쓰고 `result/.done`을 생성한다.

**스키마에 없는 필드를 새로 만들지 않는다.** zod가 모르는 키를 조용히 버리므로(에러가 아니라 무시),
넣은 지시가 대본가에게 전달되지 않는다. 담을 자리가 없으면 가장 가까운 기존 필드
(`beats[].purpose`, `structure.hook`, `tone.persona` 등)에 넣어라.
저장 전에 `FormatSchema.partial({ id: true, createdAt: true })`로 파싱해
**입력과 출력이 같은지** 확인하면 버려진 키를 잡을 수 있다.

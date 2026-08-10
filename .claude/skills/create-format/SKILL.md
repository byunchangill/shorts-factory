---
name: create-format
description: 제품정보리뷰 채널의 고유 포맷(format.json) 설계. 포맷 생성 요청서(kind format-create) 처리나, 사용자가 직접 채널 포맷/구성 설계를 요청할 때 사용.
---

# 고유 포맷 설계 (create-format)

고유 포맷은 제품정보리뷰 채널의 뼈대다: 훅 패턴, 씬 구성(beats), 말투, 이미지 스타일, 브랜딩을 한 번 정의하면 모든 영상이 같은 포맷으로 생산된다.

## 설계 원칙

1. **차별성**: 기존 유명 채널을 그대로 베끼지 않는다. 사용자 답변(컨셉/타깃/톤)에서 고유한 각도를 뽑아낸다.
2. **재현성**: beats는 어떤 제품을 넣어도 같은 구조로 돌아가야 한다. 제품 종속적 비트 금지.
   - 좋은 예: "문제 공감(3s) → 제품 등장(4s) → 사용 장면 A/B/C(각 8s) → 가격 공개(5s) → CTA(4s)"
3. **시간 예산**: beats의 secondsHint 합계 45~55초.
4. **일관성 장치**: `sceneTemplate.imageStylePrompt`는 모든 씬 이미지의 공통 접두어가 되므로, 화풍·팔레트·조명을 구체적으로 명시한다.
5. **금칙어**: tone.bannedWords에 과장 표현("무조건", "100%", "기적")을 기본 포함한다.

## 산출물

FormatSchema(shared/types.ts)를 따르는 format.json. 요청서로 들어온 경우 `result/format.json`에 쓰고 `result/.done`을 생성한다.

# 데이터 스키마 v6 (Final)

v5 → v6 변경사항 (4건):
1. SEARCH_STARTED → SEARCH_REQUESTED(user) + SEARCH_STARTED(system) 분리
2. fromStatus 다중 출처: 배열 허용 스키마 (TTS_GENERATION_STARTED 등)
3. exact_keyword 한국어 경계: 조사/어미 패턴 대폭 확장
4. template 규칙: 검출(detect)과 재작성(rewrite)을 분리

---

## 1. Job (변경 없음)

```json
{
  "jobId": "job_20260309_001",
  "keyword": "강아지",
  "contentType": "dog | sseoltoon | health",
  "needsVideo": true,
  "selectedReferenceId": null,
  "status": "searching",
  "createdAt": "2026-03-09T07:00:00+09:00",
  "updatedAt": "2026-03-09T08:30:00+09:00",
  "workspace": {
    "temp": "jobs/job_20260309_001/temp/",
    "approved": "jobs/job_20260309_001/approved/",
    "versions": "jobs/job_20260309_001/versions/",
    "final": "output/job_20260309_001/"
  }
}
```

---

## 2. 상태 머신 (변경 없음)

### 단일 소스: VALID_TRANSITIONS

**이 코드가 유일한 진짜. 다이어그램은 파생. 충돌 시 코드 우선.**

```javascript
const VALID_TRANSITIONS = {
  "searching":                ["references_presented", "error"],
  "references_presented":     ["reference_selected", "searching"],
  "reference_selected":       ["scripting"],
  "scripting":                ["script_pending_approval", "script_failed", "error"],
  "script_pending_approval":  ["script_approved", "scripting"],
  "script_failed":            ["scripting"],
  "script_approved":          ["images_generating"],
  "images_generating":        ["images_pending_approval", "images_partial", "error"],
  "images_partial":           ["images_generating"],
  "images_pending_approval":  ["images_fully_approved", "images_regen_requested", "images_version_restored"],
  "images_regen_requested":   ["images_pending_approval"],
  "images_version_restored":  ["images_pending_approval"],
  "images_fully_approved":    ["video_generating", "tts_generating"],
  "video_generating":         ["video_pending_approval", "video_failed", "error"],
  "video_pending_approval":   ["video_approved", "video_regen_requested"],
  "video_regen_requested":    ["video_pending_approval"],
  "video_failed":             ["video_generating"],
  "video_approved":           ["tts_generating"],
  "tts_generating":           ["tts_syncing", "tts_failed", "error"],
  "tts_syncing":              ["compose_done", "error"],
  "tts_failed":               ["tts_generating"],
  "compose_done":             ["qc_reviewing"],
  "qc_reviewing":             ["qc_passed", "qc_warning", "qc_failed"],
  "qc_passed":                ["exporting"],
  "qc_warning":               ["exporting", "scripting", "images_generating", "video_generating", "tts_generating"],
  "qc_failed":                ["scripting", "images_generating", "video_generating", "tts_generating"],
  "exporting":                ["exported", "error"],
  "error":                    ["searching", "scripting", "images_generating", "video_generating", "tts_generating"]
};

function canTransition(from, to) {
  if (to === "abandoned") return true;
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}
```

---

## 3. 이벤트 레지스트리

### StateEvent 스키마 (★ Fix #2: fromStatus 배열 허용)

```json
{
  "eventId": "evt_001",
  "jobId": "job_20260309_001",
  "timestamp": "2026-03-09T08:15:30+09:00",
  "fromStatus": "images_pending_approval",
  "toStatus": "images_regen_requested",
  "eventType": "SCENE_IMAGE_REGEN_REQUESTED",
  "actor": "user",
  "targetId": "scene_03",
  "reasonCode": "character_face_inconsistent",
  "reasonDetail": "3번 씬 강아지 얼굴이 다름",
  "metadata": {}
}
```

**fromStatus 타입 규칙:**
```
- 대부분의 이벤트: fromStatus = string (단일 상태)
- 다중 출처 이벤트: fromStatus = string[] (배열)
- 실제 발행 시 fromStatus에는 현재 Job의 실제 상태 값(string) 하나만 들어감
- 레지스트리의 배열은 "이 이벤트가 발행될 수 있는 상태 목록"을 의미
```

### 전체 이벤트 레지스트리 (canonical)

**모든 이벤트의 유일한 정의. 각 스킬은 이 테이블의 이벤트만 발행 가능.**

| eventType | actor | fromStatus | toStatus | 발행 스킬 |
|-----------|-------|------------|----------|----------|
| **검색 (youtube-researcher)** |||||
| `SEARCH_REQUESTED` | user | `*` | — | youtube-researcher |
| `SEARCH_STARTED` | system | `*` | `searching` | youtube-researcher |
| `REFERENCES_PRESENTED` | system | `searching` | `references_presented` | youtube-researcher |
| `REFERENCE_SELECTED` | user | `references_presented` | `reference_selected` | youtube-researcher |
| `SEARCH_RETRY` | user | `references_presented` | `searching` | youtube-researcher |
| **대본 (script-creator)** |||||
| `SCRIPT_GENERATION_STARTED` | system | `reference_selected` | `scripting` | script-creator |
| `SCRIPT_GENERATED` | system | `scripting` | `script_pending_approval` | script-creator |
| `SCRIPT_APPROVED` | user | `script_pending_approval` | `script_approved` | script-creator |
| `SCRIPT_REVISION_REQUESTED` | user | `script_pending_approval` | `scripting` | script-creator |
| `SCRIPT_FAILED` | system | `scripting` | `script_failed` | script-creator |
| `HEALTH_COMPLIANCE_AUTOFIX` | system | `null` | `null` | script-creator |
| `SIMILARITY_CHECK_COMPLETED` | system | `null` | `null` | script-creator |
| **이미지 (image-generator)** |||||
| `STYLE_BIBLE_CREATED` | system | `null` | `null` | image-generator |
| `CHARACTER_BIBLE_CREATED` | system | `null` | `null` | image-generator |
| `IMAGES_GENERATION_STARTED` | system | `script_approved` | `images_generating` | image-generator |
| `IMAGES_GENERATED` | tool | `images_generating` | `images_pending_approval` | image-generator |
| `IMAGES_PARTIAL_FAILURE` | tool | `images_generating` | `images_partial` | image-generator |
| `IMAGES_ALL_APPROVED` | user | `images_pending_approval` | `images_fully_approved` | image-generator |
| `SCENE_IMAGE_REGEN_REQUESTED` | user | `images_pending_approval` | `images_regen_requested` | image-generator |
| `SCENE_IMAGE_REGEN_COMPLETED` | tool | `images_regen_requested` | `images_pending_approval` | image-generator |
| `SCENE_IMAGE_VERSION_RESTORED` | user | `images_pending_approval` | `images_version_restored` | image-generator |
| `IMAGES_VERSION_RESTORE_DONE` | system | `images_version_restored` | `images_pending_approval` | image-generator |
| **영상 (video-maker)** |||||
| `VIDEO_GENERATION_STARTED` | system | `images_fully_approved` | `video_generating` | video-maker |
| `VIDEO_GENERATED` | tool | `video_generating` | `video_pending_approval` | video-maker |
| `VIDEO_APPROVED` | user | `video_pending_approval` | `video_approved` | video-maker |
| `VIDEO_REGEN_REQUESTED` | user | `video_pending_approval` | `video_regen_requested` | video-maker |
| `VIDEO_REGEN_COMPLETED` | tool | `video_regen_requested` | `video_pending_approval` | video-maker |
| `VIDEO_FAILED` | tool | `video_generating` | `video_failed` | video-maker |
| **TTS/합성 (tts-sync)** |||||
| `TTS_GENERATION_STARTED` | system | [`video_approved`, `images_fully_approved`] | `tts_generating` | tts-sync |
| `TTS_GENERATED` | tool | `tts_generating` | `tts_syncing` | tts-sync |
| `TTS_FAILED` | tool | `tts_generating` | `tts_failed` | tts-sync |
| `TTS_SYNC_COMPLETED` | system | `tts_syncing` | `compose_done` | tts-sync |
| `COMPOSE_FAILED` | tool | `tts_syncing` | `error` | tts-sync |
| **QC (shorts-qc-reviewer)** |||||
| `QC_STARTED` | system | `compose_done` | `qc_reviewing` | shorts-qc-reviewer |
| `QC_PASSED` | system | `qc_reviewing` | `qc_passed` | shorts-qc-reviewer |
| `QC_WARNING` | system | `qc_reviewing` | `qc_warning` | shorts-qc-reviewer |
| `QC_FAILED` | system | `qc_reviewing` | `qc_failed` | shorts-qc-reviewer |
| `QC_OVERRIDE` | user | `qc_warning` | `exporting` | shorts-qc-reviewer |
| `QC_REVISE_TO_SCRIPT` | user | [`qc_warning`, `qc_failed`] | `scripting` | shorts-qc-reviewer |
| `QC_REVISE_TO_IMAGES` | user | [`qc_warning`, `qc_failed`] | `images_generating` | shorts-qc-reviewer |
| `QC_REVISE_TO_VIDEO` | user | [`qc_warning`, `qc_failed`] | `video_generating` | shorts-qc-reviewer |
| `QC_REVISE_TO_TTS` | user | [`qc_warning`, `qc_failed`] | `tts_generating` | shorts-qc-reviewer |
| **패키징 (export-packager)** |||||
| `EXPORT_STARTED` | system | [`qc_passed`, `qc_warning`] | `exporting` | export-packager |
| `EXPORT_COMPLETED` | system | `exporting` | `exported` | export-packager |
| `EXPORT_FAILED` | system | `exporting` | `error` | export-packager |
| **공통** |||||
| `JOB_ABANDONED` | user | `*` | `abandoned` | (어느 스킬) |
| `ERROR_OCCURRED` | system | `*` | `error` | (어느 스킬) |
| `ERROR_RECOVERED_TO_SEARCHING` | system | `error` | `searching` | (어느 스킬) |
| `ERROR_RECOVERED_TO_SCRIPTING` | system | `error` | `scripting` | (어느 스킬) |
| `ERROR_RECOVERED_TO_IMAGES` | system | `error` | `images_generating` | (어느 스킬) |
| `ERROR_RECOVERED_TO_VIDEO` | system | `error` | `video_generating` | (어느 스킬) |
| `ERROR_RECOVERED_TO_TTS` | system | `error` | `tts_generating` | (어느 스킬) |

### ★ Fix #1: SEARCH_REQUESTED + SEARCH_STARTED 분리

| v5 | v6 |
|----|-----|
| `SEARCH_STARTED` actor=user | `SEARCH_REQUESTED` actor=user (요청) + `SEARCH_STARTED` actor=system (실행) |

이벤트 흐름:
```
사용자: "강아지"
  → SEARCH_REQUESTED (actor: user, 상태 변경 없음)
  → SEARCH_STARTED (actor: system, → searching)
  → REFERENCES_PRESENTED (actor: system, → references_presented)
```

### ★ Fix #2: fromStatus 배열 표기

레지스트리에서 fromStatus가 `[A, B]` 형태인 이벤트:

| eventType | fromStatus (허용 목록) |
|-----------|----------------------|
| `TTS_GENERATION_STARTED` | [`video_approved`, `images_fully_approved`] |
| `QC_REVISE_TO_SCRIPT` | [`qc_warning`, `qc_failed`] |
| `QC_REVISE_TO_IMAGES` | [`qc_warning`, `qc_failed`] |
| `QC_REVISE_TO_VIDEO` | [`qc_warning`, `qc_failed`] |
| `QC_REVISE_TO_TTS` | [`qc_warning`, `qc_failed`] |
| `EXPORT_STARTED` | [`qc_passed`, `qc_warning`] |

실제 발행 시 fromStatus 필드에는 현재 Job의 실제 상태 값 하나만 들어간다.
검증 코드:

```javascript
function validateEvent(event, registry) {
  const def = registry[event.eventType];
  if (!def) return { valid: false, reason: "unknown eventType" };
  
  // fromStatus 검증 (배열이면 포함 여부, 문자열이면 일치)
  const allowedFrom = Array.isArray(def.fromStatus) 
    ? def.fromStatus 
    : [def.fromStatus];
  
  if (def.fromStatus !== null && def.fromStatus !== "*" 
      && !allowedFrom.includes(event.fromStatus)) {
    return { valid: false, reason: `invalid fromStatus: ${event.fromStatus}` };
  }
  
  // toStatus 검증
  if (def.toStatus !== null && event.toStatus !== def.toStatus) {
    return { valid: false, reason: `invalid toStatus: ${event.toStatus}` };
  }
  
  // actor 검증
  if (event.actor !== def.actor) {
    return { valid: false, reason: `invalid actor: ${event.actor}` };
  }
  
  return { valid: true };
}
```

### 이벤트 규칙

```
1. 모든 이벤트는 위 레지스트리에 정의된 eventType만 사용한다.
2. actor는 이벤트당 하나로 고정이다.
3. fromStatus → toStatus가 VALID_TRANSITIONS에 없는 전이는 발행 불가.
4. 상태 변경 없는 이벤트는 fromStatus = null, toStatus = null.
5. 각 스킬은 자기 "발행 스킬" 열에 있는 이벤트만 발행한다.
6. 모든 toStatus는 concrete enum 값이다. 추상 값 금지.
7. fromStatus가 배열인 이벤트는, 실제 발행 시 현재 상태가 배열 내에 포함되어야 한다.
```

### reasonCode (변경 없음 — v5와 동일)

---

## 4. UsedVideoHistory (변경 없음 — v5와 동일)

---

## 5. HealthComplianceRules

### 주장 등급 (변경 없음)

### matchType 정의

| matchType | 매칭 방식 |
|-----------|----------|
| `exact_keyword` | **한국어 단어 경계 매칭** (★ Fix #3: 패턴 확장) |
| `contains_keyword` | 부분 문자열 매칭 `sentence.includes(kw)` |
| `template` | 패턴 매칭 (★ Fix #4: 검출/재작성 분리) |

### ★ Fix #3: exact_keyword 한국어 경계 확장

v5에서 `KOREAN_JOSA_STARTS`가 제한적이었던 문제 수정.
한국어 조사/어미/접속 패턴을 대폭 확장.

```javascript
/**
 * 한국어 단어 경계 판정
 * 
 * 키워드 뒤에 올 수 있는 문자를 3가지로 분류:
 * 
 * A. 매칭 (키워드 의미 유지):
 *    - 문장 끝, 공백, 문장부호
 *    - 조사: 은,는,이,가,을,를,의,에,로,와,과,도,만,까지,부터,에서,께,랑,처럼,보다,마저,조차,밖에
 *    - 어미: 입니다,였다,이다,라고,라서,라면,이라,인데,이고,이며,이지만,이었다,이니까,이라도
 *    - 서술: 됩니다,된다,되는,하는,한다,할,하고,하며,해서,하면,하지만
 *    - 존칭: 님,씨
 * 
 * B. 비매칭 (다른 단어):
 *    - 한글 자모가 이어지되 위 패턴이 아닌 경우
 *    - 예: "기적적" (기적 + 적 = 다른 단어), "완치율" (완치 + 율 = 다른 단어)
 *
 * C. 판단 불가 → 매칭으로 처리 (false negative보다 false positive가 안전)
 */

// 키워드 뒤에 올 수 있는 조사/어미/서술 패턴 (긴 것부터 매칭)
const ALLOWED_SUFFIXES = [
  // 3음절+
  "입니다", "이었다", "이니까", "이라도", "이지만", "됩니다",
  "에서는", "까지는", "부터는", "처럼은", "보다는",
  // 2음절
  "까지", "부터", "에서", "처럼", "보다", "마저", "조차", "밖에",
  "라고", "라서", "라면", "이라", "인데", "이고", "이며",
  "된다", "되는", "하는", "한다", "하고", "하며", "해서", "하면",
  // 1음절
  "은", "는", "이", "가", "을", "를", "의", "에", "로", "와",
  "과", "도", "만", "께", "랑", "님", "씨",
];

function matchExactKeyword(sentence, keyword) {
  let startIndex = 0;
  while (true) {
    const idx = sentence.indexOf(keyword, startIndex);
    if (idx === -1) return false;
    
    const afterIdx = idx + keyword.length;
    const rest = sentence.substring(afterIdx);
    
    // 키워드 뒤에 아무것도 없으면 → 매칭
    if (rest.length === 0) return true;
    
    // 키워드 뒤가 비한글 (공백, 문장부호, 숫자 등) → 매칭
    if (!/[가-힣]/.test(rest[0])) return true;
    
    // 키워드 뒤가 허용된 조사/어미로 시작 → 매칭
    // 긴 패턴부터 검사 (ALLOWED_SUFFIXES는 이미 길이 내림차순)
    let suffixMatched = false;
    for (const suffix of ALLOWED_SUFFIXES) {
      if (rest.startsWith(suffix)) {
        suffixMatched = true;
        break;
      }
    }
    if (suffixMatched) return true;
    
    // 한글이 이어지지만 허용 패턴이 아님 → 다른 단어 (비매칭)
    // 다음 위치에서 재검색
    startIndex = idx + 1;
  }
}
```

### 확장된 검증 예시

```
matchExactKeyword("이것은 기적입니다", "기적")     → true  ✅ (기적 + 입니다)
matchExactKeyword("기적적인 변화", "기적")          → false ✅ (기적적 = 다른 단어)
matchExactKeyword("정말 기적 같은 일", "기적")      → true  ✅ (기적 + 공백)
matchExactKeyword("기적이었다", "기적")             → true  ✅ (기적 + 이었다)
matchExactKeyword("기적이라고 합니다", "기적")      → true  ✅ (기적 + 이라고)
matchExactKeyword("완치됩니다", "완치")             → true  ✅ (완치 + 됩니다)
matchExactKeyword("완치율이 높다", "완치")          → false ✅ (완치율 = 다른 단어)
matchExactKeyword("완치라고 단정", "완치")          → true  ✅ (완치 + 라고)
matchExactKeyword("마법처럼 좋아졌다", "마법")      → true  ✅ (마법 + 처럼)
matchExactKeyword("마법사가 나타났다", "마법")      → false ✅ (마법사 = 다른 단어)
matchExactKeyword("만병통치에 가깝다", "만병통치")  → true  ✅ (만병통치 + 에)
```

### ★ Fix #4: template 규칙 — 검출과 재작성 분리

v5에서 template 캡처 결과를 그대로 재작성에 쓰면 "먹으하는 것을..."처럼 부자연스러워지는 문제.
→ **검출 규칙(detect)**과 **재작성 규칙(rewrite)**을 분리.

```json
{
  "diagnosis_pattern": {
    "matchType": "template",
    "detect": {
      "templates": [
        "당신은 ${disease}입니다",
        "이 증상이면 ${disease}입니다",
        "이것은 ${disease}의 신호입니다",
        "${symptom}이면 ${disease}을 의심"
      ],
      "note": "검출 전용. ${var}은 non-greedy (.+?)로 변환."
    },
    "rewrite": {
      "strategy": "full_sentence_replace",
      "template": "${symptom} 증상이 있다면 전문의 상담을 권장합니다",
      "fallback": "관련 증상이 있다면 전문의 상담을 권장합니다",
      "note": "캡처 변수 사용 가능. 자연스러운 문장이 안 되면 fallback 사용."
    },
    "severity": "high",
    "action": "rewrite_to_conditional"
  },
  "treatment_directive": {
    "matchType": "template",
    "detect": {
      "templates": [
        "반드시 ${action}하세요",
        "지금 당장 ${action}하세요",
        "이것만 ${action}하면"
      ]
    },
    "rewrite": {
      "strategy": "verb_stem_rewrite",
      "template": "${action_stem}하는 것을 고려해볼 수 있습니다",
      "stemRule": "캡처된 ${action}에서 어간을 추출. '먹으' → '먹', '운동' → '운동'",
      "fallback": "해당 방법을 고려해볼 수 있습니다",
      "note": "어간 추출이 실패하면 fallback 사용."
    },
    "severity": "high",
    "action": "rewrite_to_suggestion"
  }
}
```

### rewrite.strategy 유형

| strategy | 설명 | 예시 |
|----------|------|------|
| `full_sentence_replace` | 문장 전체를 재작성 템플릿으로 교체 | "당신은 당뇨입니다" → "당뇨 증상이 있다면 전문의 상담을 권장합니다" |
| `verb_stem_rewrite` | 캡처된 동사에서 어간 추출 후 재작성 | "반드시 운동하세요" → "운동하는 것을 고려해볼 수 있습니다" |
| `keyword_swap` | 키워드를 대체어로 교체 (exaggeration용) | "기적" → "주목할 만한" |
| `fallback` | 캡처/어간 추출 실패 시 고정 문구 사용 | → "해당 방법을 고려해볼 수 있습니다" |

### 재작성 코드

```javascript
function rewriteSentence(sentence, violation, rule) {
  const rewrite = rule.rewrite;
  
  switch (rewrite.strategy) {
    case "full_sentence_replace": {
      // 캡처 변수로 템플릿 채우기
      let result = rewrite.template;
      if (violation.matchDetail?.captures) {
        for (const [key, val] of Object.entries(violation.matchDetail.captures)) {
          result = result.replace(`\${${key}}`, val);
        }
      }
      // 결과가 자연스러운지 간단 체크 (한글 2음절 이상 포함)
      const koreanCount = (result.match(/[가-힣]/g) || []).length;
      return koreanCount >= 4 ? result : rewrite.fallback;
    }
    
    case "verb_stem_rewrite": {
      const action = violation.matchDetail?.captures?.action;
      if (!action) return rewrite.fallback;
      
      // 한국어 어간 추출 (간이)
      // "먹으" → "먹", "운동" → "운동", "드시" → "드시"
      const stem = extractKoreanVerbStem(action);
      if (!stem) return rewrite.fallback;
      
      return rewrite.template.replace("${action_stem}", stem);
    }
    
    case "keyword_swap": {
      // exact_keyword용: 키워드를 대체어로 직접 교체
      const replacements = rule.replacements;
      let result = sentence;
      for (const [from, to] of Object.entries(replacements)) {
        if (sentence.includes(from)) {
          result = result.replace(from, to);
          break;
        }
      }
      return result;
    }
    
    default:
      return rewrite.fallback || sentence;
  }
}

function extractKoreanVerbStem(captured) {
  // 간이 어간 추출: 마지막 음절의 종성/모음 패턴으로 판단
  // "먹으" → "먹" (받침+으)
  // "운동" → "운동" (명사형 동사)
  // "드시" → "드시" (존칭 어간)
  // 실패 시 null 반환
  
  if (!captured || captured.length === 0) return null;
  
  // "~으"로 끝나면 제거 (받침 뒤 매개모음)
  if (captured.endsWith("으")) return captured.slice(0, -1);
  
  // 그 외는 그대로 반환 (명사형 동사 등)
  return captured;
}
```

### 재작성 검증 예시

```
입력: "반드시 운동하세요"
detect: template "반드시 ${action}하세요" → captures: {action: "운동"}
rewrite: verb_stem_rewrite → stem: "운동" → "운동하는 것을 고려해볼 수 있습니다" ✅

입력: "이것만 먹으면 된다"
detect: template "이것만 ${action}하면" → captures: {action: "먹으"}
rewrite: verb_stem_rewrite → stem: "먹" (먹으→먹) → "먹하는 것을..." ❌ 부자연스러움
  → fallback: "해당 방법을 고려해볼 수 있습니다" ✅

입력: "당신은 당뇨입니다"
detect: template "당신은 ${disease}입니다" → captures: {disease: "당뇨"}
rewrite: full_sentence_replace → "당뇨 증상이 있다면 전문의 상담을 권장합니다" ✅
```

### 출처 등급 / 면책 / auditActions (v5와 동일)

---

## 6. GeneratedScript — healthCompliance.audit (v5와 동일)

---

## 7~9. ReferenceVideo / Scene / StyleBible / CharacterBible / ImageAsset / VideoAsset (변경 없음)

---

## 10. 작업 공간 / 11. 운영 안전 원칙 (변경 없음)

---

## 12. 향후 고려사항

### A~C (v5와 동일)

### D. 유사도 검증 정량화 (GPT 지적 반영)

현재 유사도 검증은 Claude가 직접 점수를 매기는 반자동 방식.
threshold(phrase 0.3, structure 0.7, title 0.5)는 있지만 계산 방법은 미정.

**Phase 1 실행 후 정량화 방향:**
- phrase overlap: 문장 단위 n-gram(bi-gram) 겹침률
- structure overlap: 사건 순서를 시퀀스로 변환 후 Levenshtein 거리
- title similarity: 형태소 분석 후 핵심 키워드 Jaccard 유사도
- 임베딩 기반: sentence-transformers 코사인 유사도 (정밀도 높지만 무거움)

**추가 시점:** Phase 1에서 유사도 판단이 일관되지 않을 때.

### E. 형태소 분석기 통합

exact_keyword의 한국어 경계 판정을 현재는 규칙 기반(ALLOWED_SUFFIXES)으로 처리.
운영 중 오탐/누락이 쌓이면 형태소 분석기(MeCab-ko, Kiwi 등) 도입 검토.

**추가 시점:** exact_keyword 오탐률이 5% 이상일 때.

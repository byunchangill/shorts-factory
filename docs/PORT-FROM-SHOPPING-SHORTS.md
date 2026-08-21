# 쇼핑쇼츠 저장소에서 가져온 것 — 대본 교리와 성과 루프 (2026-08-21)

> ✅ **5개 전부 이식 완료 (2026-08-21).** 아래는 이제 「할 일」이 아니라 **어디에 무엇이
> 들어갔는지의 기록**이다. 현행 규칙은 `CLAUDE.md`와 `shared/doctrine.ts`가 정본이고,
> 이 문서와 어긋나면 코드가 이긴다.
>
> | 항목 | 들어간 자리 |
> |---|---|
> | 1. 교리 v3.3 | `.claude/skills/temcasting-v33/` · `shared/doctrine.ts` · `MENU_SKILL` · `MENU_A_RULES` · `TARGET_SEC_BY_MENU` 17~29초 |
> | 2. 음성=자막 | `doctrineErrors` 1번 검사 · QC 배점표 반전 · `check-script.ts` · menu-a 카드 차단(`assemble.ts`) |
> | 3. 성과 대장 | `store/metrics.ts` · `routes/metrics.ts` · `POST /jobs/:jid/publish` · 요청서의 「직전 편 훅」 |
> | 4. 훅 게이트 | `pipeline/hookGate.ts` · `settings.hookMotionMin`(기본 8) · 하네스 32단계 |
> | 5. 골든 케이스 | `shared/__fixtures__/published.json`(15편) · `shared/golden.test.ts` |
>
> **바꾼 것 중 원문과 다른 판단 두 가지 —**
> - `charBudget()`은 이름째 `syllableBudget()`으로 바꿨다. 음절로 세는 함수가 「char」라고
>   불리면 다음 사람이 다시 글자로 센다
> - 골든 케이스는 **글자만 보는 규칙**(`textStyleErrors`)으로만 돌린다. 옛 편들은 v3.3 이전
>   포맷이라 씬 쪼개는 방식이 달라서, 구조 검사까지 돌리면 전부 실격이 나와 아무것도 못 가른다
>
> **원장 편수 주의:** 이 문서는 「20편」이라 적었지만 스냅샷 원장의 데이터 행은 **18행**이고,
> 나레이션이 남아 있는 편은 **15편**이다. 4번의 훅 실측은 또 14편 전수다.

**원래 지시 (기록용):** 아래 5개를 순서대로 이 저장소에 반영한다. 1·2를 안 하면
나머지는 의미가 없다 — 이 앱은 **폐기된 대본 규칙으로 대본을 뽑고 있었다.**

원본 저장소: `C:\Users\chang\Desktop\쇼핑쇼츠` (같은 채널 **템캐스팅**, 같은 상품군).
결정적인 파일 3개는 `docs/from-shopping-shorts/`에 스냅샷으로 떠 뒀다.

| 파일 | 무엇 |
|---|---|
| `SCRIPT_FORMULA.md` | 템캐스팅 대본 교리 v3.3 — 5블록·음절 예산·훅 8종·실격 13개 |
| `check_script.py` | 그 실격 13개를 코드로 검사하는 게이트 |
| `_metrics.csv` | **근거.** 발행 20편의 조회수·계속시청·훅 변수 원장 |

---

## 왜 지금인가

두 저장소는 같은 채널을 만든다. 그런데 대본 규칙이 **정면으로 반대다.**

| 항목 | 쇼핑쇼츠 v3.3 (발행 20편 실측 기반) | 이 앱 (현재) |
|---|---|---|
| 자막 | **음성 = 자막, 글자 하나까지 같다** | **나레이션/자막 분리** — 같으면 QC 0점 |
| 2인칭 질문형 | **실격** | 훅 4유형 중 첫째 |
| 질문형 댓글 유도 | **금지**(광고 어법) | CTA 10점 |
| 스펙 숫자 발화 | **금지** | ③비트가 「숫자를 혜택으로」 |

근거는 인상이 아니라 원장이다. `_metrics.csv`에서 `아직도 힘들게 닦으세요?`로 연 편
(`wall-tile-sheet`)이 **563회 · 계속시청 12.4%**로 채널 최하위다. 반대로 금지 명령형
(`이제 양면테이프 쓰지 마세요` 계열)과 서사형 훅이 상위를 차지한다.

---

## 1. 🔴 대본 교리 v3.3 이식

### 고치는 자리

| 파일 | 무엇을 |
|---|---|
| `.claude/skills/shorts-direct-script/SKILL.md` | 본문을 v3.3 5블록으로 교체 (또는 새 스킬 `temcasting-v33`을 만들고 아래 상수를 그쪽으로) |
| `server/src/store/projects.ts` `MENU_SKILL` | menu-a 기본 지침을 그 스킬로 — **기본 지침은 여기 한 곳만 고친다** |
| `server/src/claude/scriptRules.ts` `scriptRuleErrors()` | 실격 13개를 menu 무관 규칙으로 추가 |
| `server/src/claude/packets.ts` `MENU_B_RULES` | 요청서에 실릴 문구 |
| `shared/constants.ts` `TARGET_SEC_BY_MENU` | menu-a를 **17~29초**(v3.3 러닝타임)로 |

### v3.3 요약 (전문은 `docs/from-shopping-shorts/SCRIPT_FORMULA.md`)

**5블록** — ① 훅(0~3초, 제품·브랜드·기능 언급 0) → ② 손실(금전·시간·신체) →
③ 정보원(선택) → ④ 제품+기능 → ⑤ 클로징.

**선행 구간(①②③)은 비율이 아니라 절대 초수다** — 17~19초는 5~8초, 20~23초는 8~12초,
24~26초는 12~16초. 상위 4편이 전부 선행 10~16초다.
**「선행을 잘라 제품을 빨리 꺼내는 게 유리하다」는 통념은 표본에서 지지되지 않는다.**

**예산은 글자수가 아니라 한글 음절수다**(공백·기호·영문·숫자 제외). 기준 **7.0 음절/초**
(6.5~8.0). 자막 1장 = 11~16음절 / 1.6~2.3초.

🔴 `charBudget()`이 지금 **글자수 × 배속**으로 센다. 음절 기준으로 바꾸지 않으면
같은 대본이 두 저장소에서 다른 판정을 받는다. `budget.test.ts`도 같이 움직인다.

### 스킬 본문을 바꿔도 기존 카테고리는 안 바뀐다

카테고리를 만들 때 그 시점 스킬 본문이 `guidelines/script.md`로 복사된다.
**이미 만든 카테고리는 화면에서 붙여넣거나 파일을 갈아야 한다.** 이식 후 반드시
`workspace/menu-a/*/guidelines/script.md`를 전부 갱신할 것.

---

## 2. 🔴 음성 = 자막으로 전환하고 QC 배점을 뒤집는다

v3.3의 첫 규칙이다. **나레이션과 화면 자막은 글자 하나까지 같다.**

- 자막에만 있는 정보 없음 → **스펙 칩을 쓰지 않는다**(`chips: []`)
- 음성에만 있는 정보 없음 → 전 문장이 자막으로 나간다. 발췌·요약 금지
- **말하지 않을 것은 화면에도 없다.** 스펙은 설명란·고정댓글로 뺀다

### 고치는 자리

| 파일 | 지금 | 바꿀 것 |
|---|---|---|
| `.claude/skills/shorts-script-qc/SKILL.md` 배점표 | 「나레이션/자막 분리 10점 · 동일 문장이면 0점」 | **「음성=자막 불일치면 즉시 반려」** |
| `.claude/skills/shorts-script-qc/scripts/check-script.ts` | 중복 검사 | **불일치 검사**로 반전 (mjs는 삭제) |
| `server/src/pipeline/subtitles.ts` | 자막을 따로 받는다 | 나레이션 원문에서 낱줄을 쪼갠다 |
| `server/src/pipeline/cards.ts` | 스펙 칩 렌더 | menu-a에서 끈다 |

검사식은 이렇다 (쇼핑쇼츠 `SKILL.md` S4에서 그대로 가져옴):

```python
said  = re.sub(r"[^가-힣0-9a-zA-Z]", "", x["text"])
shown = re.sub(r"[^가-힣0-9a-zA-Z]", "", "".join(모든_자막_낱줄))
assert said == shown
```

**자막 낱줄을 이어 붙이면 원문이 남는 것 없이 복원돼야 한다.** 「연속 부분문자열」보다 세다.

한 줄 상한은 실측값이다 — **훅 88px = 11음절, 본문 78px = 13음절.** 넘으면 두 줄로
감긴다(faucet-shelf 4차 수정에서 잡혔다).

---

## 3. 성과 대장 + 발행 후 판정 루프 (S8)

**이게 없으면 앱이 아무리 편해도 편수만 늘고 성적은 안 오른다.** 이 앱에는 남의 채널을
보는 리서치는 있어도 **내 편을 채점하는 자리가 없다.**

### 만들 것

1. `workspace/metrics.csv` — 컬럼은 `docs/from-shopping-shorts/_metrics.csv` 헤더 그대로.
   핵심은 `views · retained_pct · avg_view_pct · duration_sec · hook_seed · hook_delta ·
   title_form · note`
2. 잡 완료 시 `job.json`에 `videoId`·`publishedAt` 필드. 발행 후 사람이 채우거나
   업로드 킷에서 받는다
3. **발행 48시간 뒤** 유튜브 Analytics로 지표를 끌어와 그 행을 채운다 —
   OAuth 「내 채널 분석」이 이미 있으니 **편 단위로 붙이기만 하면 된다**
4. 새 잡을 만들 때 이 대장을 먼저 읽어 **직전 편과 훅 유형·인물이 겹치지 않게** 막는다

### 판정 규칙 (두 지표를 따로 읽는다)

| 지표 | 문턱 | 뜻 | 다음 편에서 |
|---|---|---|---|
| `retained_pct` (계속 시청함) | **< 20%** | **첫 2초 실패.** 대본은 용의자가 아니다 | 훅을 **제품이 크게 움직이는 구간**으로 교체 |
| `avg_view_pct` (평균 조회율) | 낮음 | 중반 이탈 | 대본 구조·러닝타임 |

두 개를 뭉뚱그리면 훅 문제를 대본 문제로 오진한다. 실제로 그렇게 헛짚은 적이 있다.

---

## 4. 훅 화면 변화량 게이트 — 렌더 전에 막는다

발행 14편 전수 실측(2026-08-20)에서 **「계속 시청함」과 상관이 있는 변수는 하나뿐이었다.**

```
0→0.5초 화면 변화량   r = +0.57   ← 유일하게 유효
첫 컷 길이            r = +0.18   근거 없음
훅 컷 수              r = -0.15   근거 없음
```

임계 **8**이 최적이다 — 통과 11편 중앙값 33.8%, 미달 3편 19.1%(**차이 14.7p**).
미달 3편이 정확히 계속시청 하위 3편이다.

⚠️ **첫 컷 길이로는 게이트를 걸지 마라.** 7편만 보고 r=+0.82로 판단해 걸었다가
14편 전수로 다시 재니 +0.18이었다. 표본이 작았고 상하위만 골라 본 선택 편향이었다.

원본은 `쇼핑쇼츠/remotion/scripts/studio.mjs`. 그대로 옮길 수 있는 함수다 —
조립 직전(`pipeline/assemble.ts`)에서 첫 컷에 걸고, 미달이면 **ERROR로 막는다.**

```js
// 클립 첫 0.5초의 화면 변화량. 두 프레임을 회색 원시 바이트로 뽑아 평균 절대차를 낸다.
const HOOK_FREEZE_MIN = 8;
const hookMotionDelta = (clipPath) => {
  const grab = (t) => {
    const r = spawnSync(ffmpeg,
      ['-nostdin', '-v', 'error', '-ss', String(t), '-i', clipPath, '-frames:v', '1',
       '-vf', 'scale=96:170', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
      { maxBuffer: 1 << 22 });
    return r.status === 0 && r.stdout?.length === 96 * 170 ? r.stdout : null;
  };
  const a = grab(0), b = grab(0.5);
  if (!a || !b) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
```

같이 오는 규칙 하나: **훅 자막은 0.0초에 떠야 한다.** 첫 프레임이 비면 스와이프가 나간다.

---

## 5. 실전 20편을 회귀 테스트로 넣는다

`npm run harness`는 **합성 영상**을 쓴다. 파이프라인이 도는지는 보지만
**결과물이 채널 기준에 맞는지는 못 본다.**

`docs/from-shopping-shorts/check_script.py`가 실격 13개를 검사한다.
이걸 `check-script.ts`로 옮기고, 발행 편들의 나레이션을 **골든 케이스**로 넣는다 —
상위 편은 통과, `wall-tile-sheet`(563회)는 **실격이 나와야** 한다. 검사기가 실제로
성적을 가르는지는 그렇게만 확인된다.

---

## 순서

```
1 → 2  (교리·자막. 여기까지가 필수다)
3      (대장. 다음 편부터 데이터가 쌓인다)
4 → 5  (게이트. 대장이 있어야 임계를 다시 잴 수 있다)
```

1·2를 하는 동안에는 **대본만 쇼핑쇼츠 저장소에서 쓰고 영상 처리를 이 앱에서 하는 것**이
차선이다. 편한 앱이 틀린 대본을 뽑는 지금 상태가 제일 나쁘다.

---

## 거꾸로: 이 앱이 이미 앞선 것 (2026-08-21 쇼핑쇼츠로 이식 완료)

참고로만 적는다. 아래 넷은 쇼핑쇼츠가 **이 저장소에서 가져갔다.**

| 이 앱의 원본 | 쇼핑쇼츠 |
|---|---|
| `server/src/sourcing/browserDownload.ts` + `browser.ts` | `scripts/fetch_tiktok.py` (Playwright 파이썬 포트) |
| `server/src/pipeline/ocrDetect.ts` + `tools/ocr/detect_text.py` | `scripts/detect_bands.py` |
| `server/src/pipeline/vsr.ts` `vsrAreaArgs()` 이모지 패딩 | 같은 파일에 병합 |
| — | `scripts/new_ep.sh` (편 폴더 부트스트랩) |

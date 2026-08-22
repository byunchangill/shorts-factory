# -*- coding: utf-8 -*-
"""S4 대본 게이트 — shotsheet.json 을 읽어 실격 조건을 전수 검사한다.

    PYTHONUTF8=1 python check_script.py                 # out/<slug>/ 에서
    PYTHONUTF8=1 python check_script.py --sheet path/to/shotsheet.json

**게이트를 열기 전에 반드시 돌린다.** 하나라도 걸리면 사용자에게 올리지 않는다.
종료 코드 0 = 통과, 1 = 실격.

검사 세 층 —
  ① 템캐스팅 v3.3 실격 13개 (SCRIPT_FORMULA.md)
  ② AI 티      어미가 단조로우면 낭독체가 된다 (magnetic-blind 반려 사유)
  ③ 힌트 유출   미스터리 구조에서 공개 전에 제품이 확정되면 안 된다
                (upper-cabinet-lift 에서 사용자가 네 번 잡아낸 결함)

②③ 은 2026-08-19~20 upper-cabinet-lift 편에서 얻은 것이다. 근거는 파일 끝 주석.
"""
import argparse
import json
import pathlib
import re
import sys

SPB_LO, SPB_HI = 6.5, 8.0
CAP_MAX = 16
RUN_MIN, RUN_MAX = 17, 29

# 공개 전에 나오면 시청자가 제품을 확정해 버리는 어휘.
# 편마다 다르므로 shotsheet._spoiler 로 덧붙일 수 있다.
SPOILER_BASE = ["찬장", "상부장", "수납장", "위 칸", "윗칸", "선반", "바스켓", "리프팅", "전동"]

BAD_QUESTION = re.compile(r"(하시나요|이신가요|하셨죠|고민이세요|세요\?|나요\?|가요\?)")
BAD_ADJ = ["꿀템", "역대급", "미친", "신박", "강추", "괴물", "끝판왕"]
BAD_AD = ["지금 바로", "놓치지", "이런 분들께 추천", "필수템"]
FEMALE = ["시어머니", "시누이", "시댁", "언니", "오빠", "남편"]
SPEC_NUM = re.compile(r"\d|cm|kg|센치|센티|킬로|밀리|인치")

# 종결어미 — 여기 안 걸리면 연결어미로 본다(문장이 이어진다는 뜻이라 낭독 리듬을 끊지 않는다)
ENDINGS = [
    "더라고요", "거든요", "습니다", "ㅂ니다", "니다", "려고요", "고요", "는데요",
    "어요", "아요", "여요", "예요", "에요", "죠", "네요", "군요", "잖아요",
]


def syl(s):
    return len(re.findall(r"[가-힣]", s))


def ending_of(text):
    """문장의 종결어미를 돌려준다. 연결어미로 끝나면 None."""
    t = re.sub(r"[^가-힣]+$", "", text.strip())
    for e in ENDINGS:
        if t.endswith(e):
            return e
    return None


def check(sheet):
    fail, warn = [], []
    nar = sheet.get("narration") or []
    if not nar:
        return ["narration 이 비어 있다"], []

    des = sheet.get("_설계") or {}
    run = float(des.get("러닝타임") or 0)
    lead = float(des.get("선행초") or 0)
    total_syl = sum(syl(n["text"]) for n in nar)
    if not run:
        run = total_syl / 7.0
    spb = total_syl / run if run else 0

    # ─────────── ① v3.3 실격 13개 ───────────
    if sheet.get("chips"):
        fail.append(f"chips 가 비어 있지 않다({len(sheet['chips'])}개) — v3.3 은 스펙 레일을 쓰지 않는다")

    for n in nar:
        said = re.sub(r"[^가-힣0-9a-zA-Z]", "", n["text"])
        shown = re.sub(r"[^가-힣0-9a-zA-Z]", "",
                       "".join(l.replace("*", "") for ch in n.get("caption_chunks", []) for l in ch))
        if said != shown:
            fail.append(f"i{n['i']} 음성≠자막\n      말: {said}\n      글: {shown}")
        for ch in n.get("caption_chunks", []):
            for l in ch:
                if syl(l) > CAP_MAX:
                    fail.append(f"i{n['i']} 자막 1장 {syl(l)}음절(상한 {CAP_MAX}): {l}")

    beats = [n.get("beat", "") for n in nar]
    if "loss" not in beats:
        fail.append("② 손실 블록이 없다 — 금전·시간·신체 중 하나는 있어야 한다")

    lo, hi = (5, 8) if run < 20 else ((8, 12) if run < 24 else (12, 16))
    if lead and not (lo <= lead <= hi):
        fail.append(f"선행 구간 {lead:.1f}초 — 러닝타임 {run:.1f}초면 {lo}~{hi}초여야 한다")

    hook_txt = " ".join(n["text"] for n in nar if n.get("beat") == "hook")
    spoil = SPOILER_BASE + (sheet.get("_spoiler") or [])
    hit = [w for w in spoil if w in hook_txt]
    if hit:
        fail.append(f"① 훅에 제품을 확정시키는 말이 있다: {hit}")

    allt = " ".join(n["text"] for n in nar)
    if BAD_QUESTION.search(allt):
        fail.append("2인칭 질문형 — 최하위작(시트지 12.4%)의 형태다. 명령형은 허용된다")
    for w in BAD_ADJ:
        if w in allt:
            fail.append(f"평가 형용사: {w}")
    for w in BAD_AD:
        if w in allt:
            fail.append(f"광고 어법: {w}")
    if SPEC_NUM.search(allt):
        bad = [n["text"] for n in nar if SPEC_NUM.search(n["text"])]
        fail.append(f"스펙 숫자를 발화한다 — 손실 금액·대기 시간·가격 감각만 허용: {bad}")
    for w in FEMALE:
        if w in allt:
            fail.append(f"여성 화자 호칭: {w} — 화자는 남자다")

    n_dr = allt.count("더라고요")
    if n_dr < 2:
        fail.append(f"~더라고요 {n_dr}회 — 편당 2회 이상(표본 9/10편)")
    elif n_dr > 3:
        warn.append(f"~더라고요 {n_dr}회 — 3회를 넘으면 그 어미 자체가 티가 난다")

    if not (RUN_MIN <= run <= RUN_MAX):
        fail.append(f"러닝타임 {run:.1f}초 — {RUN_MIN}~{RUN_MAX}초")
    if not (SPB_LO <= spb <= SPB_HI):
        fail.append(f"발화 속도 {spb:.2f}음절/초 — {SPB_LO}~{SPB_HI}. trim.sh 의 SPEED 로 맞춘다")

    # ─────────── ② AI 티 ───────────
    ends = [ending_of(n["text"]) for n in nar]
    dup = [nar[i]["i"] for i in range(1, len(ends)) if ends[i] and ends[i] == ends[i - 1]]
    if dup:
        fail.append(f"인접 문장이 같은 어미로 끝난다: i{dup} — 낭독체가 된다")
    runlen, cur = 1, 1
    for i in range(1, len(ends)):
        cur = cur + 1 if ends[i] and ends[i - 1] else 1
        runlen = max(runlen, cur)
    if runlen > 2:
        fail.append(f"종결어미가 {runlen}문장 연속이다 — 연결어미를 사이에 넣어 말이 흐르게 한다")
    kinds = len({e for e in ends if e})
    if kinds < 4:
        warn.append(f"어미 종류가 {kinds}가지뿐이다 — 문장마다 다르게 쓰면 사람 말이 된다")

    # ─────────── ③ 힌트 유출 ───────────
    reveal = next((k for k, n in enumerate(nar) if n.get("beat") == "product"), None)
    if reveal is not None:
        for n in nar[:reveal]:
            hit = [w for w in spoil if w in n["text"]]
            if hit:
                fail.append(
                    f"i{n['i']} 공개 전에 제품이 확정된다: {hit}\n"
                    f"      「{n['text']}」 — 손실·정보원 블록은 아직 제품이 없는 세계여야 한다"
                )
    return fail, warn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default=None)
    a = ap.parse_args()
    p = pathlib.Path(a.sheet) if a.sheet else pathlib.Path(__file__).parent / "shotsheet.json"
    if not p.exists():
        sys.exit(f"shotsheet 가 없다: {p}")
    sheet = json.loads(p.read_text(encoding="utf-8"))

    fail, warn = check(sheet)
    nar = sheet.get("narration") or []
    des = sheet.get("_설계") or {}
    tot = sum(syl(n["text"]) for n in nar)
    run = float(des.get("러닝타임") or 0) or tot / 7.0
    print(f"문장 {len(nar)} · {tot}음절 · {run:.2f}초 · {tot/run:.2f}음절/초 · "
          f"선행 {float(des.get('선행초') or 0):.2f}초\n")
    for w in warn:
        print(f"  ⚠️  {w}")
    for f in fail:
        print(f"  🔴 {f}")
    print()
    if fail:
        print(f"❌ 실격 {len(fail)}건 — 게이트를 열지 않는다. 고치고 다시 돌린다.")
        sys.exit(1)
    print(f"✅ 전항 통과{f' (경고 {len(warn)}건)' if warn else ''} — 게이트에 올려도 된다.")


if __name__ == "__main__":
    main()

# ─────────────────────────────────────────────────────────────────────────────
# 근거 (2026-08-19~20, upper-cabinet-lift)
#
# ② AI 티 — 1차본이 15문장 중 ~요 종결 6연속이라 낭독체였다. magnetic-blind 도 같은
#    이유로 「AI 티가 난다」며 반려됐다(종결어미가 전부 ~습니다/~더라고요로 균일).
#    연결어미와 종결어미를 번갈아 놓으면 말이 흐른다.
#
# ③ 힌트 유출 — 사용자가 네 번 잡아낸 결함이 전부 여기서 나왔다:
#    1. 「양념통 밭인데 / 위 칸은 손이 안 닿아서」 → 결과를 먼저 말하고 원인을 뒤에 붙여
#       「위 칸」이 설명 없이 튀어나왔다. 원인 → 결과 순서로 뒤집어야 한다.
#    2. 「찬장」이라고 하는 순간 시청자가 제품을 확정해 미스터리가 죽는다.
#       손실 블록은 아직 제품이 없는 세계여야 한다.
#    3. 처음 본 물건에 「진작 할걸」은 성립하지 않는다 — 클로징이 시점과 맞아야 한다.
#    4. ①에서 화자가 답을 이미 알면 ③의 발견이 연기로 읽힌다.
#    1·3·4 는 코드로 못 잡는다. SKILL.md 「대본 논리 4문」으로 사람이 확인한다.
#    2 만 여기서 어휘로 막는다.

"""
프레임에서 글자 상자를 찾아 한 줄에 하나씩 JSON으로 뱉는다.

서버가 이 스크립트를 파이썬으로 돌리고 표준출력을 읽는다. 이미지 경로는 인자가 아니라
**표준입력으로 한 줄에 하나씩** 받는다 — 프레임이 수백 장이면 명령줄 길이 상한에 걸린다.

모델은 한 번만 올린다. 프레임마다 프로세스를 새로 띄우면 0.2초 걸릴 일이 3초가 된다.

출력(한 줄에 한 프레임):
  {"file": "...", "boxes": [{"x":0,"y":0,"w":0,"h":0,"score":0.8,"text":"..."}]}
읽을 수 없는 프레임은 boxes를 비우고 error를 담아 넘어간다 — 한 장 때문에 전체가 죽지 않는다.
"""
import json
import sys

# 한국어 윈도우 콘솔은 cp949라 중국어 자막을 찍는 순간 죽는다 (iopaint에서 겪은 그 문제)
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    print(json.dumps({"fatal": "rapidocr-onnxruntime 없음"}), flush=True)
    sys.exit(3)


def main() -> int:
    engine = RapidOCR()
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            result, _ = engine(path)
            boxes = []
            for item in result or []:
                pts, text, score = item[0], item[1], item[2]
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                boxes.append({
                    "x": round(min(xs)),
                    "y": round(min(ys)),
                    "w": round(max(xs) - min(xs)),
                    "h": round(max(ys) - min(ys)),
                    "score": round(float(score), 3),
                    "text": text,
                })
            print(json.dumps({"file": path, "boxes": boxes}, ensure_ascii=False), flush=True)
        except Exception as e:  # noqa: BLE001 - 한 장의 실패로 전체를 포기하지 않는다
            print(json.dumps({"file": path, "boxes": [], "error": str(e)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

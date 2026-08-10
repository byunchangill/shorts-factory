# AI 인페인팅 (2차 워터마크 제거) 설치 가이드

1차 제거(ffmpeg 크롭/블러/보간)는 별도 설치 없이 동작합니다.
2차 제거는 자막/워터마크를 지우고 배경을 AI로 복원하는 방식으로, IOPaint(LaMa 모델)를 사용합니다.

## 설치

```bash
# Python 3.10+ 필요. 가상환경 권장:
python -m venv .venv-inpaint
# Windows: .venv-inpaint\Scripts\activate
# macOS/Linux:
source .venv-inpaint/bin/activate

pip install iopaint
iopaint --version   # 확인
```

가상환경을 쓴 경우, 웹앱 설정 화면에서 `iopaint` 경로를
`.venv-inpaint/bin/iopaint` (Windows: `.venv-inpaint\Scripts\iopaint.exe`)로 지정하세요.

## GPU 가속 (선택)

기본은 CPU로 동작합니다(느리지만 확실). NVIDIA GPU가 있으면:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

이후 `server/src/pipeline/inpaint.ts`의 `--device=cpu`를 `--device=cuda`로 바꾸거나,
설정에서 디바이스 옵션이 추가되면 그쪽을 사용하세요.

## 동작 방식

영상 → 프레임 추출 → 존(영역)으로 마스크 생성 → 프레임별 인페인팅 → 원본 오디오와 재인코딩.
1분 영상(30fps) 기준 CPU에서 수십 분이 걸릴 수 있으므로, 짧은 클립에만 사용하는 것을 권장합니다.
움직이는 워터마크는 결과가 고르지 않을 수 있습니다 — 이 경우 1차 블러가 더 안정적입니다.

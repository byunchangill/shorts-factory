# AI 인페인팅 (2차 워터마크 제거) 설치 가이드

1차 제거(ffmpeg 크롭/보간)는 별도 설치 없이 동작합니다.
2차 제거는 자막·워터마크를 지우고 배경을 AI로 복원합니다. **두 가지가 있고 VSR이 먼저입니다.**

| 순위 | 도구 | 마스크를 누가 만드나 |
|---:|---|---|
| 1 | **VSR** (video-subtitle-remover) | 넘긴 영역 **안에서 제 OCR이 찾은 글자만** 지운다 |
| 2 | IOPaint (LaMa) | 존 사각형을 통째로 흰색으로 칠해 그 영역을 전부 지운다 |

둘 다 없으면 1차 제거만으로 우아하게 내려갑니다.

## VSR 설치 (권장)

[YaoFANGUK/video-subtitle-remover](https://github.com/YaoFANGUK/video-subtitle-remover)를
받아 가상환경을 만들고, 웹앱 **설정 → VSR**에 저장소 폴더를 적습니다.
파이썬 칸을 비우면 저장소 안의 `.venv\Scripts\python.exe`를 씁니다.

**모드는 `lama`가 기본입니다.** 이 PC(Intel Iris Xe · NVIDIA 없음) 실측 — 576×1024 3초 기준
STTN은 9분 18초에 얼룩 띠가 남았고, LaMa는 3분 53초에 자국이 거의 안 보였습니다.

설치할 때 걸리는 것:

- 저장소 코드가 **Python 3.12 문법**을 씁니다. 3.11이면
  `backend/inpaint/sttn_auto_inpaint.py` 한 줄을 고쳐야 임포트가 됩니다
- STTN 모드를 쓸 거라면 `config/config.json`의 `Sttn.MaxLoadNum`을 20으로 낮춥니다 —
  기본값(50)이 DirectML에서 빈 `RuntimeError`로 죽고 262바이트 파일만 남습니다
- OCR 기본값 `PP_OCRv5_SERVER`는 CPU에서 소스당 15분입니다.
  `SubtitleDetectMode`를 `PP_OCRv5_MOBILE`로 내리면 1분이고, 우리 용도에서 품질 차이가
  안 보였습니다
- **반투명 자막은 VSR이 못 잡습니다.** 상단·하단 밴드면 크롭이 답입니다
- **♪ 로고와 이모지는 안 지워집니다** — OCR이 글자만 찾습니다.
  로고가 벽·상판 경계에 걸치면 지우려 들지 말고 컷 구간을 0.2~0.5초 미세요

## IOPaint 설치

Python 3.12를 먼저 깝니다 (3.13은 PyTorch 지원이 아직 안 따라온 경우가 있습니다).

```bash
# Windows: winget install Python.Python.3.12
pip install iopaint
iopaint --help   # 확인 (--version 이 없는 버전이 있다)
```

**그냥 전역에 까세요.** PATH에 잡히므로 앱이 알아서 찾고, 설정에서 경로를 건드릴 일이
없습니다. PyTorch가 딸려 와 2GB 넘게 받으니 시간이 걸립니다.

### 가상환경에 깔았다면

격리가 필요한 장비(회사 PC 등)에서 venv를 썼다면 PATH에 없으므로,
웹앱 **설정 → 도구 경로**의 `iopaint` 칸에 실행 파일 경로를 직접 넣어야 합니다.

```
Windows: <리포>\.venv-inpaint\Scripts\iopaint.exe
macOS/Linux: <리포>/.venv-inpaint/bin/iopaint
```

이 값은 `workspace/settings.json`에 저장되고 깃에 올라가지 않으므로 **기계마다 따로** 넣어야 합니다.
그래서 특별한 이유가 없으면 전역 설치가 편합니다.

## GPU 가속 (선택)

기본은 CPU로 동작합니다(느리지만 확실). NVIDIA GPU가 있으면:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

이후 `server/src/pipeline/inpaint.ts`의 `--device=cpu`를 `--device=cuda`로 바꾸거나,
설정에서 디바이스 옵션이 추가되면 그쪽을 사용하세요.

## 동작 방식

영상 → 프레임 추출 → 존(영역)으로 마스크 생성 → **존 구간에 걸린 프레임만** 인페인팅 →
나머지 프레임과 합쳐 원본 오디오와 재인코딩.

**존에 구간(t0~t1)을 넣으면 그만큼만 처리합니다.** CPU에서 576×1024 한 장에 약 3~5초라
구간을 안 넣으면 75초 클립이 20시간이 됩니다 — 4초짜리 자막이면 121장, 16분입니다 (실측).
"구간 자동 찾기"로 구간을 채운 뒤 돌리세요.

움직이는 워터마크는 결과가 고르지 않을 수 있습니다 — 이 경우 1차 블러가 더 안정적입니다.

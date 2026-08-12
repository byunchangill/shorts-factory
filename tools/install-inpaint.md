# AI 인페인팅 (2차 워터마크 제거) 설치 가이드

1차 제거(ffmpeg 크롭/블러/보간)는 별도 설치 없이 동작합니다.
2차 제거는 자막/워터마크를 지우고 배경을 AI로 복원하는 방식으로, IOPaint(LaMa 모델)를 사용합니다.

## 설치

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

영상 → 프레임 추출 → 존(영역)으로 마스크 생성 → 프레임별 인페인팅 → 원본 오디오와 재인코딩.
1분 영상(30fps) 기준 CPU에서 수십 분이 걸릴 수 있으므로, 짧은 클립에만 사용하는 것을 권장합니다.
움직이는 워터마크는 결과가 고르지 않을 수 있습니다 — 이 경우 1차 블러가 더 안정적입니다.

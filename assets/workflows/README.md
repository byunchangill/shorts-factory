# ComfyUI 워크플로우 안내

## 파일 목록

| 파일 | 타입 | 권장 체크포인트 |
|------|------|----------------|
| `dog_style_workflow.json` | 강아지 | dreamshaper_8.safetensors |
| `sseoltoon_workflow.json` | 썰툰 | flat2DAnimerge_v45Sharp.safetensors |
| `health_infographic_workflow.json` | 건강 | deliberate_v6.safetensors |

## 체크포인트 다운로드

모든 파일은 **Civitai** (https://civitai.com) 또는 **HuggingFace**에서 다운로드.
다운로드 후 ComfyUI 설치 폴더의 `models/checkpoints/` 에 배치.

```bash
# ComfyUI 폴더 구조
ComfyUI/
├── models/
│   ├── checkpoints/         ← .safetensors 파일
│   ├── loras/               ← LoRA 파일
│   ├── vae/                 ← VAE 파일
│   └── upscale_models/      ← RealESRGAN 등
```

## 프롬프트 치환 방법

워크플로우 JSON에서 `__POSITIVE_PROMPT__`와 `__NEGATIVE_PROMPT__`를
`image-generator.ts`의 `buildComfyUIRequest()` 함수에서 실제 프롬프트로 치환합니다.

```typescript
// 예시 (image-generator.ts 내)
const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'));
workflow['6'].inputs.text = positivePrompt;
workflow['7'].inputs.text = negativePrompt;
workflow['3'].inputs.seed = seed;
```

## IP-Adapter 설치 (강아지 일관성)

```bash
cd ComfyUI/custom_nodes/
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git
# 이후 ComfyUI 재시작
```

## ComfyUI 로컬 실행 확인

```bash
# ComfyUI 실행
cd ~/ComfyUI && python main.py --listen 0.0.0.0 --port 8188

# 연결 테스트
curl http://127.0.0.1:8188/system_stats
```

`config/.env`의 `COMFYUI_URL=http://127.0.0.1:8188` 와 일치해야 합니다.

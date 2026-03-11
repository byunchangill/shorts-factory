# 폰트 에셋 안내

## 필요한 폰트 파일

tts-sync.ts의 FFmpeg 자막 렌더링에서 아래 폰트 파일을 참조합니다.

### NanumSquareRoundB.ttf (필수)
- **용도**: 강아지·건강 쇼츠 기본 자막 폰트
- **라이선스**: SIL Open Font License (무료, 상업적 사용 가능)
- **다운로드**: https://hangeul.naver.com/font/nanum
  - "나눔스퀘어라운드" 검색 → Bold 다운로드
- **설치 경로**: `assets/fonts/NanumSquareRoundB.ttf`

### NanumGothicBold.ttf (썰툰용, 선택)
- **용도**: 썰툰 자막 폰트 (웹툰 느낌)
- **라이선스**: SIL Open Font License (무료)
- **다운로드**: https://hangeul.naver.com/font/nanum
- **설치 경로**: `assets/fonts/NanumGothicBold.ttf`

### 구글 폰트 대안 (자동 다운로드 가능)
```bash
# Nanum Square Round (Bold)
curl -L "https://fonts.gstatic.com/s/nanumsquareround/v10/zhkJ0PFkJYGAmAotGqpvn7ZBIYvgqE6uyZHtPA.woff2" \
     -o assets/fonts/NanumSquareRoundB.ttf
```

## 폰트 설정 위치

`src/types/config.ts`의 `VOICE_SETTINGS` 또는
`src/skills/tts-sync.ts`의 FFmpeg drawtext 필터에서 참조:

```
fontfile=assets/fonts/NanumSquareRoundB.ttf
```

## 폰트 없을 때 Fallback

폰트 파일이 없으면 tts-sync.ts는 시스템 기본 폰트로 대체합니다.
한국어 자막이 깨질 수 있으므로 반드시 설치를 권장합니다.

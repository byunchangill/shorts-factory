# BGM 에셋 안내

## 필요한 BGM 파일

tts-sync.ts의 FFmpeg BGM 믹싱에서 아래 파일을 참조합니다.
모두 **상업적 이용 가능 + 저작권 Free** 소스에서 구해야 합니다.

---

## 파일 목록

### 강아지 쇼츠 — emotional-piano.mp3
- **분위기**: 따뜻하고 감동적인 피아노 또는 어쿠스틱 기타
- **BPM**: 60~80
- **길이**: 60초 이상 (루프 가능)
- **볼륨**: 나레이션 대비 -20dB (tts-sync.ts 기본값)
- **추천 소스**:
  - Pixabay Music: https://pixabay.com/music/ → "emotional piano" 검색
  - Free Music Archive: https://freemusicarchive.org/

### 썰툰 — suspense-beat.mp3
- **분위기**: 긴장감 있는 서스펜스, 반전 가능한 비트
- **BPM**: 90~110
- **길이**: 75초 이상
- **볼륨**: 나레이션 대비 -18dB
- **추천 소스**:
  - Pixabay Music: "suspense background" 검색
  - Bensound: https://www.bensound.com/ (Attribution 필요)

### 건강 쇼츠 — calm-corporate.mp3
- **분위기**: 차분하고 신뢰감 있는 코퍼레이트 스타일
- **BPM**: 75~90
- **길이**: 65초 이상
- **볼륨**: 나레이션 대비 -22dB
- **추천 소스**:
  - Pixabay Music: "corporate calm" 검색
  - YouTube Audio Library: https://studio.youtube.com/channel/UC.../music

---

## 라이선스 요건

| 소스 | 상업 가능 | 출처 표기 |
|------|-----------|-----------|
| Pixabay Music | ✅ | 불필요 |
| YouTube Audio Library | ✅ | 불필요 (CC0) |
| Free Music Archive | ✅ (CC0만) | 라이선스 확인 필요 |
| Bensound | 일부 유료 | Attribution 필요 |

---

## 설치 스크립트 (Pixabay 예시)

```bash
# Pixabay에서 수동 다운로드 후:
mv ~/Downloads/emotional-piano.mp3 assets/bgm/emotional-piano.mp3
mv ~/Downloads/suspense-beat.mp3 assets/bgm/suspense-beat.mp3
mv ~/Downloads/calm-corporate.mp3 assets/bgm/calm-corporate.mp3
```

## BGM 없을 때 Fallback

`src/types/config.ts`의 `BGM_SETTINGS`에서 `enabled: false`로 설정하면
BGM 없이 나레이션만 출력합니다.

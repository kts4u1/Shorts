# Shorts 테스트: 문어의 놀라운 비밀 4가지 🐙

유튜브 쇼츠용 **30초 세로형(1080×1920, 30fps)** 테스트 영상입니다.
그림·애니메이션·음악·효과음·나레이션 모두 코드와 오픈 모델로 직접 생성했습니다.

| 파일 | 내용 |
|---|---|
| [`output/octopus_short_2d_voice.mp4`](output/octopus_short_2d_voice.mp4) | **2D 애니메이션 + 나레이션** |
| [`output/octopus_short_3d.mp4`](output/octopus_short_3d.mp4) | **3D 애니메이션 + 나레이션** |
| [`output/octopus_short.mp4`](output/octopus_short.mp4) | 2D 애니메이션 (나레이션 없는 첫 버전) |

## 구성 (30초)

| 구간 | 내용 | 나레이션 |
|---|---|---|
| 0.0–3.6s | 훅 | "문어의 심장은 몇 개일까요?" |
| 3.6–10.2s | 사실 1: 심장 3개 | "정답은 세 개! 두 개는 아가미로, 하나는 온몸으로 피를 보내요." |
| 10.2–16.6s | 사실 2: 파란 피 | "게다가 피는 파란색이에요! 철 대신 구리로 산소를 나르거든요." |
| 16.6–22.6s | 사실 3: 헤엄칠 땐 심장 멈춤 | "헤엄칠 땐 심장 하나가 멈춰서 금방 지쳐요. 그래서 기어다니는 걸 더 좋아하죠." |
| 22.6–27.6s | 사실 4: 뉴런의 2/3가 다리에 | "뉴런의 삼분의 이가 다리에 있어요. 덕분에 다리가 스스로 맛보고 판단해요." |
| 27.6–30.0s | 아웃트로 | "신기하죠? 구독하고 또 만나요!" |

## 어떻게 만들었나

- **2D:** `src/render.py` — pycairo 벡터 드로잉으로 프레임을 그려 ffmpeg 로 인코딩
- **3D:** `3d/scene.js` — three.js 장면(문어, 모래 바닥, 물결 빛 무늬, 해초, 산호, 물고기, 3D 하트/핏방울/원그래프)을
  헤드리스 Chromium 에서 렌더링 → `src/composite3d.py` 가 2D 버전과 같은 자막/UI 를 합성
  - 문어 동작·표정·소품 타이밍은 `src/scene3d_state.py` 가 2D 와 같은 계산으로 넘겨주므로 두 버전이 똑같이 움직임
- **나레이션:** `src/narration.py` — [Supertone Supertonic](https://huggingface.co/Supertone/supertonic-3) 한국어 TTS(로컬 ONNX, OpenRAIL-M 라이선스)
  - 목소리 F2(밝고 어린 느낌의 경쾌한 여성 톤), 기본 속도 1.0 — `F2:0.75+F5:0.25` 처럼 여러 목소리를 섞을 수도 있음
  - 대사마다 여러 번 합성해 자동 검사 후 선택: Whisper 받아쓰기(발음/누락), 끝 잘림, 말 도중 순간 끊김(드롭아웃)
  - 후처리로 날카로운 대역(2.5~4.5kHz, `--presence-db`)과 고역(`--shelf-db`)을 완만히 줄이고 치찰음(ㅅ·ㅆ·ㅊ)을 동적으로 감소
- **음악/효과음:** `src/audio.py` — numpy 로 합성, 나레이션이 나올 때 음악·효과음을 자동으로 줄임(더킹), 찌그러짐 없는 리미터로 마무리(약 -15 LUFS)
- **공용 타임라인:** `src/timeline.py` — 장면, 나레이션, 효과음 타이밍

## 다시 만들기

```bash
sudo apt-get install -y ffmpeg fonts-nanum
pip install -r requirements.txt
./make_short.sh          # 2D + 3D (2d / 3d 인자로 하나만 가능)
```

다른 목소리로 바꾸기 (F1–F5 여성, M1–M5 남성, 기본 F2):

```bash
python3 src/narration.py --voice "F2:0.75+F5:0.25" --out build/narration.wav && ./make_short.sh
```

미리 보기:

```bash
python3 src/render.py --preview 2.5,7.5,18.3 --preview-dir build/preview
```

## 업로드용 메타데이터 예시

- **제목:** 문어 심장이 3개라고?! 🐙 알면 신기한 문어의 비밀 #shorts
- **설명:**
  문어는 심장이 3개, 피는 파란색! 헤엄칠 땐 심장 하나가 멈추고, 뇌세포의 2/3는 다리에 있어요.
  더 신기한 바다 이야기가 궁금하다면 구독!
- **해시태그:** #shorts #문어 #바다상식 #동물상식 #신기한사실

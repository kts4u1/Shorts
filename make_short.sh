#!/usr/bin/env bash
# 쇼츠 영상 빌드
#   ./make_short.sh          전부 (문어 2D/3D + 해달 + 해파리 + 해마 + 바다거북 + 상어 2D/3D + 불가사리 3D)
#   ./make_short.sh 2d       문어 편 2D
#   ./make_short.sh 3d       문어 편 3D
#   ./make_short.sh otter    해달 편 3D
#   ./make_short.sh jelly    해파리 편 3D
#   ./make_short.sh seahorse 해마 편 3D
#   ./make_short.sh turtle   바다거북 편 3D
#   ./make_short.sh shark    상어 편 3D
#   ./make_short.sh shark2d  상어 편 2D
#   ./make_short.sh starfish 불가사리 편 3D
# 필요: python3, node 18+, ffmpeg, Chromium(Playwright), 나눔폰트(fonts-nanum), pip install -r requirements.txt
set -euo pipefail
cd "$(dirname "$0")"
what="${1:-all}"

octopus_audio() {
  [ -f build/narration.wav ] || python3 src/narration.py --out build/narration.wav
  python3 src/audio.py build/audio_vo.wav --narration build/narration.wav
}

if [ "$what" = all ] || [ "$what" = 2d ] || [ "$what" = 3d ]; then
  octopus_audio
fi

# 문어 편 2D
if [ "$what" = all ] || [ "$what" = 2d ]; then
  python3 src/render.py --audio build/audio_vo.wav --out output/octopus_short_2d_voice.mp4
fi

# 문어 편 3D: 상태 덤프 -> three.js 렌더 -> 자막 합성
if [ "$what" = all ] || [ "$what" = 3d ]; then
  (cd 3d && npm install --silent)
  python3 src/scene3d_state.py build/states3d.json
  node 3d/render3d.cjs --states build/states3d.json --out build/frames3d --workers 3
  python3 src/composite3d.py --frames build/frames3d --audio build/audio_vo.wav --out output/octopus_short_3d.mp4
fi

# 해달 편 3D
if [ "$what" = all ] || [ "$what" = otter ]; then
  mkdir -p build/otter
  [ -f build/otter/narration.wav ] || python3 src/narration.py --timeline otter/timeline.py --out build/otter/narration.wav
  python3 src/audio.py build/otter/audio.wav --narration build/otter/narration.wav --timeline otter/timeline.py
  (cd 3d && npm install --silent)
  python3 otter/states.py build/otter/states.json
  node 3d/render3d.cjs --root otter --states build/otter/states.json --out build/otter/frames --workers 3
  python3 src/composite3d.py --frames build/otter/frames --overlay otter/overlay.py \
    --audio build/otter/audio.wav --out output/otter_short_3d.mp4
fi

# 해파리 편 3D
if [ "$what" = all ] || [ "$what" = jelly ]; then
  mkdir -p build/jelly
  [ -f build/jelly/narration.wav ] || python3 src/narration.py --timeline jelly/timeline.py --out build/jelly/narration.wav
  python3 src/audio.py build/jelly/audio.wav --narration build/jelly/narration.wav --timeline jelly/timeline.py
  (cd 3d && npm install --silent)
  python3 jelly/states.py build/jelly/states.json
  node 3d/render3d.cjs --root jelly --states build/jelly/states.json --out build/jelly/frames --workers 3
  python3 src/composite3d.py --frames build/jelly/frames --overlay jelly/overlay.py \
    --audio build/jelly/audio.wav --out output/jelly_short_3d.mp4
fi

# 해마 편 3D
if [ "$what" = all ] || [ "$what" = seahorse ]; then
  mkdir -p build/seahorse
  [ -f build/seahorse/narration.wav ] || python3 src/narration.py --timeline seahorse/timeline.py --out build/seahorse/narration.wav
  python3 src/audio.py build/seahorse/audio.wav --narration build/seahorse/narration.wav --timeline seahorse/timeline.py
  (cd 3d && npm install --silent)
  python3 seahorse/states.py build/seahorse/states.json
  node 3d/render3d.cjs --root seahorse --states build/seahorse/states.json --out build/seahorse/frames --workers 3
  python3 src/composite3d.py --frames build/seahorse/frames --overlay seahorse/overlay.py \
    --audio build/seahorse/audio.wav --out output/seahorse_short_3d.mp4
fi

# 바다거북 편 3D
if [ "$what" = all ] || [ "$what" = turtle ]; then
  mkdir -p build/turtle
  [ -f build/turtle/narration.wav ] || python3 src/narration.py --timeline turtle/timeline.py --out build/turtle/narration.wav
  python3 src/audio.py build/turtle/audio.wav --narration build/turtle/narration.wav --timeline turtle/timeline.py
  (cd 3d && npm install --silent)
  python3 turtle/states.py build/turtle/states.json
  node 3d/render3d.cjs --root turtle --states build/turtle/states.json --out build/turtle/frames --workers 3
  python3 src/composite3d.py --frames build/turtle/frames --overlay turtle/overlay.py \
    --audio build/turtle/audio.wav --out output/turtle_short_3d.mp4
fi

# 상어 편 3D
if [ "$what" = all ] || [ "$what" = shark ]; then
  mkdir -p build/shark
  [ -f build/shark/narration.wav ] || python3 src/narration.py --timeline shark/timeline.py --out build/shark/narration.wav
  python3 src/audio.py build/shark/audio.wav --narration build/shark/narration.wav --timeline shark/timeline.py
  (cd 3d && npm install --silent)
  python3 shark/states.py build/shark/states.json
  node 3d/render3d.cjs --root shark --states build/shark/states.json --out build/shark/frames --workers 3
  python3 src/composite3d.py --frames build/shark/frames --overlay shark/overlay.py \
    --audio build/shark/audio.wav --out output/shark_short_3d.mp4
fi

# 상어 편 2D (3D 편과 같은 나레이션·효과음·자막)
if [ "$what" = all ] || [ "$what" = shark2d ]; then
  mkdir -p build/shark
  [ -f build/shark/narration.wav ] || python3 src/narration.py --timeline shark/timeline.py --out build/shark/narration.wav
  [ -f build/shark/audio.wav ] || python3 src/audio.py build/shark/audio.wav --narration build/shark/narration.wav --timeline shark/timeline.py
  python3 shark/render2d.py --audio build/shark/audio.wav --out output/shark_short_2d.mp4
fi

# 불가사리 편 3D
if [ "$what" = all ] || [ "$what" = starfish ]; then
  mkdir -p build/starfish
  [ -f build/starfish/narration.wav ] || python3 src/narration.py --timeline starfish/timeline.py --out build/starfish/narration.wav
  python3 src/audio.py build/starfish/audio.wav --narration build/starfish/narration.wav --timeline starfish/timeline.py
  (cd 3d && npm install --silent)
  python3 starfish/states.py build/starfish/states.json
  node 3d/render3d.cjs --root starfish --states build/starfish/states.json --out build/starfish/frames --workers 3
  python3 src/composite3d.py --frames build/starfish/frames --overlay starfish/overlay.py \
    --audio build/starfish/audio.wav --out output/starfish_short_3d.mp4
fi

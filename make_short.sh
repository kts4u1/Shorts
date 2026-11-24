#!/usr/bin/env bash
# 쇼츠 영상 빌드
#   ./make_short.sh          전부 (문어 2D + 문어 3D + 해달 3D + 해파리 3D + 해마 3D)
#   ./make_short.sh 2d       문어 편 2D
#   ./make_short.sh 3d       문어 편 3D
#   ./make_short.sh otter    해달 편 3D
#   ./make_short.sh jelly    해파리 편 3D
#   ./make_short.sh seahorse 해마 편 3D
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

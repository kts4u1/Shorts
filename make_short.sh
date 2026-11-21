#!/usr/bin/env bash
# 쇼츠 영상 전체 빌드
#   ./make_short.sh        2D + 3D 모두
#   ./make_short.sh 2d     2D 만
#   ./make_short.sh 3d     3D 만
# 필요: python3, node 18+, ffmpeg, Chromium(Playwright), 나눔폰트(fonts-nanum), pip install -r requirements.txt
set -euo pipefail
cd "$(dirname "$0")"
what="${1:-all}"

# 1) 나레이션(TTS) + 음악/효과음 믹스
[ -f build/narration.wav ] || python3 src/narration.py --voice F2 --out build/narration.wav
python3 src/audio.py build/audio_vo.wav --narration build/narration.wav

# 2) 2D 버전
if [ "$what" = all ] || [ "$what" = 2d ]; then
  python3 src/render.py --audio build/audio_vo.wav --out output/octopus_short_2d_voice.mp4
fi

# 3) 3D 버전: 상태 덤프 -> three.js 렌더 -> 자막 합성
if [ "$what" = all ] || [ "$what" = 3d ]; then
  (cd 3d && npm install --silent)
  python3 src/scene3d_state.py build/states3d.json
  node 3d/render3d.cjs --states build/states3d.json --out build/frames3d --workers 3
  python3 src/composite3d.py --frames build/frames3d --audio build/audio_vo.wav --out output/octopus_short_3d.mp4
fi

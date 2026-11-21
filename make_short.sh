#!/usr/bin/env bash
# 쇼츠 영상 전체 빌드: 오디오 합성 -> 프레임 렌더링 + 인코딩
# 필요: python3, ffmpeg, 나눔스퀘어라운드 폰트(fonts-nanum), pip install -r requirements.txt
set -euo pipefail
cd "$(dirname "$0")"
python3 src/audio.py build/audio.wav
python3 src/render.py --audio build/audio.wav --out output/octopus_short.mp4

#!/usr/bin/env python3
"""3D 렌더러에 넘길 프레임 목록(시각 + 연출 큐)을 JSON 으로 저장.

사용법: python3 turtle/states.py build/turtle/states.json [--times 1.5,5.0]
"""
import argparse
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("turtle_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)

ap = argparse.ArgumentParser()
ap.add_argument("out", nargs="?", default="build/turtle/states.json")
ap.add_argument("--times", default=None)
args = ap.parse_args()
if args.times:
    frames = [{"index": round(float(s) * T.FPS), "t": round(float(s) * T.FPS) / T.FPS, "cues": T.CUES} for s in args.times.split(",")]
else:
    n = int(round(T.DURATION * T.FPS))
    frames = [{"index": i, "t": i / T.FPS, "cues": T.CUES} for i in range(n)]
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
with open(args.out, "w") as f:
    json.dump(frames, f)
print(f"{len(frames)} 프레임 상태 저장: {args.out}")

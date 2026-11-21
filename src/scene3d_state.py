#!/usr/bin/env python3
"""3D 렌더러(three.js)에 넘길 프레임별 상태를 JSON 으로 저장.

2D 버전과 같은 타임라인/애니메이션 계산(render.py)을 그대로 써서
3D 영상도 나레이션·자막과 정확히 같은 타이밍으로 움직이게 한다.

사용법: python3 src/scene3d_state.py build/states3d.json [--times 1.0,5.5]
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as R  # noqa: E402
from timeline import FPS, DURATION  # noqa: E402


def frame_state(t):
    st = R.octo_state(t)
    bt = (t + 0.7) % 3.3
    openness = 1.0 if bt >= 0.14 else max(0.08, 1 - math.sin(math.pi * bt / 0.14))
    octo = {k: (list(v) if isinstance(v, tuple) else v) for k, v in st.items()}
    octo["open"] = openness

    q_al, q_sc = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    props = {
        "q": {"s": q_sc * min(1.0, q_al * 1.5), "y": 845 + 14 * math.sin(t * 4),
              "rot": 0.14 * math.sin(t * 3.1)},
        "hearts": R.hearts_layout(t),
        "blood": R.blood_layout(t),
        "pie": R.pie_layout(t),
    }
    return {"t": t, "octo": octo, "floor_shift": R.floor_shift(t), "props": props}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="build/states3d.json")
    ap.add_argument("--times", default=None, help="특정 시각만 (미리보기용)")
    args = ap.parse_args()
    if args.times:
        frames = [frame_state(float(x)) for x in args.times.split(",")]
        for i, f in enumerate(frames):
            f["index"] = i
    else:
        n = int(round(DURATION * FPS))
        frames = []
        for i in range(n):
            f = frame_state(i / FPS)
            f["index"] = i
            frames.append(f)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(frames, fp, ensure_ascii=False)
    print(f"{len(frames)} 프레임 상태 저장: {args.out}")


if __name__ == "__main__":
    main()

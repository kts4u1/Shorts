#!/usr/bin/env python3
"""3D 렌더 프레임 위에 자막/UI(2D 버전과 같은 코드)를 합성해 mp4 로 인코딩.

사용법:
  python3 src/composite3d.py --frames build/frames3d --audio build/audio_vo.wav --out output/octopus_short_3d.mp4
  python3 src/composite3d.py --frames <dir> --preview 2.5,7.5 --preview-dir build/preview3d
"""
import argparse
import json
import math
import os
import subprocess
import sys
from multiprocessing import Pool

import cairo
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as R  # noqa: E402
from timeline import W, H, FPS, DURATION  # noqa: E402

FRAMES = None


def load_frame(idx):
    for ext in ("jpg", "png"):
        p = os.path.join(FRAMES, f"f_{idx:04d}.{ext}")
        if os.path.exists(p):
            im = Image.open(p).convert("RGBA")
            data = bytearray(im.tobytes("raw", "BGRA"))
            surf = cairo.ImageSurface.create_for_data(data, cairo.FORMAT_ARGB32, W, H, W * 4)
            anchors = {}
            ap = os.path.join(FRAMES, f"a_{idx:04d}.json")
            if os.path.exists(ap):
                with open(ap) as f:
                    anchors = json.load(f)
            return surf, data, anchors
    raise FileNotFoundError(f"frame {idx} not found in {FRAMES}")


def draw_vignette(ctx):
    rg = cairo.RadialGradient(540, 900, 520, 540, 960, 1250)
    rg.add_color_stop_rgba(0, 0, 0, 0, 0)
    rg.add_color_stop_rgba(1, 0, 0, 0.08, 0.35)
    ctx.set_source(rg)
    ctx.paint()


def draw_hook_sparkles(ctx, t):
    al, _ = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    if al <= 0:
        return
    for k in range(3):
        a = R.prog(t, 1.1 + k * 0.15, 1.4 + k * 0.15) * al
        if a <= 0:
            continue
        ang = -2.3 + k * 0.9
        r = 165 + 10 * math.sin(t * 5 + k)
        R.draw_sparkle(ctx, 540 + r * math.cos(ang), 845 + r * math.sin(ang), 26 * a, a)


def draw_pie_labels(ctx, t, anchors):
    lay = R.pie_layout(t)
    if lay is None or "pie_leg" not in anchors:
        return
    la = lay["label_alpha"]
    if la <= 0:
        return
    x, y = anchors["pie_leg"]
    R.text_line(ctx, [("다리", R.NAVY)], x, y - 16, 34, alpha=la, outline=6, outline_color=R.WHITE, shadow=False)
    R.text_line(ctx, [("2/3", R.NAVY)], x, y + 20, 30, alpha=la, outline=6, outline_color=R.WHITE, shadow=False)
    x, y = anchors["pie_head"]
    R.text_line(ctx, [("머리", R.NAVY)], x, y, 26, alpha=la, outline=5, outline_color=R.WHITE, shadow=False)


def composite(idx):
    t = idx / FPS
    base, _keep, anchors = load_frame(idx)
    out = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(out)
    z = R.camera_zoom(t)
    ctx.translate(W / 2, H / 2)
    ctx.scale(z, z)
    ctx.translate(-W / 2, -H / 2)
    ctx.set_source_surface(base, 0, 0)
    ctx.paint()

    st = R.octo_state(t)
    R.draw_swim_fx(ctx, st, t)
    draw_vignette(ctx)
    draw_hook_sparkles(ctx, t)
    R.draw_heart_labels(ctx, R.hearts_layout(t))
    lay = R.blood_layout(t)
    if lay is not None:
        R.draw_blood_overlay(ctx, t, lay)
    R.draw_ecg_scene(ctx, t)
    draw_pie_labels(ctx, t, anchors)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    R.draw_texts(ctx, t)
    R.draw_transition(ctx, t)
    out.flush()
    return out


def frame_bytes(idx):
    return bytes(composite(idx).get_data())


def init(frames):
    global FRAMES
    FRAMES = frames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="build/frames3d")
    ap.add_argument("--audio", default=None)
    ap.add_argument("--out", default="output/octopus_short_3d.mp4")
    ap.add_argument("--preview", default=None, help="프레임 번호 목록(쉼표) -> PNG")
    ap.add_argument("--preview-dir", default="build/preview3d")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    init(args.frames)

    if args.preview:
        os.makedirs(args.preview_dir, exist_ok=True)
        for s in args.preview.split(","):
            idx = int(s)
            path = os.path.join(args.preview_dir, f"comp_{idx:04d}.png")
            composite(idx).write_to_png(path)
            print(path)
        return

    n = int(round(DURATION * FPS))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if args.audio:
        cmd += ["-i", args.audio]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high"]
    if args.audio:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += ["-movflags", "+faststart", args.out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with Pool(args.workers, initializer=init, initargs=(args.frames,)) as pool:
        for i, data in enumerate(pool.imap(frame_bytes, range(n), chunksize=4)):
            proc.stdin.write(data)
            if i % 90 == 0:
                print(f"composite {i}/{n}", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg 인코딩 실패")
    print("완료:", args.out)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""상어 편 2D 렌더러 (pycairo). 3D 편과 같은 타임라인·오디오·자막(shark/overlay.py)을 쓴다.

사용법:
  python3 shark/render2d.py --audio build/shark/audio.wav --out output/shark_short_2d.mp4
  python3 shark/render2d.py --preview 1.0,7.5 --preview-dir build/shark2d_preview
"""
import argparse
import importlib.util
import math
import os
import subprocess
import sys
from multiprocessing import Pool

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("shark_overlay", os.path.join(HERE, "overlay.py"))
O = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(O)
T, C = O.T, O.C
W, H, FPS, DURATION = T.W, T.H, T.FPS, T.DURATION
TAU = math.tau
hx, NAVY, WH, YE = R.hx, R.NAVY, R.WHITE, R.YELLOW
prog, clamp, lerp, rnd = R.prog, R.clamp, R.lerp, R.rnd
ease_out, ease_io, ease_back, bump = R.ease_out, R.ease_io, R.ease_back, R.bump

SHARK_TOP, SHARK_BELLY, SHARK_LINE = hx("#5f93c4"), hx("#eef6fb"), NAVY
ICE_TOP, ICE_BELLY = hx("#74818a"), hx("#bcc6cc")
MOUTH_IN, GUM, TONGUE = hx("#5c1530"), hx("#f0708f"), hx("#d6506f")
XRAY = hx("#7fe8ff")


def smooth(a, b, x):
    k = clamp((x - a) / (b - a))
    return k * k * (3 - 2 * k)


def interp(keys, s):
    """(위치, 값) 키 사이를 코사인 보간."""
    s = clamp(s)
    for (s0, v0), (s1, v1) in zip(keys, keys[1:]):
        if s <= s1:
            k = (s - s0) / (s1 - s0) if s1 > s0 else 0
            k = (1 - math.cos(math.pi * k)) / 2
            return v0 + (v1 - v0) * k
    return keys[-1][1]


def fill_stroke(ctx, fill, line=NAVY, lw=6, alpha=1.0):
    ctx.set_source_rgba(*fill, alpha)
    ctx.fill_preserve()
    ctx.set_source_rgba(*line, alpha)
    ctx.set_line_width(lw)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()


# ---------------------------------------------------------------- 배경
def draw_ocean(ctx, t):
    g = cairo.LinearGradient(0, 0, 0, H)
    g.add_color_stop_rgb(0.0, *hx("#33bdf0"))
    g.add_color_stop_rgb(0.45, *hx("#1375bd"))
    g.add_color_stop_rgb(1.0, *hx("#073366"))
    ctx.set_source(g)
    ctx.paint()
    for i in range(6):                                   # 햇살
        x0 = 90 + i * 185 + 45 * math.sin(t * 0.45 + i * 1.7)
        w0 = 35 + 30 * rnd(i, 3)
        x1 = x0 - 260 + 90 * math.sin(t * 0.3 + i)
        lg = cairo.LinearGradient(0, 0, 0, 1550)
        a = 0.09 + 0.05 * math.sin(t * 0.9 + i * 2.1)
        lg.add_color_stop_rgba(0, 1, 1, 1, a)
        lg.add_color_stop_rgba(1, 1, 1, 1, 0)
        ctx.new_path()
        ctx.move_to(x0 - w0, 0)
        ctx.line_to(x0 + w0, 0)
        ctx.line_to(x1 + w0 * 4.2, 1550)
        ctx.line_to(x1 - w0 * 4.2, 1550)
        ctx.close_path()
        ctx.set_source(lg)
        ctx.fill()
    for start, fy, speed, d, sz in [(0.0, 1180, 70, 1, 1.0), (6.0, 760, 55, -1, 0.8), (12.0, 1420, 85, 1, 1.15), (19.0, 980, 60, -1, 0.9)]:
        x = ((t + start) * speed) % (W + 400) - 200
        R.draw_fish(ctx, W - x if d < 0 else x, fy + 18 * math.sin(t * 1.3 + start), sz, d, t + start)
    plankton(ctx, t)
    R.draw_seaweed(ctx, t)
    R.draw_floor(ctx, t)


def plankton(ctx, t, n=70, fall=False):
    for i in range(n):
        x = rnd(i, 1) * W + 20 * math.sin(t * 0.5 + i)
        v = 10 + 20 * rnd(i, 4)
        y = (rnd(i, 2) * H + (t * v * (2.5 if fall else -1))) % H
        R.circle(ctx, x, y, 1.5 + 2.8 * rnd(i, 5))
        ctx.set_source_rgba(1, 1, 1, 0.12 + 0.25 * rnd(i, 6))
        ctx.fill()


def bubbles(ctx, t, a=0.55):
    for i in range(16):
        speed = 90 + 120 * rnd(i, 11)
        span = H + 300
        y = H + 100 - ((t * speed + rnd(i, 13) * span) % span)
        R.draw_bubble(ctx, rnd(i, 14) * W + 18 * math.sin(t * 2.0 + i), y, 6 + 16 * rnd(i, 12), a)


def draw_xray_bg(ctx, t, a):
    g = cairo.LinearGradient(0, 0, 0, H)
    g.add_color_stop_rgba(0.0, *hx("#14325a"), a)
    g.add_color_stop_rgba(0.5, *hx("#0a1e3e"), a)
    g.add_color_stop_rgba(1.0, *hx("#040b1d"), a)
    ctx.set_source(g)
    ctx.paint()
    ctx.save()
    ctx.set_line_width(2)
    for k in range(0, W + 1, 90):
        ctx.move_to(k, 0)
        ctx.line_to(k, H)
    for k in range(0, H + 1, 90):
        ctx.move_to(0, k)
        ctx.line_to(W, k)
    ctx.set_source_rgba(0.4, 0.85, 1.0, 0.07 * a)
    ctx.stroke()
    ctx.restore()


def draw_ice_bg(ctx, t):
    g = cairo.LinearGradient(0, 0, 0, H)
    g.add_color_stop_rgb(0.0, *hx("#8fc6d4"))
    g.add_color_stop_rgb(0.3, *hx("#3d7d93"))
    g.add_color_stop_rgb(1.0, *hx("#0d2a38"))
    ctx.set_source(g)
    ctx.paint()
    for i in range(4):                                   # 얼음 사이로 들어오는 빛
        x0 = 150 + i * 260 + 30 * math.sin(t * 0.3 + i)
        lg = cairo.LinearGradient(0, 200, 0, 1500)
        lg.add_color_stop_rgba(0, 1, 1, 1, 0.12)
        lg.add_color_stop_rgba(1, 1, 1, 1, 0)
        ctx.new_path()
        ctx.move_to(x0 - 40, 200)
        ctx.line_to(x0 + 40, 200)
        ctx.line_to(x0 + 160, 1500)
        ctx.line_to(x0 - 80, 1500)
        ctx.close_path()
        ctx.set_source(lg)
        ctx.fill()
    for k in range(9):                                   # 떠 있는 얼음 조각
        cx = -60 + k * 150 + 30 * rnd(k, 1)
        cy = 120 + 70 * rnd(k, 2) + 8 * math.sin(t * 0.8 + k)
        w_, h_ = 120 + 80 * rnd(k, 3), 60 + 40 * rnd(k, 4)
        ctx.new_path()
        for j in range(7):
            ang = j / 7 * TAU
            rr = 0.75 + 0.3 * rnd(k * 7 + j, 5)
            (ctx.move_to if j == 0 else ctx.line_to)(cx + w_ * rr * math.cos(ang), cy + h_ * rr * math.sin(ang))
        ctx.close_path()
        fill_stroke(ctx, hx("#eafcff"), hx("#5aa6bd"), 5, 0.92)
    plankton(ctx, t, 90, fall=True)                     # 바다 눈


# ---------------------------------------------------------------- 상어 (옆모습)
L = 620
TOP_K = [(0, 10), (0.07, 17), (0.16, 35), (0.32, 73), (0.5, 106), (0.64, 114), (0.78, 106), (0.88, 88), (0.95, 60), (0.985, 31), (1.0, 0)]
BOT_K = [(0, 10), (0.07, 15), (0.16, 30), (0.32, 63), (0.5, 94), (0.64, 101), (0.78, 92), (0.88, 73), (0.95, 47), (0.985, 24), (1.0, 0)]
AMP_DOTS = [(0.9, -0.35), (0.92, -0.1), (0.935, -0.5), (0.95, -0.22), (0.965, -0.45), (0.972, 0.0), (0.955, 0.3), (0.925, 0.22),
            (0.905, 0.1), (0.942, 0.08), (0.982, -0.18), (0.885, -0.15)]


def shark_params(**kw):
    P = dict(x=540, y=1150, scale=1.0, rot=0.0, amp=26, freq=0.9, mode="normal", expr="normal", glow=0.0, alpha=1.0, flap=0.12)
    P.update(kw)
    return P


def sx(s):
    return (s - 0.5) * L


def cy_(s, t, P):
    return P["amp"] * (1 - s) ** 1.6 * math.sin(TAU * P["freq"] * t - 3.2 * (1 - s))


def top(s):
    return interp(TOP_K, s)


def bot(s):
    return interp(BOT_K, s)


def body_path(ctx, t, P, n=90):
    ctx.new_path()
    for i in range(n + 1):
        s = i / n
        (ctx.move_to if i == 0 else ctx.line_to)(sx(s), cy_(s, t, P) - top(s))
    for i in range(n, -1, -1):
        s = i / n
        ctx.line_to(sx(s), cy_(s, t, P) + bot(s))
    ctx.close_path()


def fin_frame(ctx, s, t, P, side):
    """지느러미를 붙일 점으로 이동하고 몸의 기울기만큼 돌린다. side: -1 위, +1 아래, 0 중심선."""
    y = cy_(s, t, P) + (bot(s) if side > 0 else -top(s) if side < 0 else 0)
    slope = (cy_(s + 0.01, t, P) - cy_(s - 0.01, t, P)) / (0.02 * L)
    ctx.translate(sx(s), y)
    ctx.rotate(math.atan(slope))


def fin(ctx, pts, fill, lw=6, line=NAVY, alpha=1.0):
    """pts: 시작점, (제어1, 제어2, 끝) ... 의 베지어 지느러미."""
    ctx.new_path()
    ctx.move_to(*pts[0])
    for c1, c2, p in pts[1:]:
        ctx.curve_to(*c1, *c2, *p)
    ctx.close_path()
    fill_stroke(ctx, fill, line, lw, alpha)


FIN_DORSAL = [(42, 12), ((10, -60), (-10, -110), (-38, -128)), ((-40, -80), (-55, -30), (-62, 12))]
FIN_DORSAL2 = [(14, 6), ((4, -18), (-6, -34), (-18, -40)), ((-18, -22), (-22, -8), (-26, 6))]
FIN_PEC = [(18, -10), ((6, 40), (-30, 100), (-74, 118)), ((-58, 70), (-44, 30), (-36, -4))]
FIN_PELVIC = [(12, -4), ((4, 18), (-18, 36), (-36, 42)), ((-30, 22), (-24, 8), (-20, -4))]
FIN_ANAL = [(10, -4), ((2, 14), (-14, 26), (-26, 30)), ((-22, 14), (-18, 4), (-16, -4))]
FIN_TAIL = [(4, -16), ((-40, -50), (-90, -110), (-128, -146)), ((-108, -90), (-80, -40), (-56, -4)),
            ((-76, 24), (-90, 60), (-100, 96)), ((-60, 64), (-26, 30), (4, 16))]


def draw_tail(ctx, t, P, fill, line, lw, alpha):
    ctx.save()
    s0 = 0.0
    y0 = cy_(s0, t, P)
    slope = (cy_(0.05, t, P) - y0) / (0.05 * L)
    ctx.translate(sx(s0) + 4, y0)
    ctx.rotate(math.atan(slope) * 1.6)
    fin(ctx, FIN_TAIL, fill, lw, line, alpha)
    ctx.restore()


def eye(ctx, x, y, rx, ry, P, t, look=(0.25, 0.08), line=NAVY):
    expr = P["expr"]
    bt = (t + 0.4) % 3.4
    openness = max(0.08, 1 - math.sin(math.pi * bt / 0.14)) if bt < 0.14 else 1.0
    if expr == "happy":
        ctx.new_path()
        ctx.arc(x, y + ry * 0.45, rx * 0.85, math.pi * 1.12, math.pi * 1.88)
        ctx.set_source_rgb(*line)
        ctx.set_line_width(max(5, rx * 0.28))
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
        return
    ry *= openness
    R.ellipse(ctx, x, y, rx, ry)
    ctx.set_source_rgb(1, 1, 1)
    ctx.fill_preserve()
    ctx.save()
    ctx.clip_preserve()
    pr = rx * (0.5 if expr == "sleepy" else 0.62)
    px, py = x + look[0] * rx, y + look[1] * ry
    R.circle(ctx, px, py, pr)
    ctx.set_source_rgb(*hx("#14112b"))
    ctx.fill()
    R.circle(ctx, px - pr * 0.35, py - pr * 0.4, pr * 0.36)
    ctx.set_source_rgb(1, 1, 1)
    ctx.fill()
    R.circle(ctx, px + pr * 0.3, py + pr * 0.35, pr * 0.16)
    ctx.fill()
    if expr == "sleepy":                                 # 졸린 듯 반쯤 감은 눈꺼풀
        ctx.new_path()
        ctx.rectangle(x - rx * 1.5, y - ry * 1.5, rx * 3, ry * 1.42)
        ctx.set_source_rgb(*ICE_TOP)
        ctx.fill()
        ctx.new_path()
        ctx.move_to(x - rx, y - ry * 0.08)
        ctx.line_to(x + rx, y - ry * 0.08)
        ctx.set_source_rgb(*line)
        ctx.set_line_width(4)
        ctx.stroke()
    ctx.restore()
    R.ellipse(ctx, x, y, rx, ry)
    ctx.set_source_rgb(*line)
    ctx.set_line_width(5)
    ctx.stroke()


def to_screen(P, lx, ly):
    c, s = math.cos(P["rot"]), math.sin(P["rot"])
    lx, ly = lx * P["scale"], ly * P["scale"]
    return (P["x"] + c * lx - s * ly, P["y"] + s * lx + c * ly)


def draw_shark_side(ctx, t, P):
    if P["alpha"] <= 0.003:
        return
    ctx.save()
    ctx.push_group()
    ctx.translate(P["x"], P["y"])
    ctx.rotate(P["rot"])
    ctx.scale(P["scale"], P["scale"])
    xr = P["mode"] == "xray"
    ice = P["mode"] == "ice"
    topc = ICE_TOP if ice else SHARK_TOP
    belly = ICE_BELLY if ice else SHARK_BELLY
    if xr:
        fillc, line, lw, fa = hx("#2a7fb0"), XRAY, 5, 0.3
    else:
        fillc, line, lw, fa = topc, NAVY, 6, 1.0
    # 몸 뒤쪽 지느러미: 꼬리, 등지느러미, 반대쪽 가슴지느러미, 배·뒷지느러미
    draw_tail(ctx, t, P, fillc, line, lw, fa)
    for s, side, pts, extra in ((0.47, -1, FIN_DORSAL, 0), (0.2, -1, FIN_DORSAL2, 0), (0.3, 1, FIN_PELVIC, 0), (0.17, 1, FIN_ANAL, 0)):
        ctx.save()
        fin_frame(ctx, s, t, P, side)
        ctx.translate(0, 8 if side < 0 else -6)
        fin(ctx, pts, fillc, lw, line, fa)
        ctx.restore()
    ctx.save()
    fin_frame(ctx, 0.66, t, P, 1)
    ctx.translate(24, -32)
    ctx.rotate(-0.25 + P["flap"] * math.sin(t * 3 + 1.5))
    ctx.scale(0.8, 0.8)
    fin(ctx, FIN_PEC, fillc, lw, line, fa * (0.85 if not xr else 1))
    ctx.restore()
    # 몸통
    body_path(ctx, t, P)
    if xr:
        ctx.set_source_rgba(*hx("#2a7fb0"), 0.3)
        ctx.fill_preserve()
        ctx.set_source_rgba(*XRAY, 0.35)
        ctx.set_line_width(16)
        ctx.stroke_preserve()
        ctx.set_source_rgba(*XRAY, 1)
        ctx.set_line_width(5)
        ctx.stroke()
    else:
        ctx.set_source_rgb(*belly)
        ctx.fill_preserve()
        ctx.save()
        ctx.clip()
        n = 70
        ctx.new_path()
        for i in range(n + 1):
            s = i / n
            (ctx.move_to if i == 0 else ctx.line_to)(sx(s), cy_(s, t, P) - top(s) - 4)
        for i in range(n, -1, -1):
            s = i / n
            k = lerp(0.32, -0.05, smooth(0.84, 1.0, s))
            ctx.line_to(sx(s), cy_(s, t, P) + bot(s) * k + 4 * math.sin(s * 40))
        ctx.close_path()
        ctx.set_source_rgb(*topc)
        ctx.fill()
        ctx.new_path()                                   # 등 위 하이라이트
        for i in range(12, 60):
            s = i / 70
            (ctx.move_to if i == 12 else ctx.line_to)(sx(s), cy_(s, t, P) - top(s) * 0.72)
        ctx.set_source_rgba(1, 1, 1, 0.22)
        ctx.set_line_width(14)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
        if ice:                                          # 그린란드상어 얼룩
            for k in range(14):
                s = 0.15 + 0.7 * rnd(k, 31)
                R.ellipse(ctx, sx(s), cy_(s, t, P) - top(s) * (0.2 + 0.6 * rnd(k, 32)), 6 + 6 * rnd(k, 33), 4 + 3 * rnd(k, 34))
                ctx.set_source_rgba(1, 1, 1, 0.18)
                ctx.fill()
        ctx.restore()
        body_path(ctx, t, P)
        ctx.set_source_rgb(*NAVY)
        ctx.set_line_width(6)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()
    if xr:
        draw_skeleton(ctx, t, P)
    # 아가미
    for k, s in enumerate((0.71, 0.74, 0.77)):
        y0 = cy_(s, t, P)
        ctx.new_path()
        ctx.move_to(sx(s) + 4, y0 - top(s) * 0.28)
        ctx.curve_to(sx(s) - 6, y0, sx(s) - 6, y0 + bot(s) * 0.2, sx(s) + 2, y0 + bot(s) * 0.4)
        ctx.set_source_rgba(*(XRAY if xr else NAVY), 0.55 if not xr else 0.4)
        ctx.set_line_width(4.5)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    # 로렌치니 기관 (주둥이 점)
    for k, (s, v) in enumerate(AMP_DOTS):
        x = sx(s)
        y = cy_(s, t, P) + (top(s) * v if v < 0 else bot(s) * v)
        g = P["glow"] * (0.75 + 0.25 * math.sin(t * 10 + k))
        if g > 0.01:
            rg = cairo.RadialGradient(x, y, 0, x, y, 22)
            rg.add_color_stop_rgba(0, 1, 0.95, 0.5, 0.9 * g)
            rg.add_color_stop_rgba(1, 1, 0.85, 0.2, 0)
            ctx.set_source(rg)
            R.circle(ctx, x, y, 22)
            ctx.fill()
        R.circle(ctx, x, y, 3.6)
        ctx.set_source_rgba(*(hx("#fff3a0") if g > 0.3 else (XRAY if xr else NAVY)), 0.95 if g > 0.3 else 0.45)
        ctx.fill()
    # 얼굴
    if not xr:
        se = 0.835
        ex, ey = sx(se), cy_(se, t, P) - top(se) * 0.3
        rs = 0.82 if P["expr"] == "sleepy" else 1.0
        eye(ctx, ex, ey, 33 * rs, 38 * rs, P, t)
        R.ellipse(ctx, sx(0.875), cy_(0.875, t, P) + bot(0.875) * 0.28, 25, 14)
        ctx.set_source_rgba(*hx("#ff2f72"), 0.33)
        ctx.fill()
        draw_side_mouth(ctx, t, P)
        # 가슴지느러미 (앞쪽)
        ctx.save()
        fin_frame(ctx, 0.63, t, P, 1)
        ctx.translate(0, -bot(0.63) * 0.55)
        ctx.rotate(P["flap"] * math.sin(t * 3))
        fin(ctx, FIN_PEC, topc, 6)
        ctx.restore()
    else:
        R.circle(ctx, sx(0.835), cy_(0.835, t, P) - top(0.835) * 0.3, 22)
        ctx.set_source_rgba(*XRAY, 0.8)
        ctx.set_line_width(4)
        ctx.stroke()
        ctx.save()
        fin_frame(ctx, 0.63, t, P, 1)
        ctx.translate(0, -bot(0.63) * 0.55)
        ctx.rotate(P["flap"] * math.sin(t * 3))
        fin(ctx, FIN_PEC, hx("#2a7fb0"), 5, XRAY, 0.3)
        for k in range(5):                               # 지느러미 살
            ctx.move_to(-10 - k * 5, 0)
            ctx.line_to(-30 - k * 10, 50 + k * 13)
        ctx.set_source_rgba(*XRAY, 0.8)
        ctx.set_line_width(3)
        ctx.stroke()
        ctx.restore()
    ctx.pop_group_to_source()
    ctx.paint_with_alpha(P["alpha"])
    ctx.restore()


def draw_side_mouth(ctx, t, P):
    p0 = (sx(0.865), cy_(0.865, t, P) + bot(0.865) * 0.5)
    p1 = (sx(0.97), cy_(0.97, t, P) + bot(0.97) * 0.3)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    if P["expr"] in ("happy", "open"):
        ctx.new_path()
        ctx.move_to(*p0)
        ctx.line_to(*p1)
        ctx.curve_to(p1[0] - 10, p1[1] + 40, p0[0] + 30, p0[1] + 52, p0[0] - 2, p0[1] + 8)
        ctx.close_path()
        ctx.set_source_rgb(*MOUTH_IN)
        ctx.fill_preserve()
        ctx.save()
        ctx.clip_preserve()
        R.ellipse(ctx, (p0[0] + p1[0]) / 2, p0[1] + 38, 28, 14)
        ctx.set_source_rgb(*TONGUE)
        ctx.fill()
        for k in range(4):                               # 작은 이빨
            f = 0.15 + k * 0.22
            x = lerp(p0[0], p1[0], f)
            y = lerp(p0[1], p1[1], f)
            ctx.new_path()
            ctx.move_to(x - 8, y - 2)
            ctx.line_to(x, y + 14)
            ctx.line_to(x + 8, y - 2)
            ctx.close_path()
            ctx.set_source_rgb(1, 1, 1)
            ctx.fill()
        ctx.restore()
        ctx.set_source_rgb(*NAVY)
        ctx.set_line_width(5)
        ctx.stroke()
    else:
        ctx.new_path()
        ctx.move_to(*p0)
        ctx.curve_to(p0[0] + 26, p0[1] + 26, p1[0] - 22, p1[1] + 18, p1[0], p1[1])
        ctx.set_source_rgb(*hx("#7a1f3d"))
        ctx.set_line_width(6)
        ctx.stroke()


def glow_stroke(ctx, lw=4, a=1.0):
    ctx.set_source_rgba(*XRAY, 0.25 * a)
    ctx.set_line_width(lw * 3.5)
    ctx.stroke_preserve()
    ctx.set_source_rgba(*XRAY, a)
    ctx.set_line_width(lw)
    ctx.stroke()


def draw_skeleton(ctx, t, P):
    """연골 골격: 척추, 머리뼈, 턱, 어깨뼈, 지느러미 살."""
    ctx.save()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    for i in range(32):                                  # 척추
        s = 0.05 + i * 0.024
        x, y = sx(s), cy_(s, t, P) + 6
        hh = 9 + 13 * min(1.0, (top(s) + bot(s)) / 150)
        R.rrect(ctx, x - 6, y - hh / 2, 12, hh, 5)
        ctx.set_source_rgba(*XRAY, 0.55)
        ctx.fill_preserve()
        ctx.set_source_rgba(*XRAY, 1)
        ctx.set_line_width(2.5)
        ctx.stroke()
    # 머리뼈
    s0, s1 = 0.8, 0.975
    ctx.new_path()
    ctx.move_to(sx(s0), cy_(s0, t, P) + 4)
    ctx.curve_to(sx(s0), cy_(s0, t, P) - top(s0) * 0.75, sx(0.93), cy_(0.93, t, P) - top(0.93) * 0.8, sx(s1), cy_(s1, t, P) - 6)
    ctx.curve_to(sx(0.95), cy_(0.95, t, P) + 8, sx(0.86), cy_(0.86, t, P) + 14, sx(s0), cy_(s0, t, P) + 4)
    ctx.close_path()
    ctx.set_source_rgba(*XRAY, 0.18)
    ctx.fill_preserve()
    glow_stroke(ctx, 4)
    # 위턱·아래턱
    for k, off in enumerate((0.36, 0.62)):
        ctx.new_path()
        ctx.move_to(sx(0.82), cy_(0.82, t, P) + bot(0.82) * off)
        ctx.curve_to(sx(0.88), cy_(0.88, t, P) + bot(0.88) * (off + 0.25), sx(0.94), cy_(0.94, t, P) + bot(0.94) * (off + 0.05), sx(0.965), cy_(0.965, t, P) + bot(0.965) * (0.25 + 0.1 * k))
        glow_stroke(ctx, 6)
    # 어깨뼈(가슴지느러미 받침)
    ctx.new_path()
    ctx.move_to(sx(0.68), cy_(0.68, t, P) - top(0.68) * 0.2)
    ctx.curve_to(sx(0.66), cy_(0.66, t, P) + bot(0.66) * 0.3, sx(0.64), cy_(0.64, t, P) + bot(0.64) * 0.6, sx(0.62), cy_(0.62, t, P) + bot(0.62) * 0.75)
    glow_stroke(ctx, 6)
    # 등지느러미·꼬리 지느러미 살
    ctx.save()
    fin_frame(ctx, 0.47, t, P, -1)
    ctx.translate(0, 8)
    ctx.new_path()
    for k in range(5):
        ctx.move_to(30 - k * 16, 4)
        ctx.line_to(-6 - k * 10, -90 + k * 14)
    glow_stroke(ctx, 2.5, 0.9)
    ctx.restore()
    ctx.save()
    y0 = cy_(0.0, t, P)
    ctx.translate(sx(0.0) + 4, y0)
    ctx.rotate(math.atan((cy_(0.05, t, P) - y0) / (0.05 * L)) * 1.6)
    ctx.new_path()
    for k in range(5):
        ctx.move_to(-10, -6)
        ctx.line_to(-118 + k * 8, -134 + k * 26)
    for k in range(3):
        ctx.move_to(-10, 6)
        ctx.line_to(-92 + k * 10, 88 - k * 22)
    glow_stroke(ctx, 2.5, 0.9)
    ctx.restore()
    ctx.restore()


# ---------------------------------------------------------------- 상어 (정면 얼굴) + 이빨
MOUTH_Y, MA = 55, 300          # 입 윗선 위치, 입 반폭(px)
TEETH_EV = [(-1, 2), (1, 4)]   # 빠지는 이빨: (턱, 번호) 아래턱 3번째, 윗턱 5번째 (3D 편과 같음)


def slot(jaw, i, row, open_):
    """입 좌표(반폭 MA 단위, y 아래로 +)의 이빨 뿌리 위치와 방향."""
    u = i / 6 * 2 - 1
    if jaw > 0:
        bx, by, dx, dy = u * 0.652, 0.096, 0.0, 1.0
    else:
        bn = 0.87 * (0.2 + 0.85 * open_)
        a = math.pi * (1.2 + 0.6 * i / 6)
        bx, by = math.cos(a) * 0.92, -math.sin(a) * bn * 0.92
        nx, ny = -math.cos(a), -math.sin(a) / bn
        nl = math.hypot(nx, ny)
        dx, dy = 0.45 * nx / nl, 0.45 * ny / nl + 0.55
        dl = math.hypot(dx, dy)
        dx, dy = dx / dl, -dy / dl
    s = 1 - 0.28 * u * u
    if row == 1:
        bx, by = bx + dx * 0.183 * s, by + dy * 0.183 * s
    return dict(x=bx, y=by, ang=math.atan2(-dx, dy), s=s * (0.7 if row else 1.0), dx=dx, dy=dy, fold=0.78 if row else 1.0)


def lerp_pose(a, b, k, kb):
    return dict(x=lerp(a["x"], b["x"], k), y=lerp(a["y"], b["y"], k), ang=lerp(a["ang"], b["ang"], k),
                s=lerp(a["s"], b["s"], kb), fold=lerp(a["fold"], b["fold"], kb), dx=b["dx"], dy=b["dy"])


def tooth_pose(jaw, i, row, t, open_):
    p = slot(jaw, i, row, open_)
    ev = [k for k, e in enumerate(TEETH_EV) if e == (jaw, i)]
    if not ev:
        return p
    k = ev[0]
    d, r = C["DROP"][k], C["REPLACE"][k]
    if row == 0:
        if t < d - 0.55:
            return p
        if t < d:                                        # 흔들흔들
            w = prog(t, d - 0.55, d)
            p["ang"] += (0.08 + 0.22 * w) * math.sin(TAU * 5.45 * (t - d))
            p["x"] += p["dx"] * 0.043 * w
            p["y"] += p["dy"] * 0.043 * w
            return p
        g = ease_out(prog(t, r + 0.4, r + 1.1))          # 빠진 자리 뒤에서 새 이빨이 자람
        if g <= 0.01:
            return None
        b = slot(jaw, i, 1, open_)
        b["s"] *= g
        return b
    if t < r:
        return p
    q = prog(t, r, r + 0.42)
    return lerp_pose(p, slot(jaw, i, 0, open_), ease_out(q), ease_back(q, 2.2))


def tooth_path(ctx, s, fold=1.0):
    wb, h = 0.108 * MA * s, 0.32 * MA * s * fold
    ctx.new_path()
    ctx.move_to(-wb, -0.04 * MA)
    ctx.curve_to(-wb * 0.95, h * 0.45, -wb * 0.3, h * 0.82, 0, h)
    ctx.curve_to(wb * 0.3, h * 0.82, wb * 0.95, h * 0.45, wb, -0.04 * MA)
    ctx.close_path()


def draw_tooth(ctx, x, y, ang, s, fold=1.0, back=False):
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    tooth_path(ctx, s, fold)
    ctx.set_source_rgb(*(hx("#dde8ef") if back else WH))
    ctx.fill_preserve()
    ctx.save()
    ctx.clip_preserve()
    ctx.rectangle(0, -MA, MA, 2 * MA)
    ctx.set_source_rgba(*hx("#9fbad0"), 0.35)
    ctx.fill()
    ctx.restore()
    ctx.set_source_rgb(*NAVY)
    ctx.set_line_width(3.5)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    ctx.restore()


def mouth_path(ctx, bpx):
    ctx.new_path()
    ctx.move_to(-MA, MOUTH_Y)
    ctx.curve_to(-MA * 0.5, MOUTH_Y + 12, MA * 0.5, MOUTH_Y + 12, MA, MOUTH_Y)
    ctx.save()
    ctx.translate(0, MOUTH_Y)
    ctx.scale(MA, max(bpx, 1))
    ctx.arc(0, 0, 1, 0, math.pi)
    ctx.restore()
    ctx.close_path()


def draw_shark_front(ctx, t, cx, cy, sc, alpha, open_, anchors):
    if alpha <= 0.003:
        return
    ctx.save()
    ctx.push_group()
    ctx.translate(cx, cy)
    ctx.scale(sc, sc)
    flap = 0.1 * math.sin(t * 3)
    for side in (-1, 1):                                 # 가슴지느러미
        ctx.save()
        ctx.translate(side * 360, 200)
        ctx.rotate(side * (0.15 + flap))
        ctx.scale(side, 1)
        fin(ctx, [(-20, -40), ((80, -10), (170, 70), (220, 160)), ((140, 150), (60, 90), (-30, 40))], SHARK_TOP, 7)
        ctx.restore()
    # 머리
    ctx.new_path()
    ctx.save()
    ctx.scale(430, 380)
    ctx.arc(0, 0, 1, math.pi, TAU)
    ctx.restore()
    ctx.save()
    ctx.scale(430, 360)
    ctx.arc(0, 0, 1, 0, math.pi)
    ctx.restore()
    ctx.close_path()
    ctx.set_source_rgb(*SHARK_TOP)
    ctx.fill_preserve()
    ctx.save()
    ctx.clip()
    R.ellipse(ctx, 0, 300, 380, 250)                     # 흰 턱
    ctx.set_source_rgb(*SHARK_BELLY)
    ctx.fill()
    ctx.save()
    ctx.translate(-140, -250)
    ctx.rotate(-0.35)
    R.ellipse(ctx, 0, 0, 130, 46)
    ctx.set_source_rgba(1, 1, 1, 0.2)
    ctx.fill()
    ctx.restore()
    ctx.restore()
    ctx.new_path()
    ctx.save()
    ctx.scale(430, 380)
    ctx.arc(0, 0, 1, math.pi, TAU)
    ctx.restore()
    ctx.save()
    ctx.scale(430, 360)
    ctx.arc(0, 0, 1, 0, math.pi)
    ctx.restore()
    ctx.close_path()
    ctx.set_source_rgb(*NAVY)
    ctx.set_line_width(7)
    ctx.stroke()
    for k in range(14):                                  # 로렌치니 점
        x = (-1 if k % 2 else 1) * (40 + 150 * rnd(k, 41))
        y = -200 + 150 * rnd(k, 42)
        R.circle(ctx, x, y, 5)
        ctx.set_source_rgba(*NAVY, 0.4)
        ctx.fill()
    P = dict(expr="normal")
    for side in (-1, 1):
        eye(ctx, side * 255, -80, 72, 82, P, t, look=(-side * 0.18, 0.12))
        R.ellipse(ctx, side * 305, 40, 52, 26)
        ctx.set_source_rgba(*hx("#ff2f72"), 0.33)
        ctx.fill()
    # 입
    tsc = smooth(0.3, 0.62, open_)
    if open_ < 0.15:
        ctx.new_path()
        ctx.arc(0, MOUTH_Y - 60, 130, 0.2 * math.pi, 0.8 * math.pi)
        ctx.set_source_rgb(*hx("#7a1f3d"))
        ctx.set_line_width(9)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    else:
        bpx = MA * 0.87 * (0.2 + 0.85 * open_)
        mouth_path(ctx, bpx)
        ctx.save()
        ctx.clip_preserve()
        g = cairo.LinearGradient(0, MOUTH_Y, 0, MOUTH_Y + bpx)
        g.add_color_stop_rgb(0, *hx("#3a0c1e"))
        g.add_color_stop_rgb(1, *MOUTH_IN)
        ctx.set_source(g)
        ctx.fill()
        R.ellipse(ctx, 0, MOUTH_Y + bpx * 0.85, MA * 0.45, bpx * 0.28)
        ctx.set_source_rgb(*TONGUE)
        ctx.fill()
        ox, oy = 0, MOUTH_Y
        poses = []
        for jaw in (1, -1):
            for row in (1, 0):
                for i in range(7):
                    p = tooth_pose(jaw, i, row, t, open_)
                    if p is not None:
                        poses.append((row, jaw, i, p))
        for row, jaw, i, p in poses:                     # 뒷줄 먼저
            if row == 1:
                draw_tooth(ctx, ox + p["x"] * MA, oy + p["y"] * MA, p["ang"], max(p["s"] * tsc, 1e-3), p["fold"], back=p["fold"] < 0.95)
        # 잇몸
        ctx.new_path()
        ctx.rectangle(-MA - 10, MOUTH_Y - 10, 2 * MA + 20, 0.16 * MA + 10)
        ctx.set_source_rgb(*GUM)
        ctx.fill()
        ctx.new_path()
        ctx.save()
        ctx.translate(0, MOUTH_Y)
        ctx.scale(MA, bpx)
        ctx.arc(0, 0, 1, 0, math.pi)
        ctx.arc_negative(0, 0, 0.84, math.pi, 0)
        ctx.restore()
        ctx.close_path()
        ctx.set_source_rgb(*GUM)
        ctx.fill()
        for row, jaw, i, p in poses:
            if row == 0:
                draw_tooth(ctx, ox + p["x"] * MA, oy + p["y"] * MA, p["ang"], max(p["s"] * tsc, 1e-3), p["fold"])
        ctx.restore()
        mouth_path(ctx, bpx)
        ctx.set_source_rgb(*NAVY)
        ctx.set_line_width(7)
        ctx.stroke()
        # 앵커: 새로 나온 이빨
        for k, (jaw, i) in enumerate(TEETH_EV):
            r = C["REPLACE"][k]
            if r <= t < r + 1.0:
                p = tooth_pose(jaw, i, 1, t, open_)
                hgt = 0.16 * MA * p["s"]
                lx, ly = ox + (p["x"] + p["dx"] * hgt / MA) * MA, oy + (p["y"] + p["dy"] * hgt / MA) * MA
                anchors[f"new{k}"] = (cx + lx * sc, cy + ly * sc)
    ctx.pop_group_to_source()
    ctx.paint_with_alpha(alpha)
    ctx.restore()
    # 빠진 이빨: 그 자리에서 떨어져 나와 천천히 가라앉음 (얼굴과 따로 그림)
    for k, (jaw, i) in enumerate(TEETH_EV):
        d = C["DROP"][k]
        tau = t - d
        if not (0 <= tau < 1.9 and t < C["CLOSE"][3]):
            continue
        p = slot(jaw, i, 0, 1.0)
        p["x"] += p["dx"] * 0.043
        p["y"] += p["dy"] * 0.043
        hgt = 0.16 * MA * p["s"]
        bx, by = p["x"] * MA, MOUTH_Y + p["y"] * MA
        c0 = (cx + (bx + p["dx"] * hgt) * sc, cy + (by + p["dy"] * hgt) * sc)
        side = 1 if k else -1
        pop = 1 - math.exp(-tau / 0.12)
        x = c0[0] + side * (40 * tau + 30 * math.sin(tau * 3.5)) * sc
        y = c0[1] + (-25 * pop + 80 * tau + 200 * tau * tau) * sc * 1.6
        ang = p["ang"] + side * (1.3 * tau + 0.25 * math.sin(tau * 5))
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(ang)
        ctx.scale(sc * (1 + 0.12 * pop), sc * (1 + 0.12 * pop))
        ctx.translate(0, -hgt)
        draw_tooth(ctx, 0, 0, 0, p["s"])
        ctx.restore()
        if tau < 1.2:
            anchors[f"drop{k}"] = (x, y)


# ---------------------------------------------------------------- 소품
def draw_tooth_rain(ctx, t):
    r0, r1 = C["TEETH_RAIN"]
    if not (r0 <= t < r1):
        return
    fade = prog(t, r0, r0 + 0.3) * (1 - prog(t, r1 - 0.25, r1))
    for i in range(26):
        ph = ((t - r0) * (0.35 + 0.25 * rnd(i, 3)) + rnd(i, 4)) % 1
        x = 80 + rnd(i, 1) * 920
        y = -120 + ph * 2160
        sc = 0.35 + 0.35 * rnd(i, 6)
        ctx.save()
        ctx.push_group()
        draw_tooth(ctx, x, y, t * (1.5 + 2 * rnd(i, 5)) + i, sc)
        ctx.pop_group_to_source()
        ctx.paint_with_alpha(fade)
        ctx.restore()


def draw_question(ctx, t):
    al, sc = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    if al <= 0:
        return
    ctx.save()
    ctx.translate(540, 900 + 14 * math.sin(t * 4))
    ctx.rotate(0.14 * math.sin(t * 3.1))
    R.text_line(ctx, [("?", YE)], 0, 0, 260, alpha=al, scale=sc, outline=30)
    ctx.restore()


def draw_speed_lines(ctx, t, x, y, a):
    if a <= 0:
        return
    ctx.save()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    for k in range(9):
        yy = y - 150 + k * 38 + 10 * rnd(k, 51)
        ln = 160 + 220 * rnd(k, 52)
        x0 = x - 330 - 200 * rnd(k, 53)
        ctx.move_to(x0, yy)
        ctx.line_to(x0 - ln, yy)
        ctx.set_source_rgba(1, 1, 1, 0.6 * a)
        ctx.set_line_width(7 + 5 * rnd(k, 54))
        ctx.stroke()
    ctx.restore()


def draw_flatfish(ctx, x, y, out, t, flip=1):
    """모래 속 넙치. out: 0 = 눈만 빼꼼, 1 = 완전히 나옴."""
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(flip * 1.4, 1.4)
    ctx.rotate(-0.12 * out * math.sin(t * 18))
    R.ellipse(ctx, 0, 0, 110, 48)
    fill_stroke(ctx, hx("#c9ad7a"), hx("#6b5430"), 5, out)
    for k in range(9):
        R.circle(ctx, -70 + 18 * k, -12 + 22 * rnd(k, 61), 6)
        ctx.set_source_rgba(0.45, 0.33, 0.18, 0.5 * out)
        ctx.fill()
    ctx.new_path()
    ctx.move_to(-100, 0)
    ctx.line_to(-150, -34)
    ctx.line_to(-150, 34)
    ctx.close_path()
    fill_stroke(ctx, hx("#c9ad7a"), hx("#6b5430"), 5, out)
    for dx in (40, 72):                                  # 눈 (모래 위로 늘 보임)
        R.circle(ctx, dx, -34, 15)
        fill_stroke(ctx, WH, NAVY, 4)
        R.circle(ctx, dx + 3, -34, 7)
        ctx.set_source_rgb(*hx("#14112b"))
        ctx.fill()
    ctx.restore()


def draw_pulses(ctx, t, x, y):
    p0, p1 = C["PULSE"]
    if not (p0 <= t < p1):
        return
    for i in range(3):
        ph = ((t - p0) * 0.9 + i / 3) % 1
        R.circle(ctx, x, y, 30 + 260 * ph)
        ctx.set_source_rgba(1, 0.92, 0.4, 0.85 * (1 - ph))
        ctx.set_line_width(8 * (1 - ph) + 2)
        ctx.stroke()


def draw_school(ctx, t):
    f0, f1 = C["FISH"]
    if t < f0:
        return
    cols = ["#ffd23f", "#ff8a3d", "#4fc3ff", "#ff6f9c"]
    for i in range(12):
        a = ease_out(prog(t, f0 + i * 0.04, f1 + i * 0.04))
        ang = i / 12 * TAU + t * 0.6
        x = lerp(1300, 540 + 380 * math.cos(ang), a)
        y = 1150 + 170 * math.sin(ang) + 30 * (i % 3)
        d = -1 if math.sin(ang) > 0 else 1
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(d * 0.9, 0.9)
        wag = 0.3 * math.sin(t * 12 + i)
        ctx.new_path()
        ctx.move_to(-34, 0)
        ctx.line_to(-62, -22 + 10 * wag)
        ctx.line_to(-62, 22 + 10 * wag)
        ctx.close_path()
        fill_stroke(ctx, hx(cols[i % 4]), NAVY, 4)
        R.ellipse(ctx, 0, 0, 44, 26)
        fill_stroke(ctx, hx(cols[i % 4]), NAVY, 4)
        R.circle(ctx, 20, -6, 6)
        ctx.set_source_rgb(*hx("#14112b"))
        ctx.fill()
        ctx.restore()


# ---------------------------------------------------------------- 장면 구성
def render_frame(t, surface=None):
    if surface is None:
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surface)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    z = O.camera_zoom(t)
    ctx.translate(W / 2, H / 2)
    ctx.scale(z, z)
    ctx.translate(-W / 2, -H / 2)
    anchors = {}

    if t < 3.6:                                          # 훅: 이빨 비
        draw_ocean(ctx, t)
        bubbles(ctx, t)
        draw_tooth_rain(ctx, t)
        draw_question(ctx, t)
    elif t < 10.2:                                       # 사실 1: 이빨이 계속 새로 남
        draw_ocean(ctx, t)
        bubbles(ctx, t)
        d0, d1 = C["DASH"]
        k = ease_out(prog(t, d0, d1))
        c0, c1, c2, c3 = C["CLOSE"]
        P = shark_params(x=lerp(-480, 540, k), y=1180 + 10 * math.sin(t * 1.6), scale=1.15, amp=lerp(40, 22, prog(t, d1, d1 + 0.6)), freq=lerp(2.2, 0.9, prog(t, d1, d1 + 0.6)))
        if d1 <= t < d1 + 1.2:
            P["expr"] = "happy"
        zin = ease_io(prog(t, c0, c1 - 0.25))            # 머리 쪽으로 다가감
        hx_, hy_ = to_screen(P, sx(0.86), cy_(0.86, t, P))
        P["scale"] = 1.15 * (1 + 1.1 * zin)
        P["x"] -= (hx_ - P["x"]) * 1.1 * zin
        P["x"] += (540 - hx_) * zin
        P["alpha"] = (1 - prog(t, c0 + 0.25, c0 + 0.5)) if t < c2 else prog(t, c3 - 0.35, c3)
        if t >= c2:
            P.update(x=540, scale=1.4, amp=26, freq=0.8, y=1150 + 10 * math.sin(t * 1.3))
        draw_speed_lines(ctx, t, P["x"], P["y"], (1 - prog(t, d1 - 0.1, d1 + 0.2)) if t >= d0 else 0)
        draw_shark_side(ctx, t, P)
        anchors["head"] = to_screen(P, sx(0.86), cy_(0.86, t, P) - 20)
        fa = prog(t, c0 + 0.3, c0 + 0.55) * (1 - prog(t, c2 + 0.05, c3 - 0.1))
        fsc = (0.82 + 0.18 * ease_back(prog(t, c0 + 0.3, c0 + 0.7), 1.8)) * (1 - 0.08 * ease_io(prog(t, c2, c3)))
        open_ = ease_out(prog(t, C["MOUTH"][0], C["MOUTH"][0] + 0.4)) * (1 - ease_io(prog(t, C["MOUTH"][1] - 0.3, C["MOUTH"][1])))
        if fa > 0:
            draw_shark_front(ctx, t, 540, 1150 + 8 * math.sin(t * 1.4), fsc, fa, open_, anchors)
    elif t < 16.6:                                       # 사실 2: 연골
        x0, x1 = C["XRAY"]
        xa = prog(t, x0, x0 + 0.2) * (1 - prog(t, x1 - 0.2, x1))
        draw_ocean(ctx, t)
        bubbles(ctx, t)
        draw_xray_bg(ctx, t, xa)
        P = shark_params(x=540, y=1150 + 10 * math.sin(t * 1.3), scale=1.4, amp=26, freq=0.8)
        if xa < 1:
            P["alpha"] = 1 - xa
            draw_shark_side(ctx, t, P)
        if xa > 0:
            Q = dict(P, mode="xray", alpha=xa)
            draw_shark_side(ctx, t, Q)
        anchors["body"] = to_screen(P, sx(0.45), cy_(0.45, t, P))
    elif t < 22.6:                                       # 사실 3: 전기
        draw_ocean(ctx, t)
        bubbles(ctx, t)
        fx, fy = 800, 1735
        found = C["FOUND"]
        out = ease_out(prog(t, found, found + 0.35))
        flee = ease_io(prog(t, found + 0.35, found + 1.4))
        fish_x, fish_y = fx + 650 * flee, fy - 10 - 150 * out - 60 * flee
        draw_pulses(ctx, t, fx + 40, fy - 30)
        aim = smooth(19.4, 20.4, t)
        lunge = smooth(found - 0.5, found, t)
        back = smooth(found + 0.2, found + 1.0, t)
        a0, a1 = C["AMPULLAE"]
        glow = smooth(a0, a0 + 0.3, t) * (1 - smooth(a1 - 0.3, a1, t))
        P = shark_params(x=lerp(480, 560, lunge), y=lerp(lerp(1040, 1180, aim), 1400, lunge) - 300 * back * lunge, scale=1.05,
                         rot=0.32 * aim * (1 - back) + 0.1 * lunge * (1 - back), glow=glow, amp=24, freq=1.0)
        if t >= found + 0.2:
            P["expr"] = "happy"
        draw_flatfish(ctx, fish_x, fish_y, out, t)       # 처음엔 모래 위로 눈만 빼꼼
        if found <= t < found + 0.6:                     # 모래 튀김
            ph = prog(t, found, found + 0.6)
            for k in range(8):
                ang = math.pi + (k + 0.5) / 8 * math.pi
                R.circle(ctx, fx + 140 * ph * math.cos(ang), fy - 10 + 110 * ph * math.sin(ang) + 120 * ph * ph, 12 * (1 - ph) + 3)
                ctx.set_source_rgba(*hx("#e8c98f"), 1 - ph)
                ctx.fill()
        draw_shark_side(ctx, t, P)
        anchors["snout"] = to_screen(P, sx(0.97), cy_(0.97, t, P))
        anchors["fish"] = (fish_x + 50, fish_y - 30)
    elif t < 27.6:                                       # 사실 4: 그린란드상어
        draw_ice_bg(ctx, t)
        P = shark_params(x=lerp(480, 600, prog(t, 22.6, 27.6)), y=1450 + 14 * math.sin(t * 0.7), scale=1.32, amp=20, freq=0.45,
                         mode="ice", expr="sleepy", flap=0.06)
        draw_shark_side(ctx, t, P)
        bubbles(ctx, t, 0.35)
    else:                                                # 아웃트로
        draw_ocean(ctx, t)
        bubbles(ctx, t)
        P = shark_params(x=540, y=1260 + 12 * math.sin(t * 2), scale=1.2, expr="happy" if t >= 27.75 else "normal", amp=30, freq=1.0, flap=0.35)
        draw_shark_side(ctx, t, P)
        draw_school(ctx, t)

    O.overlay(ctx, t, anchors)
    surface.flush()
    return surface


_surface = None


def frame_bytes(i):
    global _surface
    if _surface is None:
        _surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    render_frame(i / FPS, _surface)
    return bytes(_surface.get_data())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="output/shark_short_2d.mp4")
    ap.add_argument("--audio", default=None)
    ap.add_argument("--preview", default=None, help="쉼표로 구분한 시각(초) 목록 -> PNG")
    ap.add_argument("--preview-dir", default="build/shark2d_preview")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    if args.preview:
        os.makedirs(args.preview_dir, exist_ok=True)
        for s in args.preview.split(","):
            t = float(s)
            path = os.path.join(args.preview_dir, f"frame_{t:06.2f}.png")
            render_frame(t).write_to_png(path)
            print(path)
        return
    n_frames = int(round(DURATION * FPS))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if args.audio:
        cmd += ["-i", args.audio]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", str(FPS)]
    if args.audio:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += ["-movflags", "+faststart", args.out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    with Pool(args.workers) as pool:
        for i, data in enumerate(pool.imap(frame_bytes, range(n_frames), chunksize=4)):
            proc.stdin.write(data)
            if i % 60 == 0:
                print(f"frame {i}/{n_frames}", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg 인코딩 실패")
    print("완료:", args.out)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""문어 쇼츠 2D 애니메이션 렌더러.

1080x1920 / 30fps / 30초. 모든 그림은 pycairo 벡터 드로잉으로 생성하고
ffmpeg 로 인코딩한다.

사용법:
  python3 src/render.py --out output/octopus_short.mp4 --audio build/audio.wav
  python3 src/render.py --preview 1.5,5.5,12 --preview-dir build/preview
"""
import argparse
import math
import os
import subprocess
import sys
from multiprocessing import Pool

import cairo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import (W, H, FPS, DURATION, BOUNDARIES, SWIM_START, SWIM_END,  # noqa: E402
                      LAND_TIME, ECG_PERIOD, ECG_PANEL, JET_FREQ, heart_active)

TITLE_FONT = "NanumSquareRound ExtraBold"
TAU = math.tau


# ---------------------------------------------------------------- 유틸
def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


WHITE = hx("#ffffff")
YELLOW = hx("#ffd23f")
RED = hx("#ff4d6d")
CYAN = hx("#5ee0ff")
NAVY = hx("#0a1f44")
GREEN = hx("#3dff9a")

OCTO = hx("#ff6f9c")
OCTO_BACK = hx("#e3557f")
OCTO_LIGHT = hx("#ffa9c6")
OCTO_LINE = hx("#9e2d5a")
SUCKER = hx("#ffd3e1")
MOUTH = hx("#7a1f3d")


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def prog(t, a, b):
    if b <= a:
        return 1.0 if t >= a else 0.0
    return clamp((t - a) / (b - a))


def ease_io(x):
    return x * x * (3 - 2 * x)


def ease_out(x):
    return 1 - (1 - x) ** 3


def ease_in(x):
    return x ** 3


def ease_back(x, s=1.70158):
    x -= 1
    return x * x * ((s + 1) * x + s) + 1


def bump(x):
    return math.sin(math.pi * clamp(x))


def rnd(i, salt=0):
    v = math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
    return v - math.floor(v)


def mix(c1, c2, t):
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))


def ellipse(ctx, x, y, rx, ry):
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(max(rx, 1e-3), max(ry, 1e-3))
    ctx.new_sub_path()
    ctx.arc(0, 0, 1, 0, TAU)
    ctx.restore()


def circle(ctx, x, y, r):
    ctx.new_sub_path()
    ctx.arc(x, y, max(r, 1e-3), 0, TAU)


def rrect(ctx, x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    ctx.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 1.5 * math.pi)
    ctx.close_path()


def heartbeat(t, period=0.8, offset=0.0):
    ph = ((t + offset) % period) / period
    return math.exp(-((ph - 0.08) / 0.05) ** 2) + 0.55 * math.exp(-((ph - 0.28) / 0.05) ** 2)


# ---------------------------------------------------------------- 텍스트
def text_line(ctx, segs, cx, cy, size, alpha=1.0, scale=1.0, max_w=960,
              outline=None, outline_color=NAVY, shadow=True, font=TITLE_FONT):
    if isinstance(segs, str):
        segs = [(segs, WHITE)]
    if alpha <= 0.002 or scale <= 0.002:
        return
    ctx.save()
    ctx.select_font_face(font, cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
    ctx.set_font_size(size)
    widths = [ctx.text_extents(s).x_advance for s, _ in segs]
    total = sum(widths)
    if total > max_w:
        size *= max_w / total
        ctx.set_font_size(size)
        widths = [ctx.text_extents(s).x_advance for s, _ in segs]
        total = sum(widths)
    if outline is None:
        outline = size * 0.17
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    base_y = size * 0.36
    xs, x = [], -total / 2
    for w_ in widths:
        xs.append(x)
        x += w_

    def build():
        ctx.new_path()
        for (s, _), x0 in zip(segs, xs):
            ctx.move_to(x0, base_y)
            ctx.text_path(s)

    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    if shadow:
        ctx.save()
        ctx.translate(0, size * 0.08)
        build()
        ctx.set_source_rgba(0, 0, 0, 0.35 * alpha)
        ctx.set_line_width(outline)
        ctx.stroke_preserve()
        ctx.fill()
        ctx.restore()
    build()
    ctx.set_source_rgba(*outline_color, alpha)
    ctx.set_line_width(outline)
    ctx.stroke()
    for (s, col), x0 in zip(segs, xs):
        ctx.new_path()
        ctx.move_to(x0, base_y)
        ctx.text_path(s)
        ctx.set_source_rgba(*col, alpha)
        ctx.fill()
    ctx.restore()


def pop_anim(t, t_in, t_out, dur=0.32):
    """팝인/아웃 애니메이션 -> (alpha, scale)."""
    if t < t_in or t >= t_out:
        return 0.0, 0.0
    a = prog(t, t_in, t_in + dur)
    sc = 0.4 + 0.6 * ease_back(a, 2.2)
    al = clamp(a * 2.5)
    b = prog(t, t_out - 0.18, t_out)
    return al * (1 - b), sc * (1 - 0.3 * b)


# (등장, 퇴장, 종류, y, 내용)
TEXTS = [
    # 훅
    (0.30, 3.55, "title", 420, [("문어의 심장은", WHITE)]),
    (0.60, 3.55, "title", 535, [("몇 개", YELLOW), ("일까?", WHITE)]),
    (1.40, 3.55, "sub", 665, [("1개? 2개? 아니면...?", WHITE)]),
    # 사실 1
    (3.75, 10.15, "big", 470, [("정답은 ", WHITE), ("3개!", RED)]),
    (6.40, 10.15, "sub", 665, [("2개는 아가미로, 1개는 온몸으로", WHITE)]),
    (6.55, 10.15, "sub", 735, [("피를 보내요", WHITE)]),
    # 사실 2
    (10.35, 16.55, "title", 420, [("피 색깔이", WHITE)]),
    (10.60, 16.55, "title", 535, [("파란색", CYAN), ("이에요!", WHITE)]),
    (12.40, 16.55, "sub", 665, [("철 대신 ", WHITE), ("구리", YELLOW), ("로", WHITE)]),
    (12.55, 16.55, "sub", 735, [("산소를 나르기 때문이에요", WHITE)]),
    # 사실 3
    (16.75, 22.55, "title", 420, [("헤엄칠 땐", WHITE)]),
    (17.00, 22.55, "title", 535, [("심장 하나가 ", WHITE), ("멈춰요!", RED)]),
    (17.60, 19.55, "sub", 665, [("헤엄치면 금방 지치는 이유!", WHITE)]),
    (19.70, 22.55, "sub", 665, [("그래서 ", WHITE), ("기어다니는 걸", YELLOW), (" 좋아해요", WHITE)]),
    # 사실 4
    (22.75, 27.55, "title", 420, [("뇌세포(뉴런)의", WHITE)]),
    (23.00, 27.55, "title", 535, [("3분의 2", YELLOW), ("가 다리에!", WHITE)]),
    (24.80, 27.55, "sub", 665, [("다리가 ", WHITE), ("스스로", YELLOW), (" 맛보고 판단해요", WHITE)]),
    # 아웃트로
    (27.70, 30.5, "big", 440, [("신기하죠?", YELLOW)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WHITE)]),
]
TEXT_SIZE = {"title": 104, "big": 124, "sub": 56}

BADGES = [
    (3.70, 10.15, "사실 1"),
    (10.30, 16.55, "사실 2"),
    (16.70, 22.55, "사실 3"),
    (22.70, 27.55, "사실 4"),
]


def draw_texts(ctx, t):
    for t_in, t_out, kind, y, segs in TEXTS:
        al, sc = pop_anim(t, t_in, t_out)
        if al > 0:
            text_line(ctx, segs, 540, y, TEXT_SIZE[kind], alpha=al, scale=sc)


def draw_header(ctx, t):
    a = prog(t, 0.0, 0.4)
    ctx.save()
    ctx.select_font_face(TITLE_FONT)
    ctx.set_font_size(34)
    label = "신기한 바다 상식"
    w = ctx.text_extents(label).x_advance + 60
    rrect(ctx, 540 - w / 2, 145, w, 56, 28)
    ctx.set_source_rgba(0.02, 0.1, 0.25, 0.45 * a)
    ctx.fill_preserve()
    ctx.set_source_rgba(1, 1, 1, 0.35 * a)
    ctx.set_line_width(2)
    ctx.stroke()
    ctx.move_to(540 - w / 2 + 30, 185)
    ctx.set_source_rgba(1, 1, 1, 0.92 * a)
    ctx.show_text(label)
    ctx.restore()


def draw_badges(ctx, t):
    for t_in, t_out, label in BADGES:
        al, sc = pop_anim(t, t_in, t_out)
        if al <= 0:
            continue
        ctx.save()
        ctx.translate(540, 290)
        ctx.scale(max(sc, 1e-3), max(sc, 1e-3))
        ctx.rotate(-0.04)
        ctx.select_font_face(TITLE_FONT)
        ctx.set_font_size(44)
        w = ctx.text_extents(label).x_advance + 64
        rrect(ctx, -w / 2, -36 + 6, w, 72, 36)
        ctx.set_source_rgba(0, 0, 0, 0.3 * al)
        ctx.fill()
        rrect(ctx, -w / 2, -36, w, 72, 36)
        ctx.set_source_rgba(*YELLOW, al)
        ctx.fill_preserve()
        ctx.set_source_rgba(*NAVY, al)
        ctx.set_line_width(5)
        ctx.stroke()
        ctx.move_to(-w / 2 + 32, 16)
        ctx.set_source_rgba(*NAVY, al)
        ctx.show_text(label)
        ctx.restore()


# ---------------------------------------------------------------- 배경
def swim_weight(t):
    return ease_io(prog(t, SWIM_START - 0.05, SWIM_START + 0.25)) * \
        (1 - ease_io(prog(t, SWIM_END, SWIM_END + 0.4)))


def floor_shift(t):
    """헤엄쳐 올라갈 때 바닥이 아래로 멀어지는 정도."""
    return 210 * (ease_io(prog(t, SWIM_START, SWIM_START + 0.9))
                  - ease_io(prog(t, SWIM_END - 0.1, LAND_TIME)))


def draw_background(ctx, t):
    g = cairo.LinearGradient(0, 0, 0, H)
    g.add_color_stop_rgb(0.0, *hx("#33bdf0"))
    g.add_color_stop_rgb(0.45, *hx("#1375bd"))
    g.add_color_stop_rgb(1.0, *hx("#073366"))
    ctx.set_source(g)
    ctx.paint()

    # 햇살
    for i in range(6):
        x0 = 90 + i * 185 + 45 * math.sin(t * 0.45 + i * 1.7)
        w0 = 35 + 30 * rnd(i, 3)
        x1 = x0 - 260 + 90 * math.sin(t * 0.3 + i)
        w1 = w0 * 4.2
        a = 0.09 + 0.05 * math.sin(t * 0.9 + i * 2.1)
        lg = cairo.LinearGradient(0, 0, 0, 1550)
        lg.add_color_stop_rgba(0, 1, 1, 1, a)
        lg.add_color_stop_rgba(1, 1, 1, 1, 0)
        ctx.new_path()
        ctx.move_to(x0 - w0, 0)
        ctx.line_to(x0 + w0, 0)
        ctx.line_to(x1 + w1, 1550)
        ctx.line_to(x1 - w1, 1550)
        ctx.close_path()
        ctx.set_source(lg)
        ctx.fill()

    shift = floor_shift(t)

    # 멀리 있는 물고기 실루엣
    fishes = [(0.0, 1180, 70, 1, 1.0), (6.0, 760, 55, -1, 0.8), (12.0, 1420, 85, 1, 1.15),
              (19.0, 980, 60, -1, 0.9)]
    for start, fy, speed, d, sz in fishes:
        x = ((t + start) * speed) % (W + 400) - 200
        if d < 0:
            x = W - x
        y = fy + 18 * math.sin(t * 1.3 + start) + shift * 0.4
        draw_fish(ctx, x, y, sz, d, t + start)

    # 플랑크톤
    for i in range(70):
        x = rnd(i, 1) * W + 20 * math.sin(t * 0.5 + i)
        y = (rnd(i, 2) * H - t * (10 + 20 * rnd(i, 4)) + shift * (0.6 + rnd(i, 7))) % H
        r = 1.5 + 2.8 * rnd(i, 5)
        circle(ctx, x, y, r)
        ctx.set_source_rgba(1, 1, 1, 0.12 + 0.25 * rnd(i, 6))
        ctx.fill()

    ctx.save()
    ctx.translate(0, shift)
    draw_seaweed(ctx, t)
    draw_floor(ctx, t)
    ctx.restore()

    # 떠오르는 거품
    for i in range(16):
        speed = 90 + 120 * rnd(i, 11)
        r = 6 + 16 * rnd(i, 12)
        span = H + 300
        y = H + 100 - ((t * speed + rnd(i, 13) * span + shift * 1.5) % span)
        x = rnd(i, 14) * W + 18 * math.sin(t * 2.0 + i)
        draw_bubble(ctx, x, y, r, 0.55)


def draw_fish(ctx, x, y, sz, d, t):
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(d * sz, sz)
    wag = 0.25 * math.sin(t * 8)
    ctx.new_path()
    ctx.move_to(-38, 0)
    ctx.line_to(-62, -18 + 10 * wag)
    ctx.line_to(-62, 18 + 10 * wag)
    ctx.close_path()
    ellipse(ctx, 0, 0, 44, 20)
    ctx.set_source_rgba(0.02, 0.15, 0.35, 0.38)
    ctx.fill()
    circle(ctx, 24, -5, 4)
    ctx.set_source_rgba(1, 1, 1, 0.35)
    ctx.fill()
    ctx.restore()


def draw_bubble(ctx, x, y, r, a):
    circle(ctx, x, y, r)
    ctx.set_source_rgba(1, 1, 1, 0.08 * a / 0.55)
    ctx.fill_preserve()
    ctx.set_source_rgba(1, 1, 1, a)
    ctx.set_line_width(max(2.0, r * 0.15))
    ctx.stroke()
    ctx.new_path()
    ctx.arc(x, y, r * 0.62, math.pi * 1.1, math.pi * 1.45)
    ctx.set_source_rgba(1, 1, 1, a)
    ctx.set_line_width(max(2.0, r * 0.16))
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.stroke()


def draw_seaweed(ctx, t):
    strands = [(45, 520, 0.0, 30), (115, 380, 1.3, 26), (965, 470, 2.1, 30),
               (1035, 600, 0.7, 32), (205, 260, 2.8, 22), (885, 300, 3.6, 24)]
    for j, (rx, h, ph, w0) in enumerate(strands):
        base_y = 1760 if rx < 540 else 1735
        n = 18
        left, right = [], []
        pts = []
        for i in range(n + 1):
            s = i / n
            x = rx + 38 * math.sin(t * 1.2 + s * 3.2 + ph) * s
            y = base_y - h * s
            pts.append((x, y))
        for i, (x, y) in enumerate(pts):
            s = i / n
            w_ = w0 * (1 - 0.8 * s) * (1 + 0.25 * math.sin(s * 9 + ph))
            left.append((x - w_ / 2, y))
            right.append((x + w_ / 2, y))
        ctx.new_path()
        ctx.move_to(*left[0])
        for p in left[1:]:
            ctx.line_to(*p)
        ctx.arc(pts[-1][0], pts[-1][1], w0 * 0.1, math.pi, 0)
        for p in reversed(right):
            ctx.line_to(*p)
        ctx.close_path()
        col = hx("#2fb865") if j % 2 == 0 else hx("#24985a")
        ctx.set_source_rgb(*col)
        ctx.fill_preserve()
        ctx.set_source_rgb(*hx("#14663a"))
        ctx.set_line_width(4)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.stroke()


def draw_floor(ctx, t):
    ctx.new_path()
    ctx.move_to(0, 1745)
    ctx.curve_to(320, 1690, 700, 1770, W, 1712)
    ctx.line_to(W, H + 300)
    ctx.line_to(0, H + 300)
    ctx.close_path()
    g = cairo.LinearGradient(0, 1690, 0, H)
    g.add_color_stop_rgb(0, *hx("#f6d9a0"))
    g.add_color_stop_rgb(1, *hx("#cfa060"))
    ctx.set_source(g)
    ctx.fill()
    for i in range(26):
        x = rnd(i, 21) * W
        y = 1770 + rnd(i, 22) * 140
        ellipse(ctx, x, y, 6 + 8 * rnd(i, 23), 3 + 3 * rnd(i, 24))
        ctx.set_source_rgba(0.55, 0.38, 0.18, 0.25)
        ctx.fill()
    # 산호
    ctx.save()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    sway = 4 * math.sin(t * 1.5)
    branches = [((150, 1770), (150, 1640)), ((150, 1690), (95, 1620)), ((150, 1670), (205, 1590)),
                ((95, 1620), (80, 1575)), ((205, 1590), (230, 1550)), ((150, 1640), (165, 1585))]
    for width, col in ((30, hx("#b8455e")), (22, hx("#ff8a6b"))):
        for (x0, y0), (x1, y1) in branches:
            ctx.new_path()
            ctx.move_to(x0, y0)
            ctx.line_to(x1 + sway, y1)
            ctx.set_source_rgb(*col)
            ctx.set_line_width(width)
            ctx.stroke()
    ctx.restore()
    # 불가사리
    ctx.save()
    ctx.translate(930, 1805)
    ctx.rotate(0.3 + 0.05 * math.sin(t))
    ctx.new_path()
    for k in range(10):
        r = 62 if k % 2 == 0 else 26
        a = -math.pi / 2 + k * math.pi / 5
        (ctx.move_to if k == 0 else ctx.line_to)(r * math.cos(a), r * math.sin(a))
    ctx.close_path()
    ctx.set_source_rgb(*hx("#ffae3b"))
    ctx.fill_preserve()
    ctx.set_source_rgb(*hx("#c46a12"))
    ctx.set_line_width(5)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    for k in range(5):
        a = -math.pi / 2 + k * 2 * math.pi / 5
        circle(ctx, 30 * math.cos(a), 30 * math.sin(a), 4.5)
        ctx.set_source_rgba(1, 1, 1, 0.7)
        ctx.fill()
    ctx.restore()


# ---------------------------------------------------------------- 문어
# (기준 x, 기준 y, 각도(도), 길이, 레이어)  각도 0 = 아래, + = 오른쪽
ARMS = [
    (-105, 40, -84, 225, 0),
    (-40, 48, -38, 240, 0),
    (40, 48, 38, 240, 0),
    (105, 40, 84, 225, 0),
    (-125, 55, -62, 250, 1),
    (-45, 66, -18, 262, 1),
    (45, 66, 18, 262, 1),
    (128, 55, 62, 250, 1),
]
WAVE_ARM = 7


def octo_state(t):
    st = dict(x=540.0, y=1300.0, s=1.2, rot=0.0, expr="normal", look=(0.0, 0.0),
              spread=1.0, amp=0.20, freq=0.55, curl=1.0, armlen=1.0, stretch=1.0,
              wave=0.0, glasses=0.0, neuron=0.0, walk=0.0, indep=0.0, sweat=0.0)
    if t < 3.6:
        a = prog(t, 0.0, 0.9)
        st["y"] = lerp(2350, 1300, ease_back(a, 1.3))
        st["spread"] = lerp(0.35, 1.0, ease_out(a))
        st["curl"] = lerp(0.3, 1.0, ease_out(a))
        st["stretch"] = lerp(1.12, 1.0, ease_out(prog(t, 0.6, 1.1)))
        st["expr"] = "surprised" if 0.9 <= t < 1.6 else "normal"
        st["look"] = (0.0, -1.0) if t >= 0.9 else (0.0, 0.0)
    elif t < 10.2:
        st["expr"] = "happy" if 3.75 <= t < 5.7 else "normal"
        if t < 6.2:
            st["look"] = (0.0, -1.0)
        else:
            st["look"] = (math.sin((t - 6.2) * 1.4) * 0.8, -0.8)
    elif t < 16.6:
        if t < 11.5:
            st["look"] = (-0.85, -0.6)
        else:
            st["look"] = (0.85, -0.6) if t < 13.0 else (0.0, -0.3)
        st["expr"] = "surprised" if 11.5 <= t < 12.5 else ("happy" if 12.5 <= t < 14.2 else "normal")
    elif t < 22.6:
        m = swim_weight(t)
        jet = 0.5 + 0.5 * math.cos(TAU * JET_FREQ * (t - SWIM_START))
        squat = bump(prog(t, 16.95, SWIM_START))
        land = bump(prog(t, LAND_TIME, LAND_TIME + 0.3))
        st["stretch"] = lerp(1.0 - 0.07 * squat - 0.09 * land, 1.0 + 0.09 * (1 - jet), m)
        st["spread"] = lerp(1.0 + 0.2 * squat, 0.2 + 0.45 * jet, m)
        st["curl"] = lerp(1.0, 0.15 + 0.45 * jet, m)
        st["amp"] = lerp(0.20, 0.10, m)
        st["freq"] = lerp(0.55, 1.4, m)
        st["armlen"] = lerp(1.0, 1.12, m)
        rise = ease_io(prog(t, SWIM_START, SWIM_START + 0.9)) - ease_io(prog(t, SWIM_END - 0.1, LAND_TIME))
        st["y"] = 1300 - 30 * rise - 14 * (1 - jet) * m
        st["rot"] = 0.05 * math.sin(TAU * 0.7 * t) * m
        # 착지 후 기어다니기
        c = ease_io(prog(t, LAND_TIME, LAND_TIME + 0.35)) * (1 - ease_io(prog(t, 22.1, 22.6)))
        st["walk"] = c
        st["spread"] = lerp(st["spread"], 1.1, c)
        st["amp"] = lerp(st["amp"], 0.42, c)
        st["freq"] = lerp(st["freq"], 1.3, c)
        st["x"] = 540 + 120 * math.sin((t - LAND_TIME) * 1.8) * c
        st["y"] -= 7 * abs(math.sin(t * 3.6)) * c
        st["rot"] += 0.04 * math.sin(t * 3.6) * c
        if 17.5 <= t < 19.7:
            st["expr"] = "tired"
            st["sweat"] = 1.0
            st["look"] = (0.0, 0.6)
        elif t >= 20.2:
            st["expr"] = "happy"
            st["look"] = (math.copysign(0.8, math.cos((t - LAND_TIME) * 1.8)), 0.1)
        else:
            st["look"] = (0.0, -0.9)
    elif t < 27.6:
        z = ease_io(prog(t, 22.6, 23.2))
        st["s"] = lerp(1.2, 1.38, z)
        st["y"] = lerp(1300, 1352, z)
        st["neuron"] = prog(t, 23.3, 23.9)
        st["glasses"] = ease_back(prog(t, 24.0, 24.35), 2.5)
        st["indep"] = z
        st["amp"] = lerp(0.2, 0.32, z)
        st["freq"] = lerp(0.55, 0.9, z)
        st["look"] = (0.0, 0.7) if t >= 24.0 else (0.0, -0.6)
        st["expr"] = "normal"
    else:
        z = ease_io(prog(t, 27.6, 28.0))
        st["s"] = lerp(1.38, 1.2, z)
        st["y"] = lerp(1352, 1310, z)
        st["glasses"] = 1 - prog(t, 27.6, 27.8)
        st["indep"] = 1 - z
        st["wave"] = ease_io(prog(t, 27.75, 28.2))
        st["expr"] = "happy"
        st["look"] = (0.0, 0.0)
    return st


def arm_points(i, st, t, n=26):
    bx, by, ang_deg, length, layer = ARMS[i]
    ang = math.radians(ang_deg) * st["spread"]
    sign = 1 if ang_deg > 0 else -1
    curl = sign * (0.5 + 1.25 * abs(ang_deg) / 90) * st["curl"]
    length *= st["armlen"]
    freq = st["freq"] * lerp(1.0, 0.6 + 0.9 * rnd(i, 31), st["indep"])
    phase = i * 1.3 + st["walk"] * i * 2.2
    amp = st["amp"] * (1 + 0.6 * st["walk"] * math.sin(t * 3.6 + i * 1.7))
    if i == WAVE_ARM and st["wave"] > 0:
        w = st["wave"]
        bx = lerp(bx, 150, w)
        by = lerp(by, 30, w)
        ang = lerp(ang, math.radians(138 + 16 * math.sin(TAU * 1.8 * t)), w)
        curl = lerp(curl, 0.45 + 0.25 * math.sin(TAU * 1.8 * t - 1.0), w)
        amp = lerp(amp, 0.12, w)
    pts = []
    x, y = bx, by
    ds = length / n
    for k in range(n + 1):
        s = k / n
        pts.append((x, y))
        a = ang + curl * s * s + amp * math.sin(TAU * freq * t - s * 4.0 + phase) * s * 2.2
        x += math.sin(a) * ds
        y += math.cos(a) * ds
    return pts


def arm_outline(pts, w0):
    n = len(pts) - 1
    left, right, normals, widths = [], [], [], []
    for k, (x, y) in enumerate(pts):
        x0, y0 = pts[max(k - 1, 0)]
        x1, y1 = pts[min(k + 1, n)]
        tx, ty = x1 - x0, y1 - y0
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        w = w0 * (1 - 0.82 * k / n)
        left.append((x + nx * w / 2, y + ny * w / 2))
        right.append((x - nx * w / 2, y - ny * w / 2))
        normals.append((nx, ny))
        widths.append(w)
    return left, right, normals, widths


def draw_arm(ctx, pts, color, front):
    w0 = 46 if front else 40
    left, right, normals, widths = arm_outline(pts, w0)
    ctx.new_path()
    ctx.move_to(*left[0])
    for p in left[1:]:
        ctx.line_to(*p)
    tip = pts[-1]
    ctx.arc_negative(tip[0], tip[1], widths[-1] / 2,
                     math.atan2(left[-1][1] - tip[1], left[-1][0] - tip[0]),
                     math.atan2(right[-1][1] - tip[1], right[-1][0] - tip[0]))
    for p in reversed(right):
        ctx.line_to(*p)
    ctx.close_path()
    ctx.set_source_rgb(*color)
    ctx.fill_preserve()
    ctx.set_source_rgb(*OCTO_LINE)
    ctx.set_line_width(5)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    if front:
        n = len(pts) - 1
        for k in range(5, n - 2, 3):
            x, y = pts[k]
            nx, ny = normals[k]
            w = widths[k]
            sx, sy = x - nx * w * 0.2, y - ny * w * 0.2
            circle(ctx, sx, sy, w * 0.2)
            ctx.set_source_rgb(*SUCKER)
            ctx.fill_preserve()
            ctx.set_source_rgba(*OCTO_LINE, 0.6)
            ctx.set_line_width(2.5)
            ctx.stroke()


def head_path(ctx):
    ctx.new_path()
    ctx.move_to(-152, 52)
    ctx.curve_to(-182, -60, -142, -252, 0, -252)
    ctx.curve_to(142, -252, 182, -60, 152, 52)
    ctx.curve_to(100, 88, -100, 88, -152, 52)
    ctx.close_path()


def draw_octopus(ctx, st, t):
    s = st["s"]
    # 바닥 그림자
    lift = clamp((1300 - st["y"]) / 80) + clamp(floor_shift(t) / 210)
    ctx.save()
    sh_y = 1712 + floor_shift(t)
    ellipse(ctx, st["x"], sh_y, 190 * s * (1 - 0.4 * clamp(lift)), 26 * s)
    ctx.set_source_rgba(0.1, 0.05, 0.0, 0.22 * (1 - 0.7 * clamp(lift)))
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(st["x"], st["y"])
    ctx.rotate(st["rot"])
    ctx.scale(s, s)

    arms = [arm_points(i, st, t) for i in range(8)]
    for i in range(8):
        if ARMS[i][4] == 0:
            draw_arm(ctx, arms[i], OCTO_BACK, False)
    for i in range(8):
        if ARMS[i][4] == 1 and not (i == WAVE_ARM and st["wave"] > 0.3):
            draw_arm(ctx, arms[i], OCTO, True)

    # 머리
    ctx.save()
    k = st["stretch"]
    ctx.translate(0, -100)
    ctx.scale(1 / math.sqrt(k), k)
    ctx.translate(0, 100)
    head_path(ctx)
    rg = cairo.RadialGradient(-60, -170, 10, -20, -90, 280)
    rg.add_color_stop_rgb(0, *OCTO_LIGHT)
    rg.add_color_stop_rgb(0.55, *OCTO)
    rg.add_color_stop_rgb(1, *hx("#e2507f"))
    ctx.set_source(rg)
    ctx.fill_preserve()
    ctx.set_source_rgb(*OCTO_LINE)
    ctx.set_line_width(6)
    ctx.stroke()
    for (px, py, pr) in ((62, -172, 19), (100, -112, 12), (-18, -210, 10), (-112, -92, 9)):
        circle(ctx, px, py, pr)
        ctx.set_source_rgba(*hx("#c93a6c"), 0.28)
        ctx.fill()
    ctx.save()
    ctx.translate(-72, -172)
    ctx.rotate(-0.6)
    ellipse(ctx, 0, 0, 42, 20)
    ctx.set_source_rgba(1, 1, 1, 0.38)
    ctx.fill()
    ctx.restore()
    draw_face(ctx, st, t)
    ctx.restore()

    if st["wave"] > 0.3:
        draw_arm(ctx, arms[WAVE_ARM], OCTO, True)

    if st["neuron"] > 0:
        draw_neurons(ctx, arms, st, t)
    ctx.restore()


def draw_face(ctx, st, t):
    expr = st["expr"]
    lx, ly = st["look"]
    # 깜빡임
    bt = (t + 0.7) % 3.3
    openness = 1.0
    if bt < 0.14:
        openness = max(0.08, 1 - math.sin(math.pi * bt / 0.14))

    # 볼터치
    for side in (-1, 1):
        ellipse(ctx, side * 112, 34, 27, 16)
        ctx.set_source_rgba(*hx("#ff2f72"), 0.33)
        ctx.fill()

    ex_y = -18
    if expr == "happy":
        for side in (-1, 1):
            ctx.new_path()
            ctx.arc(side * 62, ex_y + 14, 27, math.pi * 1.12, math.pi * 1.88)
            ctx.set_source_rgb(*NAVY)
            ctx.set_line_width(10)
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            ctx.stroke()
    else:
        big = 1.14 if expr == "surprised" else 1.0
        pr = 16 if expr == "surprised" else 24
        for side in (-1, 1):
            ex = side * 62
            rx, ry = 40 * big, 48 * big * openness
            ctx.save()
            ellipse(ctx, ex, ex_y, rx, ry)
            ctx.set_source_rgb(1, 1, 1)
            ctx.fill_preserve()
            ctx.save()
            ctx.clip_preserve()
            px, py = ex + lx * 12, ex_y + ly * 15
            circle(ctx, px, py, pr)
            ctx.set_source_rgb(*hx("#14112b"))
            ctx.fill()
            circle(ctx, px - 8, py - 9, pr * 0.34)
            ctx.set_source_rgb(1, 1, 1)
            ctx.fill()
            circle(ctx, px + 7, py + 8, pr * 0.16)
            ctx.fill()
            if expr == "tired":
                ctx.new_path()
                ctx.rectangle(ex - 60, ex_y - 70, 120, 66)
                ctx.set_source_rgb(*hx("#ff86ad"))
                ctx.fill()
                ctx.new_path()
                ctx.move_to(ex - 50, ex_y - 4)
                ctx.line_to(ex + 50, ex_y - 4)
                ctx.set_source_rgb(*OCTO_LINE)
                ctx.set_line_width(5)
                ctx.stroke()
            ctx.restore()
            ellipse(ctx, ex, ex_y, rx, ry)
            ctx.set_source_rgb(*OCTO_LINE)
            ctx.set_line_width(5)
            ctx.stroke()
            ctx.restore()

    # 입
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    if expr == "happy":
        ctx.new_path()
        ctx.arc(0, 30, 28, 0, math.pi)
        ctx.close_path()
        ctx.set_source_rgb(*MOUTH)
        ctx.fill_preserve()
        ctx.save()
        ctx.clip()
        ellipse(ctx, 0, 56, 18, 12)
        ctx.set_source_rgb(*hx("#ff8fab"))
        ctx.fill()
        ctx.restore()
    elif expr == "surprised":
        ellipse(ctx, 0, 44, 15, 19)
        ctx.set_source_rgb(*MOUTH)
        ctx.fill()
    elif expr == "tired":
        ctx.new_path()
        for k in range(9):
            x = -28 + k * 7
            y = 46 + (5 if k % 2 else -5)
            (ctx.move_to if k == 0 else ctx.line_to)(x, y)
        ctx.set_source_rgb(*MOUTH)
        ctx.set_line_width(6)
        ctx.stroke()
    else:
        ctx.new_path()
        ctx.arc(0, 20, 26, 0.22 * math.pi, 0.78 * math.pi)
        ctx.set_source_rgb(*MOUTH)
        ctx.set_line_width(7)
        ctx.stroke()

    # 땀방울
    if st["sweat"] > 0:
        ph = (t * 1.3) % 1.0
        dx, dy = 150, -160 + 40 * ph
        a = 1 - ph
        drop_path(ctx, dx, dy, 13)
        ctx.set_source_rgba(*hx("#9fe3ff"), a)
        ctx.fill_preserve()
        ctx.set_source_rgba(*hx("#2c7fb8"), a)
        ctx.set_line_width(3)
        ctx.stroke()

    # 안경
    g = st["glasses"]
    if g > 0.01:
        ctx.save()
        ctx.translate(0, ex_y)
        ctx.scale(g, g)
        for side in (-1, 1):
            circle(ctx, side * 64, 0, 54)
            ctx.set_source_rgba(1, 1, 1, 0.18)
            ctx.fill_preserve()
            ctx.set_source_rgb(*hx("#2b2340"))
            ctx.set_line_width(9)
            ctx.stroke()
            ctx.new_path()
            ctx.move_to(side * 64 - 22, -26)
            ctx.line_to(side * 64 - 6, -38)
            ctx.set_source_rgba(1, 1, 1, 0.8)
            ctx.set_line_width(5)
            ctx.stroke()
        ctx.new_path()
        ctx.arc(0, 6, 16, math.pi * 1.15, math.pi * 1.85)
        ctx.set_source_rgb(*hx("#2b2340"))
        ctx.set_line_width(8)
        ctx.stroke()
        ctx.restore()


def draw_neurons(ctx, arms, st, t):
    a = st["neuron"]
    for i, pts in enumerate(arms):
        n = len(pts) - 1
        for k in range(3):
            s = (t * 0.55 + k / 3 + rnd(i, 41)) % 1.0
            idx = s * n
            j = int(idx)
            f = idx - j
            x0, y0 = pts[j]
            x1, y1 = pts[min(j + 1, n)]
            x, y = lerp(x0, x1, f), lerp(y0, y1, f)
            flick = 0.75 + 0.25 * math.sin(t * 12 + i * 3 + k)
            rg = cairo.RadialGradient(x, y, 0, x, y, 26)
            rg.add_color_stop_rgba(0, 1, 0.95, 0.55, 0.95 * a * flick)
            rg.add_color_stop_rgba(0.35, 1, 0.82, 0.25, 0.55 * a * flick)
            rg.add_color_stop_rgba(1, 1, 0.8, 0.2, 0)
            circle(ctx, x, y, 26)
            ctx.set_source(rg)
            ctx.fill()
            circle(ctx, x, y, 5.5)
            ctx.set_source_rgba(1, 1, 0.9, a)
            ctx.fill()


# ---------------------------------------------------------------- 장면별 그래픽
def heart_path(ctx, x, y, size):
    sc = size / 32.0
    ctx.new_path()
    for k in range(61):
        th = TAU * k / 60
        hx_ = 16 * math.sin(th) ** 3
        hy = -(13 * math.cos(th) - 5 * math.cos(2 * th) - 2 * math.cos(3 * th) - math.cos(4 * th))
        px, py = x + hx_ * sc, y + (hy - 2.5) * sc
        (ctx.move_to if k == 0 else ctx.line_to)(px, py)
    ctx.close_path()


def draw_heart(ctx, x, y, size, col=RED, alpha=1.0, line=NAVY):
    if size <= 1:
        return
    heart_path(ctx, x, y + size * 0.06, size)
    ctx.set_source_rgba(0, 0, 0, 0.25 * alpha)
    ctx.fill()
    heart_path(ctx, x, y, size)
    lg = cairo.LinearGradient(x, y - size * 0.5, x, y + size * 0.5)
    lg.add_color_stop_rgba(0, *mix(col, WHITE, 0.25), alpha)
    lg.add_color_stop_rgba(1, *mix(col, (0, 0, 0), 0.15), alpha)
    ctx.set_source(lg)
    ctx.fill_preserve()
    ctx.set_source_rgba(*line, alpha)
    ctx.set_line_width(max(3, size * 0.05))
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    ctx.save()
    ctx.translate(x - size * 0.22, y - size * 0.2)
    ctx.rotate(-0.7)
    ellipse(ctx, 0, 0, size * 0.12, size * 0.07)
    ctx.set_source_rgba(1, 1, 1, 0.7 * alpha)
    ctx.fill()
    ctx.restore()


def draw_hook_question(ctx, t):
    al, sc = pop_anim(t, 0.9, 3.55, dur=0.45)
    if al <= 0:
        return
    ctx.save()
    ctx.translate(540, 845 + 14 * math.sin(t * 4))
    ctx.rotate(0.14 * math.sin(t * 3.1))
    text_line(ctx, [("?", YELLOW)], 0, 0, 240, alpha=al, scale=sc, outline=30)
    ctx.restore()
    # 주변 반짝이
    for k in range(3):
        a = prog(t, 1.1 + k * 0.15, 1.4 + k * 0.15) * al
        if a <= 0:
            continue
        ang = -2.3 + k * 0.9
        r = 150 + 10 * math.sin(t * 5 + k)
        draw_sparkle(ctx, 540 + r * math.cos(ang), 845 + r * math.sin(ang), 26 * a, a)


def draw_sparkle(ctx, x, y, r, a, col=WHITE):
    ctx.new_path()
    for k in range(8):
        rr_ = r if k % 2 == 0 else r * 0.3
        ang = k * math.pi / 4
        (ctx.move_to if k == 0 else ctx.line_to)(x + rr_ * math.cos(ang), y + rr_ * math.sin(ang))
    ctx.close_path()
    ctx.set_source_rgba(*col, a)
    ctx.fill()


def draw_hearts_scene(ctx, t):
    if not (3.95 <= t < 10.2):
        return
    out = ease_in(prog(t, 9.95, 10.15))
    r = ease_io(prog(t, 6.2, 6.7))
    pos0 = [(310, 870, 128), (540, 870, 128), (770, 870, 128)]
    pos1 = [(285, 880, 98), (540, 855, 158), (795, 880, 98)]
    starts = [4.0, 4.5, 5.0]
    beating = clamp((t - 5.5) / 0.3)
    for i in range(3):
        a = prog(t, starts[i], starts[i] + 0.4)
        if a <= 0:
            continue
        sc = ease_back(a, 2.4)
        x = lerp(pos0[i][0], pos1[i][0], r)
        y = lerp(pos0[i][1], pos1[i][1], r)
        size = lerp(pos0[i][2], pos1[i][2], r)
        beat = heartbeat(t, 0.8, 0.12 * (i != 1)) * beating
        size *= sc * (1 + 0.09 * beat) * (1 - out)
        draw_heart(ctx, x, y, size)
        if r < 1:
            text_line(ctx, [(str(i + 1), WHITE)], x, y - size * 0.05, size * 0.5,
                      alpha=(1 - r) * clamp(a * 2), outline=size * 0.07, shadow=False)
        la = prog(t, 6.6, 6.9) * (1 - out)
        if la > 0:
            label = "온몸 심장" if i == 1 else "아가미 심장"
            fs = 40 if i == 1 else 34
            col = YELLOW if i == 1 else WHITE
            text_line(ctx, [(label, col)], x, y + size * 0.5 + 34, fs, alpha=la,
                      scale=lerp(0.6, 1, ease_back(prog(t, 6.6, 6.9))), max_w=260)


def drop_path(ctx, x, y, r):
    ctx.new_path()
    ctx.move_to(x, y - 2 * r)
    ctx.line_to(x + r * math.cos(-math.pi / 6), y + r * math.sin(-math.pi / 6))
    ctx.arc(x, y, r, -math.pi / 6, 7 * math.pi / 6)
    ctx.close_path()


def draw_drop(ctx, x, y, r, col, label, alpha=1.0):
    drop_path(ctx, x, y + r * 0.08, r)
    ctx.set_source_rgba(0, 0, 0, 0.25 * alpha)
    ctx.fill()
    drop_path(ctx, x, y, r)
    lg = cairo.LinearGradient(x, y - 2 * r, x, y + r)
    lg.add_color_stop_rgba(0, *mix(col, WHITE, 0.3), alpha)
    lg.add_color_stop_rgba(1, *mix(col, (0, 0, 0), 0.2), alpha)
    ctx.set_source(lg)
    ctx.fill_preserve()
    ctx.set_source_rgba(*NAVY, alpha)
    ctx.set_line_width(6)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    ctx.save()
    ctx.translate(x - r * 0.42, y - r * 0.35)
    ctx.rotate(-0.5)
    ellipse(ctx, 0, 0, r * 0.14, r * 0.28)
    ctx.set_source_rgba(1, 1, 1, 0.6 * alpha)
    ctx.fill()
    ctx.restore()
    text_line(ctx, [(label, WHITE)], x + 4, y + r * 0.05, r * 0.62, alpha=alpha,
              outline=r * 0.1, shadow=False)


def draw_blood_scene(ctx, t):
    if not (10.85 <= t < 16.6):
        return
    out = ease_in(prog(t, 16.35, 16.55))
    items = [(10.9, 300, hx("#ff3b4e"), "Fe", "사람"), (11.5, 780, hx("#3b8bff"), "Cu", "문어")]
    for t0, x, col, el, who in items:
        a = prog(t, t0, t0 + 0.4)
        if a <= 0:
            continue
        sc = ease_back(a, 2.4) * (1 - out)
        r = 66 * sc
        y = 925 + 8 * math.sin(t * 2.4 + x)
        draw_drop(ctx, x, y, r, col, el)
        text_line(ctx, [(who, YELLOW if who == "문어" else WHITE)], x, y + 66 + 42, 40,
                  alpha=clamp(a * 2) * (1 - out), scale=sc)
    va = prog(t, 11.25, 11.5) * (1 - out)
    if va > 0:
        text_line(ctx, [("VS", WHITE)], 540, 880, 64, alpha=va,
                  scale=ease_back(prog(t, 11.25, 11.55), 2.5))
    # 파란 피 반짝이
    if t >= 11.6:
        for k in range(5):
            ph = ((t - 11.6) * 1.2 + k / 5) % 1.0
            ang = k * TAU / 5 + t * 0.8
            rr_ = 95 + 25 * ph
            a = bump(ph) * (1 - out)
            draw_sparkle(ctx, 780 + rr_ * math.cos(ang), 880 + rr_ * math.sin(ang) * 0.9,
                         18 * a + 4, a, CYAN if k % 2 else WHITE)


def ecg_wave(tau):
    ph = (tau % ECG_PERIOD) / ECG_PERIOD

    def g(mu, sig):
        return math.exp(-0.5 * ((ph - mu) / sig) ** 2)
    return (0.12 * g(0.12, 0.03) - 0.18 * g(0.265, 0.012) + 1.0 * g(0.30, 0.016)
            - 0.3 * g(0.335, 0.014) + 0.22 * g(0.56, 0.045))


def draw_ecg_scene(ctx, t):
    t0, t1 = ECG_PANEL
    if not (t0 <= t < t1):
        return
    a = ease_back(prog(t, t0, t0 + 0.35), 2.0)
    out = prog(t, t1 - 0.2, t1)
    al = clamp(prog(t, t0, t0 + 0.2) * 2) * (1 - out)
    cx, cy, w, h = 540, 855, 780, 160
    ctx.save()
    ctx.translate(cx, cy)
    k_ = max(a * (1 - 0.3 * out), 1e-3)
    ctx.scale(k_, k_)
    rrect(ctx, -w / 2, -h / 2 + 8, w, h, 30)
    ctx.set_source_rgba(0, 0, 0, 0.3 * al)
    ctx.fill()
    rrect(ctx, -w / 2, -h / 2, w, h, 30)
    ctx.set_source_rgba(0.03, 0.08, 0.17, 0.9 * al)
    ctx.fill_preserve()
    active = heart_active(t)
    edge = GREEN if active else RED
    ctx.set_source_rgba(*edge, 0.7 * al)
    ctx.set_line_width(5)
    ctx.stroke()
    # 격자
    ctx.save()
    rrect(ctx, -w / 2, -h / 2, w, h, 30)
    ctx.clip()
    for gx in range(-w // 2 + 150, w // 2, 36):
        ctx.new_path()
        ctx.move_to(gx, -h / 2)
        ctx.line_to(gx, h / 2)
        ctx.set_source_rgba(*GREEN, 0.08 * al)
        ctx.set_line_width(2)
        ctx.stroke()
    for gy in range(-h // 2 + 16, h // 2, 36):
        ctx.new_path()
        ctx.move_to(-w / 2 + 150, gy)
        ctx.line_to(w / 2, gy)
        ctx.set_source_rgba(*GREEN, 0.08 * al)
        ctx.stroke()
    ctx.restore()
    # 심장 아이콘
    beat = 0.0
    if active:
        ph = (t % ECG_PERIOD) / ECG_PERIOD
        beat = math.exp(-((ph - 0.31) / 0.06) ** 2)
    hcol = RED if active else hx("#7b8496")
    draw_heart(ctx, -w / 2 + 78, -14, 74 * (1 + 0.14 * beat), hcol, al)
    text_line(ctx, [("온몸 심장", WHITE)], -w / 2 + 78, 52, 28, alpha=al, outline=5,
              shadow=False, max_w=130)
    # 파형
    x_left, x_right = -w / 2 + 150, w / 2 - 34
    span = x_right - x_left
    speed = 300.0
    pts = []
    px = 0
    while px <= span:
        tau = t - (span - px) / speed
        v = ecg_wave(tau) if heart_active(tau) else 0.0
        pts.append((x_left + px, 22 - v * 92))
        px += 3
    for lw, la in ((14, 0.22), (5, 1.0)):
        ctx.new_path()
        ctx.move_to(*pts[0])
        for p in pts[1:]:
            ctx.line_to(*p)
        ctx.set_source_rgba(*GREEN, la * al)
        ctx.set_line_width(lw)
        ctx.set_line_join(cairo.LINE_JOIN_ROUND)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    ex, ey = pts[-1]
    circle(ctx, ex, ey, 9)
    ctx.set_source_rgba(1, 1, 1, al)
    ctx.fill()
    # 상태 표시
    if active:
        text_line(ctx, [("두근두근", GREEN)], w / 2 - 115, -h / 2 + 34, 32, alpha=al,
                  outline=6, shadow=False)
    else:
        blink = 1.0 if (t * 3) % 1.0 < 0.7 else 0.45
        text_line(ctx, [("멈춤!", RED)], w / 2 - 100, -h / 2 + 38, 44, alpha=al * blink,
                  outline=8, outline_color=WHITE, shadow=False)
    ctx.restore()


def draw_swim_fx(ctx, st, t):
    m = swim_weight(t)
    if m <= 0.01:
        return
    # 속도선
    for i in range(12):
        ph = (t * 1.6 + rnd(i, 51)) % 1.0
        x = 540 + (rnd(i, 52) - 0.5) * 760
        if abs(x - 540) < 230:
            x += math.copysign(230, x - 540)
        y = 760 + ph * 1100
        L = 90 + 80 * rnd(i, 53)
        ctx.new_path()
        ctx.move_to(x, y)
        ctx.line_to(x, y + L)
        ctx.set_source_rgba(1, 1, 1, 0.45 * m * bump(ph))
        ctx.set_line_width(5)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        ctx.stroke()
    # 분사 거품
    k0 = int((t - SWIM_START) * JET_FREQ)
    for k in range(max(0, k0 - 2), k0 + 1):
        tb = SWIM_START + (k + 0.5) / JET_FREQ
        if tb > SWIM_END:
            continue
        age = t - tb
        if not (0 <= age < 1.1):
            continue
        for b in range(7):
            bx = st["x"] + (rnd(k * 7 + b, 61) - 0.5) * 150
            by = st["y"] + 260 + age * (160 + 120 * rnd(k * 7 + b, 62))
            r = (8 + 12 * rnd(k * 7 + b, 63)) * (0.6 + age * 0.6)
            draw_bubble(ctx, bx, by, r, 0.75 * (1 - age / 1.1))


def draw_pie_scene(ctx, t):
    if not (23.15 <= t < 27.6):
        return
    a = ease_back(prog(t, 23.2, 23.55), 2.0)
    out = prog(t, 27.35, 27.55)
    fill = ease_io(prog(t, 23.35, 24.1))
    al = (1 - out)
    cx, cy, r = 540, 865, 100 * a * (1 - 0.3 * out)
    circle(ctx, cx, cy + 8, r)
    ctx.set_source_rgba(0, 0, 0, 0.25 * al)
    ctx.fill()
    circle(ctx, cx, cy, r)
    ctx.set_source_rgba(*hx("#ff8fb1"), al)
    ctx.fill()
    start = -math.pi / 2
    end = start + TAU * (2 / 3) * fill
    if fill > 0:
        ctx.new_path()
        ctx.move_to(cx, cy)
        ctx.arc(cx, cy, r, start, end)
        ctx.close_path()
        ctx.set_source_rgba(*YELLOW, al)
        ctx.fill()
    circle(ctx, cx, cy, r)
    ctx.set_source_rgba(*NAVY, al)
    ctx.set_line_width(6)
    ctx.stroke()
    if fill > 0.02:
        for ang in (start, end):
            ctx.new_path()
            ctx.move_to(cx, cy)
            ctx.line_to(cx + r * math.cos(ang), cy + r * math.sin(ang))
            ctx.set_source_rgba(*NAVY, al)
            ctx.set_line_width(5)
            ctx.stroke()
    la = prog(t, 23.9, 24.2) * al
    if la > 0:
        ang = start + TAU / 3
        text_line(ctx, [("다리", NAVY)], cx + r * 0.45 * math.cos(ang), cy + r * 0.45 * math.sin(ang) - 14,
                  34, alpha=la, outline=0.1, shadow=False)
        text_line(ctx, [("2/3", NAVY)], cx + r * 0.45 * math.cos(ang), cy + r * 0.45 * math.sin(ang) + 22,
                  30, alpha=la, outline=0.1, shadow=False)
        ang2 = start - TAU / 6
        text_line(ctx, [("머리", NAVY)], cx + r * 0.52 * math.cos(ang2), cy + r * 0.52 * math.sin(ang2) - 2,
                  26, alpha=la, outline=0.1, shadow=False)
    # 반짝
    for k in range(4):
        ph = ((t - 23.4) * 0.9 + k / 4) % 1.0
        ang = k * TAU / 4 + 0.6
        draw_sparkle(ctx, cx + (r + 34) * math.cos(ang), cy + (r + 34) * math.sin(ang),
                     16 * bump(ph) + 2, bump(ph) * al * prog(t, 23.4, 23.7))


def draw_outro(ctx, t):
    if t < 28.1:
        return
    a = ease_back(prog(t, 28.15, 28.5), 2.2)
    tap = 28.8
    press = 1 - 0.1 * bump(prog(t, tap - 0.05, tap + 0.15))
    done = t >= tap + 0.05
    cx, cy, w, h = 540, 790, 400, 124
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(max(a * press, 1e-3), max(a * press, 1e-3))
    rrect(ctx, -w / 2, -h / 2 + 10, w, h, h / 2)
    ctx.set_source_rgba(0, 0, 0, 0.3)
    ctx.fill()
    rrect(ctx, -w / 2, -h / 2, w, h, h / 2)
    ctx.set_source_rgb(*(hx("#5b6474") if done else hx("#ff2e3d")))
    ctx.fill_preserve()
    ctx.set_source_rgb(*NAVY)
    ctx.set_line_width(6)
    ctx.stroke()
    text_line(ctx, [("구독 완료!" if done else "구독", WHITE)], 0, 0, 56, outline=6,
              shadow=False, max_w=w - 60)
    ctx.restore()
    # 터치 표시
    if t >= 28.4:
        mv = ease_io(prog(t, 28.4, tap))
        fx = lerp(860, cx + 165, mv)
        fy = lerp(1060, cy + 40, mv)
        fade = 1 - prog(t, tap + 0.4, tap + 0.7)
        circle(ctx, fx, fy, 30)
        ctx.set_source_rgba(1, 1, 1, 0.85 * fade)
        ctx.fill_preserve()
        ctx.set_source_rgba(*NAVY, 0.8 * fade)
        ctx.set_line_width(5)
        ctx.stroke()
        if t >= tap:
            rp = prog(t, tap, tap + 0.5)
            circle(ctx, fx, fy, 30 + 90 * ease_out(rp))
            ctx.set_source_rgba(1, 1, 1, 0.8 * (1 - rp))
            ctx.set_line_width(6)
            ctx.stroke()
    if done:
        for k in range(8):
            ph = prog(t, tap + 0.05, tap + 0.8)
            ang = k * TAU / 8
            rr_ = 150 + 140 * ease_out(ph)
            draw_sparkle(ctx, cx + rr_ * math.cos(ang), cy + rr_ * 0.55 * math.sin(ang),
                         22 * (1 - ph) + 1, 1 - ph, YELLOW if k % 2 else WHITE)


def draw_transition(ctx, t):
    for tb in BOUNDARIES:
        age = t - tb + 0.3
        if not (0 <= age < 0.75):
            continue
        for i in range(34):
            sp = 3200 * (0.7 + 0.6 * rnd(i, 71))
            y = H + 120 - age * sp + rnd(i, 72) * 300
            x = rnd(i, 73) * W + 30 * math.sin(age * 10 + i)
            r = 12 + 34 * rnd(i, 74)
            draw_bubble(ctx, x, y, r, 0.75)


def draw_vignette(ctx):
    rg = cairo.RadialGradient(540, 900, 500, 540, 960, 1250)
    rg.add_color_stop_rgba(0, 0, 0, 0, 0)
    rg.add_color_stop_rgba(1, 0, 0, 0.08, 0.45)
    ctx.set_source(rg)
    ctx.paint()


PUNCHES = [3.75, 4.0, 4.5, 5.0, 11.6, 17.32, 20.15, 23.0, 28.8]


def camera_zoom(t):
    z = 1.0
    for tp in PUNCHES:
        if t >= tp:
            z += 0.028 * math.exp(-(t - tp) / 0.12)
    return z


# ---------------------------------------------------------------- 프레임
def render_frame(t, surface=None):
    if surface is None:
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surface)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    z = camera_zoom(t)
    ctx.translate(W / 2, H / 2)
    ctx.scale(z, z)
    ctx.translate(-W / 2, -H / 2)

    st = octo_state(t)
    draw_background(ctx, t)
    draw_swim_fx(ctx, st, t)
    draw_octopus(ctx, st, t)
    draw_vignette(ctx)

    draw_hook_question(ctx, t)
    draw_hearts_scene(ctx, t)
    draw_blood_scene(ctx, t)
    draw_ecg_scene(ctx, t)
    draw_pie_scene(ctx, t)
    draw_outro(ctx, t)

    draw_header(ctx, t)
    draw_badges(ctx, t)
    draw_texts(ctx, t)
    draw_transition(ctx, t)
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
    ap.add_argument("--out", default="output/octopus_short.mp4")
    ap.add_argument("--audio", default=None)
    ap.add_argument("--preview", default=None, help="쉼표로 구분한 시각(초) 목록 -> PNG")
    ap.add_argument("--preview-dir", default="build/preview")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()

    if args.preview:
        os.makedirs(args.preview_dir, exist_ok=True)
        for s in args.preview.split(","):
            t = float(s)
            surf = render_frame(t)
            path = os.path.join(args.preview_dir, f"frame_{t:06.2f}.png")
            surf.write_to_png(path)
            print(path)
        return

    n_frames = int(round(DURATION * FPS))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if args.audio:
        cmd += ["-i", args.audio]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-r", str(FPS)]
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

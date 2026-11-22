"""해달 편 자막/UI 오버레이. src/composite3d.py --overlay otter/overlay.py 로 사용.

공용 UI(배지, 헤더, 전환 거품, 구독 버튼)는 문어 편 코드(src/render.py)를 그대로 쓰고,
해달 편 전용 요소(자막, Zzz, 카운터, 주머니 강조, '톡!' 효과, 하트)만 여기서 그린다.
"""
import importlib.util
import math
import os
import sys

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("otter_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
C = T.CUES
WH, YE = R.WHITE, R.YELLOW

TEXTS = [
    (0.30, 3.55, "title", 420, [("해달은 왜", WH)]),
    (0.60, 3.55, "title", 535, [("손잡고", YE), (" 잘까?", WH)]),
    (1.40, 3.55, "sub", 665, [("귀여운 이유가 있어요!", WH)]),
    (3.75, 10.15, "title", 420, [("자다가", WH)]),
    (4.00, 10.15, "title", 535, [("떠내려가지 않게!", YE)]),
    (6.40, 10.15, "sub", 665, [("해초", YE), ("를 몸에 감고 자기도 해요", WH)]),
    (10.35, 16.55, "title", 420, [("털이 세상에서", WH)]),
    (10.60, 16.55, "title", 535, [("가장 빽빽해요!", YE)]),
    (12.40, 16.55, "sub", 665, [("1제곱센티미터에 최대 ", WH), ("15만 가닥", YE)]),
    (16.75, 22.55, "title", 420, [("겨드랑이에", WH)]),
    (17.00, 22.55, "title", 535, [("비밀 주머니", YE), ("가 있어요!", WH)]),
    (19.70, 22.55, "sub", 665, [("제일 좋아하는 ", WH), ("돌", YE), ("을 넣고 다녀요", WH)]),
    (22.75, 27.55, "title", 420, [("그 돌로", WH)]),
    (23.00, 27.55, "title", 535, [("조개를 깨 먹어요!", YE)]),
    (24.80, 27.55, "sub", 665, [("도구", YE), ("를 쓰는 똑똑한 동물", WH)]),
    (27.70, 30.5, "big", 440, [("귀엽죠?", YE)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WH)]),
]
PUNCHES = [3.75, 11.0, 17.8] + C["HITS"] + [C["CLAM_OPEN"], 28.8]


def camera_zoom(t):
    z = 1.0
    for tp in PUNCHES:
        if t >= tp:
            z += 0.024 * math.exp(-(t - tp) / 0.12)
    return z


def draw_texts(ctx, t):
    for t_in, t_out, kind, y, segs in TEXTS:
        al, sc = R.pop_anim(t, t_in, t_out)
        if al > 0:
            R.text_line(ctx, segs, 540, y, R.TEXT_SIZE[kind], alpha=al, scale=sc)


def draw_top_shade(ctx):
    g = cairo.LinearGradient(0, 0, 0, 1000)
    g.add_color_stop_rgba(0, 0.0, 0.08, 0.2, 0.38)
    g.add_color_stop_rgba(1, 0.0, 0.08, 0.2, 0.0)
    ctx.set_source(g)
    ctx.rectangle(0, 0, 1080, 1000)
    ctx.fill()


def draw_hook_sparkles(ctx, t):
    al, _ = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    for k in range(3):
        a = R.prog(t, 1.1 + k * 0.15, 1.4 + k * 0.15) * al
        if a > 0:
            ang = -2.3 + k * 0.9
            r = 150 + 10 * math.sin(t * 5 + k)
            R.draw_sparkle(ctx, 540 + r * math.cos(ang), 800 + r * math.sin(ang), 24 * a, a)


def draw_zzz(ctx, t, anchors):
    s0, s1 = C["SLEEP"]
    fade = R.prog(t, s0 + 0.2, s0 + 0.6) * (1 - R.prog(t, s1 - 0.3, s1))
    if fade <= 0:
        return
    for key, off in (("head_a", 0.0), ("head_b", 0.5)):
        if key not in anchors:
            continue
        hx_, hy = anchors[key]
        for k in range(3):
            ph = ((t - s0) * 0.55 + k / 3 + off) % 1.0
            a = R.bump(ph) * fade
            x = hx_ + 70 + ph * 80 + 12 * math.sin(t * 3 + k)
            y = hy - 80 - ph * 170
            R.text_line(ctx, [("Z", WH)], x, y, 52 + 40 * ph, alpha=a, outline=10)


def draw_hands_heart(ctx, t, anchors):
    if "hands" not in anchors:
        return
    a1 = R.prog(t, C["B_IN"][1] + 0.1, C["B_IN"][1] + 0.4) * (1 - R.prog(t, 6.1, 6.35))
    a2 = R.prog(t, C["B_IN2"][1] + 0.1, C["B_IN2"][1] + 0.4)
    a = max(a1, a2)
    if a <= 0:
        return
    x, y = anchors["hands"]
    beat = R.heartbeat(t, 0.8)
    size = 64 * R.ease_back(min(1.0, a * 1.2), 2.2) * (1 + 0.1 * beat)
    R.draw_heart(ctx, x, y - 70, size, R.hx("#ff4f7b"), min(1.0, a * 1.5))


def draw_count(ctx, t, anchors):
    c0, c1 = C["COUNT"]
    if not (c0 <= t < C["PATCH"][1]):
        return
    a = R.prog(t, c0, c0 + 0.25) * (1 - R.prog(t, C["PATCH"][1] - 0.2, C["PATCH"][1]))
    v = int(round(150000 * R.ease_out(R.prog(t, c0, c1)) / 100) * 100)
    pop = 1 + 0.18 * R.bump(R.prog(t, c1, c1 + 0.3))
    R.text_line(ctx, [(f"{v:,}", YE)], 765, 815, 78, alpha=a, scale=pop, max_w=380)
    R.text_line(ctx, [("가닥", WH)], 765, 895, 46, alpha=a)


def draw_pouch(ctx, t, anchors):
    if "armpit" not in anchors:
        return
    a = R.prog(t, C["ARM_UP"][0] + 0.35, C["ARM_UP"][0] + 0.6) * (1 - R.prog(t, C["ROCK_OUT"] + 1.6, C["ROCK_OUT"] + 1.9))
    if a > 0:
        x, y = anchors["armpit"]
        r = 70 + 6 * math.sin(t * 6)
        ctx.save()
        ctx.set_dash([16, 11], -t * 40)
        ctx.new_path()
        ctx.arc(x, y, r, 0, math.tau)
        ctx.set_source_rgba(*R.NAVY, 0.6 * a)
        ctx.set_line_width(11)
        ctx.stroke()
        ctx.new_path()
        ctx.arc(x, y, r, 0, math.tau)
        ctx.set_source_rgba(*YE, a)
        ctx.set_line_width(6)
        ctx.stroke()
        ctx.restore()
        R.text_line(ctx, [("비밀 주머니", YE)], max(150, x - 20), y + r + 42, 44, alpha=a, scale=R.ease_back(min(1, a), 2.0))
    # 돌이 나올 때 하트
    h0 = C["ROCK_OUT"]
    if "rock" in anchors and h0 <= t < h0 + 1.4:
        x, y = anchors["rock"]
        for k in range(4):
            ph = R.prog(t, h0 + 0.3 + k * 0.12, h0 + 1.2 + k * 0.12)
            if 0 < ph < 1:
                ang = -math.pi / 2 + (k - 1.5) * 0.7
                d = 70 + 90 * ph
                R.draw_heart(ctx, x + d * math.cos(ang), y + d * math.sin(ang) - 20, 34 * (1 - ph * 0.4),
                             R.hx("#ff5c8a"), 1 - ph)


def draw_hits(ctx, t, anchors):
    if "clam" not in anchors:
        return
    x, y = anchors["clam"]
    for k, h in enumerate(C["HITS"]):
        age = t - h
        if 0 <= age < 0.38:
            p = age / 0.38
            ctx.save()
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            for i in range(8):
                ang = i * math.tau / 8 + k * 0.3
                r0, r1 = 50 + 60 * p, 80 + 90 * p
                ctx.new_path()
                ctx.move_to(x + r0 * math.cos(ang), y + 20 + r0 * math.sin(ang))
                ctx.line_to(x + r1 * math.cos(ang), y + 20 + r1 * math.sin(ang))
                ctx.set_source_rgba(1, 1, 1, 0.9 * (1 - p))
                ctx.set_line_width(7 * (1 - p) + 1)
                ctx.stroke()
            ctx.restore()
            side = -1 if k % 2 == 0 else 1
            R.text_line(ctx, [("톡!", YE)], x + side * 175, y - 40 - 30 * p, 64,
                        alpha=1 - R.prog(age, 0.25, 0.38), scale=0.7 + 0.3 * R.ease_back(min(1, age / 0.12), 2.5))
    o = C["CLAM_OPEN"]
    if o <= t < o + 1.0:
        for i in range(8):
            ph = R.prog(t, o, o + 0.9)
            ang = i * math.tau / 8 + 0.2
            d = 70 + 110 * R.ease_out(ph)
            R.draw_sparkle(ctx, x + d * math.cos(ang), y + d * 0.7 * math.sin(ang), 24 * (1 - ph) + 2, 1 - ph,
                           YE if i % 2 else WH)


def overlay(ctx, t, anchors):
    draw_top_shade(ctx)
    R.draw_vignette(ctx)
    draw_hook_sparkles(ctx, t)
    draw_zzz(ctx, t, anchors)
    draw_hands_heart(ctx, t, anchors)
    draw_count(ctx, t, anchors)
    draw_pouch(ctx, t, anchors)
    draw_hits(ctx, t, anchors)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    draw_texts(ctx, t)
    R.draw_transition(ctx, t)

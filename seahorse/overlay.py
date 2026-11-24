"""해마 편 자막/UI 오버레이. src/composite3d.py --overlay seahorse/overlay.py 로 사용.

공용 UI(배지, 헤더, 전환 거품, 구독 버튼)는 src/render.py 를 그대로 쓰고,
해마 편 전용 요소(자막, 엄마/아빠 라벨, 배 주머니 강조, 카운터, 눈 화살표, 속도계)만 여기서 그린다.
"""
import importlib.util
import math
import os
import sys

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("seahorse_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
C = T.CUES
WH, YE, CY = R.WHITE, R.YELLOW, R.CYAN
PINK = R.hx("#ff8fb8")

TEXTS = [
    (0.30, 3.55, "title", 420, [("아빠가 아기를", WH)]),
    (0.60, 3.55, "title", 535, [("낳는", YE), (" 동물이 있다?", WH)]),
    (1.40, 3.55, "sub", 665, [("정답은 바로...?", WH)]),
    (3.75, 10.15, "big", 470, [("정답은 ", WH), ("해마!", YE)]),
    (6.40, 10.15, "sub", 665, [("아빠", YE), ("가 배 주머니에서 알을 키워요", WH)]),
    (10.35, 16.55, "title", 420, [("한 번에", WH)]),
    (10.60, 16.55, "title", 535, [("천 마리", YE), (" 넘게 태어나요!", WH)]),
    (12.40, 16.55, "sub", 665, [("아빠가 배를 꿈틀거려 내보내요", WH)]),
    (16.75, 22.55, "title", 420, [("두 눈을", WH)]),
    (17.00, 22.55, "title", 535, [("따로따로", YE), (" 움직여요!", WH)]),
    (19.70, 22.55, "sub", 665, [("한쪽은 위, 한쪽은 아래를 봐요", WH)]),
    (22.75, 27.55, "title", 420, [("세상에서 가장", WH)]),
    (23.00, 27.55, "title", 535, [("느린 물고기!", YE)]),
    (24.80, 27.55, "sub", 665, [("난쟁이해마", YE), (": 한 시간에 약 1.5m", WH)]),
    (27.70, 30.5, "big", 440, [("신기하죠?", YE)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WH)]),
]
PUNCHES = [C["REVEAL"][0] + 0.3, C["BIRTH"][0], C["COUNT"][1], C["EYES"][0], 28.8]


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


def chip(ctx, text, x, y, a, col=YE, size=40):
    if a > 0:
        R.text_line(ctx, [(text, col)], x, y, size, alpha=a, scale=R.ease_back(min(1.0, a), 2.0))


def draw_hook_sparkles(ctx, t):
    al, _ = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    for k in range(3):
        a = R.prog(t, 1.1 + k * 0.15, 1.4 + k * 0.15) * al
        if a > 0:
            ang = -2.3 + k * 0.9
            r = 150 + 10 * math.sin(t * 5 + k)
            R.draw_sparkle(ctx, 540 + r * math.cos(ang), 800 + r * math.sin(ang), 24 * a, a)


def draw_reveal(ctx, t, anchors):
    r0 = C["REVEAL"][1] - 0.2
    if "male" not in anchors or not (r0 <= t < r0 + 1.0):
        return
    x, y = anchors["male"]
    ph = R.prog(t, r0, r0 + 0.9)
    for i in range(10):
        ang = i * math.tau / 10 + 0.3
        d = 120 + 180 * R.ease_out(ph)
        R.draw_sparkle(ctx, x + d * math.cos(ang), y + 120 + d * 0.9 * math.sin(ang), 28 * (1 - ph) + 3, 1 - ph,
                       YE if i % 2 else WH)


def draw_parents(ctx, t, anchors):
    f0, f1, f2, f3 = C["FEMALE"]
    a = R.prog(t, f1 - 0.1, f1 + 0.2) * (1 - R.prog(t, f2 - 0.15, f2 + 0.05))
    if a > 0:
        if "female" in anchors:
            x, y = anchors["female"]
            chip(ctx, "엄마", x, y - 95, a, PINK, 44)
        if "male" in anchors:
            x, y = anchors["male"]
            chip(ctx, "아빠", x, y - 95, a, YE, 44)


def draw_pouch(ctx, t, anchors):
    if "pouch" not in anchors:
        return
    p0, p1 = C["POUCH"]
    a = R.prog(t, p0, p0 + 0.3) * (1 - R.prog(t, p1 - 0.25, p1))
    if a <= 0:
        return
    x, y = anchors["pouch"]
    r = 88 + 6 * math.sin(t * 6)
    ctx.save()
    ctx.set_dash([16, 11], -t * 40)
    for lw, col, al in ((11, R.NAVY, 0.6), (6, YE, 1.0)):
        ctx.new_path()
        ctx.arc(x, y, r, 0, math.tau)
        ctx.set_source_rgba(*col, al * a)
        ctx.set_line_width(lw)
        ctx.stroke()
    ctx.restore()
    chip(ctx, "배 주머니", min(900, x + 150), y + 10, a, YE, 42)


def draw_count(ctx, t):
    c0, c1 = C["COUNT"]
    if not (c0 <= t < 16.35):
        return
    a = R.prog(t, c0, c0 + 0.25) * (1 - R.prog(t, 16.1, 16.35))
    v = int(round(1000 * R.ease_out(R.prog(t, c0, c1)) / 10) * 10)
    pop = 1 + 0.2 * R.bump(R.prog(t, c1, c1 + 0.3))
    label = f"{v:,}" + ("+" if v >= 1000 else "")
    R.text_line(ctx, [(label, YE)], 270, 860, 92, alpha=a, scale=pop, max_w=420)
    R.text_line(ctx, [("마리", WH)], 270, 950, 46, alpha=a)


def eye_pitch(t):
    u = t - C["EYES"][0]
    ph2 = R.ease_io(R.prog(u, 1.9, 2.2))
    a = R.lerp(-0.75, 0.75 * math.sin(u * 2.1), ph2)
    b = R.lerp(0.75, -0.75 * math.sin(u * 2.1 + 0.35), ph2)
    return a, b


def arrow(ctx, x, y, down, a, scale=1.0):
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(scale, scale if down else -scale)
    ctx.new_path()
    ctx.move_to(-14, -40)
    ctx.line_to(14, -40)
    ctx.line_to(14, 4)
    ctx.line_to(32, 4)
    ctx.line_to(0, 42)
    ctx.line_to(-32, 4)
    ctx.line_to(-14, 4)
    ctx.close_path()
    ctx.set_source_rgba(*YE, a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(5)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    ctx.restore()


def draw_eye_arrows(ctx, t, anchors):
    e0, e1 = C["EYES"]
    if not (e0 <= t < e1) or "eyeA" not in anchors:
        return
    fade = R.prog(t, e0, e0 + 0.3) * (1 - R.prog(t, e1 - 0.3, e1))
    pa, pb = eye_pitch(t)
    (xa, ya), (xb, yb) = anchors["eyeA"], anchors["eyeB"]
    left, right = ((xa, ya, pa), (xb, yb, pb)) if xa < xb else ((xb, yb, pb), (xa, ya, pa))
    for (x, y, p), dx in ((left, -130), (right, 130)):
        s = min(1.0, abs(p) / 0.5)
        if s > 0.05:
            arrow(ctx, x + dx, y + (40 if p > 0 else -40), p > 0, fade * s, 1.0)
    if t < e0 + 1.9:
        a = fade * R.prog(t, e0 + 0.2, e0 + 0.5)
        chip(ctx, "위!" if pa < 0 else "아래!", left[0] - 130, left[1] - 120 if left[2] < 0 else left[1] + 130, a, WH, 40)
        chip(ctx, "위!" if pb < 0 else "아래!", right[0] + 130, right[1] - 120 if right[2] < 0 else right[1] + 130, a, WH, 40)


def draw_speedometer(ctx, t, anchors):
    s0, s1 = C["SLOW"]
    if not (s0 <= t < s1):
        return
    a = R.prog(t, s0, s0 + 0.3) * (1 - R.prog(t, s1 - 0.25, s1))
    sc = max(R.ease_back(R.prog(t, s0, s0 + 0.4), 2.0), 1e-3)
    cx, cy, r = 820, 900, 110
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(sc, sc)
    ctx.new_path()
    ctx.arc(0, 0, r, math.pi, 2 * math.pi)
    ctx.close_path()
    ctx.set_source_rgba(1, 1, 1, 0.9 * a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(7)
    ctx.stroke()
    for k in range(7):
        ang = math.pi + k * math.pi / 6
        ctx.new_path()
        ctx.move_to(math.cos(ang) * (r - 8), math.sin(ang) * (r - 8))
        ctx.line_to(math.cos(ang) * (r - 26), math.sin(ang) * (r - 26))
        ctx.set_source_rgba(*R.NAVY, a)
        ctx.set_line_width(5)
        ctx.stroke()
    ang = math.pi + 0.05 + 0.04 * math.sin(t * 9)
    ctx.new_path()
    ctx.move_to(0, 0)
    ctx.line_to(math.cos(ang) * (r - 18), math.sin(ang) * (r - 18))
    ctx.set_source_rgba(*R.RED, a)
    ctx.set_line_width(9)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.stroke()
    R.circle(ctx, 0, 0, 12)
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.fill()
    ctx.restore()
    R.text_line(ctx, [("시속 ", WH), ("1.5m", YE)], cx, cy + 50, 42, alpha=a, scale=sc)
    if "snail" in anchors:
        x, y = anchors["snail"]
        ga = R.prog(t, 25.0, 25.3) * (1 - R.prog(t, 27.1, 27.35))
        chip(ctx, "달팽이도 추월!", min(860, max(220, x)), y - 70, ga, WH, 40)


def draw_love(ctx, t, anchors):
    o0, o1 = C["OUTRO"]
    if t < o1 or "female" not in anchors or "male" not in anchors:
        return
    a = R.prog(t, o1, o1 + 0.3)
    (xf, yf), (xm, ym) = anchors["female"], anchors["male"]
    x, y = (xf + xm) / 2, min(yf, ym) - 40
    size = 70 * R.ease_back(min(1.0, a * 1.2), 2.2) * (1 + 0.1 * R.heartbeat(t, 0.8))
    R.draw_heart(ctx, x, y, size, R.hx("#ff4f7b"), a)


def overlay(ctx, t, anchors):
    R.draw_vignette(ctx)
    draw_hook_sparkles(ctx, t)
    draw_reveal(ctx, t, anchors)
    draw_parents(ctx, t, anchors)
    draw_pouch(ctx, t, anchors)
    draw_count(ctx, t)
    draw_eye_arrows(ctx, t, anchors)
    draw_speedometer(ctx, t, anchors)
    draw_love(ctx, t, anchors)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    draw_texts(ctx, t)
    R.draw_transition(ctx, t)

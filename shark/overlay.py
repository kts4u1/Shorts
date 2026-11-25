"""상어 편 자막/UI 오버레이. src/composite3d.py --overlay shark/overlay.py 로 사용.

공용 UI(배지, 헤더, 전환 거품, 구독 버튼)는 src/render.py 를 그대로 쓰고,
상어 편 전용 요소(자막, '툭!', 이빨 화살표, 엑스레이 스캔, 번개, 400살 카운터)만 여기서 그린다.
"""
import importlib.util
import math
import os
import sys

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("shark_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
C = T.CUES
WH, YE, CY = R.WHITE, R.YELLOW, R.CYAN

TEXTS = [
    (0.30, 3.55, "title", 420, [("이빨이 평생", WH)]),
    (0.60, 3.55, "title", 535, [("수만 개", YE), ("나 나는 동물?", WH)]),
    (1.40, 3.55, "sub", 665, [("정답은 바로...?", WH)]),
    (3.75, 10.15, "big", 470, [("정답은 ", WH), ("상어!", YE)]),
    (6.40, 10.15, "sub", 665, [("빠지면 ", WH), ("뒷줄 이빨", YE), ("이 앞으로 쏙!", WH)]),
    (10.35, 16.55, "title", 420, [("상어는", WH)]),
    (10.60, 16.55, "title", 535, [("뼈가 없어요!", YE)]),
    (12.40, 16.55, "sub", 665, [("가볍고 유연한 ", WH), ("연골", CY), ("로 되어 있어요", WH)]),
    (16.75, 22.55, "title", 420, [("상어는", WH)]),
    (17.00, 22.55, "title", 535, [("전기", YE), ("를 느껴요!", WH)]),
    (19.70, 22.55, "sub", 665, [("모래 속 물고기도 찾아내요", WH)]),
    (22.75, 27.55, "title", 420, [("그린란드상어는", WH)]),
    (23.00, 27.55, "title", 535, [("400년", YE), (" 가까이 살아요!", WH)]),
    (24.80, 27.55, "sub", 665, [("지구에서 가장 오래 사는 척추동물", WH)]),
    (27.70, 30.5, "big", 440, [("신기하죠?", YE)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WH)]),
]
PUNCHES = [C["DASH"][0] + 0.25, C["DROP"], C["XRAY"][0], C["FOUND"], C["COUNT"][1], 28.8]


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
        R.text_line(ctx, [(text, col)], x, y, size, alpha=a, scale=max(R.ease_back(min(1.0, a), 2.0), 1e-3))


def draw_hook_sparkles(ctx, t):
    al, _ = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    for k in range(3):
        a = R.prog(t, 1.1 + k * 0.15, 1.4 + k * 0.15) * al
        if a > 0:
            ang = -2.3 + k * 0.9
            r = 160 + 10 * math.sin(t * 5 + k)
            R.draw_sparkle(ctx, 540 + r * math.cos(ang), 900 + r * math.sin(ang), 24 * a, a)


def draw_dash(ctx, t, anchors):
    d1 = C["DASH"][1]
    if "head" not in anchors or not (d1 - 0.1 <= t < d1 + 0.9):
        return
    x, y = anchors["head"]
    ph = R.prog(t, d1 - 0.1, d1 + 0.8)
    for i in range(10):
        ang = i * math.tau / 10 + 0.3
        d = 120 + 180 * R.ease_out(ph)
        R.draw_sparkle(ctx, x + d * math.cos(ang), y + d * 0.8 * math.sin(ang), 28 * (1 - ph) + 3, 1 - ph, YE if i % 2 else WH)


def curved_arrow(ctx, x0, y0, x1, y1, a, bend=-60):
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2 + bend
    ctx.save()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    for lw, col in ((14, R.NAVY), (8, YE)):
        ctx.new_path()
        ctx.move_to(x0, y0)
        ctx.curve_to(mx, my, mx, my, x1, y1)
        ctx.set_source_rgba(*col, a)
        ctx.set_line_width(lw)
        ctx.stroke()
    ang = math.atan2(y1 - my, x1 - mx)
    ctx.new_path()
    ctx.move_to(x1 + 22 * math.cos(ang), y1 + 22 * math.sin(ang))
    ctx.line_to(x1 + 22 * math.cos(ang + 2.4), y1 + 22 * math.sin(ang + 2.4))
    ctx.line_to(x1 + 22 * math.cos(ang - 2.4), y1 + 22 * math.sin(ang - 2.4))
    ctx.close_path()
    ctx.set_source_rgba(*YE, a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(4)
    ctx.stroke()
    ctx.restore()


def draw_teeth(ctx, t, anchors):
    d0 = C["DROP"]
    if "drop" in anchors:
        a = R.prog(t, d0, d0 + 0.15) * (1 - R.prog(t, d0 + 0.9, d0 + 1.2))
        x, y = anchors["drop"]
        chip(ctx, "툭!", x + 90, y - 30, a, WH, 60)
    c0, c1 = C["CONVEYOR"]
    a = R.prog(t, d0 + 0.5, d0 + 0.8) * (1 - R.prog(t, c1, c1 + 0.2))
    if a > 0 and "mouth" in anchors:
        x, y = anchors["mouth"]
        for k, dx in enumerate((-170, 170)):
            ph = ((t - d0) * 0.8 + k * 0.5) % 1
            curved_arrow(ctx, x + dx * 1.15, y + 140, x + dx * 0.55, y + 40, a * (0.55 + 0.45 * R.bump(ph)), bend=60)
        chip(ctx, "새 이빨 등장!", x, y + 230, a, YE, 46)


def draw_xray(ctx, t, anchors):
    x0, x1 = C["XRAY"]
    if not (x0 <= t < x1):
        return
    a = R.prog(t, x0, x0 + 0.2) * (1 - R.prog(t, x1 - 0.2, x1))
    ctx.save()
    for k in range(0, 1920, 6):
        ctx.new_path()
        ctx.move_to(0, k)
        ctx.line_to(1080, k)
        ctx.set_source_rgba(0.6, 0.95, 1.0, 0.035 * a)
        ctx.set_line_width(2)
        ctx.stroke()
    sy = 760 + ((t - x0) * 520) % 1100
    g = cairo.LinearGradient(0, sy - 60, 0, sy + 10)
    g.add_color_stop_rgba(0, 0.5, 0.95, 1, 0)
    g.add_color_stop_rgba(1, 0.5, 0.95, 1, 0.35 * a)
    ctx.set_source(g)
    ctx.rectangle(0, sy - 60, 1080, 70)
    ctx.fill()
    ctx.restore()
    R.text_line(ctx, [("X-RAY", CY)], 900, 300, 44, alpha=a)
    la = R.prog(t, x0 + 0.5, x0 + 0.8) * (1 - R.prog(t, x1 - 0.3, x1))
    if "body" in anchors:
        x, y = anchors["body"]
        chip(ctx, "연골", x - 60, y + 150, la, CY, 54)
        chip(ctx, "뼈 없음!", x + 200, y - 150, la, YE, 44)


def bolt(ctx, x0, y0, x1, y1, a, seed):
    pts = [(x0, y0)]
    n = 7
    for i in range(1, n):
        f = i / n
        jx = (R.rnd(seed * 13 + i, 1) - 0.5) * 50
        jy = (R.rnd(seed * 13 + i, 2) - 0.5) * 50
        pts.append((x0 + (x1 - x0) * f + jx, y0 + (y1 - y0) * f + jy))
    pts.append((x1, y1))
    ctx.save()
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    for lw, col, al in ((16, YE, 0.25), (7, YE, 0.9), (3, WH, 1.0)):
        ctx.new_path()
        ctx.move_to(*pts[0])
        for p in pts[1:]:
            ctx.line_to(*p)
        ctx.set_source_rgba(*col, al * a)
        ctx.set_line_width(lw)
        ctx.stroke()
    ctx.restore()


def draw_electric(ctx, t, anchors):
    a0, a1 = C["AMPULLAE"]
    la = R.prog(t, a0 + 0.2, a0 + 0.5) * (1 - R.prog(t, 19.3, 19.6))
    if "snout" in anchors:
        x, y = anchors["snout"]
        chip(ctx, "로렌치니 기관", min(860, x + 40), y - 120, la, YE, 40)
    p0, p1 = C["PULSE"]
    if "fish" in anchors and "snout" in anchors and p0 + 1.2 <= t < min(p1, C["FOUND"] + 0.2):
        flick = 1.0 if (t * 8) % 1.0 < 0.7 else 0.3
        (xs, ys), (xf, yf) = anchors["snout"], anchors["fish"]
        bolt(ctx, xf, yf - 20, xs, ys + 10, flick, int(t * 8))
    f0 = C["FOUND"]
    if "fish" in anchors:
        fa = R.prog(t, f0, f0 + 0.2) * (1 - R.prog(t, f0 + 1.1, f0 + 1.4))
        x, y = anchors["fish"]
        chip(ctx, "찾았다!", min(880, x + 20), y - 110, fa, WH, 56)


def draw_age(ctx, t):
    c0, c1 = C["COUNT"]
    if not (c0 <= t < 27.55):
        return
    a = R.prog(t, c0, c0 + 0.25) * (1 - R.prog(t, 27.35, 27.55))
    v = int(round(400 * R.ease_out(R.prog(t, c0, c1))))
    pop = 1 + 0.2 * R.bump(R.prog(t, c1, c1 + 0.3))
    R.text_line(ctx, [(f"{v}", YE), ("살", WH)], 540, 860, 120, alpha=a, scale=pop)
    # 케이크
    cx, cy = 540, 990
    ctx.save()
    R.rrect(ctx, cx - 90, cy - 10, 180, 70, 16)
    ctx.set_source_rgba(*R.hx("#ffd3e3"), a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(5)
    ctx.stroke()
    for k in range(5):
        x = cx - 60 + k * 30
        R.rrect(ctx, x - 5, cy - 50, 10, 40, 4)
        ctx.set_source_rgba(*R.hx("#7fd6ff"), a)
        ctx.fill()
        R.circle(ctx, x, cy - 60 + 2 * math.sin(t * 9 + k), 7)
        ctx.set_source_rgba(*R.hx("#ffb347"), a)
        ctx.fill()
    ctx.restore()


def overlay(ctx, t, anchors):
    R.draw_vignette(ctx)
    draw_hook_sparkles(ctx, t)
    draw_dash(ctx, t, anchors)
    draw_teeth(ctx, t, anchors)
    draw_xray(ctx, t, anchors)
    draw_electric(ctx, t, anchors)
    draw_age(ctx, t)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    draw_texts(ctx, t)
    R.draw_transition(ctx, t)

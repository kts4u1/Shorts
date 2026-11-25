"""바다거북 편 자막/UI 오버레이. src/composite3d.py --overlay turtle/overlay.py 로 사용.

공용 UI(배지, 헤더, 전환 거품, 구독 버튼)는 src/render.py 를 그대로 쓰고,
바다거북 편 전용 요소(자막, 온도계, 딸/아들 라벨, 소금물 라벨, 육지 거북 비교)만 여기서 그린다.
"""
import importlib.util
import math
import os
import sys

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("turtle_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
C = T.CUES
WH, YE, CY = R.WHITE, R.YELLOW, R.CYAN
PINK = R.hx("#ff8fb8")

TEXTS = [
    (0.30, 3.55, "title", 420, [("알이 ", WH), ("따뜻하면 딸", PINK)]),
    (0.60, 3.55, "title", 535, [("시원하면 아들", CY), ("?", WH)]),
    (1.40, 3.55, "sub", 665, [("정답은 바로...?", WH)]),
    (3.75, 10.15, "big", 470, [("정답은 ", WH), ("바다거북!", YE)]),
    (6.40, 10.15, "sub", 665, [("모래 온도", YE), ("로 성별이 정해져요", WH)]),
    (10.35, 16.55, "title", 420, [("태어난 해변을", WH)]),
    (10.60, 16.55, "title", 535, [("기억해요!", YE)]),
    (12.40, 16.55, "sub", 665, [("어른이 되면 돌아와 알을 낳아요", WH)]),
    (16.75, 22.55, "title", 420, [("알 낳을 때", WH)]),
    (17.00, 22.55, "title", 535, [("눈물", CY), ("을 흘린다?", WH)]),
    (19.70, 22.55, "sub", 665, [("사실은 몸속 ", WH), ("소금", YE), ("을 빼는 거예요", WH)]),
    (22.75, 27.55, "title", 420, [("바다거북은 머리를", WH)]),
    (23.00, 27.55, "title", 535, [("못 숨겨요!", YE)]),
    (24.80, 27.55, "sub", 665, [("육지 거북처럼 등딱지에 쏙 못 넣어요", WH)]),
    (27.70, 30.5, "big", 440, [("신기하죠?", YE)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WH)]),
]
PUNCHES = [C["HATCH"][0], C["WARM"][0], C["COOL"][0], C["RETURN"][0], C["TEARS"][0], C["RETRACT"][0] + 0.4, C["RETRACT"][0] + 1.4, 28.8]


def camera_zoom(t):
    z = 1.0
    for tp in PUNCHES:
        if t >= tp:
            z += 0.022 * math.exp(-(t - tp) / 0.12)
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
            r = 150 + 10 * math.sin(t * 5 + k)
            R.draw_sparkle(ctx, 540 + r * math.cos(ang), 830 + r * math.sin(ang), 24 * a, a)


def draw_hatch(ctx, t, anchors):
    h0 = C["HATCH"][0]
    if "nest" not in anchors or not (h0 <= t < h0 + 1.0):
        return
    x, y = anchors["nest"]
    ph = R.prog(t, h0, h0 + 0.9)
    for i in range(10):
        ang = i * math.tau / 10 + 0.3
        d = 120 + 170 * R.ease_out(ph)
        R.draw_sparkle(ctx, x + d * math.cos(ang), y - 60 + d * 0.7 * math.sin(ang), 28 * (1 - ph) + 3, 1 - ph, YE if i % 2 else WH)


def draw_thermometer(ctx, t):
    a0, a1 = C["THERMO"]
    if not (a0 <= t < a1):
        return
    a = R.prog(t, a0, a0 + 0.3) * (1 - R.prog(t, a1 - 0.25, a1))
    sc = max(R.ease_back(R.prog(t, a0, a0 + 0.4), 2.0), 1e-3)
    warm = R.ease_io(R.prog(t, C["WARM"][0], C["WARM"][0] + 0.4)) * (1 - R.ease_io(R.prog(t, C["WARM"][1] - 0.2, C["WARM"][1] + 0.1)))
    cool = R.ease_io(R.prog(t, C["COOL"][0], C["COOL"][0] + 0.4)) * (1 - R.ease_io(R.prog(t, C["COOL"][1] - 0.2, C["COOL"][1] + 0.1)))
    level = 0.45 + 0.4 * warm - 0.3 * cool
    cx, cy = 930, 880
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(sc, sc)
    R.rrect(ctx, -26, -170, 52, 230, 26)
    ctx.set_source_rgba(1, 1, 1, 0.92 * a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(6)
    ctx.stroke()
    col = R.mix(R.hx("#ff4a3d"), R.hx("#4aa8ff"), cool)
    R.rrect(ctx, -11, 50 - 200 * level, 22, 200 * level, 11)
    ctx.set_source_rgba(*col, a)
    ctx.fill()
    R.circle(ctx, 0, 70, 40)
    ctx.set_source_rgba(*col, a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(6)
    ctx.stroke()
    for k in range(6):
        ctx.new_path()
        ctx.move_to(14, -140 + k * 32)
        ctx.line_to(26, -140 + k * 32)
        ctx.set_source_rgba(*R.NAVY, 0.7 * a)
        ctx.set_line_width(4)
        ctx.stroke()
    ctx.restore()
    if warm > 0.05:
        R.text_line(ctx, [("29°C보다 따뜻", PINK)], cx - 40, cy + 140, 38, alpha=a * warm, max_w=270)
    if cool > 0.05:
        R.text_line(ctx, [("29°C보다 시원", CY)], cx - 40, cy + 140, 38, alpha=a * cool, max_w=270)


def draw_sex_labels(ctx, t, anchors):
    w = R.prog(t, C["WARM"][0] + 0.15, C["WARM"][0] + 0.45) * (1 - R.prog(t, C["WARM"][1] - 0.2, C["WARM"][1] + 0.1))
    c = R.prog(t, C["COOL"][0] + 0.15, C["COOL"][0] + 0.45) * (1 - R.prog(t, C["COOL"][1] - 0.2, C["COOL"][1] + 0.1))
    if w > 0 and "eggs_warm" in anchors:
        x, y = anchors["eggs_warm"]
        chip(ctx, "♀ 딸", x - 30, y - 115, w, PINK, 64)
    if c > 0 and "eggs_cool" in anchors:
        x, y = anchors["eggs_cool"]
        chip(ctx, "♂ 아들", x + 10, y - 115, c, CY, 64)


def draw_return(ctx, t, anchors):
    r0 = C["RETURN"][0]
    a = R.prog(t, r0 + 0.4, r0 + 0.8) * (1 - R.prog(t, 15.9, 16.3))
    if a > 0 and "head" in anchors:
        x, y = anchors["head"]
        chip(ctx, "수십 년 뒤...", min(860, max(220, x)), y - 110, a, WH, 42)


def draw_tears(ctx, t, anchors):
    e0, e1 = C["TEARS"]
    a = R.prog(t, e0 + 0.2, e0 + 0.5) * (1 - R.prog(t, C["SALT"][0] - 0.2, C["SALT"][0]))
    if "eyeL" not in anchors:
        return
    (xl, yl), (xr, yr) = anchors["eyeL"], anchors["eyeR"]
    left = (xl, yl) if xl < xr else (xr, yr)
    right = (xr, yr) if xl < xr else (xl, yl)
    if a > 0:
        chip(ctx, "엉엉...?", left[0] - 150, left[1] - 40, a, CY, 44)
    s0, s1 = C["SALT"]
    sa = R.prog(t, s0, s0 + 0.3) * (1 - R.prog(t, s1 - 0.2, s1))
    if sa > 0:
        chip(ctx, "소금물!", right[0] + 160, right[1] - 30, sa, YE, 48)
        for k in range(6):
            ph = ((t - s0) * 1.4 + k / 6) % 1.0
            for (ex, ey) in (left, right):
                R.draw_sparkle(ctx, ex + 50 * math.cos(k * 1.05), ey + 70 + 120 * ph, 14 * R.bump(ph) + 2, R.bump(ph) * sa, WH)


def draw_tortoise(ctx, x, y, s, head_out, a):
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s, s)
    navy = R.NAVY
    skin = R.hx("#a7c56a")
    hx_ = 58 + 34 * head_out
    R.circle(ctx, hx_, -6, 20)
    ctx.set_source_rgba(*skin, a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*navy, a)
    ctx.set_line_width(4)
    ctx.stroke()
    if head_out > 0.3:
        R.circle(ctx, hx_ + 7, -11, 4)
        ctx.set_source_rgba(*navy, a)
        ctx.fill()
    for lx in (-38, 30):
        R.rrect(ctx, lx, 10, 18, 22, 6)
        ctx.set_source_rgba(*skin, a)
        ctx.fill_preserve()
        ctx.set_source_rgba(*navy, a)
        ctx.set_line_width(4)
        ctx.stroke()
    ctx.new_path()
    ctx.arc(0, 14, 64, math.pi, 2 * math.pi)
    ctx.close_path()
    ctx.set_source_rgba(*R.hx("#8a6a3a"), a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*navy, a)
    ctx.set_line_width(5)
    ctx.stroke()
    for px, py in ((-30, -10), (0, -30), (30, -10)):
        R.circle(ctx, px, py, 14)
        ctx.set_source_rgba(*R.hx("#b48a4c"), a)
        ctx.fill()
    ctx.restore()


def draw_head_compare(ctx, t, anchors):
    a = R.prog(t, 23.2, 23.5) * (1 - R.prog(t, 27.35, 27.55))
    if a <= 0:
        return
    sc = max(R.ease_back(R.prog(t, 23.2, 23.55), 2.0), 1e-3)
    head_out = 0.5 + 0.5 * math.cos(math.tau * 0.7 * (t - 23.2))
    R.rrect(ctx, 60, 760, 330, 230, 34)
    ctx.set_source_rgba(1, 1, 1, 0.85 * a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(5)
    ctx.stroke()
    draw_tortoise(ctx, 210, 880, 1.15 * sc, head_out, a)
    R.text_line(ctx, [("육지 거북: ", R.NAVY), ("쏙!", R.hx("#e0602a"))], 225, 960, 34, alpha=a, outline=0.1, shadow=False, max_w=300)
    r0, r1 = C["RETRACT"]
    ra = R.prog(t, r0 + 0.3, r0 + 0.55) * (1 - R.prog(t, r1 + 0.3, r1 + 0.6))
    if ra > 0 and "head" in anchors:
        x, y = anchors["head"]
        ctx.save()
        ctx.translate(x, y + 30)
        s = 0.5 + 0.5 * R.ease_back(min(1.0, ra), 2.5)
        ctx.scale(s, s)
        ctx.set_line_cap(cairo.LINE_CAP_ROUND)
        for lw, col in ((24, R.WHITE), (14, R.hx("#ff3b5c"))):
            for d in (1, -1):
                ctx.new_path()
                ctx.move_to(-48, -48 * d)
                ctx.line_to(48, 48 * d)
                ctx.set_source_rgba(*col, ra)
                ctx.set_line_width(lw)
                ctx.stroke()
        ctx.restore()
        chip(ctx, "안 들어가요!", min(840, x + 20), y - 110, ra, YE, 46)


def overlay(ctx, t, anchors):
    R.draw_vignette(ctx)
    draw_hook_sparkles(ctx, t)
    draw_hatch(ctx, t, anchors)
    draw_thermometer(ctx, t)
    draw_sex_labels(ctx, t, anchors)
    draw_return(ctx, t, anchors)
    draw_tears(ctx, t, anchors)
    draw_head_compare(ctx, t, anchors)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    draw_texts(ctx, t)
    R.draw_transition(ctx, t)

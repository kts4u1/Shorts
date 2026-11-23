"""해파리 편 자막/UI 오버레이. src/composite3d.py --overlay jelly/overlay.py 로 사용.

공용 UI(배지, 헤더, 전환 거품, 구독 버튼)는 src/render.py 를 그대로 쓰고,
해파리 편 전용 요소(자막, X 표시, 95% 카운터, 폴립 라벨, 연대표)만 여기서 그린다.
"""
import importlib.util
import math
import os
import sys

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("jelly_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
C = T.CUES
WH, YE, CY, RD = R.WHITE, R.YELLOW, R.CYAN, R.RED

TEXTS = [
    (0.30, 3.55, "title", 420, [("뇌도 심장도", WH)]),
    (0.60, 3.55, "title", 535, [("없는 동물", YE), ("이 있다?", WH)]),
    (1.40, 3.55, "sub", 665, [("정답은 바로...?", WH)]),
    (3.75, 10.15, "big", 470, [("정답은 ", WH), ("해파리!", YE)]),
    (6.40, 10.15, "sub", 665, [("뇌 대신 온몸의 ", WH), ("신경망", CY), ("으로 살아요", WH)]),
    (10.35, 16.55, "title", 420, [("몸의 대부분이", WH)]),
    (10.60, 16.55, "title", 535, [("물", CY), ("이에요!", WH)]),
    (12.40, 16.55, "sub", 665, [("그래서 물 밖에선 금방 말라버려요", WH)]),
    (16.75, 22.55, "title", 420, [("늙으면 다시", WH)]),
    (17.00, 22.55, "title", 535, [("어려지는", YE), (" 해파리!", WH)]),
    (19.70, 22.55, "sub", 665, [("'불멸의 해파리'", YE), ("라고 불려요", WH)]),
    (22.75, 27.55, "title", 420, [("공룡보다", WH)]),
    (23.00, 27.55, "title", 535, [("먼저 살았어요!", YE)]),
    (24.80, 27.55, "sub", 665, [("5억 년", YE), (" 넘게 바다에서 살아왔어요", WH)]),
    (27.70, 30.5, "big", 440, [("신기하죠?", YE)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WH)]),
]
PUNCHES = [C["REVEAL"]] + C["XMARK"] + [C["COUNT"][1], C["BUDS"][0], C["TIMELINE"][1], 28.8]


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


def draw_hook_sparkles(ctx, t):
    al, _ = R.pop_anim(t, 0.9, 3.55, dur=0.45)
    for k in range(3):
        a = R.prog(t, 1.1 + k * 0.15, 1.4 + k * 0.15) * al
        if a > 0:
            ang = -2.3 + k * 0.9
            r = 150 + 10 * math.sin(t * 5 + k)
            R.draw_sparkle(ctx, 540 + r * math.cos(ang), 780 + r * math.sin(ang), 24 * a, a)


def draw_reveal(ctx, t, anchors):
    r0 = C["REVEAL"]
    if "jelly" not in anchors or not (r0 <= t < r0 + 1.1):
        return
    x, y = anchors["jelly"]
    ph = R.prog(t, r0, r0 + 1.0)
    for i in range(10):
        ang = i * math.tau / 10 + 0.3
        d = 180 + 200 * R.ease_out(ph)
        R.draw_sparkle(ctx, x + d * math.cos(ang), y + d * 0.8 * math.sin(ang), 30 * (1 - ph) + 3, 1 - ph,
                       YE if i % 2 else WH)


def draw_icons_overlay(ctx, t):
    labels = ["뇌", "심장", "뼈"]
    for i, x in enumerate([290, 540, 790]):
        a = R.prog(t, C["ICONS"][i] + 0.1, C["ICONS"][i] + 0.35) * (1 - R.prog(t, C["ICONS_OUT"][0], C["ICONS_OUT"][0] + 0.2))
        if a <= 0:
            continue
        R.text_line(ctx, [(labels[i], WH)], x, 965, 40, alpha=a)
        xm = R.prog(t, C["XMARK"][i], C["XMARK"][i] + 0.2)
        if xm > 0:
            s = 0.5 + 0.5 * R.ease_back(xm, 2.5)
            ctx.save()
            ctx.translate(x, 860)
            ctx.scale(s, s)
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            for lw, col in ((26, R.WHITE), (16, R.hx("#ff3b5c"))):
                for d in (1, -1):
                    ctx.new_path()
                    ctx.move_to(-62, -62 * d)
                    ctx.line_to(62, 62 * d)
                    ctx.set_source_rgba(*col, a)
                    ctx.set_line_width(lw)
                    ctx.stroke()
            ctx.restore()


def draw_count(ctx, t):
    c0, c1 = C["COUNT"]
    if not (c0 <= t < C["DROP"][1]):
        return
    a = R.prog(t, c0, c0 + 0.25) * (1 - R.prog(t, C["DROP"][1] - 0.2, C["DROP"][1]))
    v = int(round(95 * R.ease_out(R.prog(t, c0, c1))))
    pop = 1 + 0.2 * R.bump(R.prog(t, c1, c1 + 0.3))
    R.text_line(ctx, [(f"{v}%", CY)], 760, 850, 110, alpha=a, scale=pop)
    R.text_line(ctx, [("물", WH)], 760, 945, 46, alpha=a)


def chip(ctx, text, x, y, a, col=YE, size=36):
    if a <= 0:
        return
    R.text_line(ctx, [(text, col)], x, y, size, alpha=a, scale=R.ease_back(min(1.0, a), 2.0))


def draw_lifecycle(ctx, t, anchors):
    if "polyp" in anchors:
        x, y = anchors["polyp"]
        a = R.prog(t, C["POLYP"][0] + 0.3, C["POLYP"][0] + 0.6) * (1 - R.prog(t, C["REGROW"][0], C["REGROW"][0] + 0.3))
        if a > 0:
            ctx.save()
            ctx.set_dash([12, 9], -t * 30)
            ctx.new_path()
            ctx.move_to(x + 40, y - 10)
            ctx.curve_to(x + 120, y - 40, x + 150, y - 90, x + 170, y - 140)
            ctx.set_source_rgba(*YE, 0.9 * a)
            ctx.set_line_width(5)
            ctx.stroke()
            ctx.restore()
            chip(ctx, "아기 시절 (폴립)", min(850, x + 210), y - 180, a, YE, 40)
    if "jelly" in anchors:
        x, y = anchors["jelly"]
        a = R.prog(t, C["SHRINK"][0] - 0.1, C["SHRINK"][0] + 0.2) * (1 - R.prog(t, C["SHRINK"][0] + 0.9, C["SHRINK"][0] + 1.1))
        chip(ctx, "늙은 해파리", x + 250, y - 60, a, WH, 42)
        a2 = R.prog(t, C["REGROW"][1] - 0.4, C["REGROW"][1] - 0.1) * (1 - R.prog(t, 22.4, 22.55))
        chip(ctx, "다시 어른으로!", x, y - 260, a2, YE, 44)
    bs = anchors.get("babies", [])
    a3 = R.prog(t, C["BUDS"][1] + 0.3, C["BUDS"][1] + 0.6) * (1 - R.prog(t, C["REGROW"][1], C["REGROW"][1] + 0.2))
    if a3 > 0 and bs:
        x, y = bs[0]
        chip(ctx, "새로 태어나요!", max(200, x + 40), y - 110, a3, WH, 34)


def draw_mini_jelly(ctx, x, y, s, a):
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s, s)
    ctx.new_path()
    ctx.arc(0, 0, 26, math.pi, 2 * math.pi)
    ctx.close_path()
    ctx.set_source_rgba(*R.hx("#f0a8ff"), a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*R.NAVY, a)
    ctx.set_line_width(4)
    ctx.stroke()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    for k in range(5):
        xx = -18 + k * 9
        ctx.new_path()
        ctx.move_to(xx, 2)
        ctx.curve_to(xx + 5, 14, xx - 5, 24, xx + 2, 36)
        ctx.set_source_rgba(*R.hx("#f0a8ff"), a)
        ctx.set_line_width(4)
        ctx.stroke()
    ctx.restore()


def draw_dino(ctx, x, y, s, a):
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s, s)
    green, navy = R.hx("#7ed957"), R.NAVY
    ctx.new_path()
    ctx.move_to(-46, 8)                              # 꼬리 끝
    ctx.curve_to(-30, -4, -20, -14, -4, -14)         # 등
    ctx.curve_to(10, -14, 16, -20, 22, -38)          # 목
    ctx.curve_to(26, -50, 40, -50, 42, -40)          # 머리
    ctx.curve_to(44, -32, 34, -32, 30, -30)
    ctx.curve_to(26, -18, 24, 2, 16, 10)             # 목 아래
    ctx.line_to(16, 26); ctx.line_to(8, 26); ctx.line_to(6, 12)
    ctx.line_to(-12, 12); ctx.line_to(-14, 26); ctx.line_to(-22, 26); ctx.line_to(-22, 10)
    ctx.curve_to(-32, 10, -40, 12, -46, 8)
    ctx.close_path()
    ctx.set_source_rgba(*green, a)
    ctx.fill_preserve()
    ctx.set_source_rgba(*navy, a)
    ctx.set_line_width(4)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.stroke()
    R.circle(ctx, 36, -42, 3)
    ctx.set_source_rgba(*navy, a)
    ctx.fill()
    ctx.restore()


def draw_timeline(ctx, t):
    t0, t1, t2 = C["TIMELINE"]
    if not (t0 - 0.05 <= t < 27.55):
        return
    a = R.prog(t, t0 - 0.05, t0 + 0.25) * (1 - R.prog(t, 27.35, 27.55))
    y, xL, xR = 880, 120, 960
    marks = [(175, t0, "5억 년 전"), (585, t1, "2.3억 년 전"), (915, t2, "지금")]
    # 트랙
    ctx.save()
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.new_path()
    ctx.move_to(xL, y)
    ctx.line_to(xR, y)
    ctx.set_source_rgba(1, 1, 1, 0.3 * a)
    ctx.set_line_width(12)
    ctx.stroke()
    px = marks[0][0] + (marks[1][0] - marks[0][0]) * R.ease_io(R.prog(t, t0 + 0.2, t1)) \
        + (marks[2][0] - marks[1][0]) * R.ease_io(R.prog(t, t1 + 0.1, t2))
    ctx.new_path()
    ctx.move_to(marks[0][0], y)
    ctx.line_to(px, y)
    ctx.set_source_rgba(*YE, a)
    ctx.set_line_width(12)
    ctx.stroke()
    ctx.restore()
    for i, (mx, mt, label) in enumerate(marks):
        ma = R.prog(t, mt, mt + 0.3) * a
        if ma <= 0:
            continue
        sc = R.ease_back(R.prog(t, mt, mt + 0.35), 2.2)
        R.circle(ctx, mx, y, 15 * sc)
        ctx.set_source_rgba(*YE, ma)
        ctx.fill_preserve()
        ctx.set_source_rgba(*R.NAVY, ma)
        ctx.set_line_width(4)
        ctx.stroke()
        R.text_line(ctx, [(label, WH)], mx, y + 52, 34, alpha=ma, max_w=230)
        if i == 0:
            draw_mini_jelly(ctx, mx, y - 78, 1.3 * sc, ma)
        elif i == 1:
            draw_dino(ctx, mx, y - 62, 1.25 * sc, ma)
        else:
            R.text_line(ctx, [("★", YE)], mx, y - 55, 44, alpha=ma, scale=sc)


def overlay(ctx, t, anchors):
    R.draw_vignette(ctx)
    draw_hook_sparkles(ctx, t)
    draw_reveal(ctx, t, anchors)
    draw_icons_overlay(ctx, t)
    draw_count(ctx, t)
    draw_lifecycle(ctx, t, anchors)
    draw_timeline(ctx, t)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    draw_texts(ctx, t)
    R.draw_transition(ctx, t)

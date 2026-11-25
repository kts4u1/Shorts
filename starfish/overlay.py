"""불가사리 편 자막/UI 오버레이. src/composite3d.py --overlay starfish/overlay.py 로 사용.

공용 UI(배지, 헤더, 전환 거품, 구독 버튼)는 src/render.py 를 그대로 쓰고,
불가사리 편 전용 요소(자막, 눈 번호, '툭!'/'쑥쑥!', 바닷물·관족·위 라벨, 냠냠)만 여기서 그린다.
"""
import importlib.util
import math
import os
import sys

import cairo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("starfish_timeline", os.path.join(HERE, "timeline.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)
C = T.CUES
WH, YE, CY, PK = R.WHITE, R.YELLOW, R.CYAN, R.hx("#ff8fb3")
SCREEN_ORDER = [0, 4, 3, 2, 1]          # scene.js 와 같음: 화면 위에서 시계 방향

TEXTS = [
    (0.30, 3.55, "title", 420, [("팔 끝에", WH)]),
    (0.60, 3.55, "title", 535, [("눈", YE), ("이 달린 동물?", WH)]),
    (1.40, 3.55, "sub", 665, [("정답은 바로...?", WH)]),
    (3.75, 10.15, "big", 470, [("정답은 ", WH), ("불가사리!", YE)]),
    (6.40, 10.15, "sub", 665, [("다섯 팔 끝마다 ", WH), ("눈", YE), ("이 하나씩!", WH)]),
    (10.35, 16.55, "title", 420, [("팔이 잘려도", WH)]),
    (10.60, 16.55, "title", 535, [("다시 자라요!", YE)]),
    (12.40, 16.55, "sub", 665, [("팔 하나가 ", WH), ("새 불가사리", YE), ("로!", WH)]),
    (16.75, 22.55, "title", 420, [("피 대신", WH)]),
    (17.00, 22.55, "title", 535, [("바닷물", CY), ("이 흘러요!", WH)]),
    (19.70, 22.55, "sub", 665, [("작은 발 ", WH), ("수백 개", YE), ("로 꼬물꼬물", WH)]),
    (22.75, 27.55, "title", 420, [("먹는 방법도", WH)]),
    (23.00, 27.55, "title", 535, [("신기해요!", YE)]),
    (24.80, 27.55, "sub", 665, [("위", PK), ("를 몸 밖으로 꺼내서 냠!", WH)]),
    (27.70, 30.5, "big", 440, [("신기하죠?", YE)]),
    (28.00, 30.5, "sub", 590, [("다음 바다 이야기도 궁금하다면", WH)]),
]
PUNCHES = [C["HELLO"][0] + 0.1, C["ARM_OFF"], C["FLIP"][1], C["OPEN"][0], 28.8]


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


def burst(ctx, x, y, ph, n=6, r0=30, r1=110, size=22, rot=0.3):
    if not (0 < ph < 1):
        return
    for i in range(n):
        ang = i * math.tau / n + rot
        d = r0 + (r1 - r0) * R.ease_out(ph)
        R.draw_sparkle(ctx, x + d * math.cos(ang), y + d * math.sin(ang), size * (1 - ph) + 2, 1 - ph, YE if i % 2 else WH)


def ring(ctx, x, y, ph, col=YE, r0=20, r1=90):
    if not (0 < ph < 1):
        return
    ctx.save()
    ctx.new_path()
    ctx.arc(x, y, r0 + (r1 - r0) * R.ease_out(ph), 0, math.tau)
    ctx.set_source_rgba(*col, 0.9 * (1 - ph))
    ctx.set_line_width(7 * (1 - ph) + 1)
    ctx.stroke()
    ctx.restore()


def draw_hook(ctx, t, anchors):
    for i, te in enumerate(C["HOOK_EYES"]):
        key = f"eye{SCREEN_ORDER[i]}"
        if key in anchors:
            x, y = anchors[key]
            burst(ctx, x, y, R.prog(t, te, te + 0.45), n=5, r0=20, r1=80, size=18)


def draw_eyes(ctx, t, anchors):
    if not (3.6 <= t < 10.2) or "star" not in anchors:
        return
    sx, sy = anchors["star"]
    for i, te in enumerate(C["EYES"]):
        key = f"eye{(SCREEN_ORDER[i] + 4) % 5}"
        if key not in anchors:
            continue
        x, y = anchors[key]
        a = R.prog(t, te, te + 0.15) * (1 - R.prog(t, 9.3, 9.6))
        dx, dy = x - sx, y - sy
        d = math.hypot(dx, dy) or 1
        ring(ctx, x, y, R.prog(t, te, te + 0.5), YE, 18, 75)
        nx = min(1020, max(60, x + dx / d * 72))
        ny = max(760, y + dy / d * 72)
        chip(ctx, str(i + 1), nx, ny, a, YE, 62)
    b0 = C["BLINK"]
    a = R.prog(t, b0, b0 + 0.12) * (1 - R.prog(t, b0 + 0.75, b0 + 0.95))
    chip(ctx, "깜빡!", sx, sy + 40, a, WH, 54)


def draw_regrow(ctx, t, anchors):
    if not (10.2 <= t < 16.6):
        return
    off = C["ARM_OFF"]
    if "cut" in anchors:
        x, y = anchors["cut"]
        a = R.prog(t, off, off + 0.12) * (1 - R.prog(t, off + 0.7, off + 0.9))
        burst(ctx, x, y, R.prog(t, off, off + 0.5), n=6, r0=20, r1=90, size=20)
        chip(ctx, "툭!", x - 120, y + 10, a, WH, 58)
    r0, r1 = C["REGROW"]
    if "eye0" in anchors and "star" in anchors:
        x, y = anchors["eye0"]
        sx, sy = anchors["star"]
        a = R.prog(t, r0, r0 + 0.15) * (1 - R.prog(t, r1 + 0.6, r1 + 0.85))
        ph = (t - r0) * 2.2
        if r0 <= t < r1 + 0.3:
            for k in range(4):
                f = ((ph + k * 0.25) % 1.0)
                R.draw_sparkle(ctx, sx + (x - sx) * (0.5 + 0.5 * f) + 30 * math.sin(k * 2.1 + t * 6), sy + (y - sy) * (0.5 + 0.5 * f), 16 * (1 - f) + 4, 1 - f, YE if k % 2 else WH)
        chip(ctx, "쑥쑥!", x - 140, y + 20, a, YE, 58)
    b0, b1 = C["BABY"]
    if "baby" in anchors:
        x, y = anchors["baby"]
        if b0 <= t < b1:
            for k in range(5):
                f = ((t - b0) * 0.9 + k * 0.2) % 1.0
                ang = k * math.tau / 5 + t * 1.5
                R.draw_sparkle(ctx, x + 120 * math.cos(ang), y + 80 * math.sin(ang), 18 * math.sin(math.pi * f) + 3, math.sin(math.pi * f), YE if k % 2 else WH)
        hop = C["BABY_HOP"]
        a = R.prog(t, hop, hop + 0.15) * (1 - R.prog(t, 16.25, 16.5))
        chip(ctx, "한 마리 더!", x + 10, y + 150, a, YE, 54)


def draw_water(ctx, t, anchors):
    g0, g1 = C["GLASS"]
    if "madre" in anchors:
        x, y = anchors["madre"]
        a = R.prog(t, g0 + 0.35, g0 + 0.55) * (1 - R.prog(t, g1 - 0.25, g1))
        if a > 0:
            # 물방울이 구멍으로 쏙 들어가는 화살표
            for k in range(3):
                f = ((t - g0) * 1.1 + k / 3) % 1.0
                yy = y - 150 + 120 * f
                ctx.save()
                ctx.translate(x + 40, yy)
                ctx.new_path()
                ctx.move_to(0, -18)
                ctx.curve_to(12, -2, 14, 8, 0, 16)
                ctx.curve_to(-14, 8, -12, -2, 0, -18)
                ctx.set_source_rgba(*R.hx("#3fb4ff"), a * math.sin(math.pi * f))
                ctx.fill_preserve()
                ctx.set_source_rgba(*R.NAVY, a * math.sin(math.pi * f))
                ctx.set_line_width(3)
                ctx.stroke()
                ctx.restore()
            chip(ctx, "바닷물 쏙!", x + 190, y - 120, a, CY, 50)
    f0, f1 = C["FEET"]
    if "star" in anchors and 16.6 <= t < 22.6:
        x, y = anchors["star"]
        a = R.prog(t, f0 + 0.25, f0 + 0.45) * (1 - R.prog(t, 22.25, 22.5))
        chip(ctx, "관족", x + 250, y + 300, a, CY, 52)


def draw_eat(ctx, t, anchors):
    if not (22.6 <= t < 27.6):
        return
    if "clam" in anchors:
        x, y = anchors["clam"]
        a = R.prog(t, 23.0, 23.2) * (1 - R.prog(t, 24.3, 24.5))
        chip(ctx, "조개", x + 230, y + 60, a, WH, 54)
    s0, s1 = C["STOMACH"]
    if "stomach" in anchors:
        x, y = anchors["stomach"]
        a = R.prog(t, s0 + 0.4, s0 + 0.6) * (1 - R.prog(t, s1 - 0.4, s1 - 0.2))
        if a > 0:
            ctx.save()
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            for lw, col in ((12, R.NAVY), (6, PK)):
                ctx.new_path()
                ctx.move_to(x + 190, y + 150)
                ctx.curve_to(x + 150, y + 90, x + 90, y + 60, x + 40, y + 25)
                ctx.set_source_rgba(*col, a)
                ctx.set_line_width(lw)
                ctx.stroke()
            ctx.restore()
            chip(ctx, "위", x + 225, y + 190, a, PK, 64)
    y0, y1 = C["YUM"]
    if "star" in anchors:
        x, y = anchors["star"]
        for k, ty in enumerate((y0, y1)):
            a = R.prog(t, ty, ty + 0.12) * (1 - R.prog(t, ty + 0.7, ty + 0.9))
            chip(ctx, "냠냠!", x + (-300 if k == 0 else 300), y - 40 - 30 * k, a, YE, 60)


def overlay(ctx, t, anchors):
    R.draw_vignette(ctx)
    draw_hook(ctx, t, anchors)
    draw_eyes(ctx, t, anchors)
    draw_regrow(ctx, t, anchors)
    draw_water(ctx, t, anchors)
    draw_eat(ctx, t, anchors)
    R.draw_outro(ctx, t)
    R.draw_header(ctx, t)
    R.draw_badges(ctx, t)
    draw_texts(ctx, t)
    R.draw_transition(ctx, t)

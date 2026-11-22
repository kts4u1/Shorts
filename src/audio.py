#!/usr/bin/env python3
"""배경음악 + 효과음 합성 (numpy 만 사용, 저작권 걱정 없는 자체 제작 사운드).

사용법: python3 src/audio.py build/audio.wav [--narration build/narration.wav] [--timeline otter/timeline.py]
"""
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl  # noqa: E402  (타임라인 선택)

T = tl.TL
DURATION, SFX = T.DURATION, T.SFX
KEY = getattr(T, "MUSIC_KEY", 0)   # 배경음악 조옮김(반음)

SR = 44100
N = int(SR * DURATION)
rng = np.random.default_rng(7)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, start, sig, pan=0.0, gain=1.0):
    i0 = int(round(start * SR))
    if i0 >= len(buf) or i0 < 0:
        return
    sig = sig[: len(buf) - i0] * gain
    left = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    right = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    buf[i0:i0 + len(sig), 0] += sig * left
    buf[i0:i0 + len(sig), 1] += sig * right


def attack(t, a=0.004):
    return np.clip(t / a, 0, 1)


def onepole_lp(x, cutoff):
    """시간에 따라 변하는 cutoff(Hz 배열 또는 상수)의 1차 저역통과 필터."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    alpha = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha[i] * (x[i] - acc)
        y[i] = acc
    return y


# ---------------------------------------------------------------- 악기
def marimba(f, dur=0.6):
    t = tt(dur)
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.28)
         + 0.35 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t / 0.05)
         + 0.12 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t / 0.012))
    return y * attack(t, 0.002)


def pluck(f, dur=0.5):
    t = tt(dur)
    y = np.zeros_like(t)
    for k in (1, 3, 5, 7):
        y += ((-1) ** ((k - 1) // 2)) / k ** 2 * np.sin(2 * np.pi * k * f * t)
    y += 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.08)
    return y * attack(t, 0.004) * np.exp(-t / 0.32)


def pad(freqs, dur):
    t = tt(dur)
    y = np.zeros_like(t)
    for f in freqs:
        y += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t + 0.3)
    env = np.clip(t / 0.35, 0, 1) * np.clip((dur - t) / 0.45, 0, 1)
    return y * env / len(freqs)


def bass(f, dur=0.42):
    t = tt(dur)
    y = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) + 0.22 * np.sin(2 * np.pi * 3 * f * t)
    y = np.tanh(1.4 * y) * attack(t, 0.006) * np.exp(-t / 0.22)
    return y


def kick():
    t = tt(0.35)
    f = 48 + 120 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.17) * attack(t, 0.001)


def clap():
    t = tt(0.22)
    n = rng.standard_normal(len(t))
    n = onepole_lp(n, 5000) - onepole_lp(n, 700)
    env = np.zeros_like(t)
    for d in (0.0, 0.011, 0.022):
        env += (t >= d) * np.exp(-np.clip(t - d, 0, None) / (0.012 if d < 0.02 else 0.07))
    return n * env * 1.1


def hat():
    t = tt(0.06)
    n = np.diff(rng.standard_normal(len(t) + 1))
    return n * np.exp(-t / 0.016) * 0.5


# ---------------------------------------------------------------- 효과음
def sfx_pop(f=700):
    t = tt(0.12)
    freq = f * (0.6 + 1.4 * (1 - np.exp(-t / 0.025)))
    ph = 2 * np.pi * np.cumsum(freq) / SR
    return np.sin(ph) * np.exp(-t / 0.035) * attack(t, 0.001)


def sfx_boing():
    t = tt(0.55)
    freq = 260 + 140 * np.sin(2 * np.pi * 11 * t) * np.exp(-t / 0.18) + 120 * t
    ph = 2 * np.pi * np.cumsum(freq) / SR
    return (np.sin(ph) + 0.3 * np.sin(2 * ph)) * np.exp(-t / 0.2) * attack(t, 0.003) * 0.8


def sfx_ding(f=1760):
    t = tt(1.2)
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.45)
         + 0.5 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / 0.15)
         + 0.25 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / 0.05))
    return y * attack(t, 0.001) * 0.6


def sfx_sparkle():
    out = np.zeros(int(0.9 * SR))
    for k, m in enumerate((84, 88, 91, 96, 100)):
        d = sfx_ding(midi(m))[: len(out) - int(k * 0.06 * SR)] * (0.55 - 0.05 * k)
        i0 = int(k * 0.06 * SR)
        out[i0:i0 + len(d)] += d
    return out


def sfx_whoosh(dur=0.5):
    t = tt(dur)
    n = rng.standard_normal(len(t))
    x = t / dur
    cutoff = 300 + 5000 * np.sin(np.pi * x) ** 2
    y = onepole_lp(n, cutoff)
    y = onepole_lp(y, cutoff)
    return y * np.sin(np.pi * x) ** 1.5 * 1.6


def sfx_swish():
    return sfx_whoosh(0.3) * 0.6


def sfx_bubbles(n=5):
    out = np.zeros(int(0.8 * SR))
    for k in range(n):
        f0 = 380 + 500 * rng.random()
        t = tt(0.07)
        freq = f0 * (1 + 2.2 * t / 0.07)
        ph = 2 * np.pi * np.cumsum(freq) / SR
        b = np.sin(ph) * np.sin(np.pi * t / 0.07) * 0.5
        i0 = int((k * 0.09 + 0.03 * rng.random()) * SR)
        out[i0:i0 + len(b)] += b[: len(out) - i0]
    return out


def sfx_beep(f=988, dur=0.09):
    t = tt(dur)
    return np.sin(2 * np.pi * f * t) * np.clip(t / 0.004, 0, 1) * np.clip((dur - t) / 0.01, 0, 1)


def sfx_flatline():
    t = tt(1.1)
    return np.sin(2 * np.pi * 988 * t) * np.clip(t / 0.01, 0, 1) * np.clip((1.1 - t) / 0.35, 0, 1) * 0.55


def sfx_thud():
    t = tt(0.3)
    f = 70 + 90 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    n = onepole_lp(rng.standard_normal(len(t)), 900) * np.exp(-t / 0.03)
    return (np.sin(ph) * np.exp(-t / 0.1) + n * 1.5) * 0.9


def sfx_click():
    t = tt(0.05)
    n = np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t / 0.004)
    return (n * 0.4 + np.sin(2 * np.pi * 2200 * t) * np.exp(-t / 0.01)) * 0.8


def sfx_knock(f=900):
    """조개를 돌에 두드리는 '톡' 소리."""
    t = tt(0.2)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.03) + 0.45 * np.sin(2 * np.pi * f * 2.4 * t) * np.exp(-t / 0.012)
    n = np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t / 0.004) * 0.35
    return (y + n) * attack(t, 0.0005)


def sfx_splash(dur=0.7):
    """물 찰방 소리."""
    t = tt(dur)
    n = rng.standard_normal(len(t))
    y = onepole_lp(n, 300 + 3200 * np.exp(-t / 0.18)) * (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.2) * 1.6
    out = y.copy()
    b = sfx_bubbles(5)[: len(out)] * 0.6
    out[: len(b)] += b
    return out


SFX_FUNCS = {
    "pop": (lambda p: sfx_pop(p.get("f", 700)), 0.42),
    "boing": (lambda p: sfx_boing(), 0.45),
    "ding": (lambda p: sfx_ding(p.get("f", 1760)), 0.35),
    "sparkle": (lambda p: sfx_sparkle(), 0.32),
    "whoosh": (lambda p: sfx_whoosh(), 0.30),
    "swish": (lambda p: sfx_swish(), 0.30),
    "bubbles": (lambda p: sfx_bubbles(p.get("n", 5)), 0.35),
    "flatline": (lambda p: sfx_flatline(), 0.16),
    "thud": (lambda p: sfx_thud(), 0.55),
    "click": (lambda p: sfx_click(), 0.5),
    "knock": (lambda p: sfx_knock(p.get("f", 900)), 0.5),
    "splash": (lambda p: sfx_splash(), 0.35),
}


# ---------------------------------------------------------------- 작곡
CHORDS = {
    "C": [60, 64, 67, 72],
    "Am": [57, 60, 64, 69],
    "F": [53, 57, 60, 65],
    "G": [55, 59, 62, 67],
}
BASS_ROOT = {"C": 36, "Am": 45, "F": 41, "G": 43}
MELODY = {
    "C": [76, 79, 81, 79],
    "Am": [76, 74, 72, 76],
    "F": [77, 81, 84, 81],
    "G": [79, 77, 76, 74],
}
PROG = ["C", "Am", "F", "G"] * 3 + ["F", "G", "C"]
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT


def compose():
    music = np.zeros((N, 2))
    arp_pat = [0, 2, 1, 2, 3, 2, 1, 2]
    for b, ch in enumerate(PROG):
        t0 = b * BAR
        notes = CHORDS[ch]
        last = b == len(PROG) - 1
        # 패드
        place(music, t0, pad([midi(m - 12 + KEY) for m in notes[:3]], BAR + 0.3), gain=0.05)
        # 마림바 아르페지오
        for k, idx in enumerate(arp_pat):
            if last and k >= 4:
                break
            place(music, t0 + k * BEAT / 2, marimba(midi(notes[idx] + KEY)), pan=(-0.35 if k % 2 else 0.35),
                  gain=0.13 if k % 2 == 0 else 0.10)
        # 베이스
        root = midi(BASS_ROOT[ch] + KEY)
        for off, g in ((0.0, 0.32), (1.5 * BEAT, 0.22), (2 * BEAT, 0.30)):
            place(music, t0 + off, bass(root), gain=g)
        # 드럼
        for beat in range(4):
            tb = t0 + beat * BEAT
            if beat in (0, 2):
                place(music, tb, kick(), gain=0.42)
            else:
                place(music, tb, clap(), gain=0.16)
            place(music, tb, hat(), pan=0.25, gain=0.07)
            place(music, tb + BEAT / 2, hat(), pan=0.25, gain=0.045)
        # 리드 멜로디 (두 번째 마디부터)
        if b >= 1 and not last:
            for k, m in enumerate(MELODY[ch]):
                place(music, t0 + k * BEAT, pluck(midi(m + KEY)), gain=0.085)
        if last:
            for m in notes + [notes[0] + 12]:
                place(music, t0 + 2 * BEAT, marimba(midi(m + KEY), 1.2), gain=0.08)
            place(music, t0 + 2 * BEAT, pluck(midi(72 + KEY), 1.0), gain=0.09)
    # 심장이 멈추는 구간에서 음악을 살짝 줄여 긴장감
    tline = np.arange(N) / SR
    gain = np.ones(N)
    if hasattr(T, "SWIM_START"):
        dip = np.clip((tline - T.SWIM_START) / 0.1, 0, 1) * np.clip((T.SWIM_END + 0.15 - tline) / 0.2, 0, 1)
        gain = 1 - 0.55 * dip
    gain *= np.clip((DURATION - tline) / 0.6, 0, 1)
    music *= gain[:, None]
    return music


def make_sfx():
    fx = np.zeros((N, 2))
    for t0, kind, params in SFX:
        fn, g = SFX_FUNCS[kind]
        place(fx, t0, fn(params), gain=g * params.get("g", 1.0))
    if hasattr(T, "ecg_peak_times"):
        for tp in T.ecg_peak_times():
            place(fx, tp, sfx_beep(), gain=0.11)
    if hasattr(T, "jet_times"):
        for tj in T.jet_times():
            place(fx, tj - 0.05, sfx_bubbles(6), gain=0.3)
    return fx


def load_narration(path):
    import soundfile as sf
    v, sr = sf.read(path, dtype="float32")
    assert sr == SR, sr
    if v.ndim > 1:
        v = v.mean(axis=1)
    out = np.zeros(N, dtype=np.float64)
    out[: min(N, len(v))] = v[:N]
    return out


def duck_envelope(voice, attack=0.06, release=0.35):
    """나레이션이 나오는 동안 1, 아니면 0 인 부드러운 곡선."""
    win = int(0.02 * SR)
    rms = np.sqrt(np.convolve(voice ** 2, np.ones(win) / win, mode="same"))
    active = (rms > 0.02).astype(float)
    # 짧은 쉼(0.25초 이하)은 계속 말하는 것으로 간주
    hold = int(0.25 * SR)
    active = np.convolve(active, np.ones(hold), mode="same") > 0
    env = np.zeros(N)
    a_up = 1 - np.exp(-1 / (attack * SR))
    a_dn = 1 - np.exp(-1 / (release * SR))
    step = 64  # 블록 단위로 계산 (충분히 부드러움)
    e = 0.0
    for i in range(0, N, step):
        target = 1.0 if active[i] else 0.0
        a = a_up if target > e else a_dn
        e += (target - e) * (1 - (1 - a) ** step)
        env[i:i + step] = e
    # 0.1초 미리 줄이기 (말 시작과 겹치는 효과음이 첫 음절을 가리지 않도록)
    look = int(0.1 * SR)
    env = np.concatenate([env[look:], np.full(look, env[-1])])
    return env


def limiter(x, ceiling=0.89, look=0.004, release=0.12, block=32):
    """찌그러짐 없이 피크만 살짝 눌러 주는 룩어헤드 리미터."""
    peak = np.max(np.abs(x), axis=1)
    nb = int(np.ceil(len(peak) / block))
    pk = np.zeros(nb * block)
    pk[:len(peak)] = peak
    bmax = pk.reshape(nb, block).max(axis=1)
    la = max(1, int(look * SR / block))
    ahead = np.array([bmax[i:i + la + 1].max() for i in range(nb)])
    target = np.minimum(1.0, ceiling / np.maximum(ahead, 1e-9))
    rel = np.exp(-block / (release * SR))
    g = np.empty(nb)
    cur = 1.0
    for i in range(nb):
        cur = target[i] if target[i] < cur else target[i] + (cur - target[i]) * rel
        g[i] = cur
    gs = np.interp(np.arange(len(peak)), np.arange(nb) * block + block / 2, g)
    return x * gs[:, None]


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="build/audio.wav")
    ap.add_argument("--narration", default=None, help="나레이션 wav (있으면 음악 더킹 후 믹스)")
    args = ap.parse_args()
    out = args.out
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    music = compose() * 0.9
    fx = make_sfx()
    if args.narration:
        voice = load_narration(args.narration)
        env = duck_envelope(voice)
        active = env > 0.5
        voice_rms = np.sqrt(np.mean(voice[active] ** 2))
        bed_rms = np.sqrt(np.mean(music ** 2))
        # 말이 없을 때 음악은 목소리보다 약 8dB 작게, 말할 때는 추가로 약 6dB 더 줄임
        g = voice_rms * 10 ** (-8 / 20) / bed_rms
        music *= g * (1 - 0.5 * env)[:, None]
        fx *= g * (1 - 0.65 * env)[:, None]
        # 대사 첫 음절이 효과음에 묻히지 않도록 말 시작 직후 0.3초는 효과음을 더 줄임
        meta_path = os.path.splitext(args.narration)[0] + ".json"
        if os.path.exists(meta_path):
            import json
            with open(meta_path, encoding="utf-8") as f:
                lines = json.load(f)["lines"]
            protect = np.zeros(N)
            for ln in lines:
                a0, a1 = int(ln["start"] * SR), int((ln["start"] + 0.4) * SR)
                protect[max(0, a0):min(N, a1)] = 1.0
            ramp = int(0.02 * SR)
            protect = np.convolve(protect, np.ones(ramp) / ramp, mode="same")
            fx *= (1 - 0.85 * protect)[:, None]
        mixd = music + fx + voice[:, None]
        mixd *= 0.125 / voice_rms          # 목소리 평균 레벨 약 -18dBFS
    else:
        mixd = (music + fx) * (0.6 / np.max(np.abs(music + fx)))
    mixd = limiter(mixd)
    pcm = (np.clip(mixd, -1, 1) * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("오디오 저장:", out)


if __name__ == "__main__":
    main()

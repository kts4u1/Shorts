#!/usr/bin/env python3
"""한국어 나레이션 생성 (Supertone Supertonic TTS, 로컬 ONNX 실행).

대사마다 여러 번 합성해 아래 검사를 통과한 것을 고른다.
  1) Whisper 음성 인식으로 받아 적어 대사와 비교 (발음/누락 검사)
  2) 끝이 뚝 잘리지 않는지 (자연스럽게 잦아드는지)
  3) 말하는 도중 순간적으로 소리가 빠지는 구간(드롭아웃)이 없는지
검사는 최종 영상과 같은 조건(음색 처리 + 배경음악)에서 한다.
음색 처리: 고음역 완화 EQ + 치찰음 감소.

결과:
  build/narration.wav      (영상 길이 전체, 44.1kHz 모노, 후처리 적용)
  build/narration_raw.wav  (후처리 전)
  build/narration.json     (대사별 시각/검사 결과)

사용법: python3 src/narration.py [--voice F2] [--out build/narration.wav]
"""
import argparse
import json
import os
import re
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl  # noqa: E402,F401  (타임라인 선택: --timeline 경로)
from timeline import DURATION, NARRATION  # noqa: E402

SR = 44100
PAD = 0.08          # 대사 앞뒤로 남겨 두는 여백(초)
MAX_SPEED = 1.10    # 구간에 안 들어갈 때만 이 정도까지 살짝 빠르게


# ---------------------------------------------------------------- 분석
def frame_db(x, hop_s=0.005):
    hop = int(hop_s * SR)
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-9
    return 20 * np.log10(rms / rms.max())


def speech_bounds(x, thr_db=-45):
    db = frame_db(x)
    idx = np.where(db > thr_db)[0]
    hop = int(0.005 * SR)
    return idx[0] * hop, (idx[-1] + 1) * hop


def abrupt_end(x):
    """마지막 음절이 잦아들지 않고 뚝 끊기면 True (5ms 사이 15dB 이상 급락)."""
    db = frame_db(x)
    voiced = np.where(db > -45)[0]
    if len(voiced) == 0:
        return False
    last = voiced[-1]
    w = db[max(0, last - 12):min(len(db), last + 4)]
    steps = w[:-1] - w[1:]
    return bool(np.any((steps > 15) & (w[:-1] > -22)))


def dropouts(x):
    """말하는 도중 25ms 이하로 소리가 거의 사라졌다 돌아오는 구간 수."""
    db = frame_db(x)
    s, e = np.where(db > -40)[0][[0, -1]]
    cnt = 0
    i = s
    while i < e:
        if db[i] < -36:
            j = i
            while j < e and db[j] < -36:
                j += 1
            dur = j - i
            left = db[max(s, i - 3):i].max() if i > s else -99
            right = db[j:min(e + 1, j + 3)].max()
            if dur <= 5 and left > -16 and right > -16:
                cnt += 1
            i = j
        else:
            i += 1
    return cnt


# ---------------------------------------------------------------- 음성 인식 검증
_ASR = None
_DIG = "영일이삼사오육칠팔구"


def _chunk(n):
    out = ""
    for v, u in ((1000, "천"), (100, "백"), (10, "십"), (1, "")):
        d = n // v % 10
        if d:
            out += ("" if d == 1 and u else _DIG[d]) + u
    return out


def sino(n):
    """정수를 한자어 수 읽기로 (예: 150000 -> 십오만, 1 -> 일)."""
    if n == 0:
        return "영"
    man, rest = divmod(n, 10000)
    return (("" if man == 1 else _chunk(man)) + "만" if man else "") + (_chunk(rest) if rest else "")


def asr_score(seg, text):
    """faster-whisper 로 받아 적어 글자 오류율(CER) 계산. 숫자 표기 차이는 허용."""
    global _ASR
    if _ASR is None:
        from faster_whisper import WhisperModel
        _ASR = WhisperModel("small", device="cpu", compute_type="int8")
    idx = np.linspace(0, len(seg) - 1, int(len(seg) * 16000 / SR)).astype(int)
    segs, _ = _ASR.transcribe(seg[idx].astype(np.float32), language="ko", beam_size=5)
    hyp = "".join(x.text for x in segs)
    hyp = hyp.replace("%", "퍼센트")
    hyp = re.sub(r"(\d)\s*m(?![a-zA-Z])", r"\1미터", hyp)
    hyp = re.sub(r"(\d+)\.(\d+)", lambda m: sino(int(m.group(1))) + "점" + "".join(_DIG[int(d)] for d in m.group(2)), hyp)
    hyp = re.sub(r"([1-4])\s*(개|시간|마리)", lambda m: "한두세네"[int(m.group(1)) - 1] + m.group(2), hyp)
    hyp = re.sub(r"\d[\d,]*", lambda m: sino(int(m.group().replace(",", ""))), hyp)

    def norm(x):
        # 소리가 같은 표기(동음)는 같은 것으로 본다: ㅐ/ㅔ 합류, 연음 표기 등
        x = re.sub(r"[^가-힣]", "", x).replace("때는", "땐").replace("해팔이", "해파리").replace("아를", "알을").replace("의", "에")
        out = []
        for ch in x:
            c = ord(ch) - 0xAC00
            ini, med, fin = c // 588, (c % 588) // 28, c % 28
            med = {5: 1, 7: 3}.get(med, med)   # ㅔ->ㅐ, ㅖ->ㅒ
            out.append(chr(0xAC00 + ini * 588 + med * 28 + fin))
        return "".join(out)
    r, h = norm(text), norm(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / max(1, len(r)), hyp.strip()


# ---------------------------------------------------------------- 음색 다듬기
def stft(x, n=1024, hop=256):
    win = np.hanning(n)
    pad = np.concatenate([np.zeros(n), x, np.zeros(n)])
    frames = np.lib.stride_tricks.sliding_window_view(pad, n)[::hop] * win
    return np.fft.rfft(frames, axis=1), win, len(pad)


def istft(X, win, total, n=1024, hop=256):
    frames = np.fft.irfft(X, n=n, axis=1) * win
    out = np.zeros(total)
    wsum = np.zeros(total)
    for i, fr in enumerate(frames):
        out[i * hop:i * hop + n] += fr
        wsum[i * hop:i * hop + n] += win ** 2
    out /= np.maximum(wsum, 1e-6)
    return out[n:-n]


def soften(x, presence_db=-2.5, shelf_db=-5.0, warmth_db=1.5, deess_thresh=0.22, deess_floor=0.4):
    """날카로운 느낌 완화: 저역 정리, 2.5~4.5kHz(쏘는 대역) 낮춤, 6kHz 이상 완만히 감쇠, 치찰음 동적 감소."""
    n, hop = 1024, 256
    X, win, total = stft(x, n, hop)
    f = np.fft.rfftfreq(n, 1 / SR)
    lf = np.log2(np.maximum(f, 1.0))

    def db(g):
        return 10 ** (g / 20)
    eq = np.ones_like(f)
    eq *= 1 / (1 + (80 / np.maximum(f, 1)) ** 4)                       # 80Hz 이하 정리
    eq *= db(warmth_db * np.exp(-((lf - np.log2(250)) / 0.8) ** 2))     # 저음 따뜻함
    eq *= db(presence_db * np.exp(-((lf - np.log2(3000)) / 0.85) ** 2))  # 쏘는 대역 (2~4.5kHz 넓게)
    eq *= db(shelf_db / (1 + np.exp(-(lf - np.log2(6500)) / 0.25)))     # 고역 셸빙
    X *= eq[None, :]
    # 치찰음(ㅅ,ㅆ,ㅊ 등) 동적 감소
    hf = f > 4500
    e_hf = np.sum(np.abs(X[:, hf]) ** 2, axis=1)
    e_all = np.sum(np.abs(X) ** 2, axis=1) + 1e-12
    ratio = e_hf / e_all
    g = np.clip((deess_thresh / np.maximum(ratio, 1e-6)) ** 0.6, deess_floor, 1.0)
    g = np.convolve(g, np.ones(5) / 5, mode="same")
    X[:, hf] *= g[:, None]
    return istft(X, win, total, n, hop)


def transient_soften(x, amount=0.5):
    """소리가 튀어 오르는 순간(빠른 포락선 > 느린 포락선)만 살짝 줄여 말소리를 둥글게.
    전체를 누르는 압축과 달리 모음/자음 비율(음색)은 바꾸지 않는다."""
    if amount <= 0:
        return x
    hop = 44
    n = len(x) // hop
    e = np.abs(x[: n * hop]).reshape(n, hop).max(axis=1) + 1e-9

    def follow(env, att, rel):
        out = np.empty_like(env)
        cur = env[0]
        ca, cr = np.exp(-1 / (att * 1000)), np.exp(-1 / (rel * 1000))
        for i, v in enumerate(env):
            cur = v + (cur - v) * (ca if v > cur else cr)
            out[i] = cur
        return out
    fast, slow = follow(e, 0.001, 0.02), follow(e, 0.03, 0.12)
    g = np.where(fast > slow, (slow / fast) ** amount, 1.0)
    g = np.convolve(g, np.ones(5) / 5, mode="same")
    return x * np.interp(np.arange(len(x)), np.arange(n) * hop + hop / 2, g)


# ---------------------------------------------------------------- 목소리
def pitch_up(x, ratio):
    """재생 속도를 ratio 배로 올려 음높이·포먼트를 함께 올림 (길이는 1/ratio).
    TTS 를 ratio 배 느리게 합성한 뒤 적용하면 말 빠르기는 그대로, 목소리만 젊어진다."""
    if abs(ratio - 1.0) < 1e-4:
        return x
    pad = int(0.1 * SR)
    xp = np.concatenate([np.zeros(pad), x, np.zeros(pad)])
    n = len(xp)
    m = int(round(n / ratio))
    X = np.fft.rfft(xp)
    y = np.fft.irfft(X[: m // 2 + 1], m) * (m / n)
    p2 = int(round(pad / ratio))
    return y[p2:len(y) - p2]


def load_style(tts, spec):
    """'F2' 또는 'F2:0.75+F5:0.25' 처럼 여러 목소리를 비율대로 섞은 스타일."""
    from supertonic import Style
    parts = []
    for p in spec.split("+"):
        name, _, w = p.partition(":")
        parts.append((tts.get_voice_style(name.strip()), float(w) if w else 1.0))
    total = sum(w for _, w in parts)
    ttl = sum(st.ttl * (w / total) for st, w in parts).astype(np.float32)
    dp = sum(st.dp * (w / total) for st, w in parts).astype(np.float32)
    return Style(ttl, dp)


# ---------------------------------------------------------------- 메인
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="F2", help="예: F2, M4, F2:0.75+F5:0.25")
    ap.add_argument("--out", default="build/narration.wav")
    ap.add_argument("--speed", type=float, default=0.97, help="최종 말하기 속도")
    ap.add_argument("--steps", type=int, default=32)
    ap.add_argument("--seed", type=int, default=2024)
    ap.add_argument("--tries", type=int, default=8)
    ap.add_argument("--pitch", type=float, default=1.5, help="음높이·음색을 올릴 반음 수 (젊은 느낌)")
    ap.add_argument("--presence-db", type=float, default=-6.5, help="2~4.5kHz 감쇠량(dB)")
    ap.add_argument("--shelf-db", type=float, default=-4.5, help="6kHz 이상 감쇠량(dB)")
    ap.add_argument("--warmth-db", type=float, default=0.8, help="250Hz 부근 보정(dB)")
    ap.add_argument("--deess", type=float, default=0.16, help="치찰음 감소 기준 (낮을수록 강함)")
    ap.add_argument("--deess-floor", type=float, default=0.3, help="치찰음 최대 감소 (작을수록 강함)")
    ap.add_argument("--soft-attack", type=float, default=0.6, help="튀는 순간 완화 정도 (0이면 끔)")
    ap.add_argument("--no-verify", action="store_true", help="음성 인식 검증 생략")
    args = ap.parse_args()

    from supertonic import TTS
    tts = TTS(model="supertonic-3")
    assert tts.sample_rate == SR, tts.sample_rate
    style = load_style(tts, args.voice)

    # 최종 영상과 같은 조건(음색 처리 + 배경음악)에서 검사하기 위해 음악 트랙을 미리 만든다
    import audio as A
    bed = A.compose().mean(axis=1) * 0.9
    bed_rms = np.sqrt(np.mean(bed ** 2)) + 1e-9
    fx_bed = A.make_sfx().mean(axis=1)   # 효과음도 최종 영상과 같은 조건으로

    def finish(seg):
        seg = seg / (np.max(np.abs(seg)) + 1e-9) * 0.9
        fi, fo = int(0.02 * SR), int(0.06 * SR)
        seg[:fi] *= np.linspace(0, 1, fi) ** 2
        seg[-fo:] *= np.linspace(1, 0, fo) ** 2
        proc = soften(seg, args.presence_db, args.shelf_db, args.warmth_db, args.deess, args.deess_floor)
        proc = transient_soften(proc, args.soft_attack)
        return seg, proc / (np.max(np.abs(proc)) + 1e-9) * 0.9

    ratio = 2 ** (args.pitch / 12)
    raw_track = np.zeros(int(DURATION * SR), dtype=np.float64)
    track = np.zeros_like(raw_track)
    meta = []
    for li, (start, end, text) in enumerate(NARRATION):
        slot = end - start
        i0 = int((start - PAD * 0.75) * SR)
        best = None
        for attempt in range(args.tries):
            np.random.seed(args.seed + li * 100 + attempt)
            speed = args.speed
            while True:
                wav, _ = tts.synthesize(text, voice_style=style, lang="ko", speed=speed / ratio, total_steps=args.steps)
                x = pitch_up(wav[0].astype(np.float64), ratio)
                a, b = speech_bounds(x)
                dur = (b - a) / SR
                if dur + PAD <= slot or speed >= MAX_SPEED:
                    break
                speed = min(MAX_SPEED, speed * (dur + PAD) / slot + 0.005)
            a = max(0, a - int(PAD * SR))
            b = min(len(x), b + int(PAD * SR))
            seg, proc = finish(x[a:b])
            ab, dr = abrupt_end(proc), dropouts(proc)
            if args.no_verify:
                err, hyp = 0.0, ""
            else:
                act = proc[np.abs(proc) > 0.01]
                # audio.py 의 믹스와 같은 비율: 음악은 목소리보다 8dB 작게 + 말하는 동안 절반,
                # 효과음은 말하는 동안 35%, 대사 시작 0.4초는 그중 15%
                g = np.sqrt(np.mean(act ** 2)) * 10 ** (-8 / 20) / bed_rms
                music = bed[i0:i0 + len(proc)]
                fx = fx_bed[i0:i0 + len(music)] * 0.35
                fx[: int(0.4 * SR)] *= 0.15
                err, hyp = asr_score(proc[:len(music)] + music * g * 0.5 + fx * g, text)
            score = err * 10 + ab * 1.0 + dr * 0.6 + max(0.0, dur + PAD - slot) * 5
            if best is None or score < best[0]:
                best = (score, seg, proc, speed, err, hyp, ab, dr)
            if err <= 0.02 and not ab and dr == 0 and dur + PAD <= slot:
                break
            print(f"   재시도 {attempt + 1}: CER {err:.2f} 끝잘림 {ab} 드롭아웃 {dr} 길이 {dur:.2f}/{slot:.2f} '{hyp}'")
        _, seg, proc, speed, err, hyp, ab, dr = best
        n = min(len(proc), len(track) - i0)
        raw_track[i0:i0 + n] += seg[:n]
        track[i0:i0 + n] += proc[:n]
        meta.append({"start": round(start - PAD * 0.75, 3), "end": round(start - PAD * 0.75 + n / SR, 3),
                     "slot": [start, end], "speed": round(speed, 3), "text": text, "asr": hyp,
                     "cer": round(err, 3), "abrupt_end": bool(ab), "dropouts": int(dr)})
        print(f"{start:5.2f}s  {n / SR:4.2f}s/{slot:4.2f}s  x{speed:.2f}  CER {err:.2f}  "
              f"끝잘림 {ab}  드롭아웃 {dr}  {text}")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sf.write(os.path.splitext(args.out)[0] + "_raw.wav", raw_track.astype(np.float32), SR)
    sf.write(args.out, track.astype(np.float32), SR)
    with open(os.path.splitext(args.out)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump({"voice": args.voice, "pitch": args.pitch, "speed": args.speed, "lines": meta}, f, ensure_ascii=False, indent=2)
    print("나레이션 저장:", args.out)


if __name__ == "__main__":
    main()

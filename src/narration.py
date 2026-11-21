#!/usr/bin/env python3
"""한국어 나레이션 생성 (Supertone Supertonic TTS, 로컬 ONNX 실행).

각 대사를 장면 타이밍에 맞춰 합성하고, 주어진 구간에 들어가지 않으면
말하기 속도를 올려 다시 합성한다. 결과:
  build/narration.wav   (영상 길이 전체, 44.1kHz 모노)
  build/narration.json  (대사별 실제 시작/끝 시각)

사용법: python3 src/narration.py [--voice F1] [--out build/narration.wav]
"""
import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import DURATION, NARRATION  # noqa: E402

SR = 44100


def trim_silence(x, thr=0.01, pad=0.03):
    idx = np.where(np.abs(x) > thr * np.max(np.abs(x)))[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(pad * SR))
    b = min(len(x), idx[-1] + int(pad * SR))
    return x[a:b]


_ASR = None


def asr_score(seg, text):
    """faster-whisper 로 받아 적어 글자 오류율(CER)을 계산. 숫자 표기 차이는 허용."""
    global _ASR
    import re
    if _ASR is None:
        from faster_whisper import WhisperModel
        _ASR = WhisperModel("small", device="cpu", compute_type="int8")
    idx = np.linspace(0, len(seg) - 1, int(len(seg) * 16000 / SR)).astype(int)
    segs, _ = _ASR.transcribe(seg[idx].astype(np.float32), language="ko", beam_size=5)
    hyp = "".join(x.text for x in segs)
    nums = {"3개": "세개", "2개": "두개", "1개": "한개", "3분의2": "삼분의이", "3분의 2": "삼분의이"}
    for k, v in nums.items():
        hyp = hyp.replace(k, v)

    def norm(x):
        return re.sub(r"[^가-힣]", "", x).replace("때는", "땐").replace("네요", "내요")
    r, h = norm(text), norm(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / max(1, len(r)), hyp.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="F1")
    ap.add_argument("--out", default="build/narration.wav")
    ap.add_argument("--speed", type=float, default=1.08)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--no-verify", action="store_true", help="음성 인식 검증 생략")
    args = ap.parse_args()

    from supertonic import TTS
    tts = TTS(model="supertonic-3")
    assert tts.sample_rate == SR, tts.sample_rate
    style = tts.get_voice_style(args.voice)

    track = np.zeros(int(DURATION * SR), dtype=np.float32)
    meta = []
    for li, (start, end, text) in enumerate(NARRATION):
        slot = end - start
        best = None
        for attempt in range(6):
            np.random.seed(args.seed + li * 100 + attempt)
            speed = args.speed
            while True:
                wav, _ = tts.synthesize(text, voice_style=style, lang="ko", speed=speed, total_steps=12)
                seg = trim_silence(wav[0].astype(np.float32))
                dur = len(seg) / SR
                if dur <= slot or speed >= 1.45:
                    break
                speed = min(1.45, speed * min(1.12, dur / slot + 0.02))
            if args.no_verify:
                best = (0.0, seg, speed, "")
                break
            err, hyp = asr_score(seg, text)
            if best is None or err < best[0]:
                best = (err, seg, speed, hyp)
            if err <= 0.02:
                break
            print(f"   재시도 {attempt + 1}: CER {err:.2f} '{hyp}'")
        err, seg, speed, hyp = best
        seg = seg / (np.max(np.abs(seg)) + 1e-9) * 0.95
        fade = int(0.01 * SR)
        seg[:fade] *= np.linspace(0, 1, fade)
        seg[-fade:] *= np.linspace(1, 0, fade)
        i0 = int(start * SR)
        seg = seg[: len(track) - i0]
        track[i0:i0 + len(seg)] += seg
        meta.append({"start": start, "end": start + len(seg) / SR, "slot_end": end,
                     "speed": round(speed, 3), "text": text, "asr": hyp, "cer": round(err, 3)})
        print(f"{start:5.2f}s  {len(seg) / SR:4.2f}s/{slot:4.2f}s  x{speed:.2f}  CER {err:.2f}  {text}")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sf.write(args.out, track, SR)
    with open(os.path.splitext(args.out)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump({"voice": args.voice, "lines": meta}, f, ensure_ascii=False, indent=2)
    print("나레이션 저장:", args.out)


if __name__ == "__main__":
    main()

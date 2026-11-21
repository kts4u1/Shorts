"""영상/오디오가 함께 쓰는 타임라인 정의 (단위: 초)."""

W, H = 1080, 1920
FPS = 30
DURATION = 30.0

# 장면 구간
SCENES = {
    "hook":   (0.0, 3.6),    # 문어의 심장은 몇 개일까?
    "hearts": (3.6, 10.2),   # 사실 1: 심장 3개
    "blood":  (10.2, 16.6),  # 사실 2: 파란 피
    "swim":   (16.6, 22.6),  # 사실 3: 헤엄칠 땐 심장이 멈춤
    "neuron": (22.6, 27.6),  # 사실 4: 뉴런의 2/3가 다리에
    "outro":  (27.6, 30.0),  # 구독 유도
}
BOUNDARIES = [3.6, 10.2, 16.6, 22.6, 27.6]

# 헤엄 장면 세부 타이밍
SWIM_START = 17.3   # 온몸 심장 멈춤 시작
SWIM_END = 19.5     # 다시 뛰기 시작
LAND_TIME = 20.15
ECG_PERIOD = 0.75
ECG_PANEL = (16.85, 22.45)
JET_FREQ = 1.5


def heart_active(tau):
    return not (SWIM_START <= tau < SWIM_END)


def ecg_peak_times():
    """ECG 패널이 보이는 동안 심장이 뛰는 순간 (삑 소리용)."""
    out = []
    k = 0
    while True:
        tp = k * ECG_PERIOD + 0.30 * ECG_PERIOD
        if tp > ECG_PANEL[1]:
            break
        if tp >= ECG_PANEL[0] + 0.1 and heart_active(tp):
            out.append(tp)
        k += 1
    return out


def jet_times():
    """헤엄칠 때 물을 뿜는 순간 (거품 소리용)."""
    out = []
    k = 0
    while True:
        tj = SWIM_START + (k + 0.5) / JET_FREQ
        if tj >= SWIM_END:
            break
        out.append(tj)
        k += 1
    return out


# 효과음 이벤트 (시각, 종류, 파라미터)
SFX = [
    (0.02, "bubbles", {"n": 7}),
    (0.30, "pop", {"f": 600}),
    (0.60, "pop", {"f": 720}),
    (0.90, "boing", {}),
    (1.40, "pop", {"f": 820}),
    (3.40, "whoosh", {}),
    (3.75, "ding", {}),
    (4.00, "pop", {"f": 700}),
    (4.50, "pop", {"f": 860}),
    (5.00, "pop", {"f": 1020}),
    (6.20, "swish", {}),
    (6.40, "pop", {"f": 650}),
    (10.00, "whoosh", {}),
    (10.35, "pop", {"f": 600}),
    (10.60, "pop", {"f": 720}),
    (10.90, "pop", {"f": 650}),
    (11.50, "pop", {"f": 800}),
    (11.60, "sparkle", {}),
    (12.40, "pop", {"f": 650}),
    (16.40, "whoosh", {}),
    (16.75, "pop", {"f": 600}),
    (17.00, "pop", {"f": 720}),
    (17.32, "flatline", {}),
    (17.60, "pop", {"f": 650}),
    (19.55, "ding", {"f": 1320}),
    (19.70, "pop", {"f": 650}),
    (20.15, "thud", {}),
    (22.40, "whoosh", {}),
    (22.75, "pop", {"f": 600}),
    (23.00, "pop", {"f": 720}),
    (23.25, "sparkle", {}),
    (24.00, "pop", {"f": 1100}),
    (24.80, "pop", {"f": 650}),
    (27.40, "whoosh", {}),
    (27.70, "pop", {"f": 700}),
    (28.00, "pop", {"f": 650}),
    (28.15, "pop", {"f": 820}),
    (28.80, "click", {}),
    (28.85, "ding", {"f": 1568}),
]

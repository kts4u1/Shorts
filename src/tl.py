"""어떤 쇼츠의 타임라인을 쓸지 고르는 로더.

`--timeline <경로>` 인자나 SHORTS_TIMELINE 환경변수로 지정한다 (기본: src/timeline.py = 문어 편).
불러온 모듈은 sys.modules["timeline"] 으로 등록되므로 `from timeline import ...` 가 그대로 동작한다.
"""
import importlib.util
import os
import sys

_DEFAULT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "timeline.py")


def _pick():
    if "--timeline" in sys.argv:
        i = sys.argv.index("--timeline")
        p = os.path.abspath(sys.argv[i + 1])
        del sys.argv[i:i + 2]
        os.environ["SHORTS_TIMELINE"] = p   # 하위 프로세스(멀티프로세싱 워커)도 같은 타임라인을 쓰도록
        return p
    return os.path.abspath(os.environ.get("SHORTS_TIMELINE", _DEFAULT))


def load():
    p = _pick()
    cur = sys.modules.get("timeline")
    if cur is not None and os.path.abspath(getattr(cur, "__file__", "")) == p:
        return cur
    spec = importlib.util.spec_from_file_location("timeline", p)
    m = importlib.util.module_from_spec(spec)
    sys.modules["timeline"] = m
    spec.loader.exec_module(m)
    return m


TL = load()

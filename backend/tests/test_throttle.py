from app import throttle
from app.throttle import Throttle


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_blocks_at_the_limit_and_slides():
    clock = Clock()
    t = Throttle(limit=3, window_seconds=60, clock=clock)
    for _ in range(2):
        t.fail("k")
        clock.now += 10
    assert t.retry_after("k") is None
    t.fail("k")  # failures at 1000, 1010, 1020
    assert t.retry_after("k") == 40  # the first one expires at 1060; now is 1020
    clock.now = 1060
    assert t.retry_after("k") is None  # it slid out of the window
    assert t.retry_after("other") is None


def test_retry_after_is_at_least_one_second():
    clock = Clock()
    t = Throttle(limit=1, window_seconds=60, clock=clock)
    t.fail("k")
    clock.now += 59.9999
    assert t.retry_after("k") == 1


def test_reset_and_clear():
    t = Throttle(limit=1, window_seconds=60)
    t.fail("a")
    t.fail("b")
    t.reset("a")
    t.reset("never seen")
    assert t.retry_after("a") is None
    assert t.retry_after("b") is not None
    t.clear()
    assert t.retry_after("b") is None


def test_expired_keys_are_swept_when_there_are_many(monkeypatch):
    monkeypatch.setattr(throttle, "SWEEP_ABOVE", 2)
    clock = Clock()
    t = Throttle(limit=5, window_seconds=60, clock=clock)
    for key in "abc":
        t.fail(key)
    clock.now += 30
    t.fail("d")  # nothing expired yet: all kept
    assert set(t._failures) == set("abcd")
    clock.now += 31
    t.fail("e")  # a, b and c expired
    assert set(t._failures) == {"d", "e"}

"""Failed-attempt counters for login, kept in process memory.

They reset when the backend restarts and are not shared between processes, so they assume the single uvicorn
worker the image runs. A shared store (a table, Redis) is needed before adding `--workers`.
"""

import time
from collections import deque
from collections.abc import Callable

# Above this many tracked keys, keys whose failures have all expired are dropped, so a spray of distinct emails or
# addresses cannot grow the dict without bound.
SWEEP_ABOVE = 10_000


class Throttle:
    def __init__(self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window_seconds
        self.clock = clock
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        failures = self._failures.get(key, deque())
        while failures and failures[0] <= now - self.window:
            failures.popleft()
        return failures

    def retry_after(self, key: str) -> int | None:
        """Seconds until `key` may try again, or None if it is not blocked."""
        now = self.clock()
        failures = self._recent(key, now)
        if len(failures) < self.limit:
            return None
        return max(1, int(failures[0] + self.window - now + 0.999))

    def fail(self, key: str) -> None:
        now = self.clock()
        if len(self._failures) > SWEEP_ABOVE:
            self._failures = {k: v for k, v in self._failures.items() if self._recent(k, now)}
        failures = self._recent(key, now)
        failures.append(now)
        self._failures[key] = failures

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)

    def clear(self) -> None:
        self._failures.clear()

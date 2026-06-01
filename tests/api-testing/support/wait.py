"""Polling helper to replace `time.sleep(N)` in tests.

`time.sleep` is wrong in two directions: too short on slow CI runners (flake),
too long on fast ones (waste). `wait_until(predicate, ...)` calls the predicate
repeatedly until it returns truthy or the timeout expires.
"""
from __future__ import annotations

import time
from typing import Any, TypeVar
from collections.abc import Callable

T = TypeVar("T")


class WaitTimeout(AssertionError):
    """Raised when `wait_until` exceeds its timeout."""


def wait_until(
    predicate: Callable[[], T],
    *,
    timeout: float = 30.0,
    interval: float = 0.5,
    msg: str = "condition not met",
) -> T:
    """Poll `predicate` until it returns truthy or `timeout` seconds elapse.

    Returns the truthy value the predicate produced (so it can be used as data:
    `result = wait_until(lambda: client.search(...).hits)`).

    Exceptions raised by the predicate are caught and treated as "not yet" until
    the deadline, then re-raised wrapped in `WaitTimeout`. This lets you write
    predicates that do real work (e.g. HTTP calls) without per-call try/except.
    """
    if timeout <= 0:
        raise ValueError("timeout must be > 0")
    if interval <= 0:
        raise ValueError("interval must be > 0")

    deadline = time.monotonic() + timeout
    last_result: Any = None
    last_exc: BaseException | None = None

    while True:
        try:
            last_result = predicate()
            last_exc = None
            if last_result:
                return last_result
        except Exception as e:
            last_exc = e
            last_result = None

        if time.monotonic() >= deadline:
            break
        time.sleep(min(interval, max(0.0, deadline - time.monotonic())))

    if last_exc is not None:
        raise WaitTimeout(f"wait_until: {msg} after {timeout}s; last exception: {last_exc!r}") from last_exc
    raise WaitTimeout(f"wait_until: {msg} after {timeout}s; last value: {last_result!r}")

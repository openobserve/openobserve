"""Polling and retry helpers for API tests.

`wait_until` replaces `time.sleep(N)`: polls until a predicate is truthy or
the deadline expires.

`retry_on_db_lock` handles transient SQLite 500 responses that appear when
parallel test workers race on write operations against the same DB file.
"""
from __future__ import annotations

import logging
import time
from typing import Any, TypeVar
from collections.abc import Callable

import requests

log = logging.getLogger("o2-api")

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


def retry_on_db_lock(
    fn: Callable[[], requests.Response],
    *,
    max_retries: int = 3,
    base_delay: float = 0.5,
) -> requests.Response:
    """Retry an HTTP call when the server returns a transient SQLite lock error.

    SQLite's single-writer model means parallel xdist workers can race on write
    operations. The server returns 500 with "database is locked" when the
    busy-timeout expires before the lock is released. A short exponential
    backoff is enough for the other writer to commit and release the lock.

    Args:
        fn: Zero-argument callable that performs the HTTP request and returns a
            Response.
        max_retries: Maximum number of additional attempts after the first
            failure (default: 3).
        base_delay: Initial sleep in seconds; doubles on each retry (default:
            0.5s → 1s → 2s).

    Returns:
        The last Response received (success or exhausted retries).

    Example::

        resp = retry_on_db_lock(lambda: session.delete(url))
        assert resp.status_code in (200, 204)
    """
    resp = fn()
    delay = base_delay
    for attempt in range(max_retries):
        if not (resp.status_code == 500 and "database is locked" in resp.text):
            return resp
        log.warning(
            "SQLite database is locked (attempt %d/%d) — retrying in %.1fs",
            attempt + 1,
            max_retries,
            delay,
        )
        time.sleep(delay)
        delay *= 2
        resp = fn()
    return resp

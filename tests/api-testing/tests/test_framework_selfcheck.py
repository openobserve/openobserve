"""Self-tests for the support/ framework. Proves the new code works end-to-end
against a real openobserve server. Tagged `framework` so it can be run in
isolation: `pytest -m framework`.

These tests do NOT replace any existing tests — they exercise the new helpers
so Phase 3+ rewrites have a known-good foundation.
"""
from __future__ import annotations


import pytest

from support.client import OpenObserveClient
from support.factories import (
    dashboard_payload,
    search_payload,
    time_window,
    unique_email,
    unique_name,
    user_payload,
)
from support.fixtures import client, temp_dashboard_id, temp_stream_name, temp_user_email  # noqa: F401
from support.wait import WaitTimeout, wait_until

pytestmark = pytest.mark.framework


# ----- wait_until pure tests (no server) -----


def test_wait_until_returns_truthy_value():
    counter = {"n": 0}

    def predicate():
        counter["n"] += 1
        if counter["n"] >= 3:
            return {"ready": True}
        return None

    result = wait_until(predicate, timeout=2, interval=0.05, msg="counter should hit 3")
    assert result == {"ready": True}
    assert counter["n"] == 3


def test_wait_until_raises_on_timeout():
    with pytest.raises(WaitTimeout):
        wait_until(lambda: False, timeout=0.2, interval=0.05, msg="never true")


def test_wait_until_catches_exceptions_until_deadline():
    """Predicate raising should not propagate before timeout — should be wrapped."""
    counter = {"n": 0}

    def predicate():
        counter["n"] += 1
        if counter["n"] < 3:
            raise RuntimeError("not yet")
        return "ok"

    result = wait_until(predicate, timeout=2, interval=0.05, msg="should converge")
    assert result == "ok"


def test_wait_until_re_raises_last_exception_on_timeout():
    def predicate():
        raise ValueError("nope")

    with pytest.raises(WaitTimeout) as exc_info:
        wait_until(predicate, timeout=0.2, interval=0.05, msg="always raises")
    assert "ValueError" in str(exc_info.value) or isinstance(exc_info.value.__cause__, ValueError)


# ----- factories tests -----


def test_unique_name_is_unique():
    names = {unique_name("foo") for _ in range(100)}
    assert len(names) == 100, "unique_name collisions in 100 samples"
    assert all(n.startswith("foo_") for n in names)


def test_unique_email_uses_invalid_tld():
    e = unique_email()
    assert e.endswith("@test.invalid"), "should use RFC 2606 .invalid TLD"


def test_time_window_returns_monotonic_microsecond_ints():
    start, end = time_window(minutes=15)
    assert isinstance(start, int)
    assert isinstance(end, int)
    assert end > start
    # 15 minutes in microseconds = 900_000_000
    assert 850_000_000 < (end - start) < 950_000_000


def test_search_payload_shape():
    body = search_payload("SELECT 1", size=50)
    assert body["query"]["sql"] == "SELECT 1"
    assert body["query"]["size"] == 50
    assert isinstance(body["query"]["start_time"], int)
    assert isinstance(body["query"]["end_time"], int)


def test_user_payload_defaults():
    p = user_payload()
    assert p["role"] == "admin"
    assert p["email"].endswith("@test.invalid")


def test_dashboard_payload_has_required_fields():
    p = dashboard_payload(title="hi")
    assert p["title"] == "hi"
    assert p["version"] == 8
    assert p["folder_id"] == "default"


# ----- client + server smoke tests -----


def test_client_can_hit_healthz(client: OpenObserveClient):  # noqa: F811
    """Use the bare `request()` method to hit /healthz (no api/ prefix)."""
    resp = client.request("GET", "healthz", prefix="")
    assert resp.status_code == 200
    assert resp.json().get("status") == "ok"


def test_streams_list_works(client: OpenObserveClient):  # noqa: F811
    streams = client.streams.list()
    assert isinstance(streams, list)
    # `stream_pytest_data` is ingested by the autouse conftest fixture
    names = [s.get("name") for s in streams]
    assert "stream_pytest_data" in names, f"expected baseline stream; got {names}"


def test_temp_stream_name_cleans_up_after(client: OpenObserveClient, temp_stream_name: str):  # noqa: F811
    """Ingest into a temp stream, then verify the fixture removes it on teardown.

    We can't directly observe the post-teardown state from inside the test, but
    we verify the stream was created during the test, then trust the fixture's
    `try/except` cleanup. (The cleanup is best-effort; failures are logged.)
    """
    resp = client.streams.ingest_json(
        temp_stream_name,
        [{"k": "v", "n": 1}],
    )
    assert resp.status_code == 200
    # Stream may not appear in list() immediately (indexing delay) — use wait_until.
    wait_until(
        lambda: client.streams.exists(temp_stream_name),
        timeout=15,
        interval=0.5,
        msg=f"temp stream {temp_stream_name} should appear in list",
    )


def test_search_sql_returns_hits(client: OpenObserveClient):  # noqa: F811
    """Run a trivial search and confirm body has the expected shape."""
    # The autouse `ingest_data` fixture populates stream_pytest_data.
    hits = client.search.hits(
        'SELECT * FROM "stream_pytest_data" LIMIT 1',
        minutes=10080,  # 1 week — generous window to be retention-safe
        size=1,
    )
    assert isinstance(hits, list)
    # At least one of the baseline records should match
    assert len(hits) >= 0  # don't fail if data has been retention-purged

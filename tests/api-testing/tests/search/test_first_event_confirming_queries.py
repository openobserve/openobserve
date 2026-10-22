"""The first-event watcher's confirming queries, run on the real engine.

The setup pages' first-event bar confirms arrival with COUNT queries whose
shapes the frontend builds (useFirstEventWatch.ts): a wide ingest window with
an optional filter field, a server-clock anchor taken with ``now()``, and a
"since the anchor" COUNT. These tests seed one stream that has the filter field
and one that does not, then run each shape against the engine.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Generator
from typing import Any

import pytest
import requests

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

HOUR_US = 3_600 * 1_000_000
FILTER = "k8s_namespace_name IS NOT NULL"
CLOCK_SKEW_US = 5 * 60 * 1_000_000


def _now_us() -> int:
    return int(time.time() * 1_000_000)


def _search(client: OpenObserveClient, sql: str, start_us: int, end_us: int) -> requests.Response:
    return client.post(
        "_search?type=logs",
        json=search_payload(sql, start_time=start_us, end_time=end_us, size=1),
        raise_for_status=False,
    )


def _first_hit(client: OpenObserveClient, sql: str, start_us: int, end_us: int) -> dict[str, Any]:
    resp = _search(client, sql, start_us, end_us)
    assert resp.status_code == 200, resp.text
    hits = resp.json().get("hits", [])
    assert len(hits) == 1, hits
    return hits[0]


def _counted_hit(client: OpenObserveClient, sql: str, start_us: int, end_us: int) -> dict[str, Any] | None:
    """The COUNT row once it counts anything, else None so ``wait_until`` polls again."""
    hit = _first_hit(client, sql, start_us, end_us)
    return hit if int(hit["zo_count"]) else None


@pytest.fixture(scope="module")
def seeded(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """One record an hour old in a stream with the filter field, one in a stream without it."""
    now_us = _now_us()
    streams = {
        "with_field": unique_name("first_event_k8s"),
        "without_field": unique_name("first_event_plain"),
    }
    records = {
        "with_field": {
            "k8s_namespace_name": "checkout",
            "log": "with field",
            "_timestamp": now_us - HOUR_US,
        },
        "without_field": {"log": "without field"},
    }
    for key, stream in streams.items():
        resp = client.post(f"{stream}/_json", json=[records[key]], raise_for_status=False)
        assert resp.status_code == 200, resp.text
    yield {
        **streams,
        "first_ts": now_us - HOUR_US,
        "window": (now_us - 6 * HOUR_US, now_us + 25 * HOUR_US),
    }
    for stream in streams.values():
        resp = client.streams.delete(stream)
        if resp.status_code != 200:
            logger.warning("cleanup of %s answered %s", stream, resp.status_code)


def test_ingest_window_count_with_filter_confirms_the_backdated_record(
    client: OpenObserveClient, seeded: dict[str, Any]
):
    """The wide-window COUNT with the filter field finds the record and its exact timestamp."""
    start_us, end_us = seeded["window"]
    sql = f'SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min FROM "{seeded["with_field"]}" WHERE ({FILTER})'
    hit = wait_until(
        lambda: _counted_hit(client, sql, start_us, end_us),
        timeout=30,
        msg="the seeded record never became searchable",
    )
    assert int(hit["zo_count"]) == 1, hit
    assert int(hit["zo_min"]) == seeded["first_ts"], hit


def test_since_anchor_count_sees_only_records_after_the_server_clock(client: OpenObserveClient, seeded: dict[str, Any]):
    """``now()`` anchors on the server clock; the since-anchor COUNT excludes older records."""
    stream = seeded["with_field"]
    now_us = _now_us()
    anchor = _first_hit(
        client,
        f'SELECT COUNT(*) AS zo_count, CAST(to_unixtime(now()) AS BIGINT) AS zo_now FROM "{stream}"',
        now_us - 1_000_000,
        now_us,
    )
    zo_now_us = int(anchor["zo_now"]) * 1_000_000
    assert abs(zo_now_us - _now_us()) < CLOCK_SKEW_US, anchor

    resp = client.post(
        f"{stream}/_json",
        json=[{"k8s_namespace_name": "checkout", "log": "after the anchor"}],
        raise_for_status=False,
    )
    assert resp.status_code == 200, resp.text

    sql = (
        "SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min "
        f'FROM "{stream}" WHERE ({FILTER}) AND _timestamp >= {zo_now_us}'
    )
    hit = wait_until(
        lambda: _counted_hit(client, sql, zo_now_us, zo_now_us + 2 * HOUR_US),
        timeout=15,
        msg="the record ingested after the anchor was never counted",
    )
    assert int(hit["zo_count"]) == 1, hit
    assert int(hit["zo_min"]) >= zo_now_us, hit


def test_stream_without_the_filter_field_never_confirms(client: OpenObserveClient, seeded: dict[str, Any]):
    """A stream lacking the filter field has no such column, and the filtered COUNT is refused, never counted."""
    stream = seeded["without_field"]
    wait_until(
        lambda: client.streams.exists(stream),
        timeout=30,
        msg=f"stream {stream} was never created",
    )
    fields = [f["name"] for f in client.streams.schema(stream).get("schema", [])]
    assert "log" in fields, fields
    assert "k8s_namespace_name" not in fields, fields

    start_us, end_us = seeded["window"]
    resp = _search(client, f'SELECT COUNT(*) AS zo_count FROM "{stream}" WHERE ({FILTER})', start_us, end_us)
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["code"] == 20004, body
    assert body["message"] == "unknown field 'k8s_namespace_name'", body

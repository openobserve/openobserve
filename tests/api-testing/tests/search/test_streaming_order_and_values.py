"""Streaming result order and field values  [regressions #7790, #7308].

#7790 (PR #7787): under http2 streaming the new histogram flow returned hits
out of order, so the chart plotted against a sequence the rows did not have.
The order is asserted against an ingested sequence column, not just against
`_timestamp`, so a stable-but-wrong order still fails.

#7308: `_values` answered 400 for some fields reachable from the logs sidebar,
which left the field list with no values to offer.
"""
from __future__ import annotations

import logging
import os
import time
import uuid

import pytest

from support.sse import read_sse_response

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

ROW_COUNT = 25
INGEST_SETTLE_TIMEOUT = 120


def _now_us() -> int:
    return int(time.time() * 1_000_000)


@pytest.fixture(scope="module")
def ordered_stream(create_session, base_url):
    """A stream whose rows carry a known sequence, so order is checkable."""
    stream = f"order_regression_{uuid.uuid4().hex[:12]}"
    now = _now_us()
    records = [
        {"_timestamp": now - i * 1_000_000, "seq": i, "body_code": f"c{i % 3}"}
        for i in range(ROW_COUNT)
    ]
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/{stream}/_json", json=records, timeout=60
    )
    assert resp.status_code == 200, f"ingest failed: {resp.text}"

    deadline = time.time() + INGEST_SETTLE_TIMEOUT
    while time.time() < deadline:
        r = create_session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
            json={
                "query": {
                    "sql": f'SELECT COUNT(*) AS cnt FROM "{stream}"',
                    "start_time": now - 7_200_000_000,
                    "end_time": now + 3_600_000_000,
                    "size": -1,
                }
            },
            timeout=60,
        )
        hits = (r.json() or {}).get("hits") or [] if r.status_code == 200 else []
        if hits and hits[0].get("cnt", 0) >= ROW_COUNT:
            break
        time.sleep(2)
    else:
        pytest.fail(f"{stream} never reached {ROW_COUNT} rows")

    yield stream, now
    create_session.delete(
        f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs", timeout=30
    )


def test_streaming_search_returns_hits_in_the_requested_order(
    create_session, base_url, ordered_stream
):
    """`ORDER BY _timestamp DESC` over the streaming path must arrive sorted (#7790)."""
    stream, now = ordered_stream
    payload = {
        "query": {
            "sql": f'SELECT _timestamp, seq FROM "{stream}" ORDER BY _timestamp DESC',
            "start_time": now - 7_200_000_000,
            "end_time": now + 3_600_000_000,
            "from": 0,
            "size": ROW_COUNT,
        }
    }
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/_search_stream?type=logs&use_cache=false",
        json=payload,
        headers={"Accept": "text/event-stream"},
        stream=True,
        timeout=120,
    )
    assert resp.status_code == 200, f"streaming search failed: {resp.text[:300]}"

    hits = read_sse_response(resp)["results"]["hits"]
    assert len(hits) == ROW_COUNT, f"expected {ROW_COUNT} hits, got {len(hits)}"

    timestamps = [h["_timestamp"] for h in hits]
    assert timestamps == sorted(timestamps, reverse=True), "hits are not ordered"

    # The ingested sequence descends with _timestamp, so it must arrive ascending.
    assert [h["seq"] for h in hits] == list(range(ROW_COUNT))


def test_streaming_search_honours_ascending_order(
    create_session, base_url, ordered_stream
):
    """The mirror direction, so a hardcoded DESC cannot pass this file."""
    stream, now = ordered_stream
    payload = {
        "query": {
            "sql": f'SELECT _timestamp, seq FROM "{stream}" ORDER BY _timestamp ASC',
            "start_time": now - 7_200_000_000,
            "end_time": now + 3_600_000_000,
            "from": 0,
            "size": ROW_COUNT,
        }
    }
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/_search_stream?type=logs&use_cache=false",
        json=payload,
        headers={"Accept": "text/event-stream"},
        stream=True,
        timeout=120,
    )
    assert resp.status_code == 200, f"streaming search failed: {resp.text[:300]}"

    hits = read_sse_response(resp)["results"]["hits"]
    assert [h["seq"] for h in hits] == list(range(ROW_COUNT - 1, -1, -1))


def test_values_returns_field_values_without_a_bad_request(
    create_session, base_url, ordered_stream
):
    """A sidebar field must answer with its values, not 400 (#7308)."""
    stream, now = ordered_stream
    resp = create_session.get(
        f"{base_url}api/{ORG_ID}/{stream}/_values",
        params={
            "fields": "body_code",
            "size": 10,
            "start_time": now - 7_200_000_000,
            "end_time": now + 3_600_000_000,
            "type": "logs",
        },
        timeout=60,
    )

    assert resp.status_code == 200, f"_values failed: {resp.text[:300]}"
    hits = resp.json().get("hits", [])
    assert hits, f"no field values returned: {resp.text[:300]}"

    values = {v["zo_sql_key"] for v in hits[0]["values"]}
    assert values == {"c0", "c1", "c2"}, f"unexpected values: {values}"

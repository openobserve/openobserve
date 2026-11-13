"""GROUP BY + ORDER BY + LIMIT under streaming aggregation returns exactly LIMIT rows (ENT#826).

With streaming aggregation on, `_search_stream` truncated each partition to the LIMIT before the
cumulative merge (fixed in openobserve#8713), so the merged rows differed from `_search`. The planner
only splits an aggregate into partitions when its estimated runtime exceeds
`ZO_AGGS_MIN_NUM_PARTITIONS_SECS` (default 3s), which test-sized data never does. The estimate is
read from the file list, so rows still in the WAL estimate 0s and never partition even at 0. The
`streaming_aggs_limit` shard sets the threshold to 0 and pushes files out of the WAL within seconds;
the fixture waits until `_search_partition` sees every row, and the test fails if the stream was
not aggregated.
"""

from __future__ import annotations

import os
import time
import uuid

import pytest

from support.sse import read_sse_frames

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

ROW_COUNT = 300
NAMESPACES = 15
CONTAINERS = 4
SPREAD_HOURS = 30
INGEST_SETTLE_TIMEOUT = 120
FILES_UPLOADED_TIMEOUT = int(os.environ.get("FILES_UPLOADED_TIMEOUT_SECS", "180"))


def _now_us() -> int:
    return int(time.time() * 1_000_000)


def _window(now: int) -> tuple[int, int]:
    return now - (SPREAD_HOURS + 1) * 3_600_000_000, now + 600_000_000


@pytest.fixture(scope="module")
def ns_stream(create_session, base_url):
    """300 rows over 30h: 15 namespaces x 20 rows, all 4 containers in every namespace."""
    stream = f"ovn_b_aggslimit_{uuid.uuid4().hex[:10]}"
    now = _now_us()
    step = SPREAD_HOURS * 3_600_000_000 // ROW_COUNT
    records = [
        {"_timestamp": now - i * step, "ns": f"ns{i % NAMESPACES:02d}", "container": f"c{i % CONTAINERS}"}
        for i in range(ROW_COUNT)
    ]
    resp = create_session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=records, timeout=60)
    assert resp.status_code == 200, f"ingest failed: {resp.text}"

    start, end = _window(now)
    deadline = time.time() + INGEST_SETTLE_TIMEOUT
    while time.time() < deadline:
        r = create_session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
            json={"query": {"sql": f'SELECT COUNT(*) AS cnt FROM "{stream}"', "start_time": start, "end_time": end, "size": -1}},
            timeout=60,
        )
        hits = (r.json() or {}).get("hits") or [] if r.status_code == 200 else []
        if hits and hits[0].get("cnt", 0) >= ROW_COUNT:
            break
        time.sleep(2)
    else:
        pytest.fail(f"{stream} never reached {ROW_COUNT} rows")

    deadline = time.time() + FILES_UPLOADED_TIMEOUT
    while time.time() < deadline:
        part = create_session.post(
            f"{base_url}api/{ORG_ID}/_search_partition?type=logs",
            json={"sql": f'SELECT COUNT(*) AS cnt FROM "{stream}"', "start_time": start, "end_time": end, "streaming_output": True},
            timeout=60,
        )
        if part.status_code == 200 and part.json().get("records", 0) >= ROW_COUNT:
            break
        time.sleep(3)
    else:
        pytest.fail(
            f"{stream}: the file list never held {ROW_COUNT} rows within {FILES_UPLOADED_TIMEOUT}s, so the planner "
            "cannot partition; the server needs a short ZO_MAX_FILE_RETENTION_TIME"
        )

    yield stream, now
    create_session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs", timeout=30)


@pytest.mark.parametrize("limit", [3, 11])
def test_group_by_order_by_limit_is_honoured_under_streaming_aggs(create_session, base_url, ns_stream, limit):
    stream, now = ns_stream
    start, end = _window(now)
    sql = (
        f'SELECT ns, COUNT(*) AS total_rows, COUNT(DISTINCT container) AS unique_containers '
        f'FROM "{stream}" GROUP BY ns ORDER BY ns LIMIT {limit}'
    )
    expected = [
        {"ns": f"ns{i:02d}", "total_rows": ROW_COUNT // NAMESPACES, "unique_containers": CONTAINERS}
        for i in range(limit)
    ]

    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/_search_stream?type=logs&search_type=UI&use_cache=false",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": -1}},
        headers={"Accept": "text/event-stream"},
        stream=True,
        timeout=120,
    )
    assert resp.status_code == 200, f"streaming search failed: {resp.status_code} {resp.text[:300]}"
    frames = read_sse_frames(resp)
    metas = [d for e, d in frames if e == "search_response_metadata"]
    hit_frames = [d.get("hits") or [] for e, d in frames if e == "search_response_hits"]
    assert any(m.get("streaming_aggs") for m in metas), (
        "streaming aggregation did not engage, so this run cannot test ENT#826; "
        "the server needs ZO_AGGS_MIN_NUM_PARTITIONS_SECS=0"
    )
    assert hit_frames, f"no hits frames: {frames}"
    # Streaming-aggs frames are cumulative, so the last frame is the answer.
    assert hit_frames[-1] == expected, f"streaming LIMIT {limit} returned {hit_frames[-1]}"

    plain = create_session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": -1}},
        timeout=120,
    )
    assert plain.status_code == 200, plain.text[:300]
    assert plain.json()["hits"] == expected, f"non-streaming LIMIT {limit} returned {plain.json()['hits']}"

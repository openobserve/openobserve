"""GROUP BY aggregates over `_search_stream` under streaming aggregation (ENT#826, ENT#571).

ENT#826: `_search_stream` truncated each partition to the LIMIT before the cumulative merge (fixed
in openobserve#8713), so the merged rows differed from `_search`. ENT#571: a trailing `;` and a
single-quoted stream name made the merge duplicate groups, misreport the total and leak the
internal `zo_sql_num` column. Both need more than one partition. The planner only splits an
aggregate when its estimated runtime exceeds `ZO_AGGS_MIN_NUM_PARTITIONS_SECS` (default 3s), which
test-sized data never does, and the estimate is read from the file list, so rows still in the WAL
never partition even at 0. The `streaming_aggs_limit` shard sets the threshold to 0 and pushes files
out of the WAL within seconds; the fixture waits until `_search_partition` sees every row, and each
test fails if the query was not split and aggregated in streaming mode.
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


def _partition_count(session, base_url, sql: str, now: int) -> int:
    start, end = _window(now)
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search_partition?type=logs",
        json={"sql": sql, "start_time": start, "end_time": end, "streaming_output": True},
        timeout=60,
    )
    assert resp.status_code == 200, f"_search_partition failed: {resp.status_code} {resp.text[:300]}"
    return len(resp.json().get("partitions") or [])


def _stream_frames(session, base_url, sql: str, now: int) -> tuple[list[dict], list[list[dict]]]:
    """Metadata frames and per-frame hit lists of one `_search_stream` run."""
    start, end = _window(now)
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search_stream?type=logs&search_type=UI&use_cache=false",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": -1}},
        headers={"Accept": "text/event-stream"},
        stream=True,
        timeout=120,
    )
    assert resp.status_code == 200, f"streaming search failed: {resp.status_code} {resp.text[:300]}"
    frames = read_sse_frames(resp)
    errors = [d for e, d in frames if e in ("error", "search_error")]
    assert not errors, f"streaming search emitted an error frame: {errors}"
    metas = [d for e, d in frames if e == "search_response_metadata"]
    hit_frames = [d.get("hits") or [] for e, d in frames if e == "search_response_hits"]
    assert any(m.get("streaming_aggs") for m in metas), (
        "streaming aggregation did not engage, so this run cannot test the merge; "
        "the server needs ZO_AGGS_MIN_NUM_PARTITIONS_SECS=0"
    )
    assert hit_frames, f"no hits frames: {frames}"
    return metas, hit_frames


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

    _, hit_frames = _stream_frames(create_session, base_url, sql, now)
    # Streaming-aggs frames are cumulative, so the last frame is the answer.
    assert hit_frames[-1] == expected, f"streaming LIMIT {limit} returned {hit_frames[-1]}"

    plain = create_session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
        json={"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": -1}},
        timeout=120,
    )
    assert plain.status_code == 200, plain.text[:300]
    assert plain.json()["hits"] == expected, f"non-streaming LIMIT {limit} returned {plain.json()['hits']}"


def test_semicolon_and_single_quoted_stream_group_by_merges_partitions(create_session, base_url, ns_stream):
    """Trailing `;` + `'stream'` over several partitions: 4 groups of 75, no duplicates, no `zo_sql_num` (ENT#571)."""
    stream, now = ns_stream
    sql = f"SELECT container, count(*) AS cnt FROM '{stream}' GROUP BY container;"
    partitions = _partition_count(create_session, base_url, sql, now)
    assert partitions > 1, f"the query ran as {partitions} partition(s), so no cross-partition merge was tested"

    metas, hit_frames = _stream_frames(create_session, base_url, sql, now)
    hits = hit_frames[-1]
    containers = [h["container"] for h in hits]
    assert sorted(containers) == [f"c{i}" for i in range(CONTAINERS)], f"groups wrong or duplicated: {containers}"
    assert all(h["cnt"] == ROW_COUNT // CONTAINERS for h in hits), f"group counts wrong: {hits}"
    assert all("zo_sql_num" not in h for h in hits), f"internal zo_sql_num column leaked: {hits[0]}"
    assert metas[-1]["results"]["total"] == CONTAINERS, f"reported total is not {CONTAINERS}: {metas[-1]['results'].get('total')}"

"""Aggregate SQL shapes over `_search_stream`  [regression ENT#571].

A trailing `;` and a single-quoted stream name in a GROUP BY query made the
streaming path report the wrong group count, duplicate groups and leak the
internal `zo_sql_num` column. ENT#826 (LIMIT under streaming aggregation) needs
a server flag and lives in tests/regression/test_streaming_aggs_group_by_limit.py.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest

from support.sse import read_sse_frames

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

ROW_COUNT = 300
LEVELS = 6
SPREAD_HOURS = 30
INGEST_SETTLE_TIMEOUT = 120


def _now_us() -> int:
    return int(time.time() * 1_000_000)


def _window(now: int) -> tuple[int, int]:
    return now - (SPREAD_HOURS + 1) * 3_600_000_000, now + 600_000_000


@pytest.fixture(scope="module")
def shaped_stream(create_session, base_url):
    """300 rows over 30h, 6 levels x 50."""
    stream = f"ovn_b_sqlshape_{uuid.uuid4().hex[:10]}"
    now = _now_us()
    step = SPREAD_HOURS * 3_600_000_000 // ROW_COUNT
    records = [
        {
            "_timestamp": now - i * step,
            "level": f"lv{i % LEVELS}",
        }
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

    yield stream, now
    create_session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs", timeout=30)


def _stream_hits(session, base_url, sql: str, now: int) -> tuple[list[dict], list[dict]]:
    """Final hit set of a `_search_stream` run plus its metadata frames."""
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
    # Streaming-aggs frames are cumulative, so only the last one is the answer; plain frames are pages.
    if any(m.get("streaming_aggs") for m in metas):
        hits = hit_frames[-1] if hit_frames else []
    else:
        hits = [h for page in hit_frames for h in page]
    return hits, metas


def test_semicolon_and_single_quoted_stream_group_by_over_streaming(create_session, base_url, shaped_stream):
    """Trailing `;` + `'stream'`: exactly 6 groups of 50, no duplicates, no `zo_sql_num` (ENT#571)."""
    stream, now = shaped_stream
    sql = f"SELECT level, count(*) AS cnt FROM '{stream}' GROUP BY level;"
    hits, metas = _stream_hits(create_session, base_url, sql, now)

    levels = [h["level"] for h in hits]
    assert sorted(levels) == sorted(f"lv{i}" for i in range(LEVELS)), f"groups wrong or duplicated: {levels}"
    assert all(h["cnt"] == ROW_COUNT // LEVELS for h in hits), f"group counts wrong: {hits}"
    assert all("zo_sql_num" not in h for h in hits), f"internal zo_sql_num column leaked: {hits[0]}"
    assert metas, "no metadata frame"
    assert metas[-1]["results"]["total"] == LEVELS, f"reported total is not {LEVELS}: {metas[-1]['results'].get('total')}"

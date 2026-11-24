"""Overlapping streaming-aggregation cache files of two sizes are read once (#16950)."""

from __future__ import annotations

import time
from typing import Any

from support.client import OpenObserveClient
from support.sse import read_sse_frames
from support.wait import wait_until

HOUR = 3_600_000_000
MINUTE = 60_000_000


def _uncached_hits(client: OpenObserveClient, sql: str, start: int, end: int) -> list[dict[str, Any]]:
    body = {"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 1000}}
    resp = client.post("_search", params={"type": "logs", "use_cache": "false"}, json=body)
    assert resp.status_code == 200, f"{sql}: {resp.status_code} {resp.text}"
    return resp.json()["hits"]


def _stream_hits(client: OpenObserveClient, sql: str, start: int, end: int) -> list[dict[str, Any]]:
    """The final rows of one cached `_search_stream` call; streaming-aggs frames are cumulative, so the last one is the answer."""
    body = {"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": -1}}
    params = {"type": "logs", "search_type": "ui", "use_cache": "true"}
    resp = client.post("_search_stream", params=params, json=body)
    assert resp.status_code == 200, f"{sql}: {resp.status_code} {resp.text[:500]}"
    frames = read_sse_frames(resp)
    assert not [d for e, d in frames if e == "error"], f"error frames: {frames}"
    aggs = any(d.get("streaming_aggs") for e, d in frames if e == "search_response_metadata")
    hits = [d.get("hits", []) for e, d in frames if e == "search_response_hits"]
    return (hits[-1] if hits else []) if aggs else [h for page in hits for h in page]


def test_streaming_agg_cache_files_of_two_sizes_do_not_double_count(client: OpenObserveClient, temp_stream_name: str):
    """#16950: cached 2-hour and 30-minute aggregation files that overlap were both read, double-counting the overlap."""
    day = 24 * HOUR
    base = (int(time.time()) * 1_000_000 - 27 * HOUR) // (2 * HOUR) * (2 * HOUR)
    groups = ["a", "b", "c"]
    rows = [{"_timestamp": base + k * MINUTE, "grp": groups[k % 3]} for k in range(26 * 60)]
    resp = client.post(f"{temp_stream_name}/_json", json=rows)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"][0]["successful"] == len(rows), resp.text
    # The planner sizes aggregation partitions from parquet bytes only, so rows still in the memtable get one partition.
    flush = client.put("node/flush", prefix="")
    assert flush.status_code == 200, f"node/flush: {flush.status_code} {flush.text}"
    sql = (
        f"SELECT histogram(_timestamp, '1 hour') AS ts, grp, count(*) AS cnt FROM \"{temp_stream_name}\" "
        "GROUP BY ts, grp ORDER BY cnt DESC"
    )

    def planned_as_streaming_aggs() -> bool:
        resp = client.post(
            "_search_partition",
            params={"type": "logs"},
            json={"sql": sql, "start_time": base, "end_time": base + day, "streaming_output": True},
        )
        return resp.status_code == 200 and resp.json().get("streaming_aggs") is True

    wait_until(
        planned_as_streaming_aggs,
        timeout=90,
        interval=2,
        msg="precondition: the query never planned as a streaming aggregation (needs ZO_AGGS_MIN_NUM_PARTITIONS_SECS=0)",
    )

    for window in ((base, base + day), (base + 23 * HOUR, base + 25 * HOUR)):
        hits = _stream_hits(client, sql, *window)
        assert sum(h["cnt"] for h in hits) == (window[1] - window[0]) // MINUTE, f"window {window}: {hits}"
    third = (base + HOUR, base + 25 * HOUR)
    cached = _stream_hits(client, sql, *third)
    uncached = _uncached_hits(client, sql, *third)

    def key(h: dict[str, Any]) -> tuple[str, str, int]:
        return h["ts"], h["grp"], h["cnt"]

    assert sum(h["cnt"] for h in uncached) == 1440, uncached
    assert len(uncached) == 72, uncached
    assert {h["cnt"] for h in uncached} == {20}, uncached
    assert sorted(map(key, cached)) == sorted(map(key, uncached)), f"cached={sorted(map(key, cached))}"

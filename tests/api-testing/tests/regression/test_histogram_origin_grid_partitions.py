"""Long histogram buckets sit on the histogram() origin grid in partitions and the cache (#16422)."""

from __future__ import annotations

import time
from collections.abc import Generator
from datetime import UTC, datetime

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

HISTOGRAM_ORIGIN_US = 978_307_200_000_000
DAY_US = 86_400_000_000
# An hour inside the ingest_window_48h shard's window; the ENT workflow env says 5 h, so it is not read from the environment.
SPAN_HOURS = 47


def _origin_search(client: OpenObserveClient, sql: str, start: int, end: int, use_cache: bool) -> tuple[list[dict], int]:
    """(hits, result_cache_ratio) of one /_search call."""
    body = {"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 100}}
    resp = client.post("_search", params={"type": "logs", "use_cache": str(use_cache).lower()}, json=body)
    assert resp.status_code == 200, f"{sql} [{start}, {end}): {resp.status_code} {resp.text}"
    body = resp.json()
    return body["hits"], body.get("result_cache_ratio", 0)


@pytest.fixture(scope="module")
def origin_grid_stream(client: OpenObserveClient) -> Generator[tuple[str, list[int]], None, None]:
    """Rows every 10 minutes across almost the whole ingest window, so off-epoch bucket edges fall among them."""
    name = unique_name("pytest_hist_origin")
    now = int(time.time()) * 1_000_000
    span_minutes = SPAN_HOURS * 60
    stamps = [now - span_minutes * 60_000_000 + k * 600_000_000 for k in range(span_minutes // 10)]

    def all_visible() -> bool:
        hits, _ = _origin_search(client, f'SELECT count(*) AS c FROM "{name}"', stamps[0], stamps[-1] + 1, False)
        return bool(hits) and hits[0]["c"] == len(stamps)

    try:
        resp = client.post(f"{name}/_json", json=[{"_timestamp": ts, "k": k} for k, ts in enumerate(stamps)])
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"][0]["successful"] == len(stamps), resp.text
        wait_until(all_visible, timeout=60, interval=1, msg=f"{name} never showed every row")
        yield name, stamps
    finally:
        client.streams.delete(name)


@pytest.mark.parametrize("days", [30, 7, 2], ids=["30-day", "7-day", "2-day"])
def test_long_histogram_buckets_sit_on_the_origin_grid_across_partitions(
    client: OpenObserveClient, origin_grid_stream: tuple[str, list[int]], days: int
):
    """#16422: partitions and cache cut 7- and 30-day buckets on the epoch grid, so one bucket came back split across partitions."""
    stream, stamps = origin_grid_stream
    step = days * DAY_US
    sql = f"SELECT histogram(_timestamp, '{days} day') AS ts, count(*) AS c FROM \"{stream}\" GROUP BY ts ORDER BY ts DESC"
    end = int(time.time()) * 1_000_000
    # The cache drops the bucket before the last edge, so 30-day buckets need four edges in range to cache any.
    start = end - 120 * DAY_US

    def key(ts: int) -> str:
        edge = HISTOGRAM_ORIGIN_US + (ts - HISTOGRAM_ORIGIN_US) // step * step
        return datetime.fromtimestamp(edge / 1_000_000, UTC).strftime("%Y-%m-%dT%H:%M:%S")

    expected: dict[str, int] = {}
    for ts in stamps:
        expected[key(ts)] = expected.get(key(ts), 0) + 1

    resp = client.post(
        "_search_partition", params={"type": "logs"}, json={"sql": sql, "start_time": start, "end_time": end, "size": 100}
    )
    assert resp.status_code == 200, resp.text
    partitions = resp.json()["partitions"]
    assert len(partitions) > 1, f"precondition: a 120-day range is split into partitions: {partitions}"
    per_partition = [_origin_search(client, sql, p_start, p_end, False)[0] for p_start, p_end in partitions]
    keys = [hit["ts"] for hits in per_partition for hit in hits]
    assert len(keys) == len(set(keys)), f"a bucket came back from more than one partition: {per_partition}"
    merged = {hit["ts"]: hit["c"] for hits in per_partition for hit in hits}
    assert merged == expected, f"partition buckets are off the histogram() origin grid: {merged}"

    for use_cache in (False, True):
        hits, _ = _origin_search(client, sql, start, end, use_cache)
        assert {hit["ts"]: hit["c"] for hit in hits} == expected, f"use_cache={use_cache}: {hits}"
        assert len(hits) == len(expected), f"use_cache={use_cache} repeated a bucket: {hits}"

    def served_from_cache() -> tuple[list[dict], int] | None:
        hits, ratio = _origin_search(client, sql, start, end, True)
        return (hits, ratio) if ratio > 0 else None

    # The cache keeps only finished buckets, which exist only when the rows (ending 10 min ago) cross a bucket edge.
    if len(expected) < 2:
        pytest.skip(f"cached leg: the seeded rows cross no {days}-day bucket edge today; the 2-day case covers it on almost every run")
    # The cache file is written after the response, so only a repeat that reports a cache hit tests the cached buckets.
    hits, _ = wait_until(
        served_from_cache, timeout=30, interval=1, msg=f"the {days}-day histogram was never answered from the result cache"
    )
    assert {hit["ts"]: hit["c"] for hit in hits} == expected, f"cached repeat: {hits}"
    assert len(hits) == len(expected), f"the cached repeat repeated a bucket: {hits}"

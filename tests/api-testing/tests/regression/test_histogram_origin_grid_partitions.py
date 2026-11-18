"""Long histogram buckets sit on the histogram() origin grid in partitions and the cache (#16422)."""

from __future__ import annotations

import time
from collections.abc import Generator
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

HISTOGRAM_ORIGIN_US = 978_307_200_000_000
HOUR_US = 3_600_000_000
DAY_US = 24 * HOUR_US
INTERVAL_DAYS = (30, 7, 2)
# Rows sit 1 h and 2 h either side of an edge, so the oldest is under 30 days + 4 h: inside the shard's 768 h window.
ROW_OFFSETS_US = (-2 * HOUR_US, -HOUR_US, HOUR_US, 2 * HOUR_US)


@dataclass(frozen=True)
class GridCase:
    """One interval's seeded edges and the query end that keeps both as the latest edge at or before it."""

    epoch_edge: int
    origin_edge: int
    end: int


def _origin_search(
    client: OpenObserveClient, sql: str, start: int, end: int, use_cache: bool
) -> tuple[list[dict], int]:
    """(hits, result_cache_ratio) of one /_search call."""
    body = {"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 100}}
    resp = client.post("_search", params={"type": "logs", "use_cache": str(use_cache).lower()}, json=body)
    assert resp.status_code == 200, f"{sql} [{start}, {end}): {resp.status_code} {resp.text}"
    body = resp.json()
    return body["hits"], body.get("result_cache_ratio", 0)


def _grid_case(now: int, days: int) -> GridCase:
    """The latest epoch-grid and origin-grid edges with every row offset before `now`, and a query end past their rows."""
    step = days * DAY_US
    latest = now - ROW_OFFSETS_US[-1]
    epoch_edge = latest // step * step
    origin_edge = HISTOGRAM_ORIGIN_US + (latest - HISTOGRAM_ORIGIN_US) // step * step
    # Ending before the next edge keeps a newer edge out of the range, which would move the last partition cut.
    end = min(now, epoch_edge + step - 1, origin_edge + step - 1)
    return GridCase(epoch_edge, origin_edge, end)


@pytest.fixture(scope="module")
def origin_grid_stream(client: OpenObserveClient) -> Generator[tuple[str, list[int], dict[int, GridCase]], None, None]:
    """Rows either side of the latest epoch-grid and origin-grid edge of every interval, so every run crosses both."""
    name = unique_name("pytest_hist_origin")
    now = int(time.time()) * 1_000_000
    cases = {days: _grid_case(now, days) for days in INTERVAL_DAYS}
    edges = {edge for case in cases.values() for edge in (case.epoch_edge, case.origin_edge)}
    stamps = sorted(edge + offset for edge in edges for offset in ROW_OFFSETS_US)

    def all_visible() -> bool:
        hits, _ = _origin_search(client, f'SELECT count(*) AS c FROM "{name}"', stamps[0], stamps[-1] + 1, False)
        return bool(hits) and hits[0]["c"] == len(stamps)

    try:
        resp = client.post(f"{name}/_json", json=[{"_timestamp": ts, "k": k} for k, ts in enumerate(stamps)])
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"][0]["successful"] == len(stamps), (
            f"rows up to 30 days + 4 h old need ZO_INGEST_ALLOWED_UPTO >= 724: {resp.text}"
        )
        wait_until(all_visible, timeout=60, interval=1, msg=f"{name} never showed every row")
        yield name, stamps, cases
    finally:
        client.streams.delete(name)


@pytest.mark.parametrize("days", INTERVAL_DAYS, ids=[f"{days}-day" for days in INTERVAL_DAYS])
def test_long_histogram_buckets_sit_on_the_origin_grid_across_partitions(
    client: OpenObserveClient, origin_grid_stream: tuple[str, list[int], dict[int, GridCase]], days: int
):
    """#16422: partitions and cache cut 7- and 30-day buckets on the epoch grid, so one bucket came back split across partitions."""
    stream, stamps, cases = origin_grid_stream
    case = cases[days]
    step = days * DAY_US
    sql = f"SELECT histogram(_timestamp, '{days} day') AS ts, count(*) AS c FROM \"{stream}\" GROUP BY ts ORDER BY ts DESC"
    end = case.end
    # The cache drops the bucket before the last edge, so 30-day buckets need four edges in range to cache any.
    start = end - 120 * DAY_US

    def key(ts: int) -> str:
        edge = HISTOGRAM_ORIGIN_US + (ts - HISTOGRAM_ORIGIN_US) // step * step
        return datetime.fromtimestamp(edge / 1_000_000, UTC).strftime("%Y-%m-%dT%H:%M:%S")

    expected: dict[str, int] = {}
    for ts in stamps:
        if start <= ts < end:
            expected[key(ts)] = expected.get(key(ts), 0) + 1
    assert key(case.origin_edge - HOUR_US) in expected, (
        f"precondition: rows before the {days}-day origin edge: {expected}"
    )
    assert key(case.origin_edge) in expected, f"precondition: rows after the {days}-day origin edge: {expected}"

    resp = client.post(
        "_search_partition",
        params={"type": "logs"},
        json={"sql": sql, "start_time": start, "end_time": end, "size": 100},
    )
    assert resp.status_code == 200, resp.text
    partitions = resp.json()["partitions"]
    cuts = {edge for p in partitions for edge in p} - {start, end}
    # The fixed build cuts at the origin-grid edge and the broken one at the epoch-grid edge; rows sit on both sides of each.
    assert {case.epoch_edge, case.origin_edge} & cuts, (
        f"precondition: a partition edge lies at a seeded {days}-day edge {case}: {partitions}"
    )
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

    # The cache file is written after the response, so only a repeat that reports a cache hit tests the cached buckets.
    hits, _ = wait_until(
        served_from_cache,
        timeout=30,
        interval=1,
        msg=f"the {days}-day histogram was never answered from the result cache",
    )
    assert {hit["ts"]: hit["c"] for hit in hits} == expected, f"cached repeat: {hits}"
    assert len(hits) == len(expected), f"the cached repeat repeated a bucket: {hits}"

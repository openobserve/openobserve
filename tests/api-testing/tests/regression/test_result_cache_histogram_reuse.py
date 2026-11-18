"""The result cache reuses only buckets and rows the uncached query would return (#16539, #16641, #16644, #16651, #16650)."""

from __future__ import annotations

import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until



HOUR = 3_600_000_000
MINUTE = 60_000_000


def _seed(client: OpenObserveClient, stream: str, stamps: list[int]) -> None:
    """Ingest one row per stamp and wait until every row is searchable."""
    resp = client.post(f"{stream}/_json", json=[{"_timestamp": ts, "i": i} for i, ts in enumerate(stamps)])
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"][0]["successful"] == len(stamps), resp.text

    def all_visible() -> bool:
        hits, _ = _search(client, f'SELECT count(*) AS c FROM "{stream}"', min(stamps), max(stamps) + 1, False)
        return bool(hits) and hits[0]["c"] == len(stamps)

    wait_until(all_visible, timeout=60, interval=1, msg=f"{stream} never showed {len(stamps)} rows")


def _search(
    client: OpenObserveClient, sql: str, start: int, end: int, use_cache: bool, **query: Any
) -> tuple[list[dict[str, Any]], int]:
    """(hits, result_cache_ratio) of one /_search call."""
    body = {"query": {"sql": sql, "start_time": start, "end_time": end, "from": 0, "size": 100, **query}}
    resp = client.post("_search", params={"type": "logs", "use_cache": str(use_cache).lower()}, json=body)
    assert resp.status_code == 200, f"{sql}: {resp.status_code} {resp.text}"
    body = resp.json()
    return body["hits"], body.get("result_cache_ratio", 0)


def _wait_cached(client: OpenObserveClient, sql: str, start: int, end: int, **query: Any) -> None:
    """Repeat a use_cache query until it is answered from the cache; the cache file is written after the response."""
    wait_until(
        lambda: _search(client, sql, start, end, True, **query)[1] > 0,
        timeout=30,
        interval=1,
        msg=f"{sql} was never answered from the result cache",
    )


def _bucket_key(ts: int, step: int, offset: int = 0) -> str:
    """The `histogram()` key label of the bucket holding `ts`, for buckets of `step` shifted by `offset`."""
    local = (ts + offset) // step * step
    return datetime.fromtimestamp(local / 1_000_000, UTC).strftime("%Y-%m-%dT%H:%M:%S")


def _expected_buckets(stamps: list[int], start: int, end: int, step: int, offset: int = 0) -> list[dict[str, Any]]:
    counts = Counter(_bucket_key(ts, step, offset) for ts in stamps if start <= ts < end)
    return [{"ts": key, "c": n} for key, n in sorted(counts.items(), reverse=True)]


@pytest.mark.parametrize(
    ("histogram_tz", "request_tz"),
    [("'+05:30'", None), (None, "Asia/Kolkata")],
    ids=["histogram-argument", "request-timezone"],
)
def test_cached_non_utc_day_histogram_keeps_local_bucket_edges(
    client: OpenObserveClient, temp_stream_name: str, histogram_tz: str | None, request_tz: str | None
):
    """#16539 / #16641: a non-UTC '1 day' histogram served with use_cache must match the uncached zone-aligned buckets, newest first."""
    now = int(time.time()) * 1_000_000
    stamps = [now - 40 * HOUR + k * 30 * MINUTE for k in range(80)]
    _seed(client, temp_stream_name, stamps)
    tz_arg = f", {histogram_tz}" if histogram_tz else ""
    sql = f"SELECT histogram(_timestamp, '1 day'{tz_arg}) AS ts, count(*) AS c FROM \"{temp_stream_name}\" GROUP BY ts"
    extra = {"timezone": request_tz} if request_tz else {}
    ist = int(timedelta(hours=5, minutes=30).total_seconds()) * 1_000_000
    day = 24 * HOUR

    inner = (now - 41 * HOUR, now - 20 * HOUR)
    outer = (now - 41 * HOUR, now - 10 * MINUTE)
    for _ in range(2):
        hits, _ = _search(client, sql, *inner, True, **extra)
        assert hits == _expected_buckets(stamps, *inner, day, ist), f"cached inner window: {hits}"
    cached, _ = _search(client, sql, *outer, True, **extra)
    uncached, _ = _search(client, sql, *outer, False, **extra)
    assert uncached == _expected_buckets(stamps, *outer, day, ist), f"uncached outer window: {uncached}"
    assert cached == uncached, f"use_cache changed the buckets: cached={cached} uncached={uncached}"


def test_cached_histogram_reuses_only_whole_buckets_inside_the_range(client: OpenObserveClient, temp_stream_name: str):
    """#16644: a range ending mid-bucket reused the cached whole-bucket count for its last bucket."""
    top = int(time.time()) // 3600 * HOUR
    stamps = [top - 6 * HOUR + k * 10 * MINUTE for k in range(24)]
    _seed(client, temp_stream_name, stamps)
    sql = f"SELECT histogram(_timestamp, '1 hour') AS ts, count(*) AS c FROM \"{temp_stream_name}\" GROUP BY ts ORDER BY ts DESC"

    full = (top - 6 * HOUR, top - 2 * HOUR)
    hits, _ = _search(client, sql, *full, True)
    assert hits == _expected_buckets(stamps, *full, HOUR), hits
    _wait_cached(client, sql, *full)

    clipped = (top - 6 * HOUR, top - 2 * HOUR - 30 * MINUTE)
    cached, ratio = _search(client, sql, *clipped, True)
    assert ratio > 0, "the whole buckets of the clipped range must come from the cache"
    expected = _expected_buckets(stamps, *clipped, HOUR)
    assert expected[0]["c"] == 3, f"precondition: the last bucket holds three rows inside the range: {expected}"
    assert cached == expected, f"the last bucket counted rows past the range end: {cached}"
    assert _search(client, sql, *clipped, False)[0] == expected


def test_cached_ascending_limit_query_returns_the_earlier_prefix(client: OpenObserveClient, temp_stream_name: str):
    """#16651: an earlier start on a cached ORDER BY _timestamp ASC LIMIT query kept the cached first rows."""
    top = int(time.time()) // 3600 * HOUR
    stamps = [top - 3 * HOUR + k * MINUTE for k in range(120)]
    _seed(client, temp_stream_name, stamps)
    sql = f'SELECT _timestamp FROM "{temp_stream_name}" ORDER BY _timestamp ASC LIMIT 5'

    later = (top - 2 * HOUR, top - HOUR)
    hits, _ = _search(client, sql, *later, True)
    assert [h["_timestamp"] for h in hits] == [top - 2 * HOUR + k * MINUTE for k in range(5)], hits
    _wait_cached(client, sql, *later)

    earlier = (top - 3 * HOUR, top - HOUR)
    cached, _ = _search(client, sql, *earlier, True)
    expected = [top - 3 * HOUR + k * MINUTE for k in range(5)]
    assert [h["_timestamp"] for h in cached] == expected, f"the first rows did not come from the new prefix: {cached}"
    assert [h["_timestamp"] for h in _search(client, sql, *earlier, False)[0]] == expected


def test_ranked_histogram_with_cache_equals_the_uncached_result(client: OpenObserveClient, temp_stream_name: str):
    """#16650: a top-3 histogram ranked by count merged a cached narrower range into a wrong top 3."""
    top = int(time.time()) // 3600 * HOUR
    per_hour = {10: 9, 9: 8, 8: 7, 7: 1, 6: 2, 5: 6, 4: 3, 3: 5, 2: 4}
    stamps = [top - h * HOUR + k * MINUTE for h, n in per_hour.items() for k in range(n)]
    _seed(client, temp_stream_name, stamps)
    by_time = f"SELECT histogram(_timestamp, '1 hour') AS ts, count(*) AS c FROM \"{temp_stream_name}\" GROUP BY ts ORDER BY ts DESC"
    ranked = f"SELECT histogram(_timestamp, '1 hour') AS ts, count(*) AS c FROM \"{temp_stream_name}\" GROUP BY ts ORDER BY c DESC LIMIT 3"

    narrow = (top - 6 * HOUR, top - HOUR)
    wide = (top - 10 * HOUR, top - HOUR)
    hits, _ = _search(client, ranked, *narrow, True)
    assert [h["c"] for h in hits] == [6, 5, 4], hits
    # A time-ordered query over the same window proves the cache is live and gives its writer time to finish.
    _search(client, by_time, *narrow, True)
    _wait_cached(client, by_time, *narrow)
    cached, _ = _search(client, ranked, *wide, True)
    uncached, _ = _search(client, ranked, *wide, False)
    expected = [{"ts": _bucket_key(top - h * HOUR, HOUR), "c": n} for h, n in ((10, 9), (9, 8), (8, 7))]
    assert uncached == expected, uncached
    assert cached == uncached, f"use_cache changed the ranked top 3: cached={cached} uncached={uncached}"

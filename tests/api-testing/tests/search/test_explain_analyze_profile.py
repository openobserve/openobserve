"""EXPLAIN ANALYZE structured profile (`query.analyze_profile`) over `_search_stream` and `/_search`."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.sse import read_sse_frames
from support.wait import wait_until

LEVELS = ["info", "warn", "error"]
ROWS = 1_000
JOIN_ROWS = 200


@pytest.fixture(scope="module")
def window() -> tuple[int, int]:
    now_us = int(time.time() * 1_000_000)
    return now_us - 3_600_000_000, now_us + 600_000_000


@pytest.fixture(scope="module")
def streams(client: OpenObserveClient, window: tuple[int, int]) -> Generator[tuple[str, str], None, None]:
    main, other = unique_name("explain_e2e_main"), unique_name("explain_e2e_join")
    created: list[str] = []
    base_us = window[1] - 660_000_000
    try:
        for name, rows, field in ((main, ROWS, "n"), (other, JOIN_ROWS, "m")):
            records = [
                {"_timestamp": base_us - i * 1_000, "level": LEVELS[i % 3], field: i, "log": f"line {i}"}
                for i in range(rows)
            ]
            created.append(name)
            client.streams.ingest_json(name, records)
        for name, rows in ((main, ROWS), (other, JOIN_ROWS)):
            wait_until(
                lambda name=name, rows=rows: _count(client, name, window) == rows,
                timeout=60,
                interval=1.0,
                msg=f"{name} not searchable",
            )
        yield main, other
    finally:
        for name in created:
            client.streams.delete(name)


def _body(sql: str, window: tuple[int, int], *, profile: bool = True) -> dict[str, Any]:
    query: dict[str, Any] = {"sql": sql, "start_time": window[0], "end_time": window[1], "from": 0, "size": -1}
    if profile:
        query["analyze_profile"] = True
    return {"query": query}


def _count(client: OpenObserveClient, stream: str, window: tuple[int, int]) -> int:
    resp = client.post("_search?type=logs", json=_body(f'SELECT count(*) AS c FROM "{stream}"', window, profile=False))
    hits = resp.json().get("hits", []) if resp.status_code == 200 else []
    return int(hits[0].get("c", 0)) if hits else 0


def _search(client: OpenObserveClient, sql: str, window: tuple[int, int], *, profile: bool = True) -> dict[str, Any]:
    resp = client.post("_search?type=logs", json=_body(sql, window, profile=profile))
    if resp.status_code != 200:
        pytest.fail(f"{resp.status_code}: {resp.text[:500]}")
    return resp.json()


def _stream_hits(
    client: OpenObserveClient, sql: str, window: tuple[int, int], *, profile: bool = True
) -> list[dict[str, Any]]:
    # Same query string the Logs page's Explain dialog sends.
    params = {
        "type": "logs",
        "search_type": "ui",
        "use_cache": "true",
        "trace_id": uuid.uuid4().hex,
        "clear_cache": "false",
    }
    resp = client.post("_search_stream", params=params, json=_body(sql, window, profile=profile))
    if resp.status_code != 200:
        pytest.fail(f"{resp.status_code}: {resp.text[:500]}")
    frames = read_sse_frames(resp)
    errors = [data for event, data in frames if event == "error"]
    if errors:
        pytest.fail(f"error frames: {errors}")
    return [hit for event, data in frames if event == "search_response_hits" for hit in data.get("hits", [])]


def _profile(hits: list[dict[str, Any]]) -> dict[str, Any]:
    with_profile = [h for h in hits if h.get("profile")]
    if len(with_profile) != 1:
        pytest.fail(f"expected one profile row, got phases {[h.get('phase') for h in hits]}")
    return json.loads(with_profile[0]["profile"])


def _walk(node: dict[str, Any]) -> Generator[dict[str, Any], None, None]:
    yield node
    for remote in node.get("remote") or []:
        if remote.get("plan"):
            yield from _walk(remote["plan"])
    for child in node.get("children") or []:
        yield from _walk(child)


def _remotes(node: dict[str, Any]) -> list[dict[str, Any]]:
    found = list(node.get("remote") or [])
    for remote in node.get("remote") or []:
        if remote.get("plan"):
            found += _remotes(remote["plan"])
    for child in node.get("children") or []:
        found += _remotes(child)
    return found


def _scan_stats(remote: dict[str, Any]) -> dict[str, Any]:
    if "scan_stats" not in remote:
        pytest.fail(f"remote node {remote.get('node_name')!r} has no scan_stats (skipped={remote.get('skipped')})")
    return remote["scan_stats"]


def _metric(node: dict[str, Any], name: str) -> int | None:
    return next((m.get("value") for m in node.get("metrics", []) if m.get("name") == name), None)


def _output_rows(profile: dict[str, Any]) -> list[int]:
    return [v for n in _walk(profile["plan"]) if (v := _metric(n, "output_rows")) is not None]


def _run(client: OpenObserveClient, endpoint: str, sql: str, window: tuple[int, int], **kw) -> list[dict[str, Any]]:
    if endpoint == "stream":
        return _stream_hits(client, sql, window, **kw)
    return _search(client, sql, window, **kw).get("hits", [])


ENDPOINTS = ["stream", "search"]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_profile_column_only_when_requested(client: OpenObserveClient, streams, window, endpoint: str):
    sql = f'EXPLAIN ANALYZE SELECT level, count(*) AS c FROM "{streams[0]}" GROUP BY level'
    without = _run(client, endpoint, sql, window, profile=False)
    assert without, "EXPLAIN ANALYZE returned no rows"
    assert not any("profile" in h for h in without), [list(h) for h in without]
    _profile(_run(client, endpoint, sql, window, profile=True))


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_second_identical_run_is_not_served_from_cache(client: OpenObserveClient, streams, window, endpoint: str):
    sql = f'EXPLAIN ANALYZE SELECT level, count(*) AS c FROM "{streams[0]}" GROUP BY level'
    first = _profile(_run(client, endpoint, sql, window))
    second = _profile(_run(client, endpoint, sql, window))
    assert second["start_us"] > first["end_us"] >= first["start_us"], (first["start_us"], second["start_us"])
    if endpoint == "search":
        assert _search(client, sql, window)["trace_id"] != _search(client, sql, window)["trace_id"]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_count_profile_rows_match_ground_truth(client: OpenObserveClient, streams, window, endpoint: str):
    profile = _profile(_run(client, endpoint, f'EXPLAIN ANALYZE SELECT count(*) AS c FROM "{streams[0]}"', window))
    assert profile["output_rows"] == 1, profile["output_rows"]
    remotes = _remotes(profile["plan"])
    assert remotes, "profile lists no remote node"
    stats = [_scan_stats(r) for r in remotes]
    assert sum(s["records"] for s in stats) == ROWS, stats


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_group_by_profile_rows_match_ground_truth(client: OpenObserveClient, streams, window, endpoint: str):
    sql = f'EXPLAIN ANALYZE SELECT level, count(*) AS c FROM "{streams[0]}" GROUP BY level'
    profile = _profile(_run(client, endpoint, sql, window))
    assert profile["output_rows"] == len(LEVELS), profile["output_rows"]
    rows = _output_rows(profile)
    assert max(rows) == ROWS, f"no operator saw all {ROWS} input rows: {rows}"
    aggregates = [n for n in _walk(profile["plan"]) if n.get("name") == "AggregateExec"]
    assert aggregates, "plan has no AggregateExec"
    final = [n for n in aggregates if "mode=Final" in n.get("detail", "")]
    partial = [n for n in aggregates if "mode=Partial" in n.get("detail", "")]
    assert final, [n.get("detail") for n in aggregates]
    assert all(_metric(n, "output_rows") == len(LEVELS) for n in final), [_metric(n, "output_rows") for n in final]
    # Metrics are summed across partitions, so each partial partition contributes its own groups.
    assert all((_metric(n, "output_rows") or 0) >= len(LEVELS) for n in partial), [
        _metric(n, "output_rows") for n in partial
    ]
    assert all(_metric(n, "peak_mem_used") for n in aggregates), [_metric(n, "peak_mem_used") for n in aggregates]


SQL_FORMS = {
    "verbose": 'EXPLAIN ANALYZE VERBOSE SELECT level, count(*) AS c FROM "{s}" GROUP BY level',
    "lower_case": 'explain analyze select level, count(*) as c from "{s}" group by level',
    "cte": 'EXPLAIN ANALYZE WITH t AS (SELECT level FROM "{s}" WHERE n < 500) SELECT level, count(*) AS c FROM t GROUP BY level',
    "union": 'EXPLAIN ANALYZE SELECT level FROM "{s}" WHERE n < 5 UNION ALL SELECT level FROM "{o}" WHERE m < 5',
    "join": 'EXPLAIN ANALYZE SELECT a.level, count(*) AS c FROM "{s}" a JOIN "{o}" b ON a.n = b.m GROUP BY a.level',
}


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("form", list(SQL_FORMS))
def test_sql_form_keeps_profile(client: OpenObserveClient, streams, window, endpoint: str, form: str):
    sql = SQL_FORMS[form].format(s=streams[0], o=streams[1])
    profile = _profile(_run(client, endpoint, sql, window))
    assert profile["plan"].get("name"), profile["plan"]
    assert _remotes(profile["plan"]), "profile lists no remote node"


@pytest.mark.parametrize("path", ["_search?type=logs", "_search_stream?type=logs&search_type=ui&use_cache=true"])
def test_invalid_sql_is_a_clear_4xx(client: OpenObserveClient, streams, window, path: str):
    resp = client.post(path, json=_body(f'EXPLAIN ANALYZE SELEC count(*) FROM "{streams[0]}"', window))
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text[:300])
    try:
        message = resp.json().get("message", "")
    except ValueError:
        pytest.fail(f"non-JSON {resp.status_code} body: {resp.text[:300]}")
    assert "SELEC" in message, resp.text[:300]


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="#16511 item 1: _search_stream truncates EXPLAIN ANALYZE rows to the SQL LIMIT",
)
def test_limit_keeps_every_explain_analyze_row_on_stream(client: OpenObserveClient, streams, window):
    sql = f'EXPLAIN ANALYZE SELECT n FROM "{streams[0]}" WHERE n < 100 LIMIT 1'
    expected = len(_search(client, sql, window)["hits"])
    if expected < 2:
        pytest.fail(f"precondition: /_search returned {expected} rows")
    assert len(_stream_hits(client, sql, window)) == expected


@pytest.mark.xfail(
    strict=True,
    raises=AssertionError,
    reason="#16511 item 1: _search_stream drops physical_plan from EXPLAIN ... LIMIT 1",
)
def test_limit_keeps_both_plans_on_stream(client: OpenObserveClient, streams, window):
    sql = f'EXPLAIN SELECT n FROM "{streams[0]}" WHERE n < 100 LIMIT 1'
    plan_types = {h.get("plan_type") for h in _stream_hits(client, sql, window, profile=False)}
    assert {"logical_plan", "physical_plan"} <= plan_types, plan_types


@pytest.mark.xfail(
    strict=True, raises=AssertionError, reason="#16511 item 3: peak memory never reaches a node's scan_stats"
)
def test_remote_node_reports_peak_memory(client: OpenObserveClient, streams, window):
    sql = f'EXPLAIN ANALYZE SELECT level, count(*) AS c FROM "{streams[0]}" GROUP BY level'
    remotes = _remotes(_profile(_search(client, sql, window)["hits"])["plan"])
    if not remotes:
        pytest.fail("precondition: profile lists no remote node")
    peaks = [_scan_stats(r)["peak_memory_usage"] for r in remotes]
    assert all(p > 0 for p in peaks), peaks

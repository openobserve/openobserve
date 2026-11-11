"""A top-N aggregate (GROUP BY … ORDER BY agg LIMIT n) that fails must report the error, not 200 with no rows (#16516)."""

from __future__ import annotations

import time
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.wait import wait_until

ORGS = ["acme", "globex", "initech", "umbrella", "hooli"]
ROWS = 500


@pytest.fixture(scope="module")
def stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("explain_e2e_topk")
    now_us = int(time.time() * 1_000_000)
    records = [
        {
            "_timestamp": now_us - i * 1_000_000,
            "org_name": ORGS[i % len(ORGS)],
            "log": f"warehouse event {i} text",
            "n": i,
        }
        for i in range(ROWS)
    ]
    try:
        client.streams.ingest_json(name, records)
        wait_until(
            lambda: _hits(client, f'SELECT count(*) AS c FROM "{name}"')[0].get("c") == ROWS,
            timeout=60,
            interval=1.0,
            msg=f"{name} not searchable",
        )
        yield name
    finally:
        client.streams.delete(name)


def _search(client: OpenObserveClient, sql: str):
    now_us = int(time.time() * 1_000_000)
    body = search_payload(sql, start_time=now_us - 3_600_000_000, end_time=now_us + 60_000_000, size=-1)
    return client.post("_search?type=logs", json=body)


def _hits(client: OpenObserveClient, sql: str) -> list[dict[str, Any]]:
    resp = _search(client, sql)
    resp.raise_for_status()
    return resp.json().get("hits", [])


def _assert_error_reported(resp, expected: str) -> None:
    if resp.status_code != 200:
        assert 400 <= resp.status_code < 600, resp.text[:500]
        assert expected in resp.text, resp.text[:500]
        return
    body = resp.json()
    reported = str(body.get("function_error") or "")
    assert body.get("is_partial") is True, (
        f"error swallowed: 200 with {len(body.get('hits') or [])} hits, "
        f"is_partial={body.get('is_partial')!r}, function_error={reported[:300]!r}"
    )
    assert expected in reported, reported[:500]


FAILING_AGGREGATES = [
    pytest.param("SUM(CAST(log AS INT))", "Cast error", id="cast_error"),
    pytest.param("SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END)", "match_all", id="match_all_error"),
]


@pytest.mark.parametrize(("agg", "expected"), FAILING_AGGREGATES)
def test_topk_aggregate_reports_error(client: OpenObserveClient, stream: str, agg: str, expected: str):
    sql = f'SELECT org_name, {agg} AS s FROM "{stream}" GROUP BY org_name ORDER BY s DESC LIMIT 10'
    _assert_error_reported(_search(client, sql), expected)


@pytest.mark.parametrize(("agg", "expected"), FAILING_AGGREGATES)
def test_plain_aggregate_reports_error(client: OpenObserveClient, stream: str, agg: str, expected: str):
    sql = f'SELECT org_name, {agg} AS s FROM "{stream}" GROUP BY org_name'
    _assert_error_reported(_search(client, sql), expected)


def test_topk_count_returns_every_group(client: OpenObserveClient, stream: str):
    sql = f'SELECT org_name, count(*) AS s FROM "{stream}" GROUP BY org_name ORDER BY s DESC LIMIT 10'
    resp = _search(client, sql)
    assert resp.status_code == 200, resp.text[:500]
    body = resp.json()
    assert not body.get("is_partial"), body.get("function_error")
    hits = body.get("hits", [])
    assert sorted(h["org_name"] for h in hits) == sorted(ORGS), hits
    assert all(h["s"] == ROWS // len(ORGS) for h in hits), hits

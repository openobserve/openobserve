"""`col LIKE '%x%'` uses the inverted index only to narrow candidates.

A LIKE on a full-text-search field is answered by the `_all` field as a superset
and re-checked by the original predicate; on a secondary index field it is the
same exact substring lookup as `str_match()`. Either way the rows must equal a plain scan, which
`SELECT /*+ NO_INDEX */` and the `use_inverted_index=false` request field force.
"""
from __future__ import annotations

import time

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window
from support.fixtures import client, temp_stream_name  # noqa: F401
from support.wait import wait_until

ROWS = [
    ("Connection TIMEOUT occurred", "AuthService"),
    ("upstreamTimeoutError while reading", "auth-gateway"),
    ("timeout", "billing"),
    ("time out is not a match", "billingAuth"),
    ("request finished", "aaab"),
    ("ababab pattern", "search"),
]

QUERIES = [
    ("message LIKE '%timeout%'", lambda m, s: "timeout" in m),
    ("message ILIKE '%TIMEOUT%'", lambda m, s: "timeout" in m.lower()),
    ("message LIKE '%Timeout%'", lambda m, s: "Timeout" in m),
    ("message LIKE '%abab%'", lambda m, s: "abab" in m),
    ("service LIKE '%Auth%'", lambda m, s: "Auth" in s),
    ("service ILIKE '%auth%'", lambda m, s: "auth" in s.lower()),
    ("service LIKE '%aab%'", lambda m, s: "aab" in s),
    ("service LIKE '%h-ga%'", lambda m, s: "h-ga" in s),
    ("NOT (service LIKE '%billing%')", lambda m, s: "billing" not in s),
    (
        "(service LIKE '%billing%' OR message LIKE '%finished%')",
        lambda m, s: "billing" in s or "finished" in m,
    ),
    ("message NOT LIKE '%timeout%'", lambda m, s: "timeout" not in m),
]


def _count(client: OpenObserveClient, sql: str, *, use_inverted_index: bool = True) -> int:
    start, end = time_window(minutes=60)
    body = search_payload(sql, start_time=start, end_time=end, size=1)
    body["use_inverted_index"] = use_inverted_index
    resp = client.post("_search?type=logs", json=body, raise_for_status=True)
    hits = resp.json().get("hits", [])
    return int(hits[0]["n"]) if hits else 0


@pytest.fixture
def seeded_stream(client: OpenObserveClient, temp_stream_name: str) -> str:
    stream = temp_stream_name
    now = int(time.time() * 1_000_000)
    records = [
        {"_timestamp": now - i * 1_000_000, "message": message, "service": service}
        for i, (message, service) in enumerate(ROWS)
    ]
    client.streams.ingest_json(stream, records)
    resp = client.streams.update_settings(
        stream,
        full_text_search_keys={"add": ["message"]},
        index_fields={"add": ["service"]},
    )
    assert resp.status_code == 200, resp.text
    # moves the rows from memtable to files so the index path gets exercised where available
    client.put("node/flush", prefix="")
    wait_until(
        lambda: _count(client, f'SELECT count(*) AS n FROM "{stream}"') == len(ROWS),
        timeout=60,
        msg=f"{stream} never returned {len(ROWS)} rows",
    )
    return stream


@pytest.mark.parametrize("where, matches", QUERIES, ids=[q for q, _ in QUERIES])
def test_like_matches_scan_with_and_without_index(
    client: OpenObserveClient, seeded_stream: str, where: str, matches
):
    expected = sum(1 for message, service in ROWS if matches(message, service))
    sql = f'SELECT count(*) AS n FROM "{seeded_stream}" WHERE {where}'
    no_index_sql = f'SELECT /*+ NO_INDEX */ count(*) AS n FROM "{seeded_stream}" WHERE {where}'

    assert _count(client, sql) == expected
    assert _count(client, no_index_sql) == expected
    assert _count(client, sql, use_inverted_index=False) == expected

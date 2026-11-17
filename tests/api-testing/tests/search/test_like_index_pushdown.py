"""`col LIKE '%x%'` returns the same rows with the inverted index as a `use_index=false` scan."""
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


def _search(
    client: OpenObserveClient,
    sql: str,
    *,
    start: int | None = None,
    use_index: bool = True,
    size: int = 1,
) -> list[dict]:
    window_start, end = time_window(minutes=60)
    body = search_payload(sql, start_time=start or window_start, end_time=end, size=size)
    body["use_index"] = use_index
    resp = client.post("_search?type=logs", json=body, raise_for_status=True)
    return resp.json().get("hits", [])


def _count(
    client: OpenObserveClient,
    sql: str,
    *,
    start: int | None = None,
    use_index: bool = True,
) -> int:
    hits = _search(client, sql, start=start, use_index=use_index)
    return int(hits[0]["n"]) if hits else 0


def _now_micros() -> int:
    return int(time.time() * 1_000_000)


@pytest.fixture
def seeded_stream(client: OpenObserveClient, temp_stream_name: str) -> tuple[str, int]:
    """Returns the stream and a query start after its FTS field was added, so LIKE uses `_all`."""
    stream = temp_stream_name
    client.streams.ingest_json(
        stream,
        [{"_timestamp": _now_micros() - 60_000_000, "message": "setup", "service": "setup"}],
    )
    resp = client.streams.update_settings(
        stream,
        full_text_search_keys={"add": ["message"]},
        index_fields={"add": ["service"]},
    )
    assert resp.status_code == 200, resp.text
    time.sleep(1)
    start = _now_micros()
    records = [
        {"_timestamp": start + i, "message": message, "service": service}
        for i, (message, service) in enumerate(ROWS)
    ]
    client.streams.ingest_json(stream, records)
    # moves the rows from memtable to files so the index path gets exercised where available
    client.put("node/flush", prefix="")
    wait_until(
        lambda: _count(client, f'SELECT count(*) AS n FROM "{stream}"', start=start) == len(ROWS),
        timeout=60,
        msg=f"{stream} never returned {len(ROWS)} rows",
    )
    return stream, start


@pytest.mark.parametrize("where, matches", QUERIES, ids=[q for q, _ in QUERIES])
def test_like_matches_scan_with_and_without_index(
    client: OpenObserveClient, seeded_stream: tuple[str, int], where: str, matches
):
    stream, start = seeded_stream
    expected = sum(1 for message, service in ROWS if matches(message, service))
    sql = f'SELECT count(*) AS n FROM "{stream}" WHERE {where}'

    assert _count(client, sql, start=start) == expected
    assert _count(client, sql, start=start, use_index=False) == expected


def test_like_distinct_on_index_field_matches_scan(
    client: OpenObserveClient, seeded_stream: tuple[str, int]
):
    stream, start = seeded_stream
    sql = (
        f'SELECT service FROM "{stream}" WHERE service LIKE \'%Auth%\' '
        "GROUP BY service ORDER BY service LIMIT 10"
    )

    def services(use_index: bool) -> list[str]:
        hits = _search(client, sql, start=start, use_index=use_index, size=10)
        return [hit["service"] for hit in hits]

    assert services(True) == ["AuthService", "billingAuth"]
    assert services(False) == ["AuthService", "billingAuth"]


def test_like_finds_rows_written_before_field_joined_fts(
    client: OpenObserveClient, temp_stream_name: str
):
    stream = temp_stream_name
    record = {"_timestamp": _now_micros(), "message": "ok", "payload_text": "timeout"}
    client.streams.ingest_json(stream, [record])
    client.put("node/flush", prefix="")
    # the file's `_all` must be built without the field for this to catch a miss
    time.sleep(5)
    resp = client.streams.update_settings(
        stream, full_text_search_keys={"add": ["payload_text"]}
    )
    assert resp.status_code == 200, resp.text

    sql = f"""SELECT count(*) AS n FROM "{stream}" WHERE payload_text LIKE '%timeout%'"""
    wait_until(
        lambda: _count(client, sql) == 1,
        timeout=60,
        msg=f"{stream} missed a row written before payload_text joined FTS",
    )

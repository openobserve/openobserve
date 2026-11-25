"""A query function that fails on some rows must say so in function_error, not return those rows unchanged in silence (#16976)."""

from __future__ import annotations

import base64
import time
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.wait import wait_until

ROWS = 40
BAD_ROWS = 10


@pytest.fixture(scope="module")
def stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("vrl_row_fail")
    now_us = int(time.time() * 1_000_000)
    rows = [{"_timestamp": now_us - i * 1_000, "i": i, "n": "abc" if i % 4 == 0 else str(i)} for i in range(ROWS)]
    try:
        client.streams.ingest_json(name, rows)
        wait_until(
            lambda: len(_search(client, name, ".")["hits"]) == ROWS,
            timeout=60,
            interval=1.0,
            msg=f"{name} not searchable",
        )
        yield name
    finally:
        client.streams.delete(name)


def _search(client: OpenObserveClient, stream: str, vrl: str, where: str = "") -> dict[str, Any]:
    now_us = int(time.time() * 1_000_000)
    body = search_payload(
        f'SELECT * FROM "{stream}" {where}',
        start_time=now_us - 3_600_000_000,
        end_time=now_us + 60_000_000,
        size=100,
    )
    body["query"]["query_fn"] = base64.b64encode(vrl.encode()).decode()
    resp = client.post("_search?type=logs", json=body)
    assert resp.status_code == 200, f"{resp.status_code} {resp.text[:500]}"
    return resp.json()


def test_fallible_function_failing_on_some_rows_reports_the_failed_count(client: OpenObserveClient, stream: str):
    body = _search(client, stream, ".x = to_int!(.n)\n.")
    hits = body["hits"]
    assert len(hits) == ROWS
    assert sum(1 for h in hits if "x" in h) == ROWS - BAD_ROWS
    error = body.get("function_error") or ""
    if isinstance(error, list):
        error = " ".join(error)
    assert f"Query function failed on {BAD_ROWS} of {ROWS} rows" in error, body.get("function_error")
    assert "to_int" in error


@pytest.mark.parametrize(
    ("vrl", "where", "with_x"),
    [
        (".x = to_int!(.n)\n.", "WHERE n != 'abc'", ROWS - BAD_ROWS),
        (".x = to_int(.n) ?? -1\n.", "", ROWS),
        ('if .n == "abc" { abort }\n.x = 1\n.', "", ROWS - BAD_ROWS),
    ],
    ids=["failing-rows-filtered-out", "infallible-function", "intentional-abort"],
)
def test_function_with_no_runtime_failure_reports_no_error(
    client: OpenObserveClient, stream: str, vrl: str, where: str, with_x: int
):
    body = _search(client, stream, vrl, where)
    assert sum(1 for h in body["hits"] if "x" in h) == with_x
    assert not body.get("function_error"), body.get("function_error")

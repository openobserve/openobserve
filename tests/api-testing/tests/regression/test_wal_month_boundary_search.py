"""A search reads WAL parquet of every month it spans, including a short month before a 31st end (#16515).

The WAL dir filter checked a month dir `YYYY/MM` with the query end's day. A range ending on day 31 made a 30-day
middle month (or February) an invalid date, so the whole month dir was skipped and its rows went missing with no
error. The test sends one row each side of a short-month boundary (Sep 30 23:30 and Oct 1 00:30 for a run in
Nov 2026), waits until both sit in WAL parquet, then searches from the month before to the end month's last day.
The old filter kept only the later row; the earlier one is the regression.

The `wal_month_boundary` shard accepts rows ~130 days old, rotates memtables every 10s and holds parquet in the
WAL for an hour (`ZO_FILE_PUSH_INTERVAL=3600`), so nothing reaches storage while the test runs.
"""

from __future__ import annotations

import calendar
from datetime import UTC, datetime

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until


@pytest.fixture(scope="module")
def fresh_org(client: OpenObserveClient) -> str:
    """An org of its own, so the per-org WAL parquet gauge counts only this test's files."""
    resp = client.post("api/organizations", json={"name": unique_name("pytest_wal_month")}, prefix="")
    assert resp.status_code == 200, f"create org: {resp.status_code} {resp.text[:300]}"
    return resp.json()["identifier"]


def _micros(dt: datetime) -> int:
    return int(dt.timestamp()) * 1_000_000


def _prev(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _days(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _short_month_window(now: datetime) -> dict[str, datetime]:
    """Rows either side of the latest finished short-to-long month boundary, and a range ending on the 31st."""
    year, month = _prev(now.year, now.month)
    while _days(year, month) <= _days(*_prev(year, month)):
        year, month = _prev(year, month)
    short = _prev(year, month)
    start_month = _prev(*short)
    return {
        "earlier": datetime(*short, _days(*short), 23, 30, tzinfo=UTC),
        "later": datetime(year, month, 1, 0, 30, tzinfo=UTC),
        "start": datetime(*start_month, _days(*start_month), tzinfo=UTC),
        "end": datetime(year, month, _days(year, month), 23, 59, 59, tzinfo=UTC),
    }


def _wal_parquet_files(client: OpenObserveClient, org: str) -> int:
    resp = client.get("metrics", prefix="")
    assert resp.status_code == 200, f"metrics: {resp.status_code} {resp.text[:300]}"
    for line in resp.text.splitlines():
        if (
            line.startswith("zo_ingest_parquet_files{")
            and f'organization="{org}"' in line
            and 'stream_type="logs"' in line
        ):
            return int(float(line.rsplit(" ", 1)[1]))
    return 0


def test_search_reads_wal_parquet_of_a_short_month_before_a_31st_end(client: OpenObserveClient, fresh_org: str):
    window = _short_month_window(datetime.now(UTC))
    stream = unique_name("pytest_wal_month")
    rows = [{"side": side, "_timestamp": _micros(window[side])} for side in ("earlier", "later")]
    resp = client.post(f"{stream}/_json", json=rows, org=fresh_org)
    assert resp.status_code == 200, f"ingest: {resp.status_code} {resp.text[:300]}"
    status = resp.json()["status"][0]
    assert (status["successful"], status["failed"]) == (2, 0), f"ingest {window}: {status}"

    # Memtable rows are searched without the dir filter, so only rows in WAL parquet show the bug.
    wait_until(
        lambda: _wal_parquet_files(client, fresh_org) >= 2,
        timeout=240,
        interval=5,
        msg=f"the two hour files of {stream} never reached WAL parquet",
    )

    body = {
        "query": {
            "sql": f'SELECT side, _timestamp FROM "{stream}" ORDER BY _timestamp',
            "start_time": _micros(window["start"]),
            "end_time": _micros(window["end"]),
            "from": 0,
            "size": 10,
        }
    }
    resp = client.post("_search", params={"type": "logs", "use_cache": "false"}, json=body, org=fresh_org)
    assert resp.status_code == 200, f"search: {resp.status_code} {resp.text[:300]}"
    hits = [(hit["side"], hit["_timestamp"]) for hit in resp.json()["hits"]]
    assert hits == [(row["side"], row["_timestamp"]) for row in rows], f"#16515 {window}: {hits}"

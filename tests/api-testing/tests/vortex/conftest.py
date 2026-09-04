"""Shared fixtures and helpers for the vortex test suite.

All vortex tests live under tests/vortex/ and share this conftest.
Stream names always include SESSION_ID so parallel runs on a shared server
don't accumulate data across sessions.

Enterprise CI only — do not add to OSS api-testing.yml.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload
from support.wait import WaitTimeout, wait_until

SESSION_ID = str(int(time.time()))[-6:]

# Cross-phase stream — shared by test_format_conversion.py phase classes.
# Enterprise CI sets VORTEX_STREAM_NAME once; all 3 jobs inherit it.
STREAM = os.environ.get("VORTEX_STREAM_NAME", "vortex_format_test")


@pytest.fixture(scope="session")
def client() -> OpenObserveClient:
    return OpenObserveClient()


# ─── Search helpers ────────────────────────────────────────────────────────────

def _wide_window() -> tuple[int, int]:
    """Return (start_us, end_us) spanning 4 weeks back to 1 hour forward."""
    now = datetime.now(timezone.utc)
    start = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
    end = int((now + timedelta(hours=1)).timestamp() * 1_000_000)
    return start, end


def count_records(client: OpenObserveClient, stream: str, *, where: str = "") -> int:
    """Return the total record count in *stream*, optionally filtered by *where*.

    Uses a wide 4-week time window so records written at any point during the
    test session are included.
    """
    start, end = _wide_window()
    sql = f'SELECT COUNT(*) AS c FROM "{stream}"'
    if where:
        sql += f" WHERE {where}"
    payload = search_payload(sql, start_time=start, end_time=end, size=1)
    resp = client.post("_search?type=logs", json=payload)
    assert resp.status_code == 200, (
        f"count_records({stream!r}) failed: {resp.status_code} {resp.text[:200]}"
    )
    hits = resp.json().get("hits", [])
    return int(hits[0].get("c", 0)) if hits else 0


def ingest(client: OpenObserveClient, stream: str, records: list[dict]) -> None:
    """Bulk-ingest *records* into *stream* via the _json endpoint."""
    resp = client.post(
        f"{stream}/_json",
        data=json.dumps(records),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200, (
        f"ingest({stream!r}, {len(records)} records) failed: "
        f"{resp.status_code} {resp.text[:200]}"
    )


def flush_and_wait(
    client: OpenObserveClient,
    stream: str,
    expected: int,
    *,
    timeout: float = 120.0,
) -> None:
    """Flush the WAL and wait until *expected* records are searchable.

    Flushes by calling PUT /node/flush (ingester nodes only). Non-ingester
    nodes return 404 which is ignored. After flush, polls count_records
    until the expected total is reached or *timeout* seconds elapse.
    """
    resp = client.put("node/flush", prefix="")
    if resp.status_code == 200:
        logging.debug("flush_and_wait: flush succeeded for %s", stream)
    elif resp.status_code == 404:
        logging.debug("flush_and_wait: flush not applicable (non-ingester node)")
    else:
        logging.warning(
            "flush_and_wait: unexpected flush status %s: %s",
            resp.status_code, resp.text[:100],
        )

    time.sleep(1)

    def _searchable():
        return count_records(client, stream) >= expected

    wait_until(
        _searchable,
        timeout=timeout,
        interval=2.0,
        msg=f"{stream}: expected {expected} records after flush",
    )


def wait_for_stream_stats(
    client: OpenObserveClient,
    stream: str,
    min_docs: int,
    *,
    timeout: float = 60.0,
) -> dict:
    """Wait until stream stats show at least *min_docs* in doc_num.

    Stream stats (doc_num, storage_size) are updated by background compaction,
    not by WAL flush. This helper is only useful when ZO_COMPACT_INTERVAL is
    short (enterprise CI). In other environments, skip tests that call this.
    """
    def _stats_ready():
        r = client.get(f"streams?type=logs&stream_name={stream}")
        if r.status_code != 200:
            return None
        entry = next(
            (s for s in r.json().get("list", []) if s["name"] == stream), {}
        )
        stats = entry.get("stats", {})
        if int(stats.get("doc_num", 0)) >= min_docs:
            return stats
        return None

    return wait_until(
        _stats_ready,
        timeout=timeout,
        interval=5.0,
        msg=f"{stream}: doc_num did not reach {min_docs} within {timeout}s",
    )

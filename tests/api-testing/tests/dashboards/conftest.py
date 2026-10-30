"""Shared fixtures for the dashboard panel test modules.

The warehouse dataset is ingested once per session and shared by every panel
module — it is 10 000 records across two streams, and re-ingesting per module
would dominate the run time for no added coverage.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.panel_queries import BASE_TS, build_dataset
from support.wait import wait_until

logger = logging.getLogger(__name__)


def _ingest(client: OpenObserveClient, stream: str, records: list[dict]) -> None:
    resp = client.post(
        f"{stream}/_json",
        data=json.dumps(records),
        headers={"Content-Type": "application/json"},
    )
    if resp.status_code != 200:
        pytest.fail(f"Ingestion into {stream} failed: {resp.status_code} — {resp.text[:300]}")
    logger.info("Ingested %d records into %s", len(records), stream)


@pytest.fixture(scope="session")
def panel_streams(client: OpenObserveClient) -> Generator[tuple[str, str], None, None]:
    """Two streams holding the query-agent warehouse dataset: (primary, secondary).

    Uses `build_dataset()` at its default size on purpose: the expected row counts
    in the query JSON were computed by the DuckDB oracle against exactly that
    dataset. A smaller one shifts which records fall inside a query's time window
    at the boundary, and the counts stop matching.

    The secondary stream carries `stream_offset=7` — same timestamps, rotated
    field values — which is what the corpus's cross-stream CTE joins expect.

    Both streams are dropped on teardown. The PID suffix only prevents *collisions*
    between concurrent runs — without an explicit delete, every run would strand
    10 000 records on the server, which adds up fast on a shared environment.
    """
    stream = f"dashboard_panel_{BASE_TS}_{os.getpid()}"
    stream2 = f"dashboard_panel2_{BASE_TS}_{os.getpid()}"

    records = build_dataset()
    records2 = build_dataset(stream_offset=7)
    _ingest(client, stream, records)
    _ingest(client, stream2, records2)

    max_ts = max(r["_timestamp"] for r in records)

    def _count(target: str) -> int:
        now = datetime.now(UTC)
        # Records run forward of BASE_TS into the future; widen the ceiling past
        # max_ts or the vortex engine (which enforces end_time strictly) sees none.
        end_us = max(int(now.timestamp() * 1_000_000), max_ts) + 3_600_000_000
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        r = client.post(
            "_search?type=logs",
            json={
                "query": {
                    "sql": f'SELECT COUNT(*) AS c FROM "{target}"',
                    "start_time": start_us,
                    "end_time": end_us,
                    "from": 0,
                    "size": 1,
                }
            },
        )
        if r.status_code != 200:
            return 0
        hits = r.json().get("hits", [])
        return int(hits[0].get("c", 0)) if hits else 0

    # Vortex nodes serve nothing until data leaves the memtable. Probe briefly,
    # then flush once rather than waiting out the full timeout for nothing.
    memtable_visible = False
    for _ in range(3):
        if _count(stream) > 0:
            memtable_visible = True
            break
        time.sleep(1.0)
    if not memtable_visible:
        client.put("node/flush", prefix="")
        logger.info("No memtable visibility after 3s — flushed")

    # Each stream is checked independently so a cross-stream join never runs
    # against a half-ready secondary.
    for target, expected in ((stream, len(records)), (stream2, len(records2))):
        wait_until(
            lambda t=target, n=expected: _count(t) >= n,
            timeout=90,
            interval=1.0,
            msg=f"{target}: ingested records never became searchable",
        )
    logger.info("%s and %s are searchable", stream, stream2)

    yield stream, stream2

    for target in (stream, stream2):
        try:
            resp = client.streams.delete(target)
            if resp.status_code not in (200, 204, 404):
                logger.warning(
                    "stream cleanup for %s returned %s: %s",
                    target,
                    resp.status_code,
                    resp.text[:200],
                )
        except Exception as e:
            logger.warning("stream cleanup failed for %s: %s", target, e)


@pytest.fixture(scope="session")
def panel_stream(panel_streams: tuple[str, str]) -> str:
    """The primary warehouse stream, for tests that need only one."""
    return panel_streams[0]


@pytest.fixture(scope="module")
def panel_dashboard(client: OpenObserveClient) -> Generator[str, None, None]:
    """A v8 dashboard with one empty tab, deleted at module teardown.

    Panel operations are v8-only and need a tab to land in — AddPanel with no
    `tabId` targets the first tab and 404s on a dashboard that has none.

    Module-scoped so each test module gets a clean dashboard: panels are added
    and removed constantly here, and a leaked panel should not follow the suite
    into the next file.
    """
    resp = client.post(
        "dashboards",
        json={
            "version": 8,
            "title": unique_name("panel_dash"),
            "description": "Dashboard panel API tests",
            "folder_id": "default",
            "tabs": [{"tabId": "default", "name": "Default", "panels": []}],
        },
    )
    assert resp.status_code in (200, 201), f"Dashboard setup failed: {resp.status_code} {resp.text}"
    dashboard_id = resp.json()["v8"]["dashboardId"]
    yield dashboard_id
    try:
        # A non-2xx delete leaks a dashboard just as surely as an exception does,
        # so check the status too rather than only catching throws.
        resp = client.dashboards.delete(dashboard_id)
        if resp.status_code not in (200, 204, 404):
            logger.warning(
                "dashboard cleanup for %s returned %s: %s",
                dashboard_id,
                resp.status_code,
                resp.text[:200],
            )
    except Exception as e:
        logger.warning("panel_dashboard cleanup failed for %s: %s", dashboard_id, e)

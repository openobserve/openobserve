"""A wholly-discarded ingestion batch must still count its window drops.

Regression test for the fast-return in ``logs::ingest::ingest``: when every
record in a batch is out of the ingestion window there is nothing to write, and
the function used to return before the drop-counting path — so a batch that lost
*everything* incremented no ``zo_ingest_records_dropped_total`` counter and
logged no warning, the exact silent total loss the counter exists to surface.
A batch that keeps at least one record was always counted; only the all-dropped
case was invisible.

Uses the plain ``_json`` route (shared write path) so no Splunk HEC token is
needed; the offset is derived from the server's own ZO_INGEST_ALLOWED_UPTO so
the records are genuinely out of window whatever it is set to (CI raises it to
48h for backfill tests).
"""
from __future__ import annotations

import logging
import os
import time
import uuid

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

WINDOW_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_UPTO", "5"))
STALE_OFFSET_SECONDS = (WINDOW_HOURS + 24) * 60 * 60
SEARCH_MINUTES = int(STALE_OFFSET_SECONDS / 60) + 2 * 24 * 60

DROP_METRIC = "zo_ingest_records_dropped_total"


def _dropped_by_window(metrics_text: str, org: str) -> int:
    """Sum ``zo_ingest_records_dropped_total`` series for org + ingestion_window."""
    total = 0
    for line in metrics_text.splitlines():
        if not line.startswith(DROP_METRIC + "{"):
            continue
        if f'organization="{org}"' not in line or 'reason="ingestion_window"' not in line:
            continue
        total += int(float(line.rsplit(" ", 1)[1]))
    return total


def _marker_count(client: OpenObserveClient, stream: str, marker: str) -> int:
    """Rows in ``stream`` carrying ``marker``; 0 if the stream does not exist yet.

    Searched over a window that spans the stale timestamp, so a record wrongly
    stored instead of dropped is found rather than hidden by a short lookback.
    """
    resp = client.search.sql(
        f"SELECT COUNT(*) AS count FROM \"{stream}\" WHERE marker = '{marker}'",
        minutes=SEARCH_MINUTES,
        raise_for_status=False,
    )
    if resp.status_code != 200:
        return 0
    hits = resp.json().get("hits", [])
    return int(hits[0].get("count", 0)) if hits else 0


def test_wholly_discarded_batch_counts_window_drops(client: OpenObserveClient):
    """An all-out-of-window _json batch is accepted (200), stores nothing, and
    still raises zo_ingest_records_dropped_total{reason=ingestion_window} by its
    record count.
    """
    metrics = client.get("metrics", prefix="", raise_for_status=False)
    assert metrics.status_code == 200, metrics.text

    before = _dropped_by_window(metrics.text, client.org)

    n = 3
    stream = unique_name("wholedrop")
    marker = uuid.uuid4().hex
    stale_us = int((time.time() - STALE_OFFSET_SECONDS) * 1_000_000)
    records = [
        {"_timestamp": stale_us, "marker": marker, "log": "whole batch drop test"}
        for _ in range(n)
    ]
    resp = client.post(f"{stream}/_json", json=records, raise_for_status=False)
    assert resp.status_code == 200, resp.text

    # Nothing survives the window, so the whole batch is discarded and not stored.
    assert _marker_count(client, stream, marker) == 0, "all records were out of window"

    # Counter is not stream-labelled and the instance is shared, so assert a
    # monotonic increase of at least n rather than an exact delta.
    wait_until(
        lambda: _dropped_by_window(
            client.get("metrics", prefix="", raise_for_status=False).text, client.org
        )
        >= before + n,
        timeout=30,
        interval=1.0,
        msg=f"{DROP_METRIC} did not rise by at least {n} for a wholly-discarded batch",
    )

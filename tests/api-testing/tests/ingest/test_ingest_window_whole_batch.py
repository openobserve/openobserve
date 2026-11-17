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
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.prom_remote_write import remote_write
from support.wait import wait_until

logger = logging.getLogger(__name__)

WINDOW_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_UPTO", "5"))
FUTURE_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_IN_FUTURE", "24"))
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


@pytest.fixture
def metric_streams(client: OpenObserveClient) -> Generator[list[str], None, None]:
    names: list[str] = []
    yield names
    for name in names:
        client.streams.delete(name, type_="metrics")


def _three_samples_ms() -> tuple[int, int, int]:
    """Milliseconds for one sample an hour past each window bound and one inside it."""
    now_ms = int(time.time()) // 60 * 60 * 1000
    return now_ms - (WINDOW_HOURS + 1) * 3_600_000, now_ms - 10 * 60_000, now_ms + (FUTURE_HOURS + 1) * 3_600_000


def _stored_values(client: OpenObserveClient, metric: str, start_ms: int, end_ms: int) -> list[float]:
    """Every stored `value` of `metric` between two millisecond stamps, oldest first."""
    body = search_payload(
        f'SELECT _timestamp, value FROM "{metric}" ORDER BY _timestamp ASC',
        start_time=(start_ms - 3_600_000) * 1000,
        end_time=(end_ms + 3_600_000) * 1000,
    )
    resp = client.post("_search", params={"type": "metrics"}, json=body)
    if resp.status_code != 200:
        return []
    return [hit["value"] for hit in resp.json().get("hits", [])]


def test_metrics_json_drops_samples_outside_the_window(client: OpenObserveClient, metric_streams: list[str]):
    """openobserve#14638: metrics JSON stored samples older than ZO_INGEST_ALLOWED_UPTO or past the future bound."""
    metric = unique_name("pytest_window_json")
    metric_streams.append(metric)
    too_old, inside, too_new = _three_samples_ms()
    rows = [
        {"__name__": metric, "__type__": "gauge", "job": "window", "_timestamp": ts, "value": value}
        for ts, value in ((too_old, 1.0), (inside, 2.0), (too_new, 3.0))
    ]
    resp = client.post("ingest/metrics/_json", json=rows)
    assert resp.status_code == 200, resp.text
    status = resp.json()["status"][0]
    assert (status["successful"], status["failed"]) == (1, 2), status
    assert status["error"].startswith(("Too old data", "Too far data")), status

    stored = wait_until(
        lambda: _stored_values(client, metric, too_old, too_new), timeout=30, msg=f"{metric} stored nothing"
    )
    assert stored == [2.0], f"only the in-window sample may be stored: {stored}"


def test_remote_write_drops_samples_outside_the_window(client: OpenObserveClient, metric_streams: list[str]):
    """openobserve#14638: remote write answers a partial write with 400 and keeps only the in-window sample."""
    metric = unique_name("pytest_window_rw")
    metric_streams.append(metric)
    too_old, inside, too_new = _three_samples_ms()
    resp = remote_write(client, [({"__name__": metric, "job": "window"}, [(too_old, 1.0), (inside, 2.0), (too_new, 3.0)])])
    assert resp.status_code == 400, f"a partial write must be 400: {resp.status_code} {resp.text}"
    assert resp.headers.get("X-Prometheus-Remote-Write-Samples-Written") == "1", dict(resp.headers)
    assert "not written (samples: 2," in resp.json()["message"], resp.text

    stored = wait_until(
        lambda: _stored_values(client, metric, too_old, too_new), timeout=30, msg=f"{metric} stored nothing"
    )
    assert stored == [2.0], f"only the in-window sample may be stored: {stored}"

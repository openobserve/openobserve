"""Metrics JSON and remote write drop samples outside the ingest window and keep the rest (#14638)."""

from __future__ import annotations

import os
import time
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.prom_remote_write import remote_write
from support.wait import wait_until

# The default shard leaves the window to the workflow env, which the server and pytest both read.
WINDOW_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_UPTO", "5"))
FUTURE_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_IN_FUTURE", "24"))


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

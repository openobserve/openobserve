"""Remote write tells the sender how much it wrote, counted in the request's own units (#16214)."""

from __future__ import annotations

import struct
import time
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.prom_remote_write import HEADERS, exemplar, native_histogram, snappy, timeseries
from support.wait import wait_until

# Prometheus staleness marker, a NaN with a fixed payload.
STALE_NAN = struct.unpack("<d", struct.pack("<Q", 0x7FF0000000000002))[0]


@pytest.fixture
def metric_streams(client: OpenObserveClient) -> Generator[list[str], None, None]:
    names: list[str] = []
    yield names
    for name in names:
        client.streams.delete(name, type_="metrics")


def _row_count(client: OpenObserveClient, stream: str, start_ms: int) -> int:
    body = search_payload(
        f'SELECT count(value) AS c FROM "{stream}"',
        start_time=(start_ms - 3_600_000) * 1000,
        end_time=(start_ms + 3_600_000) * 1000,
    )
    resp = client.post("_search", params={"type": "metrics"}, json=body)
    if resp.status_code != 200 or not resp.json().get("hits"):
        return 0
    return resp.json()["hits"][0]["c"]


def test_remote_write_reports_written_samples_histograms_and_exemplars(
    client: OpenObserveClient, metric_streams: list[str]
):
    """openobserve#16214: a full write is a 200 carrying all three written-count headers in wire units."""
    gauge = unique_name("pytest_rw_written_gauge")
    hist = unique_name("pytest_rw_written_hist")
    metric_streams.extend([gauge, f"{gauge}_exemplars", f"{hist}_count", f"{hist}_sum", f"{hist}_bucket"])
    now_ms = int(time.time() * 1000) - 60_000
    body = timeseries(
        {"__name__": gauge, "job": "written"},
        samples=[(now_ms, 1.0), (now_ms + 1000, 2.0), (now_ms + 2000, 3.0), (now_ms + 3000, STALE_NAN)],
        exemplars=[exemplar(2.0, now_ms + 1000, {"trace_id": "abc123"})],
    ) + timeseries(
        {"__name__": hist, "job": "written"},
        histograms=[native_histogram(5, 7.5, now_ms, [2, 3]), native_histogram(6, 9.0, now_ms + 1000, [2, 4])],
    )
    resp = client.post("prometheus/api/v1/write", data=snappy(body), headers=HEADERS)
    assert resp.status_code == 200, f"{resp.status_code} {resp.text}"
    written = {
        kind: resp.headers.get(f"X-Prometheus-Remote-Write-{kind}-Written")
        for kind in ("Samples", "Histograms", "Exemplars")
    }
    # a stale marker counts as written, and a native histogram counts once though it expands into classic rows
    assert written == {"Samples": "4", "Histograms": "2", "Exemplars": "1"}, dict(resp.headers)

    wait_until(lambda: _row_count(client, gauge, now_ms) == 3, timeout=30, msg=f"{gauge} did not store 3 samples")
    wait_until(lambda: _row_count(client, f"{hist}_count", now_ms) == 2, timeout=30, msg=f"{hist}_count not stored")

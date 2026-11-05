"""The trace list summarizes whole traces and names each row by its top span  [regressions #15266, #15395]."""

from __future__ import annotations

import logging
import secrets
import time
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.otlp_json import now_unix_nano, span
from support.sse import read_sse_response
from support.wait import wait_until

logger = logging.getLogger(__name__)

MS = 1_000_000
HOUR_US = 60 * 60 * 1000 * 1000
ROUTES = ("latest", "latest_stream")
STATUS_ERROR = 2
STATUS_OK = 1


@pytest.fixture
def stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = f"e2e_trace_list_{secrets.token_hex(4)}"
    yield name
    try:
        client.streams.delete(name, type_="traces")
    except Exception as e:
        logger.warning("could not delete trace stream %s: %s", name, e)


def _span(
    trace_id: str,
    span_id: str,
    name: str,
    *,
    start_ns: int,
    duration_ms: int,
    parent_span_id: str | None = None,
    error: bool = False,
) -> dict[str, Any]:
    sp = span(name, trace_id=trace_id, span_id=span_id, time_unix_nano=start_ns, duration_nanos=duration_ms * MS)
    if parent_span_id:
        sp["parentSpanId"] = parent_span_id
    sp["status"] = {"code": STATUS_ERROR if error else STATUS_OK}
    return sp


def _resource_spans(service: str, spans: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": service}}]},
        "scopeSpans": [{"scope": {"name": "trace-list-summaries"}, "spans": spans}],
    }


def _ingest(client: OpenObserveClient, stream: str, resource_spans: list[dict[str, Any]]) -> None:
    resp = client.post("v1/traces", json={"resourceSpans": resource_spans}, headers={"stream-name": stream})
    assert resp.status_code == 200, f"Precondition: the spans must ingest, got {resp.status_code}: {resp.text}"


def _window() -> dict[str, int]:
    end_us = int(time.time() * 1_000_000) + 60_000_000
    return {"start_time": end_us - HOUR_US, "end_time": end_us}


def _list(client: OpenObserveClient, stream: str, route: str, filter_: str | None = None) -> dict[str, dict[str, Any]]:
    params: dict[str, Any] = {**_window(), "from": 0, "size": 25}
    if filter_:
        params["filter"] = filter_
    resp = client.get(f"{stream}/traces/{route}", params=params)
    assert resp.status_code == 200, f"traces/{route} failed with {resp.status_code}: {resp.text[:300]}"
    hits = read_sse_response(resp)["results"]["hits"] if route == "latest_stream" else resp.json().get("hits") or []
    return {h["trace_id"]: h for h in hits}


def _wait_listed(client: OpenObserveClient, stream: str, trace_ids: list[str], span_counts: list[int]) -> None:
    def complete() -> bool:
        rows = _list(client, stream, "latest")
        return all(rows.get(t, {}).get("spans", [0])[0] == n for t, n in zip(trace_ids, span_counts, strict=True))

    wait_until(complete, timeout=90, interval=2, msg="every seeded trace must list with all of its spans")


def _services(row: dict[str, Any]) -> list[str]:
    return sorted(s.get("service_name") for s in row.get("service_name") or [])


def test_filtered_list_summarizes_the_whole_trace(client: OpenObserveClient, stream: str):
    """#15266: a filtered trace list row still counts every span, service and the root of the trace."""
    trace_id = secrets.token_hex(16)
    gateway, api, db = secrets.token_hex(8), secrets.token_hex(8), secrets.token_hex(8)
    t0 = now_unix_nano() - 30_000 * MS
    _ingest(
        client,
        stream,
        [
            _resource_spans("gateway", [_span(trace_id, gateway, "GET /checkout", start_ns=t0, duration_ms=100)]),
            _resource_spans(
                "api",
                [
                    _span(
                        trace_id,
                        api,
                        "checkout",
                        start_ns=t0 + 10 * MS,
                        duration_ms=50,
                        parent_span_id=gateway,
                        error=True,
                    )
                ],
            ),
            _resource_spans(
                "db",
                [_span(trace_id, db, "SELECT cart", start_ns=t0 + 20 * MS, duration_ms=20, parent_span_id=api)],
            ),
        ],
    )
    _wait_listed(client, stream, [trace_id], [3])

    for route in ROUTES:
        for filter_ in (None, "service_name='api'"):
            row = _list(client, stream, route, filter_).get(trace_id)
            label = f"traces/{route} filter={filter_!r}"
            logger.info("%s -> %s", label, row)
            assert row is not None, f"{label} must list the trace"
            assert row["spans"] == [3, 1], f"#15266: {label} must count all 3 spans and the 1 error, got {row['spans']}"
            assert _services(row) == ["api", "db", "gateway"], f"#15266: {label} must list all 3 services"
            assert row["first_event"]["service_name"] == "gateway", f"#15266: {label} must name the root service"
            assert row["first_event"]["operation_name"] == "GET /checkout", f"#15266: {label} must name the root span"
            assert row["duration"] == 100_000, f"#15266: {label} must span the root's 100 ms, got {row['duration']} us"


def test_list_labels_the_outer_span_when_starts_tie(client: OpenObserveClient, stream: str):
    """#15395: when the top span and its child start in the same instant, the row names the top span."""
    traces: list[str] = []
    resource_spans = []
    for _ in range(3):
        trace_id = secrets.token_hex(16)
        top, child = secrets.token_hex(8), secrets.token_hex(8)
        t0 = now_unix_nano() - 30_000 * MS
        # The browser's own span is never exported, so even the top span has a parent here.
        missing_parent = secrets.token_hex(8)
        resource_spans.append(
            _resource_spans("web", [_span(trace_id, child, "request", start_ns=t0, duration_ms=9, parent_span_id=top)])
        )
        resource_spans.append(
            _resource_spans(
                "web",
                [
                    _span(
                        trace_id, top, "PATCH /api/users/me", start_ns=t0, duration_ms=10, parent_span_id=missing_parent
                    )
                ],
            )
        )
        traces.append(trace_id)
    # Children reach the collector first, as exporters flush them first.
    _ingest(client, stream, resource_spans[0::2])
    _ingest(client, stream, resource_spans[1::2])
    _wait_listed(client, stream, traces, [2, 2, 2])

    for route in ROUTES:
        rows = _list(client, stream, route)
        names = {t: (rows.get(t) or {}).get("first_event", {}).get("operation_name") for t in traces}
        logger.info("traces/%s first_event names: %s", route, names)
        assert set(names.values()) == {"PATCH /api/users/me"}, (
            f"#15395: traces/{route} must label every row with the outer span, got {names}"
        )

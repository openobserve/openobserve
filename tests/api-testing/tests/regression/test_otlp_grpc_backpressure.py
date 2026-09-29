"""Under a tripped disk circuit breaker OTLP/gRPC must answer UNAVAILABLE, never OK (#14640); needs the api_regression breaker leg."""
from __future__ import annotations

import uuid

import grpc
import pytest

from support.otlp_grpc import export_gauge, export_logs, export_spans, grpc_target, now_nanos


@pytest.fixture(scope="session")
def ingest_data():
    # Overrides the root autouse seed ingest, which a tripped breaker rejects by design.
    return None


@pytest.fixture(scope="module", autouse=True)
def require_tripped_breaker(client):
    resp = client.post("v1/logs", json={"resourceLogs": [{"scopeLogs": [{"logRecords": [{"body": {"stringValue": "probe"}}]}]}]})
    if resp.status_code != 503:
        pytest.skip("disk circuit breaker is not tripped; run via the api_regression otlp_grpc_backpressure leg")


@pytest.fixture(scope="module")
def channel():
    ch = grpc.insecure_channel(grpc_target())
    grpc.channel_ready_future(ch).result(timeout=30)
    yield ch
    ch.close()


@pytest.mark.parametrize(
    "send",
    [
        lambda ch, s: export_logs(ch, s, [now_nanos()]),
        lambda ch, s: export_spans(ch, s, [now_nanos()]),
        lambda ch, s: export_gauge(ch, s, f"{s}_gauge", [now_nanos()]),
    ],
    ids=["logs", "traces", "metrics"],
)
def test_overload_is_retryable_unavailable(channel, send):
    """OK would make the collector drop the batch; INTERNAL is non-retryable in OTLP."""
    result = send(channel, f"grpc_cb_{uuid.uuid4().hex[:10]}")

    assert result.code == grpc.StatusCode.UNAVAILABLE, (
        f"Bug #14640: an overloaded ingester must answer UNAVAILABLE so OTLP clients retry; got {result}"
    )
    assert "CircuitBreaker" in result.details, result


@pytest.mark.parametrize("signal", ["v1/logs", "v1/traces", "v1/metrics"])
def test_overload_is_503_over_http(client, signal):
    body = {"v1/logs": {"resourceLogs": []}, "v1/traces": {"resourceSpans": []}, "v1/metrics": {"resourceMetrics": []}}[signal]
    assert client.post(signal, json=body).status_code == 503

"""OTLP/gRPC export helpers: send logs, traces and metrics over a real gRPC channel."""
from __future__ import annotations

import base64
import os
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

import grpc
from opentelemetry.proto.collector.logs.v1 import logs_service_pb2, logs_service_pb2_grpc
from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2, metrics_service_pb2_grpc
from opentelemetry.proto.collector.trace.v1 import trace_service_pb2, trace_service_pb2_grpc
from opentelemetry.proto.common.v1 import common_pb2
from opentelemetry.proto.logs.v1 import logs_pb2
from opentelemetry.proto.metrics.v1 import metrics_pb2
from opentelemetry.proto.resource.v1 import resource_pb2
from opentelemetry.proto.trace.v1 import trace_pb2

STALE_OFFSET_NANOS = 60 * 24 * 60 * 60 * 1_000_000_000


@dataclass
class ExportResult:
    code: grpc.StatusCode
    details: str = ""
    rejected: int = 0
    error_message: str = ""
    has_partial_success: bool = False


def grpc_target() -> str:
    """host:port of the OTLP gRPC listener, from ZO_GRPC_ADDR or ZO_BASE_URL's host plus ZO_GRPC_PORT."""
    if os.environ.get("ZO_GRPC_ADDR"):
        return os.environ["ZO_GRPC_ADDR"]
    host = urlparse(os.environ.get("ZO_BASE_URL", "http://localhost:5080")).hostname or "localhost"
    return f"{host}:{os.environ.get('ZO_GRPC_PORT', '5081')}"


def metadata(stream: str, org: str = "default") -> list[tuple[str, str]]:
    creds = f"{os.environ['ZO_ROOT_USER_EMAIL']}:{os.environ['ZO_ROOT_USER_PASSWORD']}".encode()
    return [
        ("authorization", "Basic " + base64.b64encode(creds).decode()),
        ("organization", org),
        ("stream-name", stream),
    ]


def now_nanos() -> int:
    return time.time_ns()


def _resource() -> resource_pb2.Resource:
    return resource_pb2.Resource(attributes=[
        common_pb2.KeyValue(key="service.name", value=common_pb2.AnyValue(string_value="otlp-grpc-test")),
    ])


def _call(fn, request, stream: str, rejected_field: str) -> ExportResult:
    try:
        resp = fn(request, metadata=metadata(stream), timeout=30)
    except grpc.RpcError as e:
        return ExportResult(code=e.code(), details=e.details() or "")
    if not resp.HasField("partial_success"):
        return ExportResult(code=grpc.StatusCode.OK)
    ps = resp.partial_success
    return ExportResult(
        code=grpc.StatusCode.OK,
        rejected=getattr(ps, rejected_field),
        error_message=ps.error_message,
        has_partial_success=True,
    )


def export_logs(channel: grpc.Channel, stream: str, times: list[int]) -> ExportResult:
    records = [
        logs_pb2.LogRecord(time_unix_nano=t, body=common_pb2.AnyValue(string_value=f"otlp-grpc-test {i}"))
        for i, t in enumerate(times)
    ]
    req = logs_service_pb2.ExportLogsServiceRequest(resource_logs=[
        logs_pb2.ResourceLogs(resource=_resource(), scope_logs=[logs_pb2.ScopeLogs(log_records=records)]),
    ])
    return _call(logs_service_pb2_grpc.LogsServiceStub(channel).Export, req, stream, "rejected_log_records")


def export_spans(channel: grpc.Channel, stream: str, times: list[int]) -> ExportResult:
    spans = [
        trace_pb2.Span(
            trace_id=uuid.uuid4().bytes, span_id=uuid.uuid4().bytes[:8], name=f"op-{i}",
            start_time_unix_nano=t, end_time_unix_nano=t + 1_000_000,
        )
        for i, t in enumerate(times)
    ]
    req = trace_service_pb2.ExportTraceServiceRequest(resource_spans=[
        trace_pb2.ResourceSpans(resource=_resource(), scope_spans=[trace_pb2.ScopeSpans(spans=spans)]),
    ])
    return _call(trace_service_pb2_grpc.TraceServiceStub(channel).Export, req, stream, "rejected_spans")


def export_gauge(channel: grpc.Channel, stream: str, metric: str, times: list[int]) -> ExportResult:
    points = [metrics_pb2.NumberDataPoint(time_unix_nano=t, as_double=1.0) for t in times]
    req = metrics_service_pb2.ExportMetricsServiceRequest(resource_metrics=[
        metrics_pb2.ResourceMetrics(resource=_resource(), scope_metrics=[metrics_pb2.ScopeMetrics(metrics=[
            metrics_pb2.Metric(name=metric, gauge=metrics_pb2.Gauge(data_points=points)),
        ])]),
    ])
    return _call(metrics_service_pb2_grpc.MetricsServiceStub(channel).Export, req, stream, "rejected_data_points")

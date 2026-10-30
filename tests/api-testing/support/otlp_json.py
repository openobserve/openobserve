"""OTLP/HTTP JSON payload builders for ingestion tests.

OTLP/JSON is the protobuf schema's canonical JSON mapping, so every field these
builders emit has a protobuf twin; the server normalises JSON metrics through
`otlp_json_compat.rs` before the shared ingest path. Using JSON keeps these
tests dependency-free — no generated protobuf stubs to pin or regenerate.
"""
from __future__ import annotations

import time
from typing import Any

# OTLP DataPointFlags: the point is a gap, not a reading.
NO_RECORDED_VALUE_MASK = 1

# OTLP SeverityNumber for ERROR.
SEVERITY_NUMBER_ERROR = 17

AGGREGATION_TEMPORALITY_CUMULATIVE = 2


def now_unix_nano() -> int:
    return int(time.time() * 1_000_000_000)


def string_attr(key: str, value: str) -> dict[str, Any]:
    return {"key": key, "value": {"stringValue": value}}


def double_attr(key: str, value: float) -> dict[str, Any]:
    return {"key": key, "value": {"doubleValue": value}}


def resource(service_name: str) -> dict[str, Any]:
    return {"attributes": [string_attr("service.name", service_name)]}


def logs_request(records: list[dict[str, Any]], *, service: str = "otlp-json-test") -> dict[str, Any]:
    return {
        "resourceLogs": [
            {
                "resource": resource(service),
                "scopeLogs": [{"scope": {"name": "otlp-json-test"}, "logRecords": records}],
            }
        ]
    }


def log_record(
    body: str,
    *,
    time_unix_nano: int | None = None,
    severity_number: int | None = None,
    severity_text: str | None = None,
    attributes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ts = str(time_unix_nano if time_unix_nano is not None else now_unix_nano())
    rec: dict[str, Any] = {
        "timeUnixNano": ts,
        "observedTimeUnixNano": ts,
        "body": {"stringValue": body},
    }
    if severity_number is not None:
        rec["severityNumber"] = severity_number
    if severity_text is not None:
        rec["severityText"] = severity_text
    if attributes:
        rec["attributes"] = attributes
    return rec


def traces_request(spans: list[dict[str, Any]], *, service: str = "otlp-json-test") -> dict[str, Any]:
    return {
        "resourceSpans": [
            {
                "resource": resource(service),
                "scopeSpans": [{"scope": {"name": "otlp-json-test"}, "spans": spans}],
            }
        ]
    }


def span(
    name: str,
    *,
    trace_id: str,
    span_id: str,
    time_unix_nano: int | None = None,
    duration_nanos: int = 1_000_000,
    attributes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    start = time_unix_nano if time_unix_nano is not None else now_unix_nano()
    sp: dict[str, Any] = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name,
        "kind": 2,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(start + duration_nanos),
    }
    if attributes:
        sp["attributes"] = attributes
    return sp


def metrics_request(metrics: list[dict[str, Any]], *, service: str = "otlp-json-test") -> dict[str, Any]:
    return {
        "resourceMetrics": [
            {
                "resource": resource(service),
                "scopeMetrics": [{"scope": {"name": "otlp-json-test"}, "metrics": metrics}],
            }
        ]
    }


def gauge(name: str, value: float, *, time_unix_nano: int | None = None, flags: int | None = None) -> dict[str, Any]:
    dp: dict[str, Any] = {
        "timeUnixNano": str(time_unix_nano if time_unix_nano is not None else now_unix_nano()),
        "asDouble": value,
    }
    if flags is not None:
        dp["flags"] = flags
    return {"name": name, "gauge": {"dataPoints": [dp]}}


def exponential_histogram(
    name: str,
    *,
    count: int,
    total: float,
    scale: int,
    zero_count: int,
    positive_bucket_counts: list[int],
    negative_bucket_counts: list[int] | None = None,
    time_unix_nano: int | None = None,
) -> dict[str, Any]:
    ts = time_unix_nano if time_unix_nano is not None else now_unix_nano()
    dp: dict[str, Any] = {
        "timeUnixNano": str(ts),
        "startTimeUnixNano": str(ts - 60_000_000_000),
        "count": count,
        "sum": total,
        "scale": scale,
        "zeroCount": zero_count,
        "positive": {"offset": 0, "bucketCounts": positive_bucket_counts},
    }
    if negative_bucket_counts:
        dp["negative"] = {"offset": 0, "bucketCounts": negative_bucket_counts}
    return {
        "name": name,
        "exponentialHistogram": {
            "aggregationTemporality": AGGREGATION_TEMPORALITY_CUMULATIVE,
            "dataPoints": [dp],
        },
    }

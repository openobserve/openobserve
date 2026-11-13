"""Span kind and event attributes survive both OTLP HTTP decoders on the way to the store (#2693)."""

from __future__ import annotations

import json
import time
import uuid

import pytest
from opentelemetry.proto.collector.trace.v1 import trace_service_pb2
from opentelemetry.proto.common.v1 import common_pb2
from opentelemetry.proto.resource.v1 import resource_pb2
from opentelemetry.proto.trace.v1 import trace_pb2

from support.wait import wait_until

SPAN_KINDS = {"unspecified": 0, "internal": 1, "server": 2, "client": 3, "producer": 4, "consumer": 5}
EVENTS = [("msg1", "key1", "value1"), ("msg2", "key2", "value2"), ("msg3", "key3", "value3")]
SERVICE = "regression_2693"


def _span_rows(client, stream: str, trace_id: str) -> list[dict]:
    end = int(time.time() * 1_000_000) + 60_000_000
    resp = client.post(
        "_search?type=traces",
        json={
            "query": {
                "sql": f"SELECT * FROM \"{stream}\" WHERE trace_id = '{trace_id}'",
                "start_time": end - 3_600_000_000,
                "end_time": end,
                "from": 0,
                "size": 100,
            }
        },
    )
    return resp.json().get("hits", []) if resp.status_code == 200 else []


def _spans(trace_id: str) -> list[dict]:
    now_ns = time.time_ns() - 60 * 10**9
    root_id = uuid.uuid4().hex[:16]
    spans = [
        {
            "trace_id": trace_id,
            "span_id": root_id,
            "parent": "",
            "name": "main",
            "kind": SPAN_KINDS["internal"],
            "start": now_ns,
            "end": now_ns + 300 * 10**6,
            "events": [
                {"name": name, "time": now_ns + (i + 1) * 10**6, "key": key, "value": value}
                for i, (name, key, value) in enumerate(EVENTS)
            ],
        }
    ]
    for label, kind in SPAN_KINDS.items():
        spans.append(
            {
                "trace_id": trace_id,
                "span_id": uuid.uuid4().hex[:16],
                "parent": root_id,
                "name": f"child-{label}",
                "kind": kind,
                "start": now_ns + 10**6,
                "end": now_ns + 2 * 10**6,
                "events": [],
            }
        )
    return spans


def _json_body(spans: list[dict]) -> dict:
    def to_otlp(span: dict) -> dict:
        return {
            "traceId": span["trace_id"],
            "spanId": span["span_id"],
            "parentSpanId": span["parent"],
            "name": span["name"],
            "kind": span["kind"],
            "startTimeUnixNano": str(span["start"]),
            "endTimeUnixNano": str(span["end"]),
            "attributes": [],
            "events": [
                {
                    "name": event["name"],
                    "timeUnixNano": str(event["time"]),
                    "attributes": [{"key": event["key"], "value": {"stringValue": event["value"]}}],
                }
                for event in span["events"]
            ],
            "status": {"code": 0},
        }

    return {
        "resourceSpans": [
            {
                "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": SERVICE}}]},
                "scopeSpans": [{"scope": {"name": "pytest"}, "spans": [to_otlp(s) for s in spans]}],
            }
        ]
    }


def _protobuf_body(spans: list[dict]) -> bytes:
    def to_otlp(span: dict) -> trace_pb2.Span:
        return trace_pb2.Span(
            trace_id=bytes.fromhex(span["trace_id"]),
            span_id=bytes.fromhex(span["span_id"]),
            parent_span_id=bytes.fromhex(span["parent"]),
            name=span["name"],
            kind=span["kind"],
            start_time_unix_nano=span["start"],
            end_time_unix_nano=span["end"],
            events=[
                trace_pb2.Span.Event(
                    name=event["name"],
                    time_unix_nano=event["time"],
                    attributes=[
                        common_pb2.KeyValue(key=event["key"], value=common_pb2.AnyValue(string_value=event["value"]))
                    ],
                )
                for event in span["events"]
            ],
        )

    request = trace_service_pb2.ExportTraceServiceRequest(
        resource_spans=[
            trace_pb2.ResourceSpans(
                resource=resource_pb2.Resource(
                    attributes=[
                        common_pb2.KeyValue(key="service.name", value=common_pb2.AnyValue(string_value=SERVICE))
                    ]
                ),
                scope_spans=[trace_pb2.ScopeSpans(spans=[to_otlp(s) for s in spans])],
            )
        ]
    )
    return request.SerializeToString()


@pytest.fixture(params=["json", "protobuf"])
def ingested_trace(request, client):
    stream = f"regression_2693_{request.param}_{uuid.uuid4().hex[:8]}"
    trace_id = uuid.uuid4().hex
    spans = _spans(trace_id)
    if request.param == "json":
        resp = client.post("v1/traces", json=_json_body(spans), headers={"stream-name": stream})
    else:
        resp = client.otlp.traces_protobuf(_protobuf_body(spans), stream=stream)
    assert resp.status_code == 200, f"{request.param} ingest failed: {resp.status_code} {resp.text[:300]}"

    rows = wait_until(
        lambda: found if len(found := _span_rows(client, stream, trace_id)) == len(spans) else None,
        timeout=60,
        interval=2,
        msg=f"{len(spans)} spans in {stream}",
    )
    yield {row["operation_name"]: row for row in rows}
    client.delete(f"streams/{stream}?type=traces")


def test_span_kind_is_stored_as_sent(ingested_trace):
    """Each span keeps the OTLP kind it was sent with, so INTERNAL is never stored as SERVER."""
    stored = {name: str(row["span_kind"]) for name, row in ingested_trace.items()}
    assert stored["main"] == str(SPAN_KINDS["internal"]), f"Bug #2693: root INTERNAL span stored as {stored['main']}"
    for label, kind in SPAN_KINDS.items():
        assert stored[f"child-{label}"] == str(kind), f"{label} span stored as {stored[f'child-{label}']}"


def test_each_event_keeps_only_its_own_attributes(ingested_trace):
    """Attributes of an earlier event must not leak into the events after it."""
    stored_events = ingested_trace["main"]["events"]
    events = json.loads(stored_events) if isinstance(stored_events, str) else stored_events

    assert [event["name"] for event in events] == [name for name, _, _ in EVENTS]
    all_keys = {key for _, key, _ in EVENTS}
    for event, (name, key, value) in zip(events, EVENTS, strict=True):
        assert event[key] == value, f"{name} lost its own attribute: {event}"
        leaked = (all_keys - {key}) & set(event)
        assert not leaked, f"Bug #2693: {name} carries attributes of other events: {sorted(leaked)}"

"""OTLP/HTTP protobuf log ingestion with invalid UTF-8 in string fields.

Covers the fix in #14787. `prost` validates UTF-8 on every protobuf `string`
field and fails the whole message, so a single log record carrying non-UTF-8
bytes used to 400 the entire OTLP batch — and the OpenTelemetry Collector
treats 400 as permanent and drops every record in it. The Go `pdata` encoder
does not validate on marshal, so such records are produced routinely
(Windows-1252 text, binary blobs, a log line split mid-multibyte-character).

The server now retries the decode once after replacing invalid UTF-8 inside
known string fields with ASCII `?`. Two properties carry the design and both
are asserted here at the HTTP boundary:

- **length-preserving** — one `?` per bad byte, so surrounding text survives
  byte-for-byte;
- **schema-aware** — `bytes` fields (`trace_id`, `span_id`, `bytes_value`) and
  unknown field numbers are never rewritten.

The PR records "a handler-level test" as a known gap: its 15 unit tests call
the sanitizer directly and never cross the HTTP handler. That gap is what this
module closes, so every case here goes through POST /api/{org}/v1/logs and
reads the result back out of the stream.
"""
from __future__ import annotations

import json
import time

import pytest

from support import otlp_proto as otlp
from support.client import OpenObserveClient
from support.wait import wait_until

SEARCH_WINDOW_MINUTES = 5
INGEST_TIMEOUT = 60.0

# 16- and 8-byte ids that are not valid UTF-8; a blind byte walk would corrupt them.
TRACE_ID = bytes.fromhex("ff112233445566778899aabbccddeeff")
SPAN_ID = bytes.fromhex("fedcba9876543210")

# Each case is (raw string-field bytes, what the repaired field must read as).
# One `?` per invalid byte — the whole point of replacing with ASCII rather
# than U+FFFD, which is 3 bytes and would force re-encoding the payload.
POISONED_STRINGS = [
    pytest.param(b"latin1 caf\xe9 latte", "latin1 caf? latte", id="latin1_high_byte"),
    pytest.param(b"cp1252 \x93quoted\x94 text", "cp1252 ?quoted? text", id="cp1252_smart_quotes"),
    pytest.param(b"binary \x80\x81\x82 blob", "binary ??? blob", id="bare_continuation_bytes"),
    pytest.param(b"\xff\xfe leading", "?? leading", id="invalid_at_start"),
    pytest.param(b"trailing \xc3", "trailing ?", id="truncated_two_byte_tail"),
    pytest.param("split 日本".encode() + "語".encode()[:2], "split 日本??", id="split_multibyte_char"),
]

# Framing prost rejects for reasons the sanitizer cannot repair — the original
# 400 must survive rather than turn into a 200 on a half-rewritten buffer.
UNREPAIRABLE_PAYLOADS = [
    pytest.param(b"\x08", id="varint_tag_with_no_value"),
    pytest.param(otlp.tag(1, otlp.WIRE_LEN) + otlp.varint(100) + b"short", id="length_overruns_buffer"),
    pytest.param(otlp.tag(1, 3), id="group_wire_type"),
    pytest.param(otlp.tag(1, otlp.WIRE_LEN) + b"\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff", id="varint_overflows_64_bits"),
]


def now_nanos() -> int:
    return int(time.time() * 1_000_000_000)


def record(body: bytes, **kw) -> bytes:
    """A LogRecord stamped now, so it lands inside the search window."""
    return otlp.log_record(time_unix_nano=now_nanos(), body=otlp.any_string(body), **kw)


def send(client: OpenObserveClient, stream: str, payload: bytes):
    return client.otlp.logs_protobuf(payload, stream=stream)


def ingest(client: OpenObserveClient, stream: str, payload: bytes) -> None:
    """POST an OTLP batch and require the whole batch to be accepted."""
    resp = send(client, stream, payload)
    assert resp.status_code == 200, \
        f"OTLP batch rejected with {resp.status_code}: {resp.text[:500]}"


def hits(client: OpenObserveClient, stream: str, *, expected: int = 1) -> list[dict]:
    """Poll the stream until `expected` records are queryable."""
    def query():
        found = client.search.hits(
            f'SELECT * FROM "{stream}" ORDER BY _timestamp ASC',
            minutes=SEARCH_WINDOW_MINUTES,
            size=max(expected * 2, 10),
        )
        return found if len(found) >= expected else None

    return wait_until(
        query,
        timeout=INGEST_TIMEOUT,
        msg=f"{expected} record(s) queryable in {stream}",
    )


def only_hit(client: OpenObserveClient, stream: str) -> dict:
    return hits(client, stream, expected=1)[0]


# ----- the batch survives one poisoned record -----


def test_otlp_protobuf_valid_batch_is_ingested(
    client: OpenObserveClient, temp_stream_name: str
):
    """Baseline: a clean hand-built protobuf batch still ingests unchanged."""
    payload = otlp.simple_logs_request([record(b"clean protobuf body")])

    ingest(client, temp_stream_name, payload)

    assert only_hit(client, temp_stream_name)["body"] == "clean protobuf body"


@pytest.mark.parametrize(("raw", "repaired"), POISONED_STRINGS)
def test_otlp_protobuf_invalid_utf8_body_is_repaired_not_rejected(
    client: OpenObserveClient, temp_stream_name: str, raw: bytes, repaired: str
):
    """A log body holding non-UTF-8 bytes ingests, with one `?` per bad byte."""
    payload = otlp.simple_logs_request([record(raw)])

    ingest(client, temp_stream_name, payload)

    assert only_hit(client, temp_stream_name)["body"] == repaired


def test_otlp_protobuf_one_poisoned_record_does_not_drop_the_batch(
    client: OpenObserveClient, temp_stream_name: str
):
    """The regression itself: the clean records around a poisoned one must land.

    Before the fix this returned 400 and the Collector dropped all three.
    """
    payload = otlp.simple_logs_request([
        record(b"first clean record"),
        record(b"poisoned \xe9 record"),
        record(b"third clean record"),
    ])

    ingest(client, temp_stream_name, payload)

    bodies = [h["body"] for h in hits(client, temp_stream_name, expected=3)]
    assert sorted(bodies) == sorted([
        "first clean record",
        "poisoned ? record",
        "third clean record",
    ])


def test_otlp_protobuf_repairs_a_large_mixed_batch(
    client: OpenObserveClient, temp_stream_name: str
):
    """Failure probability tracked batch size in production; a 50-record batch
    with 10 poisoned records must land all 50."""
    records = [
        record(f"record {i} ".encode() + (b"\xe9" if i % 5 == 0 else b"ok"))
        for i in range(50)
    ]

    ingest(client, temp_stream_name, otlp.simple_logs_request(records))

    found = hits(client, temp_stream_name, expected=50)
    assert len(found) == 50, f"expected all 50 records, got {len(found)}"
    assert sum(1 for h in found if h["body"].endswith("?")) == 10


# ----- every string position in the OTLP log schema -----


def test_otlp_protobuf_invalid_utf8_in_attribute_key_and_value_is_repaired(
    client: OpenObserveClient, temp_stream_name: str
):
    """Both halves of a KeyValue are `string` fields and both get sanitized.

    The key is matched by prefix, not by its exact spelling: OO normalizes
    attribute keys after the repair, so the `?` the sanitizer wrote becomes
    `_` in the column name. The value keeps the `?` verbatim.
    """
    attr = otlp.key_value(b"bad_key_\xe9", otlp.any_string(b"bad_value_\xe9"))
    payload = otlp.simple_logs_request([record(b"attr case", attributes=[attr])])

    ingest(client, temp_stream_name, payload)

    hit = only_hit(client, temp_stream_name)
    keys = [k for k in hit if k.startswith("bad_key_")]
    assert len(keys) == 1, f"expected one repaired attribute key, got {keys} in {hit}"
    assert hit[keys[0]] == "bad_value_?"


def test_otlp_protobuf_invalid_utf8_in_resource_attribute_is_repaired(
    client: OpenObserveClient, temp_stream_name: str
):
    """Resource attributes sit two message levels above the log record."""
    payload = otlp.export_logs_request([
        otlp.resource_logs(
            [otlp.scope_logs([record(b"resource attr case")])],
            resource_attributes=[
                otlp.key_value(b"service.name", otlp.any_string(b"svc \xe9 name"))
            ],
        )
    ])

    ingest(client, temp_stream_name, payload)

    assert only_hit(client, temp_stream_name)["service_name"] == "svc ? name"


def test_otlp_protobuf_invalid_utf8_in_scope_name_is_repaired(
    client: OpenObserveClient, temp_stream_name: str
):
    """InstrumentationScope.name and .version are the ScopeLogs-level strings."""
    scope = otlp.instrumentation_scope(name=b"scope \xe9 lib", version=b"v1.\xe9")
    payload = otlp.simple_logs_request([record(b"scope case")], scope=scope)

    ingest(client, temp_stream_name, payload)

    hit = only_hit(client, temp_stream_name)
    assert hit["instrumentation_library_name"] == "scope ? lib"
    assert hit["instrumentation_library_version"] == "v1.?"


def test_otlp_protobuf_invalid_utf8_in_severity_text_is_repaired(
    client: OpenObserveClient, temp_stream_name: str
):
    """severity_text is LogRecord field 3 — a string that is not the body."""
    payload = otlp.simple_logs_request([
        record(b"severity case", severity_number=9, severity_text=b"WARN\xe9")
    ])

    ingest(client, temp_stream_name, payload)

    assert only_hit(client, temp_stream_name)["severity"] == "WARN?"


def test_otlp_protobuf_nested_any_values_are_repaired(
    client: OpenObserveClient, temp_stream_name: str
):
    """AnyValue recurses through ArrayValue and KeyValueList; the walk must too.

    A string four message levels below the log record — KeyValue → AnyValue →
    KeyValueList → KeyValue → AnyValue → ArrayValue → AnyValue — is still a
    `string` field, and the walk has to descend all of it to find it.
    """
    leaf = otlp.any_string(b"nested \xe9 leaf")
    nested = otlp.any_kvlist([(b"inner", otlp.any_array([leaf]))])
    payload = otlp.simple_logs_request([
        record(b"nested case", attributes=[otlp.key_value(b"meta", nested)])
    ])

    ingest(client, temp_stream_name, payload)

    hit = only_hit(client, temp_stream_name)
    assert hit["meta_inner"] == '["nested ? leaf"]', f"nested leaf not repaired in {hit}"


def test_otlp_protobuf_repairs_every_string_position_at_once(
    client: OpenObserveClient, temp_stream_name: str
):
    """One batch poisoned at resource, scope, record and attribute level."""
    scope = otlp.instrumentation_scope(name=b"scope\xe9")
    log = record(
        b"body\xe9",
        severity_text=b"ERROR\xe9",
        attributes=[otlp.key_value(b"attr\xe9", otlp.any_string(b"value\xe9"))],
    )
    payload = otlp.export_logs_request([
        otlp.resource_logs(
            [otlp.scope_logs([log], scope=scope)],
            resource_attributes=[
                otlp.key_value(b"service.name", otlp.any_string(b"svc\xe9"))
            ],
        )
    ])

    ingest(client, temp_stream_name, payload)

    hit = only_hit(client, temp_stream_name)
    assert hit["body"] == "body?"
    assert hit["severity"] == "ERROR?"
    assert hit["instrumentation_library_name"] == "scope?"
    assert hit["service_name"] == "svc?"
    attr_keys = [k for k in hit if k.startswith("attr")]
    assert len(attr_keys) == 1, f"expected one repaired attribute key, got {attr_keys}"
    assert hit[attr_keys[0]] == "value?"


# ----- bytes fields and unknown fields must survive untouched -----


def test_otlp_protobuf_trace_id_and_span_id_survive_the_repair(
    client: OpenObserveClient, temp_stream_name: str
):
    """trace_id/span_id share wire type 2 with `string`, so a blind walk would
    rewrite them. They must come back byte-identical while the body is repaired."""
    payload = otlp.simple_logs_request([
        record(b"ids \xe9 case", trace_id=TRACE_ID, span_id=SPAN_ID)
    ])

    ingest(client, temp_stream_name, payload)

    hit = only_hit(client, temp_stream_name)
    assert hit["body"] == "ids ? case", "the record was supposed to need a repair"
    assert hit["trace_id"] == TRACE_ID.hex()
    assert hit["span_id"] == SPAN_ID.hex()


def test_otlp_protobuf_bytes_attribute_value_survives_the_repair(
    client: OpenObserveClient, temp_stream_name: str
):
    """AnyValue.bytes_value is field 7 — not a string, never sanitized."""
    blob = b"\xff\xfe\x00\x01"
    payload = otlp.simple_logs_request([
        record(
            b"blob \xe9 case",
            attributes=[otlp.key_value(b"raw_blob", otlp.any_bytes(blob))],
        )
    ])

    ingest(client, temp_stream_name, payload)

    hit = only_hit(client, temp_stream_name)
    assert hit["body"] == "blob ? case", "the record was supposed to need a repair"
    # A sanitized blob would read [63,63,0,1] — 63 being ASCII '?'.
    assert hit["raw_blob"] == json.dumps(list(blob), separators=(",", ":"))


@pytest.mark.parametrize(
    ("unknown_field", "case"),
    [
        pytest.param(otlp.delimited(99, b"\xff\xfe"), "len_delimited", id="unknown_len_delimited"),
        pytest.param(otlp.varint_field(98, 1234), "varint", id="unknown_varint"),
        pytest.param(otlp.fixed64_field(97, 5678), "fixed64", id="unknown_fixed64"),
        pytest.param(otlp.fixed32_field(96, 91011), "fixed32", id="unknown_fixed32"),
    ],
)
def test_otlp_protobuf_unknown_fields_do_not_stop_the_repair(
    client: OpenObserveClient, temp_stream_name: str, unknown_field: bytes, case: str
):
    """Future OTLP fields are skipped by wire type, not sanitized and not fatal.

    A walk that abandoned on an unknown field would leave the payload
    unrepaired and return the old 400, so a 200 here is the real assertion.
    """
    log = record(f"unknown {case} \xe9".encode("latin-1")) + unknown_field
    payload = otlp.simple_logs_request([log])

    ingest(client, temp_stream_name, payload)

    assert only_hit(client, temp_stream_name)["body"] == f"unknown {case} ?"


# ----- payloads the sanitizer cannot rescue -----


@pytest.mark.parametrize("payload", UNREPAIRABLE_PAYLOADS)
def test_otlp_protobuf_unrepairable_payload_still_returns_400(
    client: OpenObserveClient, temp_stream_name: str, payload: bytes
):
    """Malformed framing is not a UTF-8 problem; the original 400 stands."""
    resp = send(client, temp_stream_name, payload)

    assert resp.status_code == 400, \
        f"malformed protobuf should still be 400, got {resp.status_code}: {resp.text[:300]}"


def test_otlp_protobuf_truncated_poisoned_payload_still_returns_400(
    client: OpenObserveClient, temp_stream_name: str
):
    """A payload that is both poisoned and truncated stays a 400: the retry is
    one attempt, not a licence to accept half a batch."""
    full = otlp.simple_logs_request([record(b"truncated \xe9 record")])

    resp = send(client, temp_stream_name, full[:-3])

    assert resp.status_code == 400, \
        f"truncated payload should be 400, got {resp.status_code}: {resp.text[:300]}"


# ----- neighbouring paths the fix must not have disturbed -----


def test_otlp_json_ingestion_is_unaffected(
    client: OpenObserveClient, temp_stream_name: str
):
    """The protobuf branch gained a `body.clone()`; the JSON branch did not change."""
    body = {
        "resourceLogs": [{
            "scopeLogs": [{
                "logRecords": [{
                    "timeUnixNano": str(now_nanos()),
                    "severityNumber": 9,
                    "severityText": "INFO",
                    "body": {"stringValue": "json otlp body"},
                }]
            }]
        }]
    }

    resp = client.otlp.logs_json(body, stream=temp_stream_name)
    assert resp.status_code == 200, resp.text[:300]

    assert only_hit(client, temp_stream_name)["body"] == "json otlp body"


def test_otlp_protobuf_content_type_with_charset_is_accepted(
    client: OpenObserveClient, temp_stream_name: str
):
    """Collectors append parameters to the Content-Type; the repair path is
    reached through the same prefix match as the plain header."""
    payload = otlp.simple_logs_request([record(b"charset \xe9 case")])

    resp = client.otlp.logs_protobuf(
        payload,
        stream=temp_stream_name,
        content_type="application/x-protobuf; charset=utf-8",
    )
    assert resp.status_code == 200, resp.text[:300]

    assert only_hit(client, temp_stream_name)["body"] == "charset ? case"


def test_otlp_traces_protobuf_still_rejects_invalid_utf8(
    client: OpenObserveClient, temp_stream_name: str
):
    """Documents the fix's declared scope: logs OTLP/HTTP protobuf only.

    Traces and metrics hit the identical prost strictness and were left out
    deliberately. This test is expected to fail the day that changes — which is
    the signal to extend the repair, not to delete the assertion.
    """
    span = (
        otlp.delimited(1, TRACE_ID)
        + otlp.delimited(2, SPAN_ID)
        + otlp.delimited(5, b"span \xe9 name")
        + otlp.fixed64_field(7, now_nanos())
        + otlp.fixed64_field(8, now_nanos())
    )
    scope_spans = otlp.delimited(2, span)
    payload = otlp.delimited(1, otlp.delimited(2, scope_spans))

    resp = client.otlp.traces_protobuf(payload, stream=temp_stream_name)

    assert resp.status_code == 400, \
        f"traces are outside the fix's scope and should still 400, got {resp.status_code}: {resp.text[:300]}"

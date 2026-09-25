"""Hand-rolled OTLP protobuf encoder for logs.

A generated `*_pb2` module cannot express these tests: the Python protobuf
runtime rejects non-UTF-8 on a `string` field at set time, and the whole point
here is to send exactly the payload the Go collector marshals happily — a
`string` field holding raw bytes. So the wire format is built by hand and every
string field takes `bytes`.

Field numbers below follow opentelemetry-proto v1 (logs/v1/logs.proto,
common/v1/common.proto, resource/v1/resource.proto).
"""
from __future__ import annotations

import struct

WIRE_VARINT = 0
WIRE_FIXED64 = 1
WIRE_LEN = 2
WIRE_FIXED32 = 5


# ----- primitives -----


def varint(value: int) -> bytes:
    """Base-128 varint, the encoding every protobuf tag and length uses."""
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def tag(number: int, wire: int) -> bytes:
    return varint((number << 3) | wire)


def delimited(number: int, payload: bytes) -> bytes:
    """Wire type 2 — carries `string`, `bytes` and nested messages alike."""
    return tag(number, WIRE_LEN) + varint(len(payload)) + payload


def varint_field(number: int, value: int) -> bytes:
    return tag(number, WIRE_VARINT) + varint(value)


def fixed64_field(number: int, value: int) -> bytes:
    return tag(number, WIRE_FIXED64) + struct.pack("<Q", value)


def fixed32_field(number: int, value: int) -> bytes:
    return tag(number, WIRE_FIXED32) + struct.pack("<I", value)


# ----- common.v1.AnyValue -----


def any_string(raw: bytes) -> bytes:
    return delimited(1, raw)


def any_bool(value: bool) -> bytes:
    return varint_field(2, 1 if value else 0)


def any_int(value: int) -> bytes:
    return varint_field(3, value)


def any_double(value: float) -> bytes:
    return tag(4, WIRE_FIXED64) + struct.pack("<d", value)


def any_array(values: list[bytes]) -> bytes:
    """ArrayValue.values is field 1, repeated AnyValue."""
    return delimited(5, b"".join(delimited(1, v) for v in values))


def any_kvlist(pairs: list[tuple[bytes, bytes]]) -> bytes:
    """KeyValueList.values is field 1, repeated KeyValue."""
    return delimited(6, b"".join(delimited(1, key_value(k, v)) for k, v in pairs))


def any_bytes(raw: bytes) -> bytes:
    """AnyValue.bytes_value — never sanitized, which is what the tests pin."""
    return delimited(7, raw)


def key_value(key: bytes, value: bytes) -> bytes:
    """common.v1.KeyValue: key=1 (string), value=2 (AnyValue)."""
    return delimited(1, key) + delimited(2, value)


# ----- logs.v1 -----


def log_record(
    *,
    time_unix_nano: int,
    body: bytes | None = None,
    attributes: list[bytes] | None = None,
    severity_number: int | None = None,
    severity_text: bytes | None = None,
    trace_id: bytes | None = None,
    span_id: bytes | None = None,
    flags: int | None = None,
    event_name: bytes | None = None,
) -> bytes:
    """`attributes` are pre-encoded KeyValue messages from `key_value`."""
    out = fixed64_field(1, time_unix_nano)
    if severity_number is not None:
        out += varint_field(2, severity_number)
    if severity_text is not None:
        out += delimited(3, severity_text)
    if body is not None:
        out += delimited(5, body)
    for attr in attributes or []:
        out += delimited(6, attr)
    if flags is not None:
        out += fixed32_field(8, flags)
    if trace_id is not None:
        out += delimited(9, trace_id)
    if span_id is not None:
        out += delimited(10, span_id)
    out += fixed64_field(11, time_unix_nano)
    if event_name is not None:
        out += delimited(12, event_name)
    return out


def instrumentation_scope(
    *,
    name: bytes | None = None,
    version: bytes | None = None,
    attributes: list[bytes] | None = None,
) -> bytes:
    out = b""
    if name is not None:
        out += delimited(1, name)
    if version is not None:
        out += delimited(2, version)
    for attr in attributes or []:
        out += delimited(3, attr)
    return out


def scope_logs(
    records: list[bytes],
    *,
    scope: bytes | None = None,
    schema_url: bytes | None = None,
) -> bytes:
    out = b""
    if scope is not None:
        out += delimited(1, scope)
    for record in records:
        out += delimited(2, record)
    if schema_url is not None:
        out += delimited(3, schema_url)
    return out


def resource(attributes: list[bytes]) -> bytes:
    return b"".join(delimited(1, attr) for attr in attributes)


def resource_logs(
    scopes: list[bytes],
    *,
    resource_attributes: list[bytes] | None = None,
    schema_url: bytes | None = None,
) -> bytes:
    out = b""
    if resource_attributes is not None:
        out += delimited(1, resource(resource_attributes))
    for scope in scopes:
        out += delimited(2, scope)
    if schema_url is not None:
        out += delimited(3, schema_url)
    return out


def export_logs_request(resource_logs_list: list[bytes]) -> bytes:
    return b"".join(delimited(1, rl) for rl in resource_logs_list)


def simple_logs_request(records: list[bytes], **kw) -> bytes:
    """One ResourceLogs holding one ScopeLogs holding `records`."""
    scope = kw.pop("scope", None)
    return export_logs_request(
        [resource_logs([scope_logs(records, scope=scope)], **kw)]
    )

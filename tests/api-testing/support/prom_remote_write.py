"""Prometheus remote-write request builders: protobuf WriteRequest and literal-only snappy, no extra dependencies."""
from __future__ import annotations

import struct

import requests

from .client import OpenObserveClient


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _field(number: int, wire_type: int, payload: bytes) -> bytes:
    key = _varint((number << 3) | wire_type)
    if wire_type == 2:
        return key + _varint(len(payload)) + payload
    return key + payload


def _zigzag(n: int) -> int:
    return (n << 1) ^ (n >> 63)


def exemplar(value: float, ms: int, labels: dict[str, str] | None = None) -> bytes:
    """A prometheus.Exemplar message."""
    body = b"".join(
        _field(1, 2, _field(1, 2, k.encode()) + _field(2, 2, v.encode())) for k, v in sorted((labels or {}).items())
    )
    return body + _field(2, 1, struct.pack("<d", value)) + _field(3, 0, _varint(ms))


def native_histogram(count: int, total: float, ms: int, bucket_counts: list[int]) -> bytes:
    """A schema-0 integer prometheus.Histogram whose positive buckets start at index 0."""
    deltas, prev = b"", 0
    for c in bucket_counts:
        deltas += _varint(_zigzag(c - prev))
        prev = c
    span = _field(1, 0, _varint(0)) + _field(2, 0, _varint(len(bucket_counts)))
    return (
        _field(1, 0, _varint(count))
        + _field(3, 1, struct.pack("<d", total))
        + _field(11, 2, span)
        + _field(12, 2, deltas)
        + _field(15, 0, _varint(ms))
    )


def timeseries(
    labels: dict[str, str],
    samples: list[tuple[int, float]] = (),
    exemplars: list[bytes] = (),
    histograms: list[bytes] = (),
) -> bytes:
    """One prometheus.TimeSeries; `exemplars`/`histograms` are encoded messages from the builders above."""
    ts = b""
    for name, value in sorted(labels.items()):
        ts += _field(1, 2, _field(1, 2, name.encode()) + _field(2, 2, value.encode()))
    for ms, value in samples:
        ts += _field(2, 2, _field(1, 1, struct.pack("<d", value)) + _field(2, 0, _varint(ms)))
    for ex in exemplars:
        ts += _field(3, 2, ex)
    for h in histograms:
        ts += _field(4, 2, h)
    return _field(1, 2, ts)


def write_request(series: list[tuple[dict[str, str], list[tuple[int, float]]]]) -> bytes:
    """A prometheus.WriteRequest: `series` is [(labels dict, [(ms, value)])]."""
    return b"".join(timeseries(labels, samples) for labels, samples in series)


def snappy(data: bytes) -> bytes:
    """Snappy block format made of literals only, which every decoder accepts."""
    out = bytearray(_varint(len(data)))
    for start in range(0, len(data), 65536):
        chunk = data[start:start + 65536]
        n = len(chunk) - 1
        if n < 60:
            out.append(n << 2)
        else:
            out += bytes([61 << 2]) + struct.pack("<H", n)
        out += chunk
    return bytes(out)


HEADERS = {
    "Content-Type": "application/x-protobuf",
    "Content-Encoding": "snappy",
    "X-Prometheus-Remote-Write-Version": "0.1.0",
}


def remote_write(
    client: OpenObserveClient, series: list[tuple[dict[str, str], list[tuple[int, float]]]], org: str | None = None
) -> requests.Response:
    """POST one remote-write request and return the raw response."""
    return client.post("prometheus/api/v1/write", data=snappy(write_request(series)), headers=HEADERS, org=org)

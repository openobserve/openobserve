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


def write_request(series: list[tuple[dict[str, str], list[tuple[int, float]]]]) -> bytes:
    """A prometheus.WriteRequest: `series` is [(labels dict, [(ms, value)])]."""
    body = b""
    for labels, samples in series:
        ts = b""
        for name, value in sorted(labels.items()):
            ts += _field(1, 2, _field(1, 2, name.encode()) + _field(2, 2, value.encode()))
        for ms, value in samples:
            sample = _field(1, 1, struct.pack("<d", value)) + _field(2, 0, _varint(ms))
            ts += _field(2, 2, sample)
        body += _field(1, 2, ts)
    return body


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

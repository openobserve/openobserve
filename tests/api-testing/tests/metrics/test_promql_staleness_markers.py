"""Prometheus staleness markers end a series at once (Metrics v2, spec section 8).

Prometheus remote-writes a special NaN (bits 0x7ff0000000000002) when a target or
series disappears. OpenObserve stores it as a NULL-value row and PromQL stops
returning the series from the marker on, instead of holding the last value for
the 5-minute lookback.

The marker goes in a second request: a stream gets its `value` column from real
samples, and a marker for a stream without one is dropped.
"""
import struct
import time
import uuid

import pytest

from support.wait import wait_until

STALE_NAN = struct.unpack("<d", struct.pack("<Q", 0x7FF0000000000002))[0]
SPACING_SEC = 15


def _varint(n):
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _field(number, wire_type, payload):
    key = _varint((number << 3) | wire_type)
    if wire_type == 2:
        return key + _varint(len(payload)) + payload
    return key + payload


def _write_request(series):
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


def _snappy(data):
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


def _remote_write(session, base_url, org_id, series):
    r = session.post(
        f"{base_url}api/{org_id}/prometheus/api/v1/write",
        data=_snappy(_write_request(series)),
        headers={"Content-Type": "application/x-protobuf", "Content-Encoding": "snappy",
                 "X-Prometheus-Remote-Write-Version": "0.1.0"},
    )
    assert r.status_code in (200, 204), f"remote write failed: {r.status_code} {r.text[:300]}"


@pytest.fixture(scope="module")
def stale_metric(create_session, base_url, org_id):
    """`a` samples t0..t5 then is marked stale at t6; `b` keeps sampling to t20."""
    session = create_session
    metric = f"pytest_stale_{uuid.uuid4().hex[:8]}"
    t0 = (int(time.time()) // 60) * 60 - 30 * 60
    at = [t0 + i * SPACING_SEC for i in range(21)]

    def labels(instance):
        return {"__name__": metric, "job": "pytest", "instance": instance}

    _remote_write(session, base_url, org_id, [
        (labels("a"), [(t * 1000, float(i)) for i, t in enumerate(at[:6])]),
        (labels("b"), [(t * 1000, float(i)) for i, t in enumerate(at)]),
    ])

    def visible():
        q = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query",
                        params={"query": f"count({metric})", "time": str(at[5])})
        result = q.json().get("data", {}).get("result", []) if q.status_code == 200 else []
        return bool(result) and float(result[0]["value"][1]) == 2

    wait_until(visible, timeout=120, interval=2, msg=f"{metric} never became queryable")
    _remote_write(session, base_url, org_id, [(labels("a"), [(at[6] * 1000, STALE_NAN)])])
    yield metric, at
    session.delete(f"{base_url}api/{org_id}/streams/{metric}?type=metrics")


def _range(session, base_url, org_id, query, start, end):
    q = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query_range",
                    params={"query": query, "start": str(start), "end": str(end),
                            "step": str(SPACING_SEC)})
    assert q.status_code == 200, f"range query failed: {q.status_code} {q.text[:300]}"
    return q.json()["data"]["result"]


def test_stale_marker_ends_the_series(create_session, base_url, org_id, stale_metric):
    metric, at = stale_metric

    def instance_a_ends():
        result = _range(create_session, base_url, org_id, metric, at[0], at[20])
        series = {s["metric"]["instance"]: [int(float(v[0])) for v in s["values"]] for s in result}
        return series if series.get("a") and max(series["a"]) < at[6] else None

    series = wait_until(instance_a_ends, timeout=120, interval=2,
                        msg="series a still has values after its stale marker")
    # without the marker `a` would hold its t5 value until t5 + 5m
    assert max(series["a"]) == at[5]
    assert max(series["b"]) == at[20]


def test_count_drops_at_the_marker(create_session, base_url, org_id, stale_metric):
    metric, at = stale_metric

    def counts_after_marker():
        result = _range(create_session, base_url, org_id, f"count({metric})", at[4], at[8])
        counts = {int(float(t)): float(v) for t, v in result[0]["values"]} if result else {}
        return counts if counts.get(at[6]) == 1 else None

    counts = wait_until(counts_after_marker, timeout=120, interval=2, msg="count never dropped at the marker")
    assert counts[at[5]] == 2
    assert counts[at[6]] == 1
    assert counts[at[8]] == 1


def test_range_functions_ignore_the_marker(create_session, base_url, org_id, stale_metric):
    metric, at = stale_metric
    q = create_session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query",
                           params={"query": f'count_over_time({metric}{{instance="a"}}[10m])',
                                   "time": str(at[8])})
    assert q.status_code == 200, f"instant query failed: {q.status_code} {q.text[:300]}"
    assert float(q.json()["data"]["result"][0]["value"][1]) == 6, "the marker must not count as a sample"

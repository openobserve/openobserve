"""An OTLP Sum that can go down is stored as a gauge, not a counter  [regression #14675].

OTLP marks a Sum that can decrease (an UpDownCounter, such as the collector's
`system.memory.usage`) with `isMonotonic: false`. It was stored with the
`counter` type, so the metrics UI showed it in per-second units (GB/s) and
charted `rate()` over it. The stored type is what `/prometheus/api/v1/metadata`
and the stream's `metrics_meta` report.

A monotonic Sum in the same payload must still be a counter, so a build that
stores every Sum as a gauge cannot pass either.
"""

import time
import uuid

import pytest

from support.wait import wait_until


@pytest.fixture(scope="module")
def sum_names(create_session, base_url, org_id):
    """Two OTLP Sums in bytes, one that can go down and one that cannot, ingested together."""
    session = create_session
    up_down = f"pytest_sum_updown_{uuid.uuid4().hex[:6]}"
    monotonic = f"pytest_sum_monotonic_{uuid.uuid4().hex[:6]}"
    now_ns = int(time.time() * 1e9) - 120 * 10**9

    def sum_metric(name, is_monotonic):
        return {
            "name": name,
            "unit": "By",
            "sum": {
                "aggregationTemporality": 2,
                "isMonotonic": is_monotonic,
                "dataPoints": [
                    {
                        "startTimeUnixNano": str(now_ns - 60 * 10**9),
                        "timeUnixNano": str(now_ns),
                        "asDouble": 8.0e9,
                    }
                ],
            },
        }

    payload = {
        "resourceMetrics": [
            {
                "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "pytest_sum_type"}}]},
                "scopeMetrics": [
                    {
                        "scope": {"name": "pytest"},
                        "metrics": [sum_metric(up_down, False), sum_metric(monotonic, True)],
                    }
                ],
            }
        ]
    }

    resp = session.post(f"{base_url}api/{org_id}/v1/metrics", json=payload)
    assert resp.status_code == 200, f"OTLP metrics ingest failed: {resp.status_code} {resp.text[:400]}"

    def stored_type(name):
        r = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/metadata", params={"metric": name})
        entries = r.json().get("data", {}).get(name, []) if r.status_code == 200 else []
        return entries[0].get("type") if entries else None

    wait_until(
        lambda: stored_type(up_down) and stored_type(monotonic),
        timeout=120,
        interval=2,
        msg="the metadata of the two sums never appeared",
    )
    yield up_down, monotonic, stored_type
    for name in (up_down, monotonic):
        session.delete(f"{base_url}api/{org_id}/streams/{name}?type=metrics")


def test_sum_that_can_go_down_is_a_gauge(sum_names):
    up_down, _monotonic, stored_type = sum_names
    assert stored_type(up_down) == "gauge", f"{up_down} has isMonotonic false and must be a gauge"


def test_monotonic_sum_stays_a_counter(sum_names):
    """Control: a Sum that only goes up keeps the counter type."""
    _up_down, monotonic, stored_type = sum_names
    assert stored_type(monotonic) == "counter", f"{monotonic} has isMonotonic true and must stay a counter"


def test_stream_metrics_meta_has_the_same_type(create_session, base_url, org_id, sum_names):
    """The UI reads `metrics_meta.metric_type` to pick units and default queries."""
    up_down, monotonic, _stored_type = sum_names
    for name, expected in ((up_down, "gauge"), (monotonic, "counter")):
        r = create_session.get(f"{base_url}api/{org_id}/streams/{name}/schema", params={"type": "metrics"})
        assert r.status_code == 200, f"{name}: {r.status_code} {r.text[:300]}"
        stored = ((r.json().get("metrics_meta") or {}).get("metric_type") or "").lower()
        assert stored == expected, f"{name}: metrics_meta.metric_type is {stored!r}, expected {expected}"

"""An OTLP Sum that can go down is stored as a gauge, not a counter  [regression #14675].

OTLP marks a Sum that can decrease (an UpDownCounter, such as the collector's
`system.memory.usage`) with `isMonotonic: false`. It was stored with the
`counter` type, so the metrics UI showed it in per-second units (GB/s) and
charted `rate()` over it. The stored type is what `/prometheus/api/v1/metadata`
and the stream's `metrics_meta` report.

A monotonic Sum in the same payload must still be a counter, so a build that
stores every Sum as a gauge cannot pass either.

A stream created before the fix keeps its stored `counter`; the next Sum that
can go down corrects it to `gauge`, and nothing ever turns a gauge back.
"""

import time
import uuid

import pytest

from support.wait import wait_until


def _otlp_sums(session, base_url, org_id, sums):
    """Ingest one OTLP/JSON request carrying a byte Sum per `(name, is_monotonic)`."""
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
                        "metrics": [sum_metric(name, is_monotonic) for name, is_monotonic in sums],
                    }
                ],
            }
        ]
    }

    resp = session.post(f"{base_url}api/{org_id}/v1/metrics", json=payload)
    assert resp.status_code == 200, f"OTLP metrics ingest failed: {resp.status_code} {resp.text[:400]}"


def _stored_type(session, base_url, org_id, name):
    r = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/metadata", params={"metric": name})
    entries = r.json().get("data", {}).get(name, []) if r.status_code == 200 else []
    return entries[0].get("type") if entries else None


@pytest.fixture(scope="module")
def sum_names(create_session, base_url, org_id):
    """Two OTLP Sums in bytes, one that can go down and one that cannot, ingested together."""
    session = create_session
    up_down = f"pytest_sum_updown_{uuid.uuid4().hex[:6]}"
    monotonic = f"pytest_sum_monotonic_{uuid.uuid4().hex[:6]}"
    _otlp_sums(session, base_url, org_id, [(up_down, False), (monotonic, True)])

    def stored_type(name):
        return _stored_type(session, base_url, org_id, name)

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


@pytest.fixture(scope="module")
def legacy_streams(create_session, base_url, org_id):
    """A stream stored as a counter, as before the fix, and a control stored as a gauge."""
    session = create_session
    as_counter = f"pytest_sum_legacy_counter_{uuid.uuid4().hex[:6]}"
    as_gauge = f"pytest_sum_legacy_gauge_{uuid.uuid4().hex[:6]}"
    now_ms = int(time.time() * 1000) - 300 * 1000
    payload = [
        {"__name__": name, "__type__": metric_type, "_timestamp": now_ms, "value": 1.0}
        for name, metric_type in ((as_counter, "counter"), (as_gauge, "gauge"))
    ]
    resp = session.post(f"{base_url}api/{org_id}/ingest/metrics/_json", json=payload)
    assert resp.status_code == 200, f"metrics ingest failed: {resp.status_code} {resp.text[:400]}"

    def stored_type(name):
        return _stored_type(session, base_url, org_id, name)

    wait_until(
        lambda: stored_type(as_counter) == "counter" and stored_type(as_gauge) == "gauge",
        timeout=120,
        interval=2,
        msg="the legacy streams never reported their seeded types",
    )
    yield as_counter, as_gauge, stored_type
    for name in (as_counter, as_gauge):
        session.delete(f"{base_url}api/{org_id}/streams/{name}?type=metrics")


def test_legacy_counter_is_corrected_by_a_sum_that_can_go_down(create_session, base_url, org_id, legacy_streams):
    """A stream stored as a counter becomes a gauge on the next Sum with isMonotonic false."""
    as_counter, as_gauge, stored_type = legacy_streams
    _otlp_sums(create_session, base_url, org_id, [(as_counter, False), (as_gauge, True)])
    wait_until(
        lambda: stored_type(as_counter) == "gauge",
        timeout=120,
        interval=2,
        msg=f"{as_counter} kept its stored counter type after a Sum with isMonotonic false",
    )
    assert stored_type(as_gauge) == "gauge", f"{as_gauge}: a monotonic Sum must not turn a stored gauge into a counter"

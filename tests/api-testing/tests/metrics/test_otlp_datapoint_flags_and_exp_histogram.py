"""OTLP data-point flags and exponential histograms  [#14637, #14634].

#14637 (PR #14727): bit 0 of `flags` is NO_RECORDED_VALUE -- the point marks a
gap, e.g. a Prometheus staleness marker translated by the Collector. It was
turned into a label and the point's value stored as if it were real data, so
gaps became readings.

#14634 (PR #14724): exponential histograms were flattened into classic buckets
incorrectly -- each bucket carried its own count rather than the cumulative
count, `zero_count` was never written so zero-bucket observations were lost, and
there was no `le="inf"` bucket, which makes `histogram_quantile` return NaN.
All three are asserted separately because each fails on its own.
"""

import time
import uuid

import pytest

from support.wait import wait_until


@pytest.fixture(scope="module")
def flagged_metric(create_session, base_url, org_id):
    """One point flagged NO_RECORDED_VALUE, one clean point a second later."""
    session = create_session
    metric = f"pytest_flags_{uuid.uuid4().hex[:6]}"
    t_ns = int(time.time() * 1e9) - 180 * 10**9

    payload = {"resourceMetrics": [{
        "resource": {"attributes": [{"key": "service.name",
                                     "value": {"stringValue": "pytest_flags"}}]},
        "scopeMetrics": [{"scope": {"name": "pytest"}, "metrics": [{
            "name": metric,
            "gauge": {"dataPoints": [
                {"asDouble": 99.0, "timeUnixNano": str(t_ns), "flags": 1},
                {"asDouble": 7.0, "timeUnixNano": str(t_ns + 10**9), "flags": 0},
            ]},
        }]}],
    }]}
    r = session.post(f"{base_url}api/{org_id}/v1/metrics", json=payload)
    assert r.status_code == 200, f"OTLP ingest failed: {r.status_code} {r.text[:300]}"

    at = int(t_ns / 1e9) + 60

    def visible():
        q = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query",
                        params={"query": metric, "time": str(at)})
        return q.status_code == 200 and bool(q.json().get("data", {}).get("result"))

    wait_until(visible, timeout=120, interval=2, msg=f"{metric} never became queryable")
    return metric, at


@pytest.fixture(scope="module")
def exp_histogram(create_session, base_url, org_id):
    """An exponential histogram with a non-empty zero bucket."""
    session = create_session
    metric = f"pytest_exphist_{uuid.uuid4().hex[:6]}"
    t_ns = int(time.time() * 1e9) - 180 * 10**9
    zero_count, positive = 3, ["2", "3", "2"]      # total = 3 + 7 = 10

    payload = {"resourceMetrics": [{
        "resource": {"attributes": [{"key": "service.name",
                                     "value": {"stringValue": "pytest_exphist"}}]},
        "scopeMetrics": [{"scope": {"name": "pytest"}, "metrics": [{
            "name": metric,
            "exponentialHistogram": {"aggregationTemporality": 2, "dataPoints": [{
                "startTimeUnixNano": str(t_ns), "timeUnixNano": str(t_ns),
                "count": "10", "sum": 55.0, "scale": 0,
                "zeroCount": str(zero_count),
                "positive": {"offset": 0, "bucketCounts": positive},
            }]},
        }]}],
    }]}
    r = session.post(f"{base_url}api/{org_id}/v1/metrics", json=payload)
    assert r.status_code == 200, f"OTLP ingest failed: {r.status_code} {r.text[:300]}"

    at = int(t_ns / 1e9) + 60

    def visible():
        q = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query",
                        params={"query": f"{metric}_bucket", "time": str(at)})
        return q.status_code == 200 and bool(q.json().get("data", {}).get("result"))

    wait_until(visible, timeout=120, interval=2, msg=f"{metric}_bucket never appeared")
    return metric, at, zero_count, 10


def _buckets(session, base_url, org_id, metric, at):
    q = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query",
                    params={"query": f"{metric}_bucket", "time": str(at)})
    assert q.status_code == 200, f"bucket query failed: {q.status_code} {q.text[:300]}"
    out = {}
    for s in q.json()["data"]["result"]:
        out[s["metric"].get("le")] = float(s["value"][1])
    return out


def test_no_recorded_value_point_is_dropped(create_session, base_url, org_id, flagged_metric):
    """The flagged point marks a gap and must not be stored as a reading."""
    metric, at = flagged_metric
    q = create_session.get(f"{base_url}api/{org_id}/prometheus/api/v1/query_range",
                           params={"query": metric, "start": str(at - 600),
                                   "end": str(at), "step": "30"})
    assert q.status_code == 200, f"range query failed: {q.status_code} {q.text[:300]}"
    values = {v[1] for s in q.json()["data"]["result"] for v in s.get("values", [])}

    assert "7" in values or 7.0 in {float(v) for v in values}, \
        f"the clean point must survive, got {values}"
    assert "99" not in values and 99.0 not in {float(v) for v in values}, \
        f"a NO_RECORDED_VALUE point was stored as real data: {values}"


def test_exponential_histogram_buckets_are_cumulative(create_session, base_url, org_id, exp_histogram):
    metric, at, _zero, total = exp_histogram
    buckets = _buckets(create_session, base_url, org_id, metric, at)

    finite = sorted(((float(le), v) for le, v in buckets.items() if le not in (None, "inf", "+Inf")),
                    key=lambda p: p[0])
    counts = [v for _le, v in finite]
    assert counts == sorted(counts), \
        f"bucket counts must be cumulative (non-decreasing), got {finite}"
    assert counts[-1] == total, \
        f"the widest finite bucket must reach the total {total}, got {counts[-1]}"


def test_exponential_histogram_has_zero_and_inf_buckets(create_session, base_url, org_id, exp_histogram):
    metric, at, zero_count, total = exp_histogram
    buckets = _buckets(create_session, base_url, org_id, metric, at)

    inf = next((v for le, v in buckets.items() if le in ("inf", "+Inf")), None)
    assert inf is not None, f"an le=inf bucket must exist, got {sorted(buckets)}"
    assert inf == total, f"the inf bucket must carry the total {total}, got {inf}"

    # Zero-bucket observations were silently lost before the fix.
    assert buckets.get("0") == zero_count, \
        f"the zero bucket must carry zeroCount {zero_count}, got {buckets.get('0')}"

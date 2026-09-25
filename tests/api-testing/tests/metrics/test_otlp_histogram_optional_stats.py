"""OTLP histogram optional stats must be skipped when absent  [regression #13019].

OTLP's `HistogramDataPoint` defines `sum`, `min` and `max` as optional. The
ingestion path turned a missing optional into JSON `null` and still emitted the
`_sum` / `_min` / `_max` record, so those metrics existed with no real value.
PR #13082 skips the record entirely when the stat is absent, while `_count` and
the bucket records are always emitted.

Asserting only that `_count` exists would pass on the unfixed build, so the
contract here is the ABSENCE of `_sum` / `_min` / `_max` for a point that
carries none -- proven against a second histogram in the same payload that does
carry them, so a build emitting nothing at all cannot pass either.
"""

import time
import uuid

import pytest

from support.wait import wait_until


@pytest.fixture(scope="module")
def histogram_names(create_session, base_url, org_id):
    """Two histograms: one without sum/min/max, one with, ingested together."""
    session = create_session
    bare = f"pytest_hist_bare_{uuid.uuid4().hex[:6]}"
    full = f"pytest_hist_full_{uuid.uuid4().hex[:6]}"
    now_ns = int(time.time() * 1e9) - 120 * 10**9

    def point(with_stats):
        p = {
            "startTimeUnixNano": str(now_ns),
            "timeUnixNano": str(now_ns),
            "count": "6",
            "bucketCounts": ["2", "3", "1"],
            "explicitBounds": [1.0, 5.0],
        }
        if with_stats:
            p.update({"sum": 21.0, "min": 0.5, "max": 9.0})
        return p

    payload = {"resourceMetrics": [{
        "resource": {"attributes": [
            {"key": "service.name", "value": {"stringValue": "pytest_hist"}}]},
        "scopeMetrics": [{"scope": {"name": "pytest"}, "metrics": [
            {"name": bare, "unit": "1",
             "histogram": {"dataPoints": [point(False)], "aggregationTemporality": 2}},
            {"name": full, "unit": "1",
             "histogram": {"dataPoints": [point(True)], "aggregationTemporality": 2}},
        ]}],
    }]}

    resp = session.post(f"{base_url}api/{org_id}/v1/metrics", json=payload)
    assert resp.status_code == 200, f"OTLP metrics ingest failed: {resp.status_code} {resp.text[:400]}"

    def names():
        r = session.get(f"{base_url}api/{org_id}/prometheus/api/v1/label/__name__/values")
        return set(r.json().get("data", [])) if r.status_code == 200 else set()

    wait_until(lambda: f"{full}_sum" in names(), timeout=120, interval=2,
               msg="the control histogram's _sum never appeared")
    return bare, full, names()


def test_absent_optional_stats_emit_no_record(create_session, base_url, org_id, histogram_names):
    bare, _full, present = histogram_names
    for suffix in ("sum", "min", "max"):
        assert f"{bare}_{suffix}" not in present, \
            f"{bare}_{suffix} must not exist for a point that carries no {suffix}"


def test_count_and_buckets_survive(create_session, base_url, org_id, histogram_names):
    bare, _full, present = histogram_names
    assert f"{bare}_count" in present, f"{bare}_count must still be emitted"
    assert f"{bare}_bucket" in present, f"{bare}_bucket must still be emitted"


def test_present_optional_stats_are_still_emitted(create_session, base_url, org_id, histogram_names):
    """Control: a point that DOES carry the stats keeps its _sum/_min/_max."""
    _bare, full, present = histogram_names
    for suffix in ("sum", "min", "max"):
        assert f"{full}_{suffix}" in present, \
            f"{full}_{suffix} must exist for a point that carries {suffix}"

"""PromQL range-selector left-boundary regression (issue #14546 / PR #14547).

Prometheus 3.0 made range selectors and lookback left-open, right-closed:
`(t-range, t]`. A sample landing exactly on a window's left boundary belongs to
the previous window only. Before the fix OpenObserve kept it in both windows, so
whenever an evaluation timestamp aligned with a sample it counted one extra
sample per series — a periodic spike in any `*_over_time` graph.

This exercises that end-to-end through the real `query_range` engine: samples on
exact minute boundaries, a `[3m]` window that is an exact multiple of the 60s
spacing, and a 10s step so some eval points land on a sample and some do not. The
fixed count is alignment-independent (always 3); the bug returned 4 at the
aligned points.

Every evaluation is kept strictly interior to the ingested span: the PromQL data
loader fetches a right-open time range, so a sample sitting exactly on the query
end is not loaded. Evaluating there would under-count on any build and mask the
boundary rule under test, so the query window leaves a sample of margin on each
side.
"""
import time
import uuid

import pytest

from support.wait import wait_until

SPACING_SEC = 60          # sample interval
NUM_SAMPLES = 15          # samples at t0, t0+60, ... t0+840
RANGE_SEC = 180           # [3m] window — an exact multiple of the spacing
STEP_SEC = 10             # divides 60, so 1 in 6 eval points lands on a sample
EXPECTED_COUNT = RANGE_SEC // SPACING_SEC  # 3 samples per full window

# Evaluate strictly inside the span, aligned to a sample so aligned eval points
# exist; both ends stay clear of the first and last ingested sample.
QUERY_START_OFF = 5 * SPACING_SEC   # t0+300; left window edge lands on t0+120
QUERY_END_OFF = QUERY_START_OFF + 290  # t0+590; below the last sample (t0+840)


@pytest.fixture(scope="module")
def boundary_metric(create_session, base_url, org_id):
    """Ingest a gauge sampled exactly every 60s on minute boundaries.

    Returns (metric_name, t0_sec). Data is placed ~20 min in the past so every
    sample is queryable and inside any default retention window.
    """
    session = create_session
    metric = f"pytest_boundary_{uuid.uuid4().hex[:8]}"

    now_sec = int(time.time())
    t0_sec = (now_sec // SPACING_SEC) * SPACING_SEC - 20 * 60

    payload = [
        {
            "__name__": metric,
            "__type__": "gauge",
            "job": "pytest",
            "_timestamp": (t0_sec + i * SPACING_SEC) * 1000,  # ingest wants ms
            "value": float(i),
        }
        for i in range(NUM_SAMPLES)
    ]

    resp = session.post(f"{base_url}api/{org_id}/ingest/metrics/_json", json=payload)
    assert resp.status_code == 200, \
        f"metrics ingest failed: {resp.status_code} {resp.text[:500]}"

    # Read 30s past the last sample over a window wide enough to hold them all, so
    # every sample is strictly interior and the count is boundary-independent.
    ready_ts = t0_sec + (NUM_SAMPLES - 1) * SPACING_SEC + SPACING_SEC // 2
    ready_window = (NUM_SAMPLES + 5) * SPACING_SEC

    def all_samples_visible():
        r = session.get(
            f"{base_url}api/{org_id}/prometheus/api/v1/query",
            params={
                "query": f"count_over_time({metric}[{ready_window}s])",
                "time": str(ready_ts),
            },
        )
        if r.status_code != 200:
            return False
        result = r.json().get("data", {}).get("result", [])
        return result and float(result[0]["value"][1]) == NUM_SAMPLES

    wait_until(
        all_samples_visible,
        timeout=90,
        interval=1,
        msg=f"metric {metric} never reached {NUM_SAMPLES} samples via query API",
    )
    return metric, t0_sec


def test_count_over_time_is_alignment_independent(create_session, base_url, org_id, boundary_metric):
    """`count_over_time(m[3m])` returns a flat 3 at every step, aligned or not."""
    session = create_session
    metric, t0_sec = boundary_metric

    start_sec = t0_sec + QUERY_START_OFF
    end_sec = t0_sec + QUERY_END_OFF

    resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/query_range",
        params={
            "query": f"count_over_time({metric}[{RANGE_SEC}s])",
            "start": str(start_sec),
            "end": str(end_sec),
            "step": str(STEP_SEC),
        },
    )
    assert resp.status_code == 200, f"query_range failed: {resp.status_code} {resp.text[:500]}"

    body = resp.json()
    assert body["status"] == "success", body
    result = body["data"]["result"]
    assert len(result) == 1, f"expected exactly one series, got {len(result)}: {result}"

    values = result[0]["values"]
    assert values, "range query returned no points"

    # Every fully-covered window holds exactly EXPECTED_COUNT samples regardless
    # of alignment; a sample on the window's left boundary must NOT be counted.
    off_by_one = [(ts, v) for ts, v in values if float(v) != EXPECTED_COUNT]
    assert not off_by_one, (
        f"count_over_time({metric}[{RANGE_SEC}s]) is not alignment-independent; "
        f"points off {EXPECTED_COUNT}: {off_by_one}"
    )

    # The bug only surfaced where the eval timestamp coincided with a sample —
    # assert we actually exercised such minute-aligned points.
    aligned = [(ts, v) for ts, v in values if round(float(ts)) % SPACING_SEC == 0]
    assert aligned, "test never hit a sample-aligned eval point; alignment not exercised"
    assert all(float(v) == EXPECTED_COUNT for _, v in aligned), \
        f"sample-aligned eval points spiked (left-boundary double-count): {aligned}"

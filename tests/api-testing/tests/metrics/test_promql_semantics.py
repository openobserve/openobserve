"""PromQL result shapes the spec fixes, verified end to end.

Three regressions found by A/B testing against Thanos (openobserve#14607,
#14609, #14610, consolidated in o2-enterprise#2661):

* ``absent_over_time(missing[5m])`` returned NO series. The spec says one series
  with value 1 — which is exactly the idiom missing-data alerts are built on, so
  such an alert could never fire.
* ``scalar(v)`` returned its argument unchanged instead of reducing it, so a
  query that should yield a scalar yielded a vector.
* An instant query on a range selector or subquery returned a vector (one value
  per series) instead of a matrix (every raw sample).

A fourth group came from the same sweep: ``sort``, ``sort_desc``,
``present_over_time`` and the ``@`` modifier were reported as unimplemented and
now evaluate. They are pinned here because nothing else covers them — an
"unsupported function" error is a silent regression for a dashboard that uses
one. ``mad_over_time`` and ``double_exponential_smoothing`` are still
unimplemented and are deliberately NOT asserted.

Each assertion is on ``resultType``/series count, not on the numbers, so the
tests stay stable whatever else the instance holds.
"""
from __future__ import annotations

import logging
import time
import uuid

import pytest

from support.otlp_json import gauge, metrics_request
from support.wait import wait_until

logger = logging.getLogger(__name__)

SAMPLE_COUNT = 10
SAMPLE_INTERVAL_NANOS = 60 * 1_000_000_000


@pytest.fixture(scope="module")
def seeded_metric(client):
    """A metric with several samples over the last 10 minutes."""
    name = f"promql_sem_{uuid.uuid4().hex[:8]}"
    first = int(time.time() * 1_000_000_000) - SAMPLE_COUNT * SAMPLE_INTERVAL_NANOS
    for i in range(1, SAMPLE_COUNT + 1):
        payload = metrics_request(
            [gauge(name, float(i), time_unix_nano=first + i * SAMPLE_INTERVAL_NANOS)]
        )
        assert client.post("v1/metrics", json=payload).status_code == 200

    def queryable():
        resp = client.get("prometheus/api/v1/query", params={"query": name})
        if resp.status_code != 200:
            return False
        return bool(resp.json().get("data", {}).get("result"))

    wait_until(queryable, timeout=120, interval=3, msg=f"{name} queryable")
    return name


def _instant(client, query: str):
    resp = client.get("prometheus/api/v1/query", params={"query": query})
    assert resp.status_code == 200, resp.text
    return resp.json().get("data", {})


def test_absent_over_time_reports_a_missing_metric(client):
    """A metric that does not exist at all must produce one series, not zero."""
    missing = f"promql_absent_{uuid.uuid4().hex[:8]}"
    end = int(time.time())
    resp = client.get(
        "prometheus/api/v1/query_range",
        params={"query": f"absent_over_time({missing}[5m])", "start": end - 600, "end": end, "step": "60s"},
    )
    assert resp.status_code == 200, resp.text
    result = resp.json().get("data", {}).get("result", [])
    assert result, (
        "absent_over_time() over a wholly missing metric returned no series, so a "
        "missing-data alert written with this idiom can never fire"
    )


def test_scalar_reduces_to_a_scalar(client, seeded_metric):
    data = _instant(client, f"scalar({seeded_metric})")
    assert data.get("resultType") == "scalar", (
        f"scalar() must reduce its argument; got resultType={data.get('resultType')!r}"
    )


def test_instant_query_on_a_range_selector_returns_a_matrix(client, seeded_metric):
    data = _instant(client, f"{seeded_metric}[5m]")
    assert data.get("resultType") == "matrix", (
        f"a range selector must return every raw sample as a matrix; got "
        f"resultType={data.get('resultType')!r}"
    )


@pytest.mark.parametrize(
    "query",
    [
        "sort({metric})",
        "sort_desc({metric})",
        "present_over_time({metric}[5m])",
        "{metric} @ end()",
    ],
)
def test_previously_unsupported_functions_now_evaluate(client, seeded_metric, query):
    """Each of these used to come back as an unsupported-function error."""
    resp = client.get(
        "prometheus/api/v1/query",
        params={"query": query.format(metric=seeded_metric)},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("status") != "error", (
        f"{query.format(metric=seeded_metric)} returned an error: "
        f"{body.get('error') or body.get('message')}"
    )

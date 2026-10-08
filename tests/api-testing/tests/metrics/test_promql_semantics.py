"""PromQL result shapes and smoothing aliases, verified end to end."""
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
        "sin({metric})",
        "cos({metric})",
        "tan({metric})",
        "asin({metric})",
        "acos({metric})",
        "atan({metric})",
        "sinh({metric})",
        "cosh({metric})",
        "tanh({metric})",
        "asinh({metric})",
        "acosh({metric})",
        "atanh({metric})",
        "deg({metric})",
        "rad({metric})",
        "pi()",
        "first_over_time({metric}[5m])",
        "mad_over_time({metric}[5m])",
        "ts_of_min_over_time({metric}[5m])",
        "ts_of_max_over_time({metric}[5m])",
        "ts_of_last_over_time({metric}[5m])",
        "ts_of_first_over_time({metric}[5m])",
        "histogram_fraction(0, 1, {metric})",
        'histogram_quantiles({metric}, "q", 0.5, 0.9)',
        'sort_by_label({metric}, "__name__")',
        'sort_by_label_desc({metric}, "__name__")',
        "min_of(1, 2)",
        "max_of(1, 2)",
        "vector(1) * start()",
        "vector(1) * end()",
        "vector(1) * range()",
        "vector(1) * step()",
        "limitk(1, {metric})",
        "limit_ratio(0.5, {metric})",
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


@pytest.mark.parametrize(("endpoint", "result_type"), [("query", "vector"), ("query_range", "matrix")])
def test_smoothing_aliases_return_identical_results(client, seeded_metric, endpoint, result_type):
    end = int(time.time())
    params = {"time": end} if endpoint == "query" else {"start": end - 180, "end": end, "step": "60s"}
    results = []
    for name in ("holt_winters", "double_exponential_smoothing"):
        resp = client.get(
            f"prometheus/api/v1/{endpoint}",
            params={**params, "query": f"{name}({seeded_metric}[10m], 0.5, 0.3)"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("status") == "success", body
        data = body.get("data", {})
        assert data.get("resultType") == result_type, data
        result = data.get("result", [])
        assert result, f"{name} returned no series"
        if endpoint == "query_range":
            assert all(series.get("values") for series in result), result
        else:
            assert all(series.get("value") for series in result), result
        results.append(data)
    assert results[0] == results[1]


@pytest.mark.parametrize("name", ["holt_winters", "double_exponential_smoothing"])
@pytest.mark.parametrize("method", ["get", "post"])
def test_format_query_preserves_smoothing_name(client, name, method):
    query = f"{name}(m[5m], 0.5, 0.3)"
    request_args = {"params": {"query": query}}
    if method == "post":
        # The POST handler requires a query parameter even when the expression is in the form.
        request_args = {"params": {"query": ""}, "data": {"query": query}}
    resp = getattr(client, method)("prometheus/api/v1/format_query", **request_args)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("status") == "success", body
    assert body.get("data") == query


@pytest.mark.parametrize("name", ["holt_winters", "double_exponential_smoothing"])
@pytest.mark.parametrize("endpoint", ["query", "query_range", "format_query"])
@pytest.mark.parametrize("args", ["m[5m], 0.5", "m[5m], 0.5, 0.3, 0.1"])
def test_smoothing_arity_error_names_called_function(client, name, endpoint, args):
    end = int(time.time())
    params = {"query": f"{name}({args})", "time": end}
    if endpoint == "query_range":
        params.update({"start": end - 180, "end": end, "step": "60s"})
    resp = client.get(f"prometheus/api/v1/{endpoint}", params=params)
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body.get("status") == "error", body
    assert f"call to '{name}'" in body.get("error", ""), body

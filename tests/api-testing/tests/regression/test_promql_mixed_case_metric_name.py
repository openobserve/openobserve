"""
PromQL Mixed-Case Metric Name Regression (openobserve#13926)

With ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=false, ingestion preserves a metric
name's original case, but the PromQL WAL distributed plan sent it to
DataFusion as an unquoted SQL table name -- which DataFusion lowercases in
the Flight receiver before schema lookup. An exact mixed-case query then
returned no data even though the metric had just been ingested.

Fixed by #13937: the metric is represented as a case-preserving
TableReference::bare and its quoted form is serialized into the placeholder
physical plan.

ZO_FORMAT_STREAM_NAME_TO_LOWERCASE defaults to true, so this bug only
reproduces with it explicitly set to false -- the server must be restarted
with that env var for the case-preservation assertion below to be
meaningful. The label-values lookup makes the test self-adapting either
way: it queries whatever name the server actually stored, so it still
passes (less meaningfully) under the default lowercase-everything config.
"""

import time
import pytest


MIXED_CASE_METRIC = "MyMixedCaseMetric_13926"


def test_promql_query_returns_data_for_ingested_metric_name(create_session, base_url):
    """Ingest a mixed-case metric, then query the PromQL API using the exact
    name the server reports for it via label values. Must not come back
    empty -- that emptiness, on an unquoted exact-case query, was the bug.
    """
    session = create_session
    org_id = "default"
    now_us = int(time.time() * 1_000_000)

    payload = [
        {
            "__name__": MIXED_CASE_METRIC,
            "__type__": "gauge",
            "namespace": "regression_13926",
            "_timestamp": now_us,
            "value": 42.0,
        }
    ]
    resp = session.post(f"{base_url}api/{org_id}/ingest/metrics/_json", json=payload)
    assert resp.status_code == 200, f"metric ingest failed: {resp.status_code} {resp.text}"

    # Give the write path a moment to become searchable.
    time.sleep(2)

    # Discover the name as the server actually stored it, so this test is
    # meaningful whether ZO_FORMAT_STREAM_NAME_TO_LOWERCASE is true or false.
    labels_resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/label/__name__/values"
    )
    assert labels_resp.status_code == 200, (
        f"label values query failed: {labels_resp.status_code} {labels_resp.text}"
    )
    stored_names = labels_resp.json().get("data", [])
    matches = [n for n in stored_names if n.lower() == MIXED_CASE_METRIC.lower()]
    assert matches, (
        f"ingested metric {MIXED_CASE_METRIC!r} not found in label values at all: {stored_names}"
    )
    stored_name = matches[0]

    query_resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/query",
        params={"query": stored_name},
    )
    assert query_resp.status_code == 200, (
        f"query for stored name {stored_name!r} failed: "
        f"{query_resp.status_code} {query_resp.text}"
    )
    result = query_resp.json().get("data", {}).get("result", [])
    assert result, (
        f"query for {stored_name!r} (as reported by label values) returned no "
        f"data -- this is exactly the #13926 symptom: an exact-case query "
        f"against a mixed-case metric name returning empty"
    )


@pytest.mark.skip(
    reason=(
        "Requires the server restarted with ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=false "
        "to actually exercise case preservation; the assertion above is the "
        "env-agnostic version of this same check. Kept here, skipped, as "
        "documentation of the exact reported repro for whoever runs that config."
    )
)
def test_promql_query_preserves_exact_mixed_case_name(create_session, base_url):
    session = create_session
    org_id = "default"
    now_us = int(time.time() * 1_000_000)

    payload = [
        {
            "__name__": MIXED_CASE_METRIC,
            "__type__": "gauge",
            "namespace": "regression_13926",
            "_timestamp": now_us,
            "value": 42.0,
        }
    ]
    resp = session.post(f"{base_url}api/{org_id}/ingest/metrics/_json", json=payload)
    assert resp.status_code == 200

    time.sleep(2)

    query_resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/query",
        params={"query": MIXED_CASE_METRIC},
    )
    assert query_resp.status_code == 200
    result = query_resp.json().get("data", {}).get("result", [])
    assert result, (
        f"exact mixed-case query for {MIXED_CASE_METRIC!r} returned no data -- "
        f"reproduces #13926 under ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=false"
    )

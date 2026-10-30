"""Prometheus label metadata endpoints  [regression #14635].

Two separate defects, fixed in two PRs, and the shipped behaviour for the second
is NOT what the issue asked for:

  - #14729 made `/labels` and `/label/__name__/values` honour `start`/`end`.
    They previously returned an empty list whenever a time range was supplied,
    which is exactly what Grafana's metric browser sends, so it showed nothing.

  - #14814 made `/label/{name}/values` REJECT a request that does not identify a
    single metric, with HTTP 400 and a Prometheus `bad_data` error. The issue
    asked for these to work without `match[]` the way Prometheus does; the fix
    deliberately chose an explicit error over a cross-stream query, because
    querying across all metric streams is unsupported. A successful empty list
    was the bug: it hid that nothing had been queried.

So the asserted contract here is the error, not the values. `/labels` and
`/label/__name__/values` keep working without `match[]`.
"""
import time
import uuid

import pytest

from support.wait import wait_until

LABEL_NAME = "job"
JOB_VALUE = "pytest_label_metadata"


@pytest.fixture(scope="module")
def labelled_metric(create_session, base_url, org_id):
    """Ingest one gauge carrying a non-__name__ label, and wait for it to be queryable."""
    session = create_session
    metric = f"pytest_labels_{uuid.uuid4().hex[:8]}"
    now_sec = int(time.time())

    payload = [
        {
            "__name__": metric,
            "__type__": "gauge",
            LABEL_NAME: JOB_VALUE,
            "_timestamp": (now_sec - 60 + i) * 1000,
            "value": float(i),
        }
        for i in range(5)
    ]
    resp = session.post(f"{base_url}api/{org_id}/ingest/metrics/_json", json=payload)
    assert resp.status_code == 200, f"metrics ingest failed: {resp.status_code} {resp.text[:400]}"

    def visible():
        r = session.get(
            f"{base_url}api/{org_id}/prometheus/api/v1/label/__name__/values",
        )
        return r.status_code == 200 and metric in r.json().get("data", [])

    wait_until(visible, timeout=90, interval=1,
               msg=f"metric {metric} never appeared in /label/__name__/values")
    yield metric, now_sec
    session.delete(f"{base_url}api/{org_id}/streams/{metric}?type=metrics")


def test_labels_honours_a_time_range(create_session, base_url, org_id, labelled_metric):
    """`/labels` must return names with start/end, not the empty list it used to."""
    session = create_session
    _, now_sec = labelled_metric

    resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/labels",
        params={"start": str(now_sec - 3600), "end": str(now_sec + 60)},
    )
    assert resp.status_code == 200, f"/labels failed: {resp.status_code} {resp.text[:400]}"
    names = resp.json().get("data", [])
    assert names, "/labels returned nothing for a range that contains ingested data"
    assert LABEL_NAME in names, f"expected {LABEL_NAME!r} among label names, got {names}"


def test_name_values_honours_a_time_range(create_session, base_url, org_id, labelled_metric):
    """`/label/__name__/values` must return metric names with start/end."""
    session = create_session
    metric, now_sec = labelled_metric

    resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/label/__name__/values",
        params={"start": str(now_sec - 3600), "end": str(now_sec + 60)},
    )
    assert resp.status_code == 200, \
        f"/label/__name__/values failed: {resp.status_code} {resp.text[:400]}"
    values = resp.json().get("data", [])
    assert metric in values, \
        f"{metric} missing from /label/__name__/values over a range containing it, got {values[:20]}"


def test_label_values_without_a_metric_is_rejected(create_session, base_url, org_id, labelled_metric):
    """An unscoped label-values request must error, not answer an empty success."""
    session = create_session
    _, now_sec = labelled_metric

    resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/label/{LABEL_NAME}/values",
        params={"start": str(now_sec - 3600), "end": str(now_sec + 60)},
    )
    assert resp.status_code == 400, \
        f"unscoped label values should be rejected with 400, got {resp.status_code}: {resp.text[:400]}"
    body = resp.json()
    assert body.get("status") == "error", f"expected a Prometheus error envelope, got {body}"
    assert "match[]" in body.get("error", ""), \
        f"the error should tell the caller match[] is required, got {body.get('error')!r}"


def test_label_values_with_a_metric_returns_values(create_session, base_url, org_id, labelled_metric):
    """Scoped by match[], the same request returns the label's values."""
    session = create_session
    metric, now_sec = labelled_metric

    resp = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/label/{LABEL_NAME}/values",
        params={
            "match[]": metric,
            "start": str(now_sec - 3600),
            "end": str(now_sec + 60),
        },
    )
    assert resp.status_code == 200, \
        f"scoped label values failed: {resp.status_code} {resp.text[:400]}"
    values = resp.json().get("data", [])
    assert JOB_VALUE in values, f"expected {JOB_VALUE!r} among {LABEL_NAME} values, got {values}"

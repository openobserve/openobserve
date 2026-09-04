"""Summary endpoint API tests.

Rewritten in Phase 4 of the api-tests revamp.

The ORIGINAL (634 LOC, 1 running test + 2 silently-skipped tests) tried a
full E2E lifecycle: create a new organization, ingest data, create a
pipeline + alert + template + destination + function + dashboard, verify
all of those appear in the summary counts, then delete everything.

The 2 skipped tests had a real cause: the rewrite of test_organisations.py
in Phase 4.4 already documented (via xfail) that
`DELETE /api/organizations/{id}` returns 404 unconditionally — so the
test's "delete the organization after all tests are done" teardown was
broken at the backend, leaving every CI run's resources behind. After
enough runs, leftover state would collide with the next run's create
attempts and the tests would fail.

This rewrite gives up on the per-test new-org approach and tests the
summary endpoint's CONTRACT against the conftest-default org instead:
- Shape of the response
- Counts incrementally increase when a new resource is created
- Auth requirement (no auth → not 200)
- Nonexistent org → 404

What's lost: the full lifecycle assertion that EVERY resource type
(pipeline, alert, function, dashboard) increments its own counter. That
test would need either (a) the org-delete endpoint to be fixed so we can
create+destroy a per-test org, or (b) running this against an isolated
ephemeral OO instance per run. Both are infrastructure work, not test
work. Documented in the deferred-work section of HANDOFF.md.
"""
from __future__ import annotations

import logging

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = "default"


# ----- contract -----


def test_summary_returns_expected_shape(client: OpenObserveClient):
    """GET /api/{org}/summary returns a dict with the standard count keys."""
    resp = client.get("summary")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert isinstance(body, dict), f"summary should be a dict, got {type(body).__name__}"

    # Top-level shape: at least one of the recognized count keys must be present.
    # The exact key set varies across OO versions, so we check for the union
    # of known names rather than requiring all.
    known_keys = {
        "streams", "pipelines", "alerts", "total_functions",
        "total_dashboards", "num_streams",
    }
    present = known_keys & set(body.keys())
    assert present, f"summary should contain at least one of {sorted(known_keys)}: got {list(body.keys())}"


def test_summary_streams_count_is_nonnegative_int(client: OpenObserveClient):
    """The streams sub-dict (if present) reports a non-negative num_streams int."""
    body = client.get("summary").json()
    streams_data = body.get("streams")
    if not streams_data or not isinstance(streams_data, dict):
        logger.info("test_summary_streams_count: 'streams' key absent or non-dict; skipping shape check")
        return

    num_streams = streams_data.get("num_streams")
    assert isinstance(num_streams, int), \
        f"num_streams should be int, got {type(num_streams).__name__}: {num_streams!r}"
    assert num_streams >= 0, f"num_streams should be >= 0, got {num_streams}"


def test_summary_pipelines_count_is_nonnegative_int(client: OpenObserveClient):
    """The pipelines sub-dict (if present) reports non-negative num_realtime + num_scheduled."""
    body = client.get("summary").json()
    pipelines_data = body.get("pipelines")
    if not pipelines_data or not isinstance(pipelines_data, dict):
        logger.info("test_summary_pipelines_count: 'pipelines' key absent or non-dict; skipping shape check")
        return

    for field in ("num_realtime", "num_scheduled"):
        if field in pipelines_data:
            v = pipelines_data[field]
            assert isinstance(v, int), f"pipelines.{field} should be int, got {type(v).__name__}: {v!r}"
            assert v >= 0, f"pipelines.{field} should be >= 0, got {v}"


def test_summary_alerts_count_is_nonnegative_int(client: OpenObserveClient):
    """The alerts sub-dict (if present) reports non-negative num_scheduled/num_realtime."""
    body = client.get("summary").json()
    alerts_data = body.get("alerts")
    if not alerts_data or not isinstance(alerts_data, dict):
        logger.info("test_summary_alerts_count: 'alerts' key absent or non-dict; skipping shape check")
        return

    for field in ("num_scheduled", "num_realtime"):
        if field in alerts_data:
            v = alerts_data[field]
            assert isinstance(v, int), f"alerts.{field} should be int, got {type(v).__name__}: {v!r}"
            assert v >= 0, f"alerts.{field} should be >= 0, got {v}"


# ----- behavioral: count changes when a resource is added -----


def test_summary_stream_count_increases_after_ingest(
    client: OpenObserveClient, temp_stream_name: str
):
    """After ingesting to a new stream, num_streams should increase by at least 1.

    Replaces the original "create everything and assert count == 1" pattern
    (which depended on test ordering + a fresh per-test org). Now uses a
    delta-based check that works regardless of what other streams exist.
    """
    body_before = client.get("summary").json()
    streams_before = body_before.get("streams", {}).get("num_streams", 0)

    # Ingest creates the stream as a side-effect
    resp = client.streams.ingest_json(temp_stream_name, [{"k": "v", "n": 1}])
    assert resp.status_code == 200, resp.text

    # Wait until the new stream is visible in the summary count
    def _stream_visible_in_summary() -> bool:
        body = client.get("summary").json()
        streams_after = body.get("streams", {}).get("num_streams", 0)
        return streams_after > streams_before

    wait_until(
        _stream_visible_in_summary,
        timeout=30,
        interval=0.5,
        msg=f"summary num_streams did not increase after ingesting to {temp_stream_name}",
    )


# ----- error paths -----


def test_summary_unauth_request_is_rejected(client: OpenObserveClient):
    """Removing the Authorization header should NOT yield a 200 summary."""
    # Build the URL via the client so we hit the same host/org
    url = client.url("summary")
    # Use a fresh requests Session with no auth header
    import requests
    resp = requests.get(url, timeout=10)
    assert resp.status_code != 200, \
        f"summary without auth should NOT be 200, got {resp.status_code}: {resp.text[:200]}"
    # Specifically expect 401 or 403
    assert resp.status_code in (401, 403), \
        f"summary without auth should be 401 or 403, got {resp.status_code}: {resp.text[:200]}"


def test_summary_for_nonexistent_org_returns_4xx(client: OpenObserveClient):
    """GET /api/{nonexistent_org}/summary should return a 4xx, not 200 with empty data."""
    fake_org = unique_name("nosuchorg")
    resp = client.get("summary", org=fake_org)
    # OO behavior: 404 or 401 depending on whether the auth check or the
    # org-lookup runs first. Either is acceptable as long as it's 4xx and
    # NOT 200 with a misleading "everything is zero" body.
    assert 400 <= resp.status_code < 500, \
        f"nonexistent org should yield 4xx, got {resp.status_code}: {resp.text[:200]}"

"""query_exemplars returns OTLP exemplars for plain and range selectors, including after a result-cache warm-up (#14636)."""
from __future__ import annotations

import time
import uuid

from support.otlp_json import metrics_request, now_unix_nano, string_attr
from support.wait import wait_until

TRACE_ID = "112233445566778899aabbccddeeff00"
SPAN_ID = "1122334455667788"
POINTS = 6
POINT_SPACING_NANOS = 30 * 1_000_000_000


def _ingest_gauge_with_exemplars(client, name: str) -> None:
    now = now_unix_nano()
    points = []
    for i in range(POINTS):
        t = str(now - (POINTS - 1 - i) * POINT_SPACING_NANOS)
        points.append({
            "timeUnixNano": t,
            "asDouble": 1.5 + i,
            "attributes": [string_attr("job", "exemplar-test")],
            "exemplars": [{
                "timeUnixNano": t,
                "asDouble": 1.5 + i,
                "traceId": TRACE_ID,
                "spanId": SPAN_ID,
                "filteredAttributes": [string_attr("exkey", "exval")],
            }],
        })
    payload = metrics_request([{"name": name, "gauge": {"dataPoints": points}}])
    resp = client.post("v1/metrics", json=payload)
    assert resp.status_code == 200, resp.text


def _query_exemplars(client, query: str) -> list[dict]:
    # The newest exemplar is stamped at ingest time, so a whole-second `now` would cut it off.
    end = int(time.time()) + 60
    resp = client.get(
        "prometheus/api/v1/query_exemplars",
        params={"query": query, "start": end - 900, "end": end},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("status") == "success", body
    return [ex for series in body["data"] for ex in series.get("exemplars", [])]


def _metric_name() -> str:
    return f"exemplar_{uuid.uuid4().hex[:10]}"


def test_plain_selector_returns_exemplars(client):
    """A bare metric selector must return the stored exemplars, not an empty list."""
    name = _metric_name()
    _ingest_gauge_with_exemplars(client, name)

    exemplars = wait_until(
        lambda: _query_exemplars(client, name),
        timeout=120, interval=3, msg=f"exemplars for {name}",
    )

    assert len(exemplars) == POINTS, exemplars
    labels = exemplars[0]["labels"]
    assert labels["trace_id"] == TRACE_ID, labels
    assert labels["span_id"] == SPAN_ID, labels
    assert labels["exkey"] == "exval", labels


def test_range_selector_returns_exemplars(client):
    """Exemplars under a range function stay reachable alongside the plain-selector fix."""
    name = _metric_name()
    _ingest_gauge_with_exemplars(client, name)

    exemplars = wait_until(
        lambda: _query_exemplars(client, f"rate({name}[5m])"),
        timeout=120, interval=3, msg=f"rate() exemplars for {name}",
    )
    assert all(ex["labels"]["trace_id"] == TRACE_ID for ex in exemplars), exemplars


def test_exemplars_survive_a_warm_range_query_cache(client):
    """An exemplar query after query_range on the same query must not hit that cache entry and panic."""
    name = _metric_name()
    _ingest_gauge_with_exemplars(client, name)
    wait_until(lambda: _query_exemplars(client, name), timeout=120, interval=3, msg=f"exemplars for {name}")

    end = int(time.time()) + 60
    for step in (1, 15, 30, 60):
        resp = client.get(
            "prometheus/api/v1/query_range",
            params={"query": name, "start": end - 900, "end": end, "step": step},
        )
        assert resp.status_code == 200, resp.text

    for _ in range(2):
        assert len(_query_exemplars(client, name)) == POINTS
    assert client.get("healthz", prefix="").status_code == 200

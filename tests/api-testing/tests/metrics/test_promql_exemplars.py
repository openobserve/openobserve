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


def _histogram_point(series: str, t_nanos: int, exemplar_nanos: list[int]) -> dict:
    return {
        "timeUnixNano": str(t_nanos),
        "startTimeUnixNano": str(t_nanos - 60 * 1_000_000_000),
        "count": "3",
        "sum": 6.0,
        "bucketCounts": ["1", "2", "0"],
        "explicitBounds": [1.0, 5.0],
        "attributes": [string_attr("svc", series)],
        "exemplars": [
            {"timeUnixNano": str(e), "asDouble": 2.0, "traceId": TRACE_ID, "spanId": SPAN_ID}
            for e in exemplar_nanos
        ],
    }


def test_exemplars_are_grouped_per_series_and_bounded_by_start(client):
    """ENT#2739: one `data` element per series with its own labels, and no exemplar older than `start`."""
    name = f"ovn_b_exh_{uuid.uuid4().hex[:10]}"
    sec = 1_000_000_000
    now = now_unix_nano()
    start_s = now // sec - 300
    points = []
    for series in ("alpha", "beta"):
        # Inside the window, but also carrying an exemplar stamped 25 min before `start`.
        points.append(_histogram_point(series, now - 60 * sec, [now - 60 * sec, (start_s - 1500) * sec]))
        # Before `start` yet inside the 5m lookback of an instant evaluation at `start`.
        points.append(_histogram_point(series, (start_s - 120) * sec, [(start_s - 120) * sec]))
    payload = metrics_request([{"name": name, "histogram": {"aggregationTemporality": 2, "dataPoints": points}}])
    resp = client.post("v1/metrics", json=payload)
    assert resp.status_code == 200, resp.text

    end_s = int(time.time()) + 60

    def _series():
        r = client.get(
            "prometheus/api/v1/query_exemplars",
            params={"query": f"{name}_bucket", "start": start_s, "end": end_s},
        )
        assert r.status_code == 200, r.text
        return r.json()["data"]

    try:
        data = wait_until(lambda: [s for s in _series() if s.get("exemplars")], timeout=120, interval=3, msg=f"exemplars for {name}")
        by_svc = {s["seriesLabels"].get("svc"): s for s in data}
        assert sorted(by_svc) == ["alpha", "beta"], f"expected one data element per series, got {[s['seriesLabels'] for s in data]}"
        for svc, s in by_svc.items():
            assert s["seriesLabels"].get("__name__") == name, s["seriesLabels"]
            stamps = [ex["timestamp"] for ex in s["exemplars"]]
            assert stamps, f"{svc}: no exemplars"
            assert all(start_s <= ts <= end_s for ts in stamps), f"{svc}: exemplar outside [{start_s}, {end_s}]: {stamps}"
            assert len(stamps) == 1, f"{svc}: only the in-window exemplar belongs here, got {stamps}"
    finally:
        for suffix in ("", "_bucket", "_count", "_sum", "_exemplars"):
            client.delete(f"streams/{name}{suffix}?type=metrics")

"""PromQL Prometheus-parity, query-API and result-cache fixes #5152, #14925, #15142, #15002, #15150, #15186, #15164, #15204 and #15187."""

from __future__ import annotations

import logging
import math
import time
import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from typing import Any, NamedTuple

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

STEP = 60
# Samples sit off the evaluation grid: the WAL scan drops a sample stamped exactly at the evaluation time.
HALF = 30
# The largest value ingestion keeps finite; ingestion clamps Inf and drops NaN, so queries build those.
NEAR_MAX = 1e308
BLOCK_CACHE_COUNTERS = (
    "zo_metrics_blocks_cache_hits_total",
    "zo_metrics_blocks_cache_misses_total",
    "zo_metrics_blocks_cache_partial_hits_total",
)
NAMELESS_SELECTORS = (
    'topk(5, count by (__name__)({{env="dev"}}))',
    'rate({{env="dev"}}[5m])',
    '{{env="dev"}}',
)


class CacheRatio(NamedTuple):
    count: float
    sum: float


def _metric_name(slug: str) -> str:
    return unique_name(f"pytest_promql_{slug}")


def _anchor(minutes_ago: int = 10) -> int:
    # Minute-aligned and inside the last 30 minutes, the window the querier still reads from the WAL.
    return int(time.time()) // 60 * 60 - minutes_ago * 60


def _series(metric: str, labels: dict[str, str], points: list[tuple[int, float]]) -> list[dict[str, Any]]:
    return [{"__name__": metric, **labels, "_timestamp": sec * 1000, "value": value} for sec, value in points]


def _json(resp) -> Any:
    try:
        return resp.json()
    except ValueError:
        return {}


def _ingest(client: OpenObserveClient, rows: list[dict[str, Any]], created: list, org: str | None = None) -> None:
    org = org or client.org
    resp = client.post("ingest/metrics/_json", json=rows, org=org)
    body = _json(resp)
    assert resp.status_code == 200, f"ingest into {org}: {body}"
    statuses = body.get("status") or []
    created.extend((org, stream.get("name")) for stream in statuses)
    written = sum(stream.get("successful") or 0 for stream in statuses)
    assert written == len(rows), "Precondition: every sample must be accepted"


def _promql(client: OpenObserveClient, endpoint: str, params: dict[str, Any], org: str | None = None):
    resp = client.get(f"prometheus/api/v1/{endpoint}", params=params, org=org)
    return resp.status_code, _json(resp)


def _instant(client: OpenObserveClient, query: str, at: int, org: str | None = None) -> list[dict[str, Any]]:
    status, body = _promql(client, "query", {"query": query, "time": at}, org)
    assert status == 200, f"{query} must evaluate: {body}"
    assert body.get("status") == "success"
    return body["data"]["result"]


def _instant_value(client: OpenObserveClient, query: str, at: int, org: str | None = None) -> str:
    result = _instant(client, query, at, org)
    assert len(result) == 1, f"{query} must return exactly one sample"
    return result[0]["value"][1]


def _range_query(
    client: OpenObserveClient, query: str, *, start: int, end: int, use_cache: bool = True, org: str | None = None
) -> list[dict[str, Any]]:
    params = {"query": query, "start": start, "end": end, "step": f"{STEP}s"}
    if not use_cache:
        params["use_cache"] = "false"
    status, body = _promql(client, "query_range", params, org)
    assert status == 200, f"{query} range must evaluate: {body}"
    assert body.get("status") == "success"
    return body["data"]["result"]


def _wait_for_samples(client: OpenObserveClient, selector: str, count: int, org: str | None = None) -> None:
    # Ingestion acknowledges before samples are searchable.
    def seen() -> float:
        _, body = _promql(client, "query", {"query": f"sum(count_over_time({selector}[30m]))"}, org)
        result = (body.get("data") or {}).get("result") or []
        return float(result[0]["value"][1]) if result else 0

    wait_until(lambda: seen() == count, timeout=60, interval=1, msg=f"{selector} never showed {count} samples")


def _create_org_through_ingestion(client: OpenObserveClient, created: list) -> str:
    org = f"pytestpromql{uuid.uuid4().hex[:12]}"
    _ingest(client, _series(_metric_name("org_seed"), {}, [(_anchor(), 1)]), created, org)
    logger.info("Created org through ingestion: %s", org)
    return org


def _scrape_server_metrics(client: OpenObserveClient) -> str:
    resp = client.get("metrics", prefix="")
    assert resp.status_code == 200, "the server must expose its own metrics"
    return resp.text


def _sample_of(text: str, name: str, label_filter: str = "") -> float | None:
    for line in text.split("\n"):
        if (line.startswith(f"{name}{{") or line.startswith(f"{name} ")) and label_filter in line:
            return float(line.split()[-1])
    return None


def _cache_ratio(client: OpenObserveClient, org: str) -> CacheRatio:
    text = _scrape_server_metrics(client)
    label = f'organization="{org}"'
    count = _sample_of(text, "zo_query_metrics_cache_ratio_count", label)
    total = _sample_of(text, "zo_query_metrics_cache_ratio_sum", label)
    return CacheRatio(count if count is not None else 0, total if total is not None else 0)


def _values_of(result: list[dict[str, Any]]) -> list[str]:
    return [value for series in result for _, value in series["values"]]


@pytest.fixture
def created(client: OpenObserveClient) -> Generator[list[tuple[str, str]], None, None]:
    streams: list[tuple[str, str]] = []
    yield streams
    for org, stream in streams:
        try:
            client.delete(f"streams/{stream}", params={"type": "metrics", "delete_all": "true"}, org=org)
        except Exception as e:
            logger.warning("cleanup of %s/%s failed: %s", org, stream, e)


def test_quantile_between_two_infinities_returns_signed_inf_15142(client, created):
    """quantile returns +Inf and -Inf, not NaN, when it interpolates between two infinite values (#15142)."""
    metric = _metric_name("q_inf")
    t = _anchor()
    rows = [
        row
        for i, v in (("a", 1), ("b", NEAR_MAX), ("c", NEAR_MAX))
        for row in _series(metric, {"i": i}, [(t + HALF, v)])
    ]
    _ingest(client, rows, created)
    _wait_for_samples(client, metric, 3)

    # {10, +Inf, +Inf} at q=0.75 interpolates halfway between the two infinities.
    assert _instant_value(client, f"quantile(0.75, {metric} * 10)", t + STEP) == "+Inf"
    assert _instant_value(client, f"quantile(0.25, -({metric} * 10))", t + STEP) == "-Inf"


def test_quantile_over_time_between_two_infinities_returns_inf_15142(client, created):
    """quantile_over_time returns +Inf, not NaN, between two infinite samples (#15142)."""
    metric = _metric_name("qot_inf")
    t = _anchor()
    points = [(t + HALF, 0.1), (t + STEP + HALF, NEAR_MAX), (t + 2 * STEP + HALF, NEAR_MAX)]
    _ingest(client, _series(metric, {"job": "e2e"}, points), created)
    _wait_for_samples(client, metric, 3)

    value = _instant_value(client, f"quantile_over_time(0.75, ({metric} * 10)[3m:1m])", t + 3 * STEP)
    assert value == "+Inf"


def test_min_over_time_skips_nan_unless_every_sample_is_nan_15002(client, created):
    """min_over_time skips a NaN sample, and stays NaN only when every sample is NaN (#15002)."""
    metric = _metric_name("min_nan")
    t = _anchor()
    points = [(t + HALF, 5), (t + STEP + HALF, 0), (t + 2 * STEP + HALF, 3)]
    _ingest(client, _series(metric, {"job": "e2e"}, points), created)
    _wait_for_samples(client, metric, 3)
    with_nan = f"({metric} / {metric} * {metric})"
    assert _instant_value(client, with_nan, t + 2 * STEP) == "NaN", "Precondition: 0/0 makes the middle sample NaN"

    assert _instant_value(client, f"min_over_time({with_nan}[3m:1m])", t + 3 * STEP) == "3"
    assert _instant_value(client, f"min_over_time(({metric} * 0 / 0)[3m:1m])", t + 3 * STEP) == "NaN"


def test_changes_does_not_count_nan_followed_by_nan_15002(client, created):
    """changes does not count a NaN followed by another NaN as a change (#15002)."""
    metric = _metric_name("changes_nan")
    t = _anchor()
    points = [(t + HALF, 1), (t + STEP + HALF, 2), (t + 2 * STEP + HALF, 3)]
    _ingest(client, _series(metric, {"job": "e2e"}, points), created)
    _wait_for_samples(client, metric, 3)
    all_nan = f"({metric} * 0 / 0)[3m:1m]"
    assert _instant_value(client, f"count_over_time({all_nan})", t + 3 * STEP) == "3", "Precondition: three NaN samples"

    assert _instant_value(client, f"changes({all_nan})", t + 3 * STEP) == "0"


def test_sum_over_time_keeps_small_term_between_large_ones_15002(client, created):
    """sum_over_time keeps the 1 in 1e100 + 1 - 1e100 (#15002)."""
    metric = _metric_name("sum_kahan")
    t = _anchor()
    _ingest(client, _series(metric, {"job": "e2e"}, [(t + 30, 1e100), (t + 40, 1), (t + 50, -1e100)]), created)
    _wait_for_samples(client, metric, 3)

    assert _instant_value(client, f"sum_over_time({metric}[1m])", t + STEP) == "1"


def test_avg_over_time_of_near_max_samples_does_not_overflow_15002(client, created):
    """avg_over_time of two 1e308 samples is 1e308, not +Inf (#15002)."""
    metric = _metric_name("avg_overflow")
    t = _anchor()
    _ingest(client, _series(metric, {"job": "e2e"}, [(t + 30, NEAR_MAX), (t + 40, NEAR_MAX)]), created)
    _wait_for_samples(client, metric, 2)

    assert _instant_value(client, f"avg_over_time({metric}[1m])", t + STEP) == "1e+308"


def test_increase_caps_window_start_before_counter_zero_point_15002(client, created):
    """increase() caps the window start before the counter zero point, like Prometheus 2.51+ (#15002)."""
    metric = _metric_name("increase")
    t = _anchor()
    _ingest(client, _series(metric, {"job": "e2e"}, [(t + 70, 1), (t + 80, 2), (t + 90, 3), (t + 100, 4)]), created)
    _wait_for_samples(client, metric, 4)

    # Window (t+45, t+105]: delta 3 over 30s, start capped to 5s, end 5s, so 3 * 40/30; the old order gave 4.5.
    assert _instant_value(client, f"increase({metric}[1m])", t + 105) == "4"


def test_rate_window_reaching_before_epoch_returns_a_value_15002(client, created):
    """a rate window that reaches back before 1970 returns a value instead of failing (#15002)."""
    metric = _metric_name("pre_epoch")
    t = _anchor()
    _ingest(client, _series(metric, {"job": "e2e"}, [(t + 70, 1), (t + 80, 2), (t + 90, 3), (t + 100, 4)]), created)
    _wait_for_samples(client, metric, 4)

    # 60y is longer than the time since the epoch, so the window start is negative.
    assert _instant_value(client, f"increase({metric}[60y])", t + 105) == "4"


def test_histogram_quantile_ignores_bucket_growth_below_one_part_in_1e12_15002(client, created):
    """histogram_quantile(1) ignores a bucket that grows by less than one part in 1e12 (#15002)."""
    metric = f"{_metric_name('hq_noise')}_bucket"
    t = _anchor()
    buckets = [("1", 10), ("2", 10.000000000005), ("+Inf", 10.000000000005)]
    rows = [row for le, v in buckets for row in _series(metric, {"job": "e2e", "le": le}, [(t + HALF, v)])]
    _ingest(client, rows, created)
    _wait_for_samples(client, metric, 3)

    assert _instant_value(client, f"histogram_quantile(1, {metric})", t + STEP) == "1"


def test_deriv_and_predict_linear_over_constant_inf_window_return_nan_15002(client, created):
    """deriv and predict_linear over a constant +Inf window return NaN instead of nothing (#15002)."""
    metric = _metric_name("deriv_inf")
    t = _anchor()
    points = [(t + k * STEP + HALF, NEAR_MAX) for k in range(4)]
    _ingest(client, _series(metric, {"job": "e2e"}, points), created)
    _wait_for_samples(client, metric, 4)
    inf_window = f"({metric} * 10)[3m:1m]"
    assert _instant_value(client, f"{metric} * 10", t + 4 * STEP) == "+Inf", "Precondition: the window is +Inf"

    assert _instant_value(client, f"deriv({inf_window})", t + 4 * STEP) == "NaN"
    assert _instant_value(client, f"predict_linear({inf_window}, 60)", t + 4 * STEP) == "NaN"


def test_negating_a_missing_metric_returns_empty_result_15002(client):
    """negating a metric that does not exist returns an empty result instead of an error (#15002)."""
    absent = _metric_name("absent")

    result = _instant(client, f"-{absent}", _anchor(1))
    assert result == []


def test_same_range_query_in_two_orgs_never_shares_cached_result_15186(client, created):
    """the same range query in two orgs never returns the other org's cached result (#15186)."""
    metric = _metric_name("cache_org")
    other_org = _create_org_through_ingestion(client, created)
    # Ends 8 minutes ago so the whole range is older than the 5-minute cache delay.
    end = _anchor(8)
    start = end - 12 * STEP

    def points(v: int) -> list[tuple[int, int]]:
        return [(end - (17 - k) * STEP + HALF, v) for k in range(18)]

    _ingest(client, _series(metric, {"job": "e2e"}, points(11)), created)
    _ingest(client, _series(metric, {"job": "e2e"}, points(22)), created, other_org)
    _wait_for_samples(client, metric, 18)
    _wait_for_samples(client, metric, 18, other_org)
    window = {"start": start, "end": end}

    own = _range_query(client, metric, **window)
    assert _values_of(own) == ["11"] * 13

    before = _cache_ratio(client, other_org)
    other = _range_query(client, metric, **window, org=other_org)
    assert _values_of(other) == ["22"] * 13, "the other org must get its own samples"
    assert _cache_ratio(client, other_org).count == before.count, "its first query must not be a cache hit"

    other_again = _range_query(client, metric, **window, org=other_org)
    assert _values_of(other_again) == ["22"] * 13
    assert _cache_ratio(client, other_org).count == before.count + 1, "the repeat must be served from its own cache"

    assert _values_of(_range_query(client, metric, **window)) == ["11"] * 13


def test_repeated_and_shifted_cached_range_equal_uncached_result_15186(client, created):
    """a repeated and a shifted range query served from the cache equal the uncached result (#15186)."""
    metric = _metric_name("cache_reuse")
    # A dedicated org, so its cache counters move only for this test's queries.
    org = _create_org_through_ingestion(client, created)
    base = _anchor(18)
    points = [(base + k * STEP + HALF, 100 + k) for k in range(-6, 13)]
    _ingest(client, _series(metric, {"job": "e2e"}, points), created, org)
    _wait_for_samples(client, metric, len(points), org)
    first = {"start": base, "end": base + 8 * STEP, "org": org}
    shifted = {"start": base + 4 * STEP, "end": base + 12 * STEP, "org": org}

    def expected(window: dict[str, Any]) -> list[str]:
        # A step at base + j minutes reads the sample 30s earlier, whose value is 99 + j.
        offset = (window["start"] - base) // STEP
        return [str(99 + offset + i) for i in range((window["end"] - window["start"]) // STEP + 1)]

    assert _values_of(_range_query(client, metric, **first)) == expected(first)

    before_repeat = _cache_ratio(client, org)
    assert _values_of(_range_query(client, metric, **first)) == expected(first)
    after_repeat = _cache_ratio(client, org)
    assert after_repeat.count == before_repeat.count + 1, "the repeat must be a cache hit"
    assert after_repeat.sum - before_repeat.sum > 1, "the repeat must be served wholly from cache"

    assert _values_of(_range_query(client, metric, **shifted)) == expected(shifted)
    after_shift = _cache_ratio(client, org)
    assert after_shift.count == after_repeat.count + 1, "the shifted window must reuse the cached overlap"
    reused = after_shift.sum - after_repeat.sum
    assert reused > 0, "only part of the shifted window can come from cache"
    assert reused < 1

    assert _values_of(_range_query(client, metric, **shifted, use_cache=False)) == expected(shifted)
    assert _values_of(_range_query(client, metric, **first, use_cache=False)) == expected(first)


def test_server_metrics_expose_block_cache_misses_and_partial_hits_15164(client):
    """the server metrics expose block-cache misses and partial hits next to the existing hits counter (#15164)."""
    text = _scrape_server_metrics(client)
    declared = dict(
        line.split(" ")[2:4] for line in text.split("\n") if line.startswith("# TYPE zo_metrics_blocks_cache_")
    )

    assert {name: declared.get(name) for name in BLOCK_CACHE_COUNTERS} == dict.fromkeys(BLOCK_CACHE_COUNTERS, "counter")
    for name in BLOCK_CACHE_COUNTERS:
        value = _sample_of(text, name)
        assert value is not None, f"{name} must carry a numeric sample"
        assert math.isfinite(value), f"{name} must carry a numeric sample"


def test_concurrent_usage_lookups_agree_and_list_the_charting_dashboard_15204(client, temp_dashboard_id):
    """concurrent usage lookups all succeed with the same answer and list the dashboard that charts the metric (#15204)."""
    metric = _metric_name("usage")
    title = f"e2e 15204 {metric}"
    panel = {
        "id": "Panel_ID1",
        "type": "line",
        "title": "usage",
        "description": "",
        "queryType": "promql",
        "config": {"show_legends": True},
        "queries": [
            {
                "query": f"sum(rate({metric}[5m]))",
                "customQuery": True,
                "fields": {
                    "stream": "",
                    "stream_type": "metrics",
                    "x": [],
                    "y": [],
                    "z": [],
                    "filter": {"filterType": "group", "logicalOperator": "AND", "conditions": []},
                },
                "config": {"promql_legend": "", "query_type": "range"},
            }
        ],
        "layout": {"x": 0, "y": 0, "w": 96, "h": 14, "i": 1},
    }
    payload = {
        "version": 8,
        "title": title,
        "description": "",
        "tabs": [{"tabId": "default", "name": "Default", "panels": [panel]}],
    }
    create = client.post("dashboards", params={"folder": "default"}, json=payload)
    assert create.status_code == 200, "Precondition: the dashboard must be created"
    saved = create.json()
    dashboard_id = (saved.get(f"v{saved.get('version')}") or saved).get("dashboardId")
    temp_dashboard_id.append(dashboard_id)

    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: client.get(f"metrics/{metric}/usage"), range(6)))
    assert [r.status_code for r in responses] == [200] * 6
    bodies = [r.json() for r in responses]
    for body in bodies:
        assert body == bodies[0]
    assert bodies[0].get("dashboards") == [{"id": dashboard_id, "title": title, "folder_id": "default"}]


def test_regex_alternation_matches_whole_label_values_only_15187(client, created):
    """a regex alternation in a label matcher matches whole label values only (#15187)."""
    metric = _metric_name("re_anchor")
    t = _anchor()
    labels = ["first", "last", "first-extra", "prefix-last", "middle", "bc{abc}", "xbc{abc}"]
    rows = [row for i, label in enumerate(labels) for row in _series(metric, {"label": label}, [(t + HALF, i + 1)])]
    _ingest(client, rows, created)
    _wait_for_samples(client, metric, len(labels))

    def matched(matcher: str) -> list[str]:
        return sorted(s["metric"]["label"] for s in _instant(client, f"{metric}{{label{matcher}}}", t + STEP))

    assert matched('=~"first|last"') == ["first", "last"]
    assert matched('!~"first|last"') == ["bc{abc}", "first-extra", "middle", "prefix-last", "xbc{abc}"]
    assert matched('=~"bc{abc}"') == ["bc{abc}"]


def test_escaped_quote_matcher_survives_at_end_reserialization_15187(client, created):
    """an escaped quote in a label matcher matches the label value, also when @ end() re-serializes the query (#15187)."""
    metric = _metric_name("escaped")
    t = _anchor()
    rows = [
        row
        for path, note, v in (("api.v1", 'a"b', 10), ("apiXv1", 'a"b', 20), ("api.v2", "ab", 30))
        for row in _series(metric, {"path": path, "note": note}, [(t + k * STEP + HALF, v + k) for k in range(4)])
    ]
    _ingest(client, rows, created)
    _wait_for_samples(client, metric, len(rows))

    quoted = _instant(client, rf'{metric}{{note="a\"b"}}', t + 4 * STEP)
    assert sorted(s["metric"]["path"] for s in quoted) == ["api.v1", "apiXv1"]

    pinned = _range_query(
        client, rf'{metric}{{path=~"api\\.v[0-9]+",note="a\"b"}} @ end()', start=t + STEP, end=t + 4 * STEP
    )
    assert [s["metric"]["path"] for s in pinned] == ["api.v1"]
    assert _values_of(pinned) == ["13"] * 4, "@ end() pins every step to the last sample"


@pytest.mark.parametrize("endpoint", ["query", "query_range"])
@pytest.mark.parametrize("template", NAMELESS_SELECTORS)
def test_selector_without_metric_name_is_a_400_not_a_panic_5152(client, endpoint, template):
    """a selector with no metric name is answered with 400 "metric name is required" (#5152)."""
    query = template.format(metric=_metric_name("nameless"))
    at = _anchor(1)
    params = (
        {"query": query, "time": at}
        if endpoint == "query"
        else {"query": query, "start": at - 300, "end": at, "step": "60"}
    )
    status, body = _promql(client, endpoint, params)

    assert status == 400, f"{query}: {body}"
    assert body.get("errorType") == "bad_data", body
    assert "metric name is required" in body.get("error", ""), body


def test_same_selector_with_a_metric_name_returns_data_5152(client, created):
    """the named form of the #5152 query returns the per-name count (#5152)."""
    metric = _metric_name("named")
    t = _anchor()
    rows = [
        row for inst in ("i1", "i2", "i3") for row in _series(metric, {"env": "dev", "inst": inst}, [(t + HALF, 1)])
    ]
    _ingest(client, rows, created)
    _wait_for_samples(client, metric, 3)

    result = _instant(client, f'topk(5, count by (__name__)({metric}{{env="dev"}}))', t + STEP)
    assert [(s["metric"], s["value"][1]) for s in result] == [({"__name__": metric}, "3")]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("day_of_week(vector(0))", "4"),
        ("year(vector(4e10))", "3237"),
        ("year(vector(-9e12))", "NaN"),
        ("year(vector(-1e13))", "NaN"),
        ("month(vector(-1e13))", "NaN"),
        ("vector(1)/0", "+Inf"),
        ("-vector(1)/0", "-Inf"),
        ("vector(0)/0", "NaN"),
        ("vector(1e21)", "1e+21"),
        ("vector(1e-7)", "1e-07"),
    ],
)
def test_date_functions_and_special_values_match_prometheus_14925(client, query, expected):
    """date functions out of range give NaN, and +Inf, -Inf and exponents are written as Prometheus writes them (#14925)."""
    assert _instant_value(client, query, _anchor(1)) == expected


def test_count_values_labels_an_infinite_value_plus_inf_14925(client):
    """count_values writes an infinite value into its label as +Inf (#14925)."""
    result = _instant(client, 'count_values("v", vector(1)/0)', _anchor(1))
    assert [(s["metric"], s["value"][1]) for s in result] == [({"v": "+Inf"}, "1")]


def test_window_functions_return_prometheus_values_15150(client, created):
    """mad_over_time, ts_of_*_over_time and histogram_fraction return Prometheus's values (#15150)."""
    gauge = _metric_name("y")
    hist = f"{_metric_name('frac')}_bucket"
    t = _anchor(15)
    rows = _series(gauge, {"job": "e2e"}, [(t + k * STEP + HALF, 10 * k) for k in range(6)])
    for le, per_minute in (("0.5", 1), ("1", 3), ("+Inf", 4)):
        rows += _series(hist, {"job": "e2e", "le": le}, [(t + k * STEP + HALF, per_minute * k) for k in range(6)])
    _ingest(client, rows, created)
    _wait_for_samples(client, gauge, 6)
    _wait_for_samples(client, hist, 18)
    # (t+40, t+340] holds 10, 20, 30, 40 and 50, at t+90 to t+330
    at = t + 340

    assert _instant_value(client, f"mad_over_time({gauge}[5m])", at) == "10"
    assert _instant_value(client, f"ts_of_max_over_time({gauge}[5m])", at) == str(t + 330)
    assert _instant_value(client, f"ts_of_min_over_time({gauge}[5m])", at) == str(t + 90)
    assert _instant_value(client, f"ts_of_last_over_time({gauge}[5m])", at) == str(t + 330)
    assert _instant_value(client, f"histogram_fraction(0, 1, rate({hist}[5m]))", at) == "0.75"


def test_sort_by_label_and_limit_ratio_partition_series_15150(client, created):
    """sort_by_label orders by the label, and limit_ratio(r) and limit_ratio(-(1-r)) split the series cleanly (#15150)."""
    sorted_metric = _metric_name("sorted")
    split_metric = _metric_name("split")
    t = _anchor()
    rows = [row for i in "dbac" for row in _series(sorted_metric, {"i": i}, [(t + HALF, 1)])]
    rows += [row for i in range(40) for row in _series(split_metric, {"i": f"{i:02d}"}, [(t + HALF, i)])]
    _ingest(client, rows, created)
    _wait_for_samples(client, sorted_metric, 4)
    _wait_for_samples(client, split_metric, 40)

    def labels(query: str) -> list[str]:
        return [s["metric"]["i"] for s in _instant(client, query, t + STEP)]

    assert labels(f'sort_by_label({sorted_metric}, "i")') == ["a", "b", "c", "d"]
    assert labels(f'sort_by_label_desc({sorted_metric}, "i")') == ["d", "c", "b", "a"]
    for ratio in (0.1, 0.25, 0.5, 0.75, 0.9):
        kept = set(labels(f"limit_ratio({ratio}, {split_metric})"))
        rest = set(labels(f"limit_ratio(-(1 - {ratio}), {split_metric})"))
        assert kept.isdisjoint(rest), f"ratio {ratio}: a series landed in both halves"
        assert len(kept | rest) == 40, f"ratio {ratio}: the halves must cover every series"


@pytest.mark.parametrize("name", ["double_exponential_smoothing", "holt_winters"])
def test_smoothing_returns_the_prometheus_value_15187(client, created, name):
    """both smoothing names give -1 on samples 5, 0 and 3 with factors 0.5 and 0.5 (#15187)."""
    metric = _metric_name("smooth")
    t = _anchor()
    _ingest(
        client,
        _series(metric, {"job": "e2e"}, [(t + HALF, 5), (t + STEP + HALF, 0), (t + 2 * STEP + HALF, 3)]),
        created,
    )
    _wait_for_samples(client, metric, 3)

    assert _instant_value(client, f"{name}({metric}[5m], 0.5, 0.5)", t + 3 * STEP) == "-1"

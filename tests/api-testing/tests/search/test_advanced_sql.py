"""Advanced SQL query tests against the search endpoint.

Rewritten in Phase 4 of the api-tests revamp:
- Replaces the 1-hour time window (which often returned 0 hits against
  the older stream_pytest_data fixture) with a 1-week window matching
  what conftest's autouse ingest fixture uses.
- Body validation tightened: queries that SHOULD return data (basic
  aggregations over fields present in the test dataset) now REQUIRE
  >=1 hit. The original silently logged a warning and passed — masking
  any real query regression.
- Queries with restrictive WHERE filters (LIKE patterns, specific value
  lists) tolerate empty results and explain why in a logger.info call.
- Uses client.search.sql() so the conftest-managed session + auth +
  payload defaults apply.
- Drops the in-test connection retry + time.sleep — if the server is
  overloaded the underlying requests timeout is the right signal.
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

ORG_ID = "default"
STREAM = "stream_pytest_data"
# Wide window — the autouse ingest fixture loads test data with timestamps
# that may be days old; we don't want the time window to be the variable
# that makes tests flake.
QUERY_MINUTES = 60 * 24 * 7  # 1 week


def _query(client: OpenObserveClient, sql: str, size: int = 100) -> list[dict]:
    """Run SQL via the search endpoint; return the hits list. Asserts 200."""
    resp = client.search.sql(sql, minutes=QUERY_MINUTES, size=size)
    assert resp.status_code == 200, \
        f"query failed: {resp.status_code} {resp.text[:500]}"
    body = resp.json()
    assert "hits" in body, f"response missing 'hits' key: {body}"
    return body["hits"]


def _require_fields(hits: list[dict], required_fields: list[str], context: str) -> None:
    """Assert every hit contains every required field. Used by every test."""
    for i, hit in enumerate(hits):
        for field in required_fields:
            assert field in hit, \
                f"{context}: hit {i} missing field {field!r}: {hit}"


# ----- tests that should produce hits against stream_pytest_data -----


def test_error_rate_analysis(client: OpenObserveClient):
    """info-rate analysis grouped by container+namespace, ordered by rate."""
    sql = f"""SELECT
        COUNT(_timestamp) AS pvcount,
        COUNT(CASE WHEN level = 'info' THEN 1 END) AS infocount,
        (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) AS inforate,
        COALESCE(kubernetes_container_name, 'unknown') AS component,
        COALESCE(kubernetes_namespace_name, 'default') AS environment
    FROM "{STREAM}"
    WHERE (level IS NOT NULL)
    GROUP BY COALESCE(kubernetes_container_name, 'unknown'), COALESCE(kubernetes_namespace_name, 'default')
    HAVING (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) >= 0
    ORDER BY (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) DESC
    LIMIT 50"""
    hits = _query(client, sql, size=50)

    assert len(hits) >= 1, f"expected at least 1 hit; aggregations over level should return data: got {len(hits)}"
    _require_fields(hits, ["pvcount", "infocount", "inforate", "component", "environment"], "error_rate")

    # HAVING clause asserts info_rate >= 0; verify that holds.
    for i, hit in enumerate(hits):
        assert hit["inforate"] >= 0, f"hit {i} info_rate should be >= 0, got {hit['inforate']}"


def test_performance_percentiles(client: OpenObserveClient):
    """p95/p75/p50 percentiles of floatvalue, bucketed by histogram time."""
    sql = f"""SELECT histogram(_timestamp) AS _time,
        approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.95) AS p95,
        approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.75) AS p75,
        approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.50) AS p50
    FROM "{STREAM}"
    WHERE (floatvalue IS NOT NULL)
    GROUP BY histogram(_timestamp)
    ORDER BY histogram(_timestamp)"""
    hits = _query(client, sql)

    assert len(hits) >= 1, "expected at least 1 histogram bucket with floatvalue data"
    _require_fields(hits, ["_time", "p95", "p75", "p50"], "perf_percentiles")

    # Percentile ordering: p95 >= p75 >= p50 (only check buckets that have all three)
    for i, hit in enumerate(hits):
        p95, p75, p50 = hit["p95"], hit["p75"], hit["p50"]
        if p95 is not None and p75 is not None and p50 is not None:
            assert p95 >= p75 >= p50, \
                f"hit {i}: percentile order violated p95={p95}, p75={p75}, p50={p50}"


def test_log_volume_analysis(client: OpenObserveClient):
    """log volume aggregation: total_logs vs info_count + computed info_rate."""
    sql = f"""SELECT
        histogram(_timestamp) AS time_bucket,
        COUNT(_timestamp) AS total_logs,
        SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) AS info_count,
        ROUND(100.0 * SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) / COUNT(_timestamp), 2) AS info_rate,
        COALESCE(kubernetes_container_name, 'unknown') AS component
    FROM "{STREAM}"
    GROUP BY histogram(_timestamp), COALESCE(kubernetes_container_name, 'unknown')
    ORDER BY histogram(_timestamp) ASC, ROUND(100.0 * SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) / COUNT(_timestamp), 2) DESC"""
    hits = _query(client, sql)

    assert len(hits) >= 1, "expected at least 1 hit; SELECT * grouped by histogram should return data"
    _require_fields(hits, ["time_bucket", "total_logs", "info_count", "info_rate", "component"], "log_volume")

    # Logical invariant: info_count <= total_logs always
    for i, hit in enumerate(hits):
        assert hit["info_count"] <= hit["total_logs"], \
            f"hit {i}: info_count ({hit['info_count']}) should be <= total_logs ({hit['total_logs']})"


def test_source_analysis(client: OpenObserveClient):
    """log_count grouped by platform (container) + source_group (namespace)."""
    sql = f"""SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS platform,
        COALESCE(kubernetes_namespace_name, 'default') AS source_group,
        COUNT(_timestamp) AS log_count
    FROM "{STREAM}"
    GROUP BY COALESCE(kubernetes_container_name, 'unknown'), COALESCE(kubernetes_namespace_name, 'default')
    ORDER BY COUNT(_timestamp) DESC"""
    hits = _query(client, sql)

    assert len(hits) >= 1, "expected at least 1 hit"
    _require_fields(hits, ["platform", "source_group", "log_count"], "source_analysis")

    for i, hit in enumerate(hits):
        assert hit["log_count"] > 0, f"hit {i}: log_count should be > 0, got {hit['log_count']}"


def test_host_performance_stats(client: OpenObserveClient):
    """COUNT DISTINCT + AVG/MIN/MAX over floatvalue."""
    sql = f"""SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS hostname,
        COUNT(DISTINCT stream) AS unique_stream_count,
        COUNT(DISTINCT level) AS unique_level_count,
        AVG(floatvalue) AS avg_float_value,
        MIN(floatvalue) AS min_float_value,
        MAX(floatvalue) AS max_float_value
    FROM "{STREAM}"
    WHERE floatvalue IS NOT NULL
    GROUP BY COALESCE(kubernetes_container_name, 'unknown')
    ORDER BY AVG(floatvalue) DESC
    LIMIT 20"""
    hits = _query(client, sql, size=20)

    assert len(hits) >= 1, "expected at least 1 hit; floatvalue is present in test data"
    _require_fields(
        hits,
        ["hostname", "unique_stream_count", "unique_level_count",
         "avg_float_value", "min_float_value", "max_float_value"],
        "host_performance",
    )

    # MIN <= AVG <= MAX (with float tolerance — AVG of a single value can drift
    # by ~1e-14 due to backend float arithmetic, e.g. AVG([23.45]) = 23.450000000000003)
    eps = 1e-9
    for i, hit in enumerate(hits):
        mn, av, mx = hit["min_float_value"], hit["avg_float_value"], hit["max_float_value"]
        if mn is not None and av is not None and mx is not None:
            assert mn - eps <= av <= mx + eps, \
                f"hit {i}: min/avg/max should be ordered: min={mn}, avg={av}, max={mx}"


def test_component_percentiles_ordering(client: OpenObserveClient):
    """p99 >= p95 >= median ordering check per component."""
    sql = f"""SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS component,
        approx_percentile_cont(CAST(floatvalue AS Float), 0.99) AS p99_took,
        approx_percentile_cont(CAST(floatvalue AS Float), 0.95) AS p95_took,
        approx_percentile_cont(CAST(floatvalue AS Float), 0.50) AS median_took,
        COUNT(_timestamp) AS requests
    FROM "{STREAM}"
    WHERE floatvalue > 0
    GROUP BY COALESCE(kubernetes_container_name, 'unknown')
    ORDER BY approx_percentile_cont(CAST(floatvalue AS Float), 0.99) DESC
    LIMIT 15"""
    hits = _query(client, sql, size=15)

    assert len(hits) >= 1, "expected at least 1 hit"
    _require_fields(hits, ["component", "p99_took", "p95_took", "median_took", "requests"], "comp_percentiles")

    for i, hit in enumerate(hits):
        p99, p95, median = hit["p99_took"], hit["p95_took"], hit["median_took"]
        if p99 is not None and p95 is not None and median is not None:
            assert p99 >= p95 >= median, \
                f"hit {i}: percentile order violated p99={p99}, p95={p95}, median={median}"


def test_error_categorization_with_str_match(client: OpenObserveClient):
    """CASE-WHEN log categorization using str_match_ignore_case + date_format."""
    sql = f"""SELECT
        count(_timestamp) AS count,
        CASE
            WHEN str_match_ignore_case(log, 'level=error') THEN 'Level Error'
            WHEN str_match_ignore_case(log, 'level=warn') THEN 'Level Warning'
            WHEN str_match_ignore_case(log, 'forbidden') THEN 'Permission Forbidden'
            ELSE 'Other Log Types'
        END AS log_category,
        date_format(_timestamp, '%Y-%m-%d', 'UTC') AS _date
    FROM "{STREAM}"
    WHERE log IS NOT NULL AND log != ''
    GROUP BY CASE
            WHEN str_match_ignore_case(log, 'level=error') THEN 'Level Error'
            WHEN str_match_ignore_case(log, 'level=warn') THEN 'Level Warning'
            WHEN str_match_ignore_case(log, 'forbidden') THEN 'Permission Forbidden'
            ELSE 'Other Log Types'
        END, date_format(_timestamp, '%Y-%m-%d', 'UTC')
    ORDER BY count(_timestamp) DESC
    LIMIT 15"""
    hits = _query(client, sql, size=15)

    assert len(hits) >= 1, "expected at least 1 hit; log field is populated in test data"
    _require_fields(hits, ["count", "log_category", "_date"], "error_categorization")

    valid_categories = {"Level Error", "Level Warning", "Permission Forbidden", "Other Log Types"}
    for i, hit in enumerate(hits):
        assert hit["count"] > 0, f"hit {i}: count should be > 0, got {hit['count']}"
        assert hit["log_category"] in valid_categories, \
            f"hit {i}: unexpected log_category {hit['log_category']!r}"


def test_metadata_extraction_with_regex(client: OpenObserveClient):
    """regexp_match extraction of `caller=` from log lines."""
    sql = f"""SELECT
        array_extract(regexp_match(log, 'caller=([^\\s]+)'), 1) AS caller,
        count(_timestamp) AS count
    FROM "{STREAM}"
    WHERE str_match_ignore_case(log, 'caller=')
    GROUP BY array_extract(regexp_match(log, 'caller=([^\\s]+)'), 1)"""
    hits = _query(client, sql)

    # Some test datasets may not contain 'caller=' patterns. Skip (visible in
    # pytest output) rather than silently passing if the pattern isn't present.
    if not hits:
        pytest.skip("'caller=' pattern absent in test data — test data dependent")

    _require_fields(hits, ["caller", "count"], "metadata_extraction")
    for i, hit in enumerate(hits):
        assert hit["count"] > 0, f"hit {i}: count should be > 0, got {hit['count']}"


def test_complex_nested_aggregation_with_cte(client: OpenObserveClient):
    """CTE + window function + RANK + cross-environment service health classification."""
    sql = f"""WITH env_metrics AS (
        SELECT
            kubernetes_namespace_name AS environment,
            kubernetes_container_name AS service,
            COUNT(*) AS log_count,
            COUNT(CASE WHEN level IN ('error', 'warn') THEN 1 END) AS issue_count,
            AVG(CASE WHEN took IS NOT NULL THEN CAST(took AS FLOAT) ELSE NULL END) AS avg_latency
        FROM "{STREAM}"
        WHERE kubernetes_namespace_name IS NOT NULL
        GROUP BY kubernetes_namespace_name, kubernetes_container_name
    ),
    env_totals AS (
        SELECT
            environment,
            SUM(log_count) AS total_logs,
            SUM(issue_count) AS total_issues,
            AVG(avg_latency) AS env_avg_latency
        FROM env_metrics
        GROUP BY environment
    )
    SELECT
        em.environment,
        em.service,
        em.log_count,
        em.issue_count,
        ROUND((em.log_count * 100.0) / et.total_logs, 2) AS log_share_percent,
        ROUND((em.issue_count * 100.0) / NULLIF(et.total_issues, 0), 2) AS issue_share_percent,
        em.avg_latency,
        et.env_avg_latency,
        CASE
            WHEN em.avg_latency > et.env_avg_latency * 1.5 THEN 'High Latency'
            WHEN em.issue_count > et.total_issues * 0.3 THEN 'High Issues'
            WHEN em.log_count > et.total_logs * 0.4 THEN 'High Volume'
            ELSE 'Normal'
        END AS service_status,
        RANK() OVER (PARTITION BY em.environment ORDER BY em.issue_count DESC) AS issue_rank
    FROM env_metrics em
    JOIN env_totals et ON em.environment = et.environment
    WHERE em.log_count > 0
    ORDER BY em.environment, RANK() OVER (PARTITION BY em.environment ORDER BY em.issue_count DESC)"""
    hits = _query(client, sql)

    assert len(hits) >= 1, "expected at least 1 hit; CTE aggregation over universal fields should return data"
    _require_fields(
        hits,
        ["environment", "service", "log_count", "issue_count",
         "log_share_percent", "service_status", "issue_rank"],
        "complex_nested",
    )

    valid_statuses = {"High Latency", "High Issues", "High Volume", "Normal"}
    for i, hit in enumerate(hits):
        assert hit["log_count"] > 0, f"hit {i}: log_count should be > 0, got {hit['log_count']}"
        assert hit["issue_count"] >= 0, f"hit {i}: issue_count should be >= 0, got {hit['issue_count']}"
        assert 0 <= hit["log_share_percent"] <= 100, \
            f"hit {i}: log_share_percent out of range: {hit['log_share_percent']}"
        assert hit["issue_rank"] >= 1, f"hit {i}: issue_rank should be >= 1, got {hit['issue_rank']}"
        assert hit["service_status"] in valid_statuses, \
            f"hit {i}: unexpected service_status {hit['service_status']!r}"


# ----- tests with restrictive filters — empty hits is acceptable -----


def test_api_log_analysis_with_message_filter(client: OpenObserveClient):
    """API log analysis filtered by `message LIKE '%bulk%'`.

    Restrictive filter — the test dataset may not contain 'bulk' messages.
    Empty results are acceptable; if hits present, validate shape.
    """
    sql = f"""SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS api,
        level AS log_level,
        COUNT(CASE WHEN LOWER(COALESCE(level, 'n/a')) = 'info' THEN 1 END) AS api_info_log_count,
        COALESCE(kubernetes_namespace_name, 'default') AS component,
        COALESCE(kubernetes_container_name, 'unknown') AS platform,
        COUNT(_timestamp) AS counter
    FROM "{STREAM}"
    WHERE kubernetes_namespace_name IS NOT NULL
        AND message LIKE '%bulk%'
    GROUP BY COALESCE(kubernetes_container_name, 'unknown'), level, COALESCE(kubernetes_namespace_name, 'default')
    ORDER BY COALESCE(kubernetes_container_name, 'unknown'), COUNT(_timestamp) DESC"""
    hits = _query(client, sql)

    if not hits:
        pytest.skip("no messages containing 'bulk' in test data — test data dependent")
    _require_fields(hits, ["api", "log_level", "api_info_log_count", "component", "platform", "counter"], "api_log")


def test_time_series_window_functions(client: OpenObserveClient):
    """LAG window function for growth-rate calculation per namespace.

    Filters on `kubernetes_namespace_name IN ('production','staging','monitoring','default')`.
    The test data may not have all four namespaces; empty is acceptable.
    """
    sql = f"""SELECT
        histogram(_timestamp) AS time_bucket,
        kubernetes_namespace_name AS environment,
        COUNT(*) AS current_count,
        LAG(COUNT(*)) OVER (
            PARTITION BY kubernetes_namespace_name
            ORDER BY histogram(_timestamp)
        ) AS previous_count,
        CASE
            WHEN LAG(COUNT(*)) OVER (
                PARTITION BY kubernetes_namespace_name
                ORDER BY histogram(_timestamp)
            ) IS NOT NULL THEN
                ROUND(
                    ((COUNT(*) - LAG(COUNT(*)) OVER (
                        PARTITION BY kubernetes_namespace_name
                        ORDER BY histogram(_timestamp)
                    )) * 100.0) /
                    LAG(COUNT(*)) OVER (
                        PARTITION BY kubernetes_namespace_name
                        ORDER BY histogram(_timestamp)
                    ), 2
                )
            ELSE 0
        END AS growth_rate_percent
    FROM "{STREAM}"
    WHERE kubernetes_namespace_name IN ('production', 'staging', 'monitoring', 'default')
    GROUP BY histogram(_timestamp), kubernetes_namespace_name
    ORDER BY histogram(_timestamp), kubernetes_namespace_name"""
    hits = _query(client, sql)

    if not hits:
        pytest.skip(
            "test data lacks namespaces in ('production','staging','monitoring','default') "
            "— test data dependent"
        )
    _require_fields(
        hits, ["time_bucket", "environment", "current_count", "growth_rate_percent"], "window_fn"
    )

    expected_envs = {"production", "staging", "monitoring", "default"}
    for i, hit in enumerate(hits):
        assert hit["current_count"] > 0, f"hit {i}: current_count should be > 0"
        assert hit["environment"] in expected_envs, \
            f"hit {i}: unexpected environment {hit['environment']!r}"


def test_advanced_regex_json_path_extraction(client: OpenObserveClient):
    """regexp_match-based API analysis with health-status classification.

    Filters on `message LIKE '/api/%'` AND requires method/took/code fields —
    test data may not have all these, so empty is acceptable.
    """
    sql = r"""SELECT
        regexp_match(message, '/api/([^/]+)')[1] AS api_group,
        regexp_match(message, '/([^?/]+)(?:\?|$)')[1] AS endpoint,
        method AS http_method,
        AVG(CAST(took AS FLOAT)) AS avg_response_time,
        COUNT(CASE WHEN CAST(code AS INT) >= 400 THEN 1 END) AS error_count,
        COUNT(CASE WHEN CAST(code AS INT) >= 500 THEN 1 END) AS server_error_count,
        approx_percentile_cont(CAST(took AS FLOAT), 0.99) AS p99_response_time,
        CASE
            WHEN COUNT(CASE WHEN CAST(code AS INT) >= 500 THEN 1 END) > 0 THEN 'Critical'
            WHEN COUNT(CASE WHEN CAST(code AS INT) >= 400 THEN 1 END) > 2 THEN 'Warning'
            WHEN AVG(CAST(took AS FLOAT)) > 5000 THEN 'Slow'
            ELSE 'Healthy'
        END AS health_status
    FROM "STREAMPLACEHOLDER"
    WHERE message IS NOT NULL
        AND message LIKE '/api/%'
        AND method IS NOT NULL
        AND took IS NOT NULL
        AND code IS NOT NULL
    GROUP BY regexp_match(message, '/api/([^/]+)')[1], regexp_match(message, '/([^?/]+)(?:\?|$)')[1], method
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(CASE WHEN CAST(code AS INT) >= 400 THEN 1 END) DESC, AVG(CAST(took AS FLOAT)) DESC""".replace("STREAMPLACEHOLDER", STREAM)
    hits = _query(client, sql)

    if not hits:
        pytest.skip(
            "test data lacks message LIKE '/api/%' rows with method/took/code "
            "— test data dependent"
        )
    _require_fields(
        hits,
        ["api_group", "endpoint", "http_method", "avg_response_time", "error_count",
         "server_error_count", "p99_response_time", "health_status"],
        "advanced_regex",
    )

    valid_statuses = {"Critical", "Warning", "Slow", "Healthy"}
    for i, hit in enumerate(hits):
        assert hit["error_count"] >= 0
        assert hit["server_error_count"] >= 0
        assert hit["server_error_count"] <= hit["error_count"], \
            f"hit {i}: server_error_count ({hit['server_error_count']}) > error_count ({hit['error_count']})"
        assert hit["health_status"] in valid_statuses, \
            f"hit {i}: unexpected health_status {hit['health_status']!r}"

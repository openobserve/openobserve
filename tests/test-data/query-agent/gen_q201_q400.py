"""Generate Q201-Q400 query entries from june6.sql structural templates.

All queries use synthetic field names mapped from june6.sql structural patterns.
SQL uses ``{stream}`` placeholder — replaced at runtime by the query-agent
test harness.

Usage:
  cd tests/test-data/query-agent && python3 gen_q201_q400.py
"""

import json
from pathlib import Path

QUERIES_DIR = Path(__file__).parent / "queries"

# ── Time offset formula ────────────────────────────────────────────────────
# For query index qi (1-indexed, qi = int(qid[1:])):
#   base = BASE_TS + (qi-1) * 60_000_000
#   5 records at ts = base + i * 18_000_000  (i=0..4)
#   start_offset = (qi-1)*60_000_000 - 1_000_000
#   end_offset   = (qi-1)*60_000_000 + 4*18_000_000 + 1_000_000

def time_offset(qi):
    """Return start/end offsets (microseconds) for query index *qi* (1-indexed)."""
    return {
        "start_offset": (qi - 1) * 60_000_000 - 1_000_000,
        "end_offset": (qi - 1) * 60_000_000 + 4 * 18_000_000 + 1_000_000
    }

def make_entry(qid, category, sql):
    """Build a single query entry dict with time_offset for the given QID."""
    qi = int(qid[1:])
    return {
        "id": qid,
        "sql": sql,
        "category": category,
        "time_offset": time_offset(qi)
    }

# ── All 200 queries (Q201-Q400) ──────────────────────────────────────────

QUERIES = []

# ============================
# AGGREGATION — 25 queries (Q201-Q225)
# ============================

AGGREGATION = [
    # CASE WHEN + COUNT with NOT LIKE chains (june6: histogram error-rate patterns)
    ("""SELECT COUNT(CASE WHEN action_category = 'performanceMetric' AND error_code NOT IN ('E001', 'E003', 'E005') AND page_slug IN ('itemPage', 'searchPage') AND exception_message NOT LIKE '%NullPointer%' THEN 1 END) AS filtered_errors, COUNT(CASE WHEN action_category = 'performanceMetric' THEN 1 END) AS total_metrics, COUNT(DISTINCT visitor_session_id) AS unique_users FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL"""),

    # Percentage calculation with CASE (june6: 100.0 * COUNT(CASE...)/COUNT(*))
    ("""SELECT (100.0 * COUNT(CASE WHEN action_category = 'navigation' AND error_code NOT IN ('E002', 'E004') AND exception_message NOT LIKE '%Timeout%' THEN 1 END) / COUNT(*)) AS nav_error_pct, COUNT(*) AS total_events, COUNT(DISTINCT os_platform) AS platforms FROM "{stream}" WHERE page_slug IN ('itemPage', 'cartPage', 'checkoutPage')"""),

    # Long IN list with GROUP BY (june6: IN with 5+ values)
    ("""SELECT action_category, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE page_slug IN ('itemPage', 'searchPage', 'cartPage', 'checkoutPage', 'itemPage') AND os_platform IN ('Android 14', 'iOS 17.4', 'Mac OS X (iPhone)', 'Android 13', 'Windows 11') AND org_name = 'warehouse-east' GROUP BY action_category ORDER BY cnt DESC"""),

    # Multi-field LIKE OR chain with COUNT DISTINCT (june6: error search across 5+ fields)
    ("""SELECT COUNT(DISTINCT visitor_session_id) AS affected_users FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND (exception_message LIKE '%NullPointer%' OR upstream_error_code LIKE '%UP-E00%' OR error_code LIKE '%E00%' OR event_detail LIKE '%timeout%' OR exception_message LIKE '%ResourceExhausted%')"""),

    # approx_percentile_cont with CASE in subquery (june6: P95 duration range)
    ("""SELECT record_type, COUNT(*) AS cnt, approx_percentile_cont(CAST(latency_ms AS FLOAT), 0.95) AS p95_latency FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 GROUP BY record_type ORDER BY p95_latency DESC"""),

    # Multi-condition COUNT with NOT LIKE and NOT IN (june6: error rate by platform)
    ("""SELECT os_platform, COUNT(*) AS total, COUNT(CASE WHEN action_category = 'performanceMetric' AND error_code NOT IN ('E001', 'E002') AND exception_message NOT LIKE '%Timeout%' THEN 1 END) AS clean_metrics, COUNT(CASE WHEN action_category = 'interaction' THEN 1 END) AS interactions FROM "{stream}" WHERE org_name IN ('warehouse-east', 'warehouse-west') AND page_slug IN ('itemPage', 'cartPage') GROUP BY os_platform"""),

    # HAVING with complex aggregate condition (june6: error threshold)
    ("""SELECT component_name, COUNT(*) AS error_count, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message LIKE '%Exception%' GROUP BY component_name HAVING COUNT(*) > 1 AND COUNT(DISTINCT visitor_session_id) >= 2"""),

    # COUNT with CASE WHEN char_length (june6: error msg length fallback)
    ("""SELECT (CASE WHEN char_length(exception_message) > 0 THEN exception_message ELSE error_code END) AS display_error, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message IS NOT NULL GROUP BY display_error ORDER BY cnt DESC"""),

    # Multiple aggregate functions with GROUP BY (june6: comprehensive stats)
    ("""SELECT page_slug, COUNT(*) AS total, MIN(latency_ms) AS min_latency, MAX(latency_ms) AS max_latency, AVG(latency_ms) AS avg_latency, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category IN ('performanceMetric', 'interaction') AND latency_ms > 0 GROUP BY page_slug"""),

    # COUNT with coalesce fallback (june6: source/referrer coalesce)
    ("""SELECT coalesce(endpoint_path, resource_path) AS source_path, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'navigation' GROUP BY source_path ORDER BY cnt DESC"""),

    # Complex WHERE with multiple AND/OR/NOT IN (june6: combined filters)
    ("""SELECT device_type, COUNT(*) AS event_count, COUNT(DISTINCT visitor_session_id) AS unique_users FROM "{stream}" WHERE org_name IN ('warehouse-east', 'warehouse-west') AND build_version NOT IN ('v1.0.0', 'v1.1.2') AND device_type IN ('Mobile', 'Computer', 'Tablet') AND action_category = 'navigation' AND page_slug = 'itemPage' GROUP BY device_type"""),

    # Aggregate with IS NULL / IS NOT NULL (june6: null-check aggregations)
    ("""SELECT COUNT(*) AS total, COUNT(CASE WHEN info_tag IS NULL THEN 1 END) AS null_tags, COUNT(CASE WHEN info_tag IS NOT NULL THEN 1 END) AS tagged, COUNT(CASE WHEN bot_flag IS NULL THEN 1 END) AS human_only FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # Multiple LIKE patterns in aggregate (june6: FTS-like aggregation)
    ("""SELECT COUNT(CASE WHEN exception_message LIKE '%Exception%' THEN 1 END) AS exception_count, COUNT(CASE WHEN upstream_error_code LIKE '%UP-E00%' THEN 1 END) AS upstream_errors, COUNT(CASE WHEN event_detail LIKE '%timeout%' THEN 1 END) AS timeouts, COUNT(CASE WHEN error_code LIKE '%E00%' THEN 1 END) AS coded_errors FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # GROUP BY with ORDER BY and LIMIT (june6: top-N aggregation)
    ("""SELECT component_name, COUNT(*) AS cnt, AVG(latency_ms) AS avg_latency FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 GROUP BY component_name ORDER BY avg_latency DESC LIMIT 5"""),

    # CASE WHEN with platform classification (june6: platform grouping)
    ("""SELECT (CASE WHEN os_platform IN ('Android 14', 'Android 13') THEN 'Android' WHEN os_platform IN ('iOS 17.4', 'Mac OS X (iPhone)') THEN 'iOS' ELSE os_platform END) AS platform_group, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'navigation' GROUP BY platform_group"""),

    # COUNT DISTINCT with multiple WHERE conditions
    ("""SELECT COUNT(DISTINCT visitor_session_id) AS users, COUNT(DISTINCT component_name) AS components, COUNT(DISTINCT page_slug) AS pages FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version NOT IN ('v1.0.0') AND action_category IN ('performanceMetric', 'interaction', 'navigation')"""),

    # Subquery with aggregation (june6: nested aggregate pattern)
    ("""SELECT error_code, COUNT(*) AS cnt FROM (SELECT error_code, exception_message FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message LIKE '%Exception%') GROUP BY error_code ORDER BY cnt DESC"""),

    # Aggregation with BETWEEN
    ("""SELECT COUNT(*) AS mid_range FROM "{stream}" WHERE latency_ms BETWEEN 50 AND 500 AND action_category = 'performanceMetric'"""),

    # STRING_AGG with GROUP BY (june6: concat aggregation)
    ("""SELECT page_slug, STRING_AGG(DISTINCT error_code, ', ') AS error_codes FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY page_slug"""),

    # Complex aggregaton with NOT IN + IN + LIKE
    ("""SELECT action_subcategory, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category NOT IN ('interaction', 'navigation') AND page_slug IN ('itemPage', 'searchPage', 'cartPage') AND exception_message LIKE '%Exception%' GROUP BY action_subcategory ORDER BY cnt DESC"""),

    # percentage calculation (success rate)
    ("""SELECT (100.0 * COUNT(CASE WHEN response_code = 200 THEN 1 END) / COUNT(*)) AS success_rate, COUNT(*) AS total_requests, COUNT(DISTINCT uri_path) AS unique_paths FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # MIN/MAX/AVG with CASE classification
    ("""SELECT tag_b, MIN(latency_ms) AS min_lat, MAX(latency_ms) AS max_lat, AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, COUNT(*) AS cnt FROM "{stream}" WHERE latency_ms > 0 GROUP BY tag_b"""),

    # ARRAY_AGG with DISTINCT (june6: user sampling)
    ("""SELECT page_slug, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'navigation' AND page_slug IN ('itemPage', 'cartPage', 'checkoutPage', 'searchPage') AND device_type IN ('Mobile', 'Computer', 'Tablet') AND org_name = 'warehouse-east' AND build_version IS NOT NULL GROUP BY page_slug ORDER BY cnt DESC"""),

    # HAVING with percentage threshold
    ("""SELECT page_slug, COUNT(*) AS total, COUNT(CASE WHEN response_code >= 400 THEN 1 END) AS errors FROM "{stream}" GROUP BY page_slug HAVING COUNT(CASE WHEN response_code >= 400 THEN 1 END) > 0"""),

    # Group by device with platform CASE + error rate
    ("""SELECT (CASE WHEN device_type IN ('Mobile', 'Tablet') THEN 'Mobile_Device' WHEN device_type = 'Computer' THEN 'Desktop' ELSE device_type END) AS device_class, COUNT(*) AS total, COUNT(CASE WHEN response_code >= 400 THEN 1 END) AS errors FROM "{stream}" GROUP BY device_class"""),
]

# ============================
# BASIC_SELECT — 25 queries (Q226-Q250)
# ============================

BASIC_SELECT = [
    # CONCAT chain (june6: multi-field concat for display)
    ("""SELECT _timestamp, concat(action_category, ' - ', action_subcategory, ' - ', error_code, ' : ', exception_message) AS display_msg FROM "{stream}" WHERE org_name = 'warehouse-east'"""),

    # COALESCE with CONCAT (june6: fallback source)
    ("""SELECT _timestamp, coalesce(page_url, page_slug) AS effective_page, coalesce(exception_message, error_code) AS issue_desc, concat(coalesce(endpoint_path, resource_path), '?via=', http_method) AS full_path FROM "{stream}" WHERE action_category = 'navigation'"""),

    # LIKE OR chain across fields (june6: multi-field search)
    ("""SELECT * FROM "{stream}" WHERE exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E00%' OR error_code LIKE '%E00%' OR event_detail LIKE '%fail%' OR log_message LIKE '%ERROR%'"""),

    # Multi-condition with NOT LIKE chain (june6: exclusion search)
    ("""SELECT visitor_session_id, action_category, exception_message, page_slug FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND exception_message NOT LIKE '%Timeout%' AND exception_message NOT LIKE '%NullPointer%' AND error_code NOT IN ('E001', 'E002') AND device_type IN ('Mobile', 'Computer')"""),

    # Simple SELECT with IN list (june6: filtered fetch)
    ("""SELECT * FROM "{stream}" WHERE action_category = 'navigation' AND page_slug IN ('itemPage', 'cartPage', 'checkoutPage', 'searchPage', 'itemPage') AND device_type IN ('Mobile', 'Computer')"""),

    # char_length CASE fallback (june6: error display logic)
    ("""SELECT _timestamp, (CASE WHEN char_length(exception_message) > 0 THEN exception_message ELSE error_code END) AS display_error, action_category, page_slug, device_type FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # SELECT with BETWEEN and IS NULL check
    ("""SELECT * FROM "{stream}" WHERE latency_ms BETWEEN 100 AND 1000 AND action_category = 'performanceMetric' AND info_tag IS NULL AND bot_flag IS NOT NULL"""),

    # CONCAT multi-field with CASE (june6: enriched select)
    ("""SELECT concat(page_slug, ':', action_category, ':', action_subcategory) AS event_path, (CASE WHEN char_length(exception_message) > 0 THEN exception_message ELSE 'no_error' END) AS error_text, visitor_session_id, device_type FROM "{stream}" WHERE org_name = 'warehouse-east'"""),

    # COALESCE chain with LIKE filter (june6: multi-source selection)
    ("""SELECT _timestamp, coalesce(page_url, resource_path) AS page_ref, coalesce(exception_message, upstream_error_code, error_code, 'unknown') AS error_label FROM "{stream}" WHERE action_category = 'performanceMetric' AND (exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E%')"""),

    # Star select with NOT IN + IS NOT NULL + LIKE chain
    ("""SELECT * FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version NOT IN ('v1.0.0', 'v1.1.2') AND device_type IN ('Mobile', 'Tablet', 'Computer') AND action_category = 'navigation' AND page_slug = 'itemPage' AND visitor_session_id IS NOT NULL"""),

    # Multi-field select with platform classification
    ("""SELECT _timestamp, visitor_session_id, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE 'Other' END) AS platform, action_category, page_slug FROM "{stream}" WHERE org_name = 'warehouse-east'"""),

    # Select with complex LIKE OR + IN clause
    ("""SELECT _timestamp, exception_message, error_code, component_name FROM "{stream}" WHERE (exception_message LIKE '%NullPointer%' OR exception_message LIKE '%Timeout%' OR exception_message LIKE '%ResourceExhausted%') AND page_slug IN ('itemPage', 'cartPage', 'checkoutPage') AND org_name = 'warehouse-east'"""),

    # Top-N with ORDER BY and LIMIT (june6: recent events)
    ("""SELECT _timestamp, visitor_session_id, action_category, page_slug, exception_message FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category = 'performanceMetric' ORDER BY _timestamp DESC LIMIT 20"""),

    # COALESCE for source attribution (june6: source/page mapping)
    ("""SELECT _timestamp, coalesce(page_url, page_slug) AS source, action_category, action_subcategory, visitor_session_id FROM "{stream}" WHERE org_name IN ('warehouse-east', 'warehouse-west') AND action_category = 'navigation'"""),

    # LIKE NOT LIKE combo (june6: inclusion + exclusion search)
    ("""SELECT * FROM "{stream}" WHERE exception_message LIKE '%Exception%' AND exception_message NOT LIKE '%Timeout%' AND exception_message NOT LIKE '%NullPointer%' AND error_code LIKE '%E00%' AND page_slug IN ('itemPage', 'cartPage')"""),

    # Long select list with conditional expressions
    ("""SELECT _timestamp, visitor_session_id, action_category, error_code, exception_message, (CASE WHEN latency_ms > 500 THEN 'slow' WHEN latency_ms > 100 THEN 'medium' ELSE 'fast' END) AS speed_class FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0"""),

    # Select with IS NULL filter on multiple columns
    ("""SELECT * FROM "{stream}" WHERE bot_flag IS NULL AND info_tag IS NULL AND action_category = 'performanceMetric' AND org_name = 'warehouse-east'"""),

    # Select with regex_match and platform filter (june6: re_match for platform)
    ("""SELECT _timestamp, visitor_session_id, os_platform, action_category, exception_message FROM "{stream}" WHERE re_match(os_platform, 'Android|iPhone|iOS') AND page_slug IN ('itemPage', 'cartPage') AND error_code IS NOT NULL"""),

    # Select with coalesce for display and multi-filter
    ("""SELECT _timestamp, coalesce(exception_message, 'N/A') AS error_text, coalesce(endpoint_path, resource_path) AS called_path, action_category FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND action_category IN ('performanceMetric', 'interaction')"""),

    # Multi-field IN with different value sets
    ("""SELECT * FROM "{stream}" WHERE page_slug IN ('itemPage', 'searchPage', 'cartPage') AND action_category IN ('performanceMetric', 'navigation', 'interaction') AND os_platform IN ('Android 14', 'iOS 17.4') AND device_type IN ('Mobile', 'Tablet')"""),

    # LIKE chain with DISTINCT
    ("""SELECT DISTINCT component_name, error_code FROM "{stream}" WHERE (exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E%') AND org_name = 'warehouse-east'"""),

    # Long WHERE with multiple NOT IN
    ("""SELECT * FROM "{stream}" WHERE org_name NOT IN ('warehouse-south', 'warehouse-central') AND build_version NOT IN ('v1.0.0', 'v1.1.2') AND error_code NOT IN ('E002', 'E004') AND action_category NOT IN ('interaction', 'navigation')"""),

    # Select with ORDER BY multiple columns
    ("""SELECT _timestamp, action_category, action_subcategory, page_slug, latency_ms FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 ORDER BY latency_ms DESC, _timestamp ASC LIMIT 15"""),

    # Select with var-length LIKE
    ("""SELECT * FROM "{stream}" WHERE component_name LIKE '%sorter%' OR component_name LIKE '%conveyor%' OR component_name LIKE '%zone%' OR component_name LIKE '%scan%'"""),

    # Select with NOT IN + IN + IS NULL combo
    ("""SELECT _timestamp, visitor_session_id, action_category, bot_flag, info_tag FROM "{stream}" WHERE action_category NOT IN ('interaction', 'navigation') AND page_slug IN ('itemPage', 'cartPage') AND bot_flag IS NULL AND org_name = 'warehouse-east'"""),
]

# ============================
# COMBINED — 20 queries (Q251-Q270)
# ============================

COMBINED = [
    # Complex CASE WHEN with nested AND/OR in WHERE (june6: context + category combos)
    ("""SELECT CASE WHEN page_slug = 'itemPage' AND (action_category = 'navigation' AND action_subcategory = 'clickEvent') THEN 'item_click' WHEN page_slug = 'cartPage' AND (action_category = 'interaction' AND response_code = 200) THEN 'cart_success' WHEN page_slug = 'itemPage' AND (action_category = 'performanceMetric' AND error_code IN ('E001', 'E003')) THEN 'item_error' ELSE 'other' END AS event_class, COUNT(*) AS cnt FROM "{stream}" GROUP BY event_class"""),

    # GROUP BY + HAVING with complex CASE (june6: threshold alerting)
    ("""SELECT page_slug, COUNT(*) AS total, COUNT(CASE WHEN response_code >= 400 THEN 1 END) AS error_count, COUNT(CASE WHEN latency_ms > 500 THEN 1 END) AS slow_count FROM "{stream}" GROUP BY page_slug HAVING COUNT(CASE WHEN response_code >= 400 THEN 1 END) > 1 OR COUNT(CASE WHEN latency_ms > 500 THEN 1 END) > 2"""),

    # Multi-field GROUP BY + HAVING + CASE percentage
    ("""SELECT os_platform, action_category, COUNT(*) AS total, (100.0 * COUNT(CASE WHEN response_code >= 400 THEN 1 END) / COUNT(*)) AS error_pct FROM "{stream}" WHERE os_platform IN ('Android 14', 'iOS 17.4', 'Windows 11') GROUP BY os_platform, action_category HAVING COUNT(CASE WHEN response_code >= 400 THEN 1 END) > 0"""),

    # COALESCE + CONCAT in GROUP BY context (june6: enriched grouping)
    ("""SELECT coalesce(page_url, concat(page_slug, '-fallback')) AS page_label, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" GROUP BY page_label ORDER BY cnt DESC"""),

    # CASE WHEN with char_length + NOT IN + GROUP BY (june6: error type classification)
    ("""SELECT (CASE WHEN char_length(exception_message) > 20 THEN substring(exception_message, 1, 20) || '...' ELSE exception_message END) AS short_error, error_code, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code NOT IN ('E002', 'E004') AND exception_message IS NOT NULL GROUP BY short_error, error_code ORDER BY cnt DESC"""),

    # Complex HAVING with multiple aggregate conditions
    ("""SELECT component_name, page_slug, COUNT(*) AS cnt, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency, MAX(latency_ms) AS max_latency FROM "{stream}" WHERE latency_ms > 0 GROUP BY component_name, page_slug HAVING COUNT(*) >= 2 AND AVG(CAST(latency_ms AS FLOAT)) > 50"""),

    # CASE WHEN with IN/NOT IN chains (june6: combined classification)
    ("""SELECT (CASE WHEN page_slug IN ('itemPage', 'searchPage') AND action_category = 'navigation' THEN 'browse' WHEN page_slug IN ('cartPage', 'checkoutPage') AND action_category = 'interaction' THEN 'purchase' WHEN action_category = 'performanceMetric' AND error_code NOT IN ('E001', 'E002') THEN 'monitoring' ELSE 'other' END) AS session_type, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" GROUP BY session_type"""),

    # HAVING with LIKE pattern filter
    ("""SELECT error_code, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message LIKE '%Exception%' GROUP BY error_code HAVING COUNT(*) > 2 AND COUNT(DISTINCT visitor_session_id) >= 1"""),

    # Multi-dimension GROUP BY with platform mapping
    ("""SELECT (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE 'Other' END) AS platform, page_slug, action_category, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' GROUP BY platform, page_slug, action_category HAVING COUNT(*) > 0 ORDER BY cnt DESC"""),

    # GROUP BY with COALESCE and complex HAVING
    ("""SELECT coalesce(device_type, 'unknown') AS device, COUNT(*) AS total, COUNT(CASE WHEN response_code >= 400 THEN 1 END) AS errors, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency FROM "{stream}" WHERE latency_ms > 0 GROUP BY device HAVING AVG(CAST(latency_ms AS FLOAT)) > 100 OR COUNT(CASE WHEN response_code >= 400 THEN 1 END) > 2"""),

    # Combined CASE with multi-level classification
    ("""SELECT (CASE WHEN latency_ms < 100 THEN 'fast' WHEN latency_ms < 500 THEN 'medium' WHEN latency_ms < 1000 THEN 'slow' ELSE 'timeout' END) AS response_class, (CASE WHEN response_code = 200 THEN 'success' WHEN response_code >= 400 THEN 'error' ELSE 'other' END) AS status_class, COUNT(*) AS cnt FROM "{stream}" WHERE latency_ms > 0 GROUP BY response_class, status_class ORDER BY cnt DESC"""),

    # GROUP BY with NOT IN chains and HAVING threshold
    ("""SELECT action_subcategory, COUNT(*) AS cnt FROM "{stream}" WHERE action_category NOT IN ('interaction', 'navigation') AND error_code NOT IN ('E001', 'E003', 'E005') AND exception_message NOT LIKE '%Timeout%' GROUP BY action_subcategory HAVING COUNT(*) >= 2"""),

    # COALESCE in GROUP BY with multiple condition CASE
    ("""SELECT coalesce(component_name, 'unknown_component') AS comp, coalesce(error_code, 'no_error') AS err, COUNT(*) AS cnt, (CASE WHEN COUNT(*) > 3 THEN 'high' WHEN COUNT(*) > 1 THEN 'medium' ELSE 'low' END) AS severity FROM "{stream}" WHERE action_category = 'performanceMetric' GROUP BY comp, err ORDER BY cnt DESC"""),

    # HAVING with percentage calculation (june6: error rate threshold)
    ("""SELECT page_slug, COUNT(*) AS total, COUNT(CASE WHEN exception_message LIKE '%Exception%' THEN 1 END) AS exceptions, (100.0 * COUNT(CASE WHEN exception_message LIKE '%Exception%' THEN 1 END) / COUNT(*)) AS exception_rate FROM "{stream}" GROUP BY page_slug HAVING (100.0 * COUNT(CASE WHEN exception_message LIKE '%Exception%' THEN 1 END) / COUNT(*)) > 20"""),

    # Multi-condition CASE + GROUP BY + COALESCE
    ("""SELECT coalesce(tag_a, 'unknown') AS env, (CASE WHEN build_version IN ('v1.0.0', 'v1.1.2') THEN 'legacy' WHEN build_version IN ('v2.0.0', 'v2.1.3', 'v2.2.0') THEN 'current' ELSE 'other' END) AS version_class, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" GROUP BY env, version_class ORDER BY env, version_class"""),

    # GROUP BY with multiple CASE + HAVING
    ("""SELECT (CASE WHEN os_platform LIKE '%Android%' THEN 'android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' OR os_platform LIKE '%Mac%' THEN 'ios' ELSE 'other' END) AS platform_family, (CASE WHEN device_type IN ('Mobile', 'Tablet') THEN 'mobile' WHEN device_type = 'Computer' THEN 'desktop' ELSE 'unknown' END) AS device_family, COUNT(*) AS cnt FROM "{stream}" GROUP BY platform_family, device_family HAVING COUNT(*) > 2"""),

    # Complex WHERE with nested AND/OR + GROUP BY
    ("""SELECT record_type, action_category, COUNT(*) AS cnt FROM "{stream}" WHERE (page_slug = 'itemPage' AND action_category IN ('navigation', 'performanceMetric')) OR (page_slug = 'cartPage' AND action_category IN ('interaction', 'navigation')) OR (page_slug = 'checkoutPage' AND response_code >= 400) GROUP BY record_type, action_category ORDER BY cnt DESC"""),

    # GROUP BY with aggregate CASE percentage (june6: success rate)
    ("""SELECT org_name, COUNT(*) AS total, COUNT(CASE WHEN response_code = 200 THEN 1 END) AS successes, (100.0 * COUNT(CASE WHEN response_code = 200 THEN 1 END) / NULLIF(COUNT(*), 0)) AS success_rate FROM "{stream}" WHERE action_category = 'performanceMetric' GROUP BY org_name ORDER BY success_rate DESC"""),

    # HAVING with MIN/MAX/AVG range checks
    ("""SELECT page_slug, MIN(latency_ms) AS min_lat, MAX(latency_ms) AS max_lat, AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, COUNT(*) AS cnt FROM "{stream}" WHERE latency_ms > 0 GROUP BY page_slug HAVING MAX(latency_ms) - MIN(latency_ms) > 200 AND COUNT(*) >= 2"""),

    # GROUP BY with date_trunc-like filter + multi-field aggregation
    ("""SELECT action_category, page_slug, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users, COUNT(DISTINCT component_name) AS unique_components FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND action_category IN ('performanceMetric', 'navigation', 'interaction') AND page_slug IN ('itemPage', 'cartPage', 'checkoutPage') GROUP BY action_category, page_slug ORDER BY cnt DESC"""),
]

# ============================
# CTE_SUBQUERY — 25 queries (Q271-Q295)
# ============================

CTE_SUBQUERY = [
    # CTE with CASE WHEN platform mapping (june6: error aggregation CTE)
    ("""WITH platform_events AS (SELECT _timestamp, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE 'Other' END) AS platform, action_category, exception_message, error_code, visitor_session_id FROM "{stream}" WHERE org_name = 'warehouse-east') SELECT platform, COUNT(*) AS total, COUNT(DISTINCT visitor_session_id) AS users, COUNT(CASE WHEN exception_message LIKE '%Exception%' THEN 1 END) AS errors FROM platform_events GROUP BY platform"""),

    # CTE with COALESCE + CONCAT (june6: enriched event CTE)
    ("""WITH enriched AS (SELECT _timestamp, concat(coalesce(page_url, page_slug), '::', action_category) AS event_path, coalesce(exception_message, error_code) AS issue, visitor_session_id FROM "{stream}" WHERE action_category = 'performanceMetric') SELECT event_path, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM enriched WHERE issue IS NOT NULL GROUP BY event_path ORDER BY cnt DESC"""),

    # CTE with multi-condition filter + aggregate
    ("""WITH filtered AS (SELECT * FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version NOT IN ('v1.0.0', 'v1.1.2') AND device_type IN ('Mobile', 'Computer', 'Tablet') AND action_category IN ('performanceMetric', 'navigation') AND page_slug = 'itemPage') SELECT action_category, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency FROM filtered GROUP BY action_category"""),

    # CTE with char_length CASE + aggregation
    ("""WITH error_messages AS (SELECT _timestamp, (CASE WHEN char_length(exception_message) > 0 THEN exception_message ELSE error_code END) AS display_error, action_category, page_slug, visitor_session_id FROM "{stream}" WHERE action_category = 'performanceMetric') SELECT display_error, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM error_messages GROUP BY display_error ORDER BY cnt DESC"""),

    # Subquery with approx_percentile (june6: P95 duration range)
    ("""SELECT duration_bucket, COUNT(*) AS cnt FROM (SELECT (CASE WHEN ((MAX(_timestamp) - MIN(_timestamp)) / 60000000) < 60 THEN 'under_1min' WHEN ((MAX(_timestamp) - MIN(_timestamp)) / 60000000) < 120 THEN '1_2min' ELSE 'over_2min' END) AS duration_bucket FROM "{stream}" WHERE action_category = 'navigation' GROUP BY visitor_session_id) GROUP BY duration_bucket"""),

    # CTE with LIKE OR chain filter
    ("""WITH error_set AS (SELECT * FROM "{stream}" WHERE exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E00%' OR error_code LIKE '%E00%' OR event_detail LIKE '%fail%') SELECT action_category, page_slug, COUNT(*) AS cnt FROM error_set GROUP BY action_category, page_slug ORDER BY cnt DESC"""),

    # Nested subquery with CASE (june6: multi-level aggregation)
    ("""SELECT error_type, COUNT(*) AS total FROM (SELECT (CASE WHEN exception_message LIKE '%Exception%' THEN 'exception' WHEN upstream_error_code LIKE '%UP-E%' THEN 'upstream' WHEN error_code LIKE '%E00%' THEN 'coded' ELSE 'other' END) AS error_type FROM "{stream}" WHERE action_category = 'performanceMetric') GROUP BY error_type"""),

    # CTE with COALESCE for fallback source
    ("""WITH source_map AS (SELECT _timestamp, coalesce(page_url, resource_path) AS origin, action_category, action_subcategory, visitor_session_id, latency_ms FROM "{stream}" WHERE action_category = 'navigation') SELECT origin, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency FROM source_map GROUP BY origin ORDER BY cnt DESC"""),

    # CTE with NOT IN filter + aggregation
    ("""WITH clean_data AS (SELECT * FROM "{stream}" WHERE error_code NOT IN ('E002', 'E004', 'E005') AND exception_message NOT LIKE '%Timeout%' AND action_category NOT IN ('interaction', 'navigation') AND info_tag IS NULL) SELECT component_name, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM clean_data GROUP BY component_name ORDER BY cnt DESC"""),

    # CTE joining two subqueries (june6: self-CTE pattern)
    ("""WITH metrics AS (SELECT visitor_session_id, COUNT(*) AS event_count FROM "{stream}" WHERE action_category = 'performanceMetric' GROUP BY visitor_session_id), navigations AS (SELECT visitor_session_id, COUNT(*) AS nav_count FROM "{stream}" WHERE action_category = 'navigation' GROUP BY visitor_session_id) SELECT COALESCE(m.visitor_session_id, n.visitor_session_id) AS user_id, COALESCE(m.event_count, 0) AS metrics, COALESCE(n.nav_count, 0) AS navigations FROM metrics m FULL OUTER JOIN navigations n ON m.visitor_session_id = n.visitor_session_id"""),

    # CTE with platform classification + GROUP BY
    ("""WITH classified AS (SELECT *, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE 'Other' END) AS platform_group FROM "{stream}" WHERE org_name = 'warehouse-east') SELECT platform_group, page_slug, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM classified GROUP BY platform_group, page_slug ORDER BY platform_group, cnt DESC"""),

    # CTE with multi-condition CASE
    ("""WITH event_class AS (SELECT *, (CASE WHEN latency_ms < 100 THEN 'fast' WHEN latency_ms < 500 THEN 'normal' WHEN latency_ms < 1000 THEN 'slow' ELSE 'degraded' END) AS speed, (CASE WHEN response_code = 200 THEN 'ok' WHEN response_code >= 500 THEN 'server_error' WHEN response_code >= 400 THEN 'client_error' ELSE 'unknown' END) AS outcome FROM "{stream}" WHERE latency_ms > 0) SELECT speed, outcome, COUNT(*) AS cnt FROM event_class GROUP BY speed, outcome ORDER BY cnt DESC"""),

    # Subquery with STRING_AGG (june6: aggregated list)
    ("""SELECT error_code, COUNT(*) AS cnt FROM (SELECT error_code, exception_message FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL) GROUP BY error_code ORDER BY cnt DESC LIMIT 5"""),

    # CTE with complex WHERE + HAVING
    ("""WITH filtered AS (SELECT * FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND device_type IN ('Mobile', 'Computer', 'Tablet') AND page_slug IN ('itemPage', 'cartPage', 'checkoutPage') AND action_category IN ('performanceMetric', 'navigation', 'interaction')) SELECT page_slug, action_category, COUNT(*) AS cnt FROM filtered GROUP BY page_slug, action_category HAVING COUNT(*) >= 2"""),

    # CTE with COALESCE + CONCAT + aggregation
    ("""WITH display AS (SELECT concat(page_slug, '/', action_category) AS page_action, coalesce(exception_message, error_code, 'none') AS issue, visitor_session_id FROM "{stream}" WHERE action_category = 'performanceMetric') SELECT page_action, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM display GROUP BY page_action ORDER BY cnt DESC"""),

    # CTE with subquery in FROM (june6: nested aggregation)
    ("""WITH raw_counts AS (SELECT page_slug, COUNT(*) AS total FROM "{stream}" WHERE action_category = 'navigation' GROUP BY page_slug), error_counts AS (SELECT page_slug, COUNT(*) AS errors FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY page_slug) SELECT COALESCE(r.page_slug, e.page_slug) AS page, COALESCE(r.total, 0) AS total_nav, COALESCE(e.errors, 0) AS total_errors FROM raw_counts r LEFT JOIN error_counts e ON r.page_slug = e.page_slug ORDER BY total_nav DESC"""),

    # CTE with LIKE chain + DISTINCT
    ("""WITH suspect_events AS (SELECT DISTINCT visitor_session_id, action_category, page_slug FROM "{stream}" WHERE exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E%' OR error_code LIKE '%E00%' OR event_detail LIKE '%fail%') SELECT action_category, page_slug, COUNT(*) AS cnt FROM suspect_events GROUP BY action_category, page_slug ORDER BY cnt DESC"""),

    # CTE with char_length CASE + IS NULL
    ("""WITH error_data AS (SELECT (CASE WHEN char_length(exception_message) > 0 THEN exception_message ELSE error_code END) AS error_label, action_category, page_slug, visitor_session_id, info_tag FROM "{stream}" WHERE action_category = 'performanceMetric') SELECT error_label, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users, COUNT(CASE WHEN info_tag IS NULL THEN 1 END) AS untagged FROM error_data GROUP BY error_label ORDER BY cnt DESC"""),

    # CTE with platform mapping + percentage calc
    ("""WITH platform_data AS (SELECT (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE os_platform END) AS platform, action_category, error_code, exception_message FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category IN ('performanceMetric', 'navigation')) SELECT platform, COUNT(*) AS total, (100.0 * COUNT(CASE WHEN error_code IS NOT NULL THEN 1 END) / COUNT(*)) AS error_rate FROM platform_data GROUP BY platform"""),

    # CTE with BETWEEN + COALESCE
    ("""WITH latency_data AS (SELECT coalesce(page_slug, 'unknown') AS page, latency_ms, response_code FROM "{stream}" WHERE latency_ms BETWEEN 50 AND 2000) SELECT page, COUNT(*) AS cnt, AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, COUNT(CASE WHEN response_code >= 400 THEN 1 END) AS errors FROM latency_data GROUP BY page"""),

    # CTE with NOT IN on multiple fields
    ("""WITH clean AS (SELECT * FROM "{stream}" WHERE org_name NOT IN ('warehouse-south', 'warehouse-central') AND error_code NOT IN ('E002', 'E004') AND action_category NOT IN ('interaction', 'navigation') AND build_version NOT IN ('v1.0.0')) SELECT page_slug, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency FROM clean GROUP BY page_slug"""),

    # CTE with multi-field COALESCE chain
    ("""WITH enriched AS (SELECT _timestamp, coalesce(page_url, resource_path, endpoint_path, page_slug) AS effective_url, coalesce(exception_message, upstream_error_code, error_code) AS issue_text, visitor_session_id FROM "{stream}" WHERE action_category = 'performanceMetric') SELECT effective_url, COUNT(*) AS cnt, COUNT(CASE WHEN issue_text LIKE '%Exception%' OR issue_text LIKE '%UP-E%' THEN 1 END) AS issues FROM enriched GROUP BY effective_url ORDER BY cnt DESC"""),

    # Triple-nested subquery (june6: deep subqueries)
    ("""SELECT component_name, COUNT(*) AS cnt FROM (SELECT component_name, error_code FROM (SELECT component_name, error_code, exception_message FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message IS NOT NULL) WHERE error_code IN ('E001', 'E003', 'E005')) GROUP BY component_name"""),

    # CTE with specific platform + page filter (june6: focused dashboard query)
    ("""WITH android_item_page AS (SELECT * FROM "{stream}" WHERE re_match(os_platform, 'Android') AND page_slug = 'itemPage' AND action_category IN ('navigation', 'performanceMetric') AND exception_message IS NOT NULL) SELECT error_code, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM android_item_page GROUP BY error_code ORDER BY cnt DESC"""),

    # CTE with aggregate functions + HAVING
    ("""WITH page_stats AS (SELECT page_slug, COUNT(*) AS cnt, AVG(CAST(latency_ms AS FLOAT)) AS avg_lat FROM "{stream}" WHERE latency_ms > 0 GROUP BY page_slug) SELECT page_slug, cnt, avg_lat FROM page_stats WHERE avg_lat > 100 AND cnt > 2 ORDER BY avg_lat DESC"""),
]

# ============================
# DATE_TIME — 10 queries (Q296-Q305)
# ============================

DATE_TIME = [
    # _timestamp arithmetic with CASE (june6: reduced time window)
    ("""SELECT _timestamp, _timestamp - 360000000 AS reduced_start, _timestamp + 60000000 AS reduced_end, visitor_session_id, action_category, exception_message FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message LIKE '%Exception%' AND visitor_session_id IS NOT NULL"""),

    # date_trunc equivalent with integer math (june6: minute bucketing)
    ("""SELECT (_timestamp - (_timestamp % 60000000)) AS minute_bucket, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' AND page_slug = 'itemPage' GROUP BY minute_bucket ORDER BY minute_bucket"""),

    # Time range filter with aggregate (june6: time-windowed aggregation)
    ("""SELECT action_category, COUNT(*) AS cnt, MIN(_timestamp) AS first_event, MAX(_timestamp) AS last_event FROM "{stream}" WHERE action_category IN ('performanceMetric', 'navigation') GROUP BY action_category"""),

    # _timestamp with CONCAT for time-series display
    ("""SELECT _timestamp, concat(page_slug, '-', action_category) AS event_type, latency_ms, component_name FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 100 ORDER BY _timestamp DESC LIMIT 20"""),

    # Minute-rounded timestamp with CASE (june6: bucketed time report)
    ("""SELECT (_timestamp - (_timestamp % 120000000)) AS two_min_bucket, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE 'Other' END) AS platform, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' GROUP BY two_min_bucket, platform ORDER BY two_min_bucket"""),

    # Hour bucketing with integer division
    ("""SELECT (_timestamp / 3600000000) * 3600000000 AS hour_bucket, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'performanceMetric' GROUP BY hour_bucket ORDER BY hour_bucket"""),

    # Time arithmetic with multiple filters
    ("""SELECT _timestamp, visitor_session_id, action_category, page_slug, latency_ms FROM "{stream}" WHERE _timestamp BETWEEN (_timestamp - 300000000) AND (_timestamp + 300000000) AND action_category = 'performanceMetric' ORDER BY latency_ms DESC LIMIT 10"""),

    # _timestamp + COALESCE + action time
    ("""SELECT _timestamp, coalesce(page_url, page_slug) AS source, action_category, response_code, latency_ms FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 ORDER BY _timestamp DESC LIMIT 15"""),

    # Time-sorted with platform + page filter
    ("""SELECT _timestamp, os_platform, action_category, page_slug, error_code FROM "{stream}" WHERE re_match(os_platform, 'Android|iPhone|iOS') AND page_slug IN ('itemPage', 'cartPage') AND action_category IN ('navigation', 'performanceMetric', 'interaction') ORDER BY _timestamp ASC LIMIT 25"""),

    # Hour aggregation with GROUP BY (june6: hourly traffic pattern)
    ("""SELECT (_timestamp / 3600000000) * 3600000000 AS hour_slot, page_slug, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' GROUP BY hour_slot, page_slug ORDER BY hour_slot, cnt DESC"""),
]

# ============================
# FULL_TEXT_SEARCH — 20 queries (Q306-Q325)
# ============================

FULL_TEXT_SEARCH = [
    # LIKE with % wildcard (june6: HTTP path search)
    ("""SELECT COUNT(*) AS cnt, response_code AS status FROM "{stream}" WHERE uri_path LIKE '%/api/%' GROUP BY status ORDER BY status ASC"""),

    # Multi-field LIKE OR (june6: cross-field text search)
    ("""SELECT _timestamp, exception_message, error_code, action_category FROM "{stream}" WHERE exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E00%' OR error_code LIKE '%E00%' OR event_detail LIKE '%fail%' OR log_message LIKE '%ERROR%' ORDER BY _timestamp DESC"""),

    # LIKE with NOT LIKE exclusion (june6: targeted search)
    ("""SELECT * FROM "{stream}" WHERE exception_message LIKE '%Exception%' AND exception_message NOT LIKE '%Timeout%' AND exception_message NOT LIKE '%NullPointer%'"""),

    # LIKE chain on component names (june6: module name search)
    ("""SELECT _timestamp, component_name, action_category, exception_message FROM "{stream}" WHERE component_name LIKE '%sorter%' OR component_name LIKE '%conveyor%' OR component_name LIKE '%zone%' ORDER BY _timestamp DESC LIMIT 20"""),

    # re_match with LIKE combo (june6: platform-specific search)
    ("""SELECT _timestamp, os_platform, action_category, exception_message FROM "{stream}" WHERE re_match(os_platform, 'Android|iPhone|iOS') AND (exception_message LIKE '%Exception%' OR error_code LIKE '%E00%') AND action_category = 'performanceMetric'"""),

    # Complex LIKE OR chain across 8 fields (june6: comprehensive search)
    ("""SELECT _timestamp, exception_message, upstream_error_code, error_code, event_detail FROM "{stream}" WHERE exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E00%' OR error_code LIKE '%E00%' OR event_detail LIKE '%fail%' OR log_message LIKE '%ERROR%' OR issue_type LIKE '%timeout%' OR graphql_operation LIKE '%update%' OR api_name LIKE '%Search%' ORDER BY _timestamp DESC LIMIT 15"""),

    # NOT LIKE chain (june6: exclusion search)
    ("""SELECT * FROM "{stream}" WHERE exception_message NOT LIKE '%Timeout%' AND exception_message NOT LIKE '%NullPointer%' AND error_code NOT LIKE '%E00%' AND upstream_error_code NOT LIKE '%UP-E00%' AND action_category = 'performanceMetric'"""),

    # LIKE with IN combo (june6: filtered text search)
    ("""SELECT * FROM "{stream}" WHERE component_name LIKE '%zone%' AND page_slug IN ('itemPage', 'cartPage', 'checkoutPage') AND action_category = 'performanceMetric' AND org_name = 'warehouse-east'"""),

    # FTS with ORDER BY + LIMIT (june6: recent matches)
    ("""SELECT _timestamp, exception_message, error_code, visitor_session_id FROM "{stream}" WHERE exception_message LIKE '%Exception%' AND exception_message LIKE '%at%' ORDER BY _timestamp DESC LIMIT 10"""),

    # match_all equivalent (LIKE on log) (june6: full-text search)
    ("""SELECT _timestamp, log, action_category, page_slug FROM "{stream}" WHERE log LIKE '%ERROR%' OR log LIKE '%WARN%' ORDER BY _timestamp DESC LIMIT 10"""),

    # re_match on platform + LIKE on error (june6: platform errors)
    ("""SELECT _timestamp, os_platform, exception_message, error_code FROM "{stream}" WHERE re_match(os_platform, 'Android|iPhone|iOS') AND action_category = 'performanceMetric' AND (exception_message LIKE '%Exception%' OR exception_message LIKE '%Error%') ORDER BY _timestamp DESC"""),

    # Multi-field LIKE with DISTINCT (june6: unique matches)
    ("""SELECT DISTINCT component_name, error_code FROM "{stream}" WHERE (exception_message LIKE '%NullPointer%' OR exception_message LIKE '%Timeout%' OR exception_message LIKE '%ResourceExhausted%') AND action_category = 'performanceMetric'"""),

    # LIKE with NOT IN exclusion
    ("""SELECT * FROM "{stream}" WHERE component_name LIKE '%controller%' AND error_code NOT IN ('E001', 'E002') AND exception_message NOT LIKE '%Timeout%' AND action_category = 'performanceMetric'"""),

    # str_match_ignore_case (june6: case-insensitive search)
    ("""SELECT _timestamp, log, action_category FROM "{stream}" WHERE str_match_ignore_case(log, 'error') OR str_match_ignore_case(log, 'warn') ORDER BY _timestamp DESC LIMIT 10"""),

    # re_not_match exclusion (june6: negative regex filter)
    ("""SELECT * FROM "{stream}" WHERE re_not_match(error_code, 'E00[24]') AND action_category = 'performanceMetric' AND exception_message IS NOT NULL"""),

    # regexp_like (june6: regex filter)
    ("""SELECT _timestamp, component_name, exception_message FROM "{stream}" WHERE regexp_like(component_name, '(sorter|conveyor|zone)-[a-z]+') AND action_category = 'performanceMetric' ORDER BY _timestamp DESC LIMIT 20"""),

    # Combined re_match + re_not_match (june6: include + exclude)
    ("""SELECT _timestamp, os_platform, action_category, exception_message FROM "{stream}" WHERE re_match(os_platform, 'Android|iPhone|iOS') AND re_not_match(error_code, 'E00[12]') AND action_category = 'performanceMetric'"""),

    # LIKE with underscore wildcard
    ("""SELECT * FROM "{stream}" WHERE pallet_id LIKE 'PL-_00%' AND scan_category = 'inbound' ORDER BY _timestamp DESC"""),

    # Complex LIKE with OR + NOT LIKE combo
    ("""SELECT _timestamp, visitor_session_id, exception_message, error_code FROM "{stream}" WHERE (exception_message LIKE '%Exception%' OR error_code LIKE '%E00%') AND exception_message NOT LIKE '%Timeout%' AND error_code NOT IN ('E002') AND page_slug = 'itemPage'"""),

    # FTS with array_extract(regexp_match(...)) (june6: regex capture group)
    ("""SELECT _timestamp, array_extract(regexp_match(db_info, 'cid-([a-z0-9]+)'), 1) AS extracted_cid, action_category FROM "{stream}" WHERE action_category = 'performanceMetric' AND db_info IS NOT NULL LIMIT 10"""),
]

# ============================
# HISTOGRAM — 25 queries (Q326-Q350)
# ============================

HISTOGRAM = [
    # Basic histogram with CASE breakdown (june6: platform histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE 'Other' END) AS platform, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' GROUP BY _time, platform ORDER BY _time ASC"""),

    # Histogram with CASE inside COUNT (june6: error rate by platform)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(CASE WHEN action_category = 'performanceMetric' AND error_code NOT IN ('E001', 'E003') THEN 1 END) AS clean_metrics, COUNT(*) AS total_events FROM "{stream}" WHERE org_name = 'warehouse-east' GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with percentage calc (june6: error percentage)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, (100.0 * COUNT(CASE WHEN action_category = 'performanceMetric' AND exception_message LIKE '%Exception%' THEN 1 END) / COUNT(*)) AS error_pct FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category IN ('performanceMetric', 'navigation') GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with breakdown column (june6: x_axis + breakdown)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt, os_platform AS breakdown FROM "{stream}" WHERE page_slug IN ('itemPage', 'searchPage') AND action_category IN ('navigation') AND os_platform IN ('Android 14', 'iOS 17.4', 'Windows 11') AND org_name IN ('warehouse-east') GROUP BY _time, breakdown ORDER BY _time ASC"""),

    # Histogram with long IN list filter (june6: focused histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND device_type IN ('Mobile', 'Computer', 'Tablet') AND page_slug = 'itemPage' AND action_category IN ('performanceMetric', 'navigation') GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with NOT IN + IS NOT NULL (june6: exclusion histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version NOT IN ('v1.0.0', 'v1.1.2') AND device_type IN ('Mobile', 'Computer') AND page_slug = 'itemPage' AND action_category IN ('performanceMetric', 'navigation') GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with LIKE filter (june6: error histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, exception_message, COUNT(*) AS error_count FROM "{stream}" WHERE org_name IN ('warehouse-east', 'warehouse-west') AND re_match(os_platform, 'Android|iPhone') AND action_category = 'performanceMetric' AND (exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E%') GROUP BY _time, exception_message ORDER BY _time ASC"""),

    # Histogram with platform + error breakdown (june6: dual breakdown)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE os_platform END) AS platform, COUNT(CASE WHEN action_category = 'performanceMetric' AND error_code NOT IN ('E002', 'E004') AND exception_message NOT LIKE '%Timeout%' THEN 1 END) AS filtered_count FROM "{stream}" WHERE org_name = 'warehouse-east' GROUP BY _time, platform ORDER BY _time ASC"""),

    # Histogram threshold-style query (june6: threshold monitoring)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, MAX(latency_ms) AS max_latency, COUNT(CASE WHEN latency_ms > 500 THEN 1 END) AS slow_count, COUNT(*) AS total FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with multiple CASE COUNT (june6: multi-metric histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(CASE WHEN action_category = 'performanceMetric' THEN 1 END) AS performance_count, COUNT(CASE WHEN action_category = 'navigation' THEN 1 END) AS navigation_count, COUNT(CASE WHEN action_category = 'interaction' THEN 1 END) AS interaction_count FROM "{stream}" WHERE org_name = 'warehouse-east' GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with COALESCE filter (june6: coalesce in histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt, coalesce(page_url, page_slug) AS page FROM "{stream}" WHERE action_category = 'navigation' AND org_name = 'warehouse-east' GROUP BY _time, page ORDER BY _time ASC"""),

    # Histogram with char_length CASE (june6: error display histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, (CASE WHEN char_length(exception_message) > 20 THEN substring(exception_message, 1, 20) || '...' ELSE exception_message END) AS short_error, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message IS NOT NULL GROUP BY _time, short_error ORDER BY _time ASC"""),

    # Histogram with approx_percentile (june6: P95 histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, approx_percentile_cont(CAST(latency_ms AS FLOAT), 0.95) AS p95_latency, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 AND page_slug LIKE '%Page%' GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with device_type breakdown
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, device_type, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'navigation' AND page_slug = 'itemPage' AND device_type IN ('Mobile', 'Computer', 'Tablet') GROUP BY _time, device_type ORDER BY _time ASC"""),

    # Histogram with NOT IN exclusion pattern
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version NOT IN ('v1.0.0', 'v1.1.2', 'v1.2.0') AND device_type IN ('Mobile', 'Computer') AND page_slug = 'itemPage' AND action_category NOT IN ('interaction', 'navigation') GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with error type breakdown
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, error_code, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL AND error_code IN ('E001', 'E003', 'E005', 'E002', 'E004') GROUP BY _time, error_code ORDER BY _time ASC"""),

    # Histogram with long multi-condition WHERE
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' AND build_version IS NOT NULL AND device_type IN ('Mobile', 'Computer', 'Tablet') AND page_slug IN ('itemPage', 'cartPage') AND action_category IN ('performanceMetric', 'navigation') AND error_code NOT IN ('E002', 'E004') AND visitor_session_id IS NOT NULL GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with component breakdown
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, component_name, COUNT(*) AS cnt, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 GROUP BY _time, component_name ORDER BY _time ASC"""),

    # Histogram with 5-minute bucket (different granularity)
    ("""SELECT histogram(_timestamp, '5 minutes') AS _time, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE org_name = 'warehouse-east' GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with platform + page breakdown (june6: multi-column breakdown)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' WHEN os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%' THEN 'iOS' ELSE os_platform END) AS platform, page_slug, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' AND page_slug IN ('itemPage', 'cartPage', 'searchPage') GROUP BY _time, platform, page_slug ORDER BY _time ASC"""),

    # Histogram with LIKE chain OR filter
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "{stream}" WHERE exception_message LIKE '%Exception%' OR upstream_error_code LIKE '%UP-E%' OR error_code LIKE '%E00%' GROUP BY _time ORDER BY _time ASC"""),

    # Histogram with response_code breakdown
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, response_code, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND response_code > 0 GROUP BY _time, response_code ORDER BY _time ASC"""),

    # Histogram with tag breakdown
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, tag_a, COUNT(*) AS cnt, COUNT(DISTINCT visitor_session_id) AS users FROM "{stream}" WHERE action_category = 'navigation' AND tag_a IN ('prod', 'staging') GROUP BY _time, tag_a ORDER BY _time ASC"""),

    # Histogram with 1-minute bucket + CASE (june6: fine-grained histogram)
    ("""SELECT histogram(_timestamp, '1 minutes') AS _time, (CASE WHEN latency_ms < 100 THEN 'fast' WHEN latency_ms < 500 THEN 'medium' ELSE 'slow' END) AS speed, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 GROUP BY _time, speed ORDER BY _time ASC"""),

    # Histogram COUNT with HAVING-like filter (june6: zero-result histogram)
    ("""SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-nonexistent' GROUP BY _time ORDER BY _time ASC"""),
]

# ============================
# MATH_FUNCTIONS — 8 queries (Q351-Q358)
# ============================

MATH_FUNCTIONS = [
    # Arithmetic percentage calc (june6: rate calculation)
    ("""SELECT (100.0 * COUNT(CASE WHEN response_code >= 400 THEN 1 END) / COUNT(*)) AS error_rate, (100.0 * COUNT(CASE WHEN latency_ms > 500 THEN 1 END) / COUNT(*)) AS slow_rate, COUNT(*) AS total FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # ROUND + AVG (june6: rounded metrics)
    ("""SELECT page_slug, ROUND(AVG(CAST(latency_ms AS FLOAT)), 2) AS avg_latency, ROUND(MAX(latency_ms), 2) AS max_latency, ROUND(MIN(latency_ms), 2) AS min_latency FROM "{stream}" WHERE latency_ms > 0 AND action_category = 'performanceMetric' GROUP BY page_slug"""),

    # ABS + arithmetic (june6: delta calculation)
    ("""SELECT ABS(MAX(latency_ms) - MIN(latency_ms)) AS latency_spread, AVG(CAST(latency_ms AS FLOAT)) AS avg_latency, COUNT(*) AS cnt FROM "{stream}" WHERE latency_ms > 0 AND action_category = 'performanceMetric'"""),

    # POWER + SQRT (june6: statistical math)
    ("""SELECT SQRT(AVG(CAST(latency_ms * latency_ms AS FLOAT)) - AVG(CAST(latency_ms AS FLOAT)) * AVG(CAST(latency_ms AS FLOAT))) AS stddev_approx, AVG(CAST(latency_ms AS FLOAT)) AS mean, COUNT(*) AS cnt FROM "{stream}" WHERE latency_ms > 0 AND action_category = 'performanceMetric'"""),

    # Arithmetic with CASE (june6: ratio calculation)
    ("""SELECT (CASE WHEN COUNT(CASE WHEN action_category = 'navigation' THEN 1 END) > 0 THEN ROUND(100.0 * COUNT(CASE WHEN action_category = 'performanceMetric' THEN 1 END) / COUNT(CASE WHEN action_category = 'navigation' THEN 1 END), 1) ELSE 0 END) AS metric_to_nav_ratio FROM "{stream}" WHERE org_name = 'warehouse-east'"""),

    # CEIL + FLOOR (june6: bucketing arithmetic)
    ("""SELECT FLOOR(AVG(CAST(latency_ms AS FLOAT)) / 100) * 100 AS latency_bucket_floor, CEIL(AVG(CAST(latency_ms AS FLOAT)) / 100) * 100 AS latency_bucket_ceil, COUNT(*) AS cnt FROM "{stream}" WHERE latency_ms > 0 GROUP BY page_slug"""),

    # Division + NULLIF (june6: safe division)
    ("""SELECT component_name, ROUND(100.0 * COUNT(CASE WHEN response_code >= 400 THEN 1 END) / NULLIF(COUNT(*), 0), 2) AS error_pct, COUNT(*) AS total FROM "{stream}" WHERE action_category = 'performanceMetric' GROUP BY component_name"""),

    # Complex arithmetic with multiple aggregates (june6: analytics math)
    ("""SELECT COUNT(*) AS n, SUM(CAST(latency_ms AS FLOAT)) AS sum_x, SUM(CAST(latency_ms * latency_ms AS FLOAT)) AS sum_x2, AVG(CAST(latency_ms AS FLOAT)) AS mean, (SUM(CAST(latency_ms * latency_ms AS FLOAT)) / COUNT(*) - AVG(CAST(latency_ms AS FLOAT)) * AVG(CAST(latency_ms AS FLOAT))) AS variance_approx FROM "{stream}" WHERE latency_ms > 0 AND action_category = 'performanceMetric'"""),
]

# ============================
# PAGINATION — 7 queries (Q359-Q365)
# ============================

PAGINATION = [
    # LIMIT with complex LIKE filter (june6: paginated search)
    ("""SELECT * FROM "{stream}" WHERE action_category = 'navigation' AND action_subcategory = 'clickEvent' AND page_slug = 'itemPage' AND component_name LIKE '%zone%' LIMIT 20"""),

    # LIMIT with multi-condition WHERE + ORDER BY (june6: sorted pagination)
    ("""SELECT _timestamp, visitor_session_id, action_category, exception_message FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category = 'performanceMetric' AND exception_message LIKE '%Exception%' ORDER BY _timestamp DESC LIMIT 15"""),

    # LIMIT with IN clause + ORDER BY (june6: filtered limited fetch)
    ("""SELECT * FROM "{stream}" WHERE action_category = 'navigation' AND action_subcategory = 'clickEvent' AND page_slug = 'itemPage' AND component_name LIKE '%conveyor%' AND device_type IN ('Mobile', 'Computer') LIMIT 10"""),

    # LIMIT with NOT IN exclusion
    ("""SELECT * FROM "{stream}" WHERE action_category = 'navigation' AND action_subcategory = 'clickEvent' AND page_slug = 'itemPage' AND device_type IN ('Mobile', 'Computer', 'Tablet') AND error_code NOT IN ('E001', 'E002') LIMIT 15"""),

    # LIMIT + OFFSET with ORDER BY
    ("""SELECT _timestamp, action_category, page_slug, latency_ms FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 ORDER BY latency_ms DESC LIMIT 10 OFFSET 5"""),

    # LIMIT with platform filter + LIKE chain
    ("""SELECT * FROM "{stream}" WHERE action_category = 'navigation' AND action_subcategory = 'clickEvent' AND page_slug = 'itemPage' AND (component_name LIKE '%sorter%' OR component_name LIKE '%zone%') AND os_platform IN ('Android 14', 'iOS 17.4') LIMIT 10"""),

    # LIMIT with CASE in ORDER BY
    ("""SELECT _timestamp, action_category, page_slug, error_code, exception_message FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category IN ('performanceMetric', 'navigation') ORDER BY (CASE WHEN error_code IS NOT NULL THEN 0 ELSE 1 END), _timestamp DESC LIMIT 20"""),
]

# ============================
# STRING_FUNCTIONS — 15 queries (Q366-Q380)
# ============================

STRING_FUNCTIONS = [
    # CONCAT multi-field (june6: message construction)
    ("""SELECT concat(action_category, '-', action_subcategory, ' :: ', coalesce(exception_message, 'ok')) AS event_summary, _timestamp, visitor_session_id FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # COALESCE chain (june6: fallback display)
    ("""SELECT _timestamp, coalesce(exception_message, upstream_error_code, error_code, 'no_error') AS display_error, coalesce(page_url, resource_path, endpoint_path) AS source FROM "{stream}" WHERE action_category = 'performanceMetric'"""),

    # UPPER/LOWER with LIKE (june6: case-insensitive matching)
    ("""SELECT _timestamp, UPPER(error_code) AS err, LOWER(exception_message) AS msg, action_category FROM "{stream}" WHERE action_category = 'performanceMetric' AND LOWER(exception_message) LIKE '%exception%'"""),

    # SUBSTRING with char_length (june6: truncation)
    ("""SELECT _timestamp, (CASE WHEN char_length(exception_message) > 30 THEN substring(exception_message, 1, 30) || '...' ELSE exception_message END) AS truncated_error, error_code FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message IS NOT NULL"""),

    # CONCAT with COALESCE in WHERE (june6: enriched filter)
    ("""SELECT concat(page_slug, '/', action_category) AS path, COUNT(*) AS cnt FROM "{stream}" WHERE concat(page_slug, '/', action_category) LIKE '%itemPage%' GROUP BY path ORDER BY cnt DESC"""),

    # TRIM + LOWER (june6: normalized comparison)
    ("""SELECT _timestamp, action_category, error_code FROM "{stream}" WHERE LOWER(TRIM(error_code)) IN ('e001', 'e003', 'e005') AND action_category = 'performanceMetric'"""),

    # REPLACE + CONCAT (june6: string transform)
    ("""SELECT _timestamp, REPLACE(component_name, '-engine', '') AS comp_short, REPLACE(exception_message, 'Exception', 'ERR') AS short_msg FROM "{stream}" WHERE action_category = 'performanceMetric' AND component_name LIKE '%engine%'"""),

    # char_length with CASE + aggregation
    ("""SELECT (CASE WHEN char_length(exception_message) > 40 THEN 'long_msg' WHEN char_length(exception_message) > 10 THEN 'medium_msg' WHEN char_length(exception_message) > 0 THEN 'short_msg' ELSE 'no_msg' END) AS msg_length_class, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' GROUP BY msg_length_class"""),

    # STRING_AGG with ORDER BY
    ("""SELECT page_slug, STRING_AGG(DISTINCT error_code, ' | ' ORDER BY error_code ASC) AS error_list FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY page_slug"""),

    # Multi-field CONCAT with COALESCE (june6: display string)
    ("""SELECT _timestamp, concat(coalesce(page_url, page_slug), ' | ', coalesce(exception_message, 'ok')) AS display_text, visitor_session_id FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category = 'performanceMetric' LIMIT 20"""),

    # UPPER + LOWER + CONCAT combo
    ("""SELECT _timestamp, concat(UPPER(action_category), ':', LOWER(error_code)) AS type_code, exception_message FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL"""),

    # char_length filter + CONCAT
    ("""SELECT concat(substring(exception_message, 1, 25), '... [', error_code, ']') AS summary, action_category FROM "{stream}" WHERE action_category = 'performanceMetric' AND char_length(exception_message) > 10"""),

    # LIKE with string functions (june6: pattern matching)
    ("""SELECT _timestamp, exception_message FROM "{stream}" WHERE action_category = 'performanceMetric' AND LOWER(exception_message) LIKE '%timeout%' AND LOWER(component_name) LIKE '%controller%'"""),

    # CONCAT_WS-style manual concat
    ("""SELECT _timestamp, concat(page_slug, ' -> ', action_category, ' -> ', action_subcategory) AS full_path, latency_ms FROM "{stream}" WHERE action_category = 'navigation' ORDER BY _timestamp DESC LIMIT 15"""),

    # Multi-level coalesce with CONCAT (june6: comprehensive fallback)
    ("""SELECT _timestamp, concat(coalesce(page_url, resource_path, endpoint_path, page_slug), '?', coalesce(http_method, 'GET')) AS full_url, visitor_session_id, action_category FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category IN ('performanceMetric', 'navigation') LIMIT 20"""),
]

# ============================
# UNION — 12 queries (Q381-Q392)
# ============================

UNION = [
    # UNION ALL with different page filters (june6: multi-page union)
    ("""SELECT 'item_page' AS source, component_name, COUNT(*) AS cnt FROM "{stream}" WHERE page_slug = 'itemPage' AND action_category = 'performanceMetric' GROUP BY component_name UNION ALL SELECT 'cart_page' AS source, component_name, COUNT(*) AS cnt FROM "{stream}" WHERE page_slug = 'cartPage' AND action_category = 'performanceMetric' GROUP BY component_name UNION ALL SELECT 'search_page' AS source, component_name, COUNT(*) AS cnt FROM "{stream}" WHERE page_slug = 'searchPage' AND action_category = 'performanceMetric' GROUP BY component_name"""),

    # UNION ALL with platform breakdown (june6: platform union)
    ("""SELECT 'Android' AS platform, page_slug, COUNT(*) AS cnt FROM "{stream}" WHERE os_platform LIKE '%Android%' AND action_category = 'navigation' GROUP BY page_slug UNION ALL SELECT 'iOS' AS platform, page_slug, COUNT(*) AS cnt FROM "{stream}" WHERE (os_platform LIKE '%iOS%' OR os_platform LIKE '%iPhone%') AND action_category = 'navigation' GROUP BY page_slug UNION ALL SELECT 'Other' AS platform, page_slug, COUNT(*) AS cnt FROM "{stream}" WHERE os_platform NOT LIKE '%Android%' AND os_platform NOT LIKE '%iOS%' AND os_platform NOT LIKE '%iPhone%' AND action_category = 'navigation' GROUP BY page_slug"""),

    # UNION with COALESCE + subquery (june6: unified source union)
    ("""SELECT coalesce(page_url, page_slug) AS source, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' AND page_slug = 'itemPage' GROUP BY source UNION ALL SELECT coalesce(page_url, page_slug) AS source, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' AND page_slug = 'cartPage' GROUP BY source"""),

    # UNION with error aggregation across orgs
    ("""SELECT 'east' AS region, error_code, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code UNION ALL SELECT 'west' AS region, error_code, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-west' AND action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code"""),

    # UNION ALL with different device types
    ("""SELECT 'mobile' AS device_class, action_category, COUNT(*) AS cnt FROM "{stream}" WHERE device_type IN ('Mobile', 'Tablet') AND action_category IN ('performanceMetric', 'navigation') GROUP BY action_category UNION ALL SELECT 'desktop' AS device_class, action_category, COUNT(*) AS cnt FROM "{stream}" WHERE device_type = 'Computer' AND action_category IN ('performanceMetric', 'navigation') GROUP BY action_category"""),

    # UNION with complex WHERE in each branch
    ("""SELECT 'errors' AS event_type, error_code AS detail, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL AND exception_message LIKE '%Exception%' GROUP BY error_code UNION ALL SELECT 'upstream_errors' AS event_type, upstream_error_code AS detail, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND upstream_error_code IS NOT NULL AND upstream_error_code LIKE '%UP-E%' GROUP BY upstream_error_code"""),

    # UNION ALL with CASE breakdown
    ("""SELECT (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' ELSE 'non-Android' END) AS platform, COUNT(CASE WHEN action_category = 'navigation' THEN 1 END) AS nav_cnt, COUNT(CASE WHEN action_category = 'performanceMetric' THEN 1 END) AS metric_cnt FROM "{stream}" GROUP BY platform UNION ALL SELECT 'TOTAL' AS platform, COUNT(CASE WHEN action_category = 'navigation' THEN 1 END) AS nav_cnt, COUNT(CASE WHEN action_category = 'performanceMetric' THEN 1 END) AS metric_cnt FROM "{stream}" """),

    # UNION with subquery filters
    ("""SELECT * FROM (SELECT _timestamp, 'error' AS record_type, exception_message AS detail, action_category FROM "{stream}" WHERE action_category = 'performanceMetric' AND exception_message LIKE '%Exception%' LIMIT 10) UNION ALL SELECT * FROM (SELECT _timestamp, 'timeout' AS record_type, event_detail AS detail, action_category FROM "{stream}" WHERE action_category = 'performanceMetric' AND event_detail LIKE '%timeout%' LIMIT 10)"""),

    # UNION ALL with different tag environments
    ("""SELECT 'prod' AS env, error_code, COUNT(*) AS cnt FROM "{stream}" WHERE tag_a = 'prod' AND action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code UNION ALL SELECT 'staging' AS env, error_code, COUNT(*) AS cnt FROM "{stream}" WHERE tag_a = 'staging' AND action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code UNION ALL SELECT 'dev' AS env, error_code, COUNT(*) AS cnt FROM "{stream}" WHERE tag_a = 'dev' AND action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code"""),

    # UNION with aggregate across different action types
    ("""SELECT 'page_nav' AS metric, page_slug AS label, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'navigation' GROUP BY page_slug UNION ALL SELECT 'component_err' AS metric, component_name AS label, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY component_name"""),

    # UNION ALL with multiple orgs + platform classification
    ("""SELECT org_name, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' ELSE os_platform END) AS platform, COUNT(*) AS cnt FROM "{stream}" WHERE org_name IN ('warehouse-east', 'warehouse-west') AND action_category = 'navigation' GROUP BY org_name, platform UNION ALL SELECT 'warehouse-north' AS org_name, (CASE WHEN os_platform LIKE '%Android%' THEN 'Android' ELSE os_platform END) AS platform, COUNT(*) AS cnt FROM "{stream}" WHERE org_name = 'warehouse-north' AND action_category = 'navigation' GROUP BY platform"""),

    # UNION with ORDER BY (june6: top results union)
    ("""SELECT error_code, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code UNION ALL SELECT upstream_error_code, COUNT(*) AS cnt FROM "{stream}" WHERE action_category = 'performanceMetric' AND upstream_error_code IS NOT NULL GROUP BY upstream_error_code ORDER BY cnt DESC LIMIT 10"""),
]

# ============================
# WINDOW — 8 queries (Q393-Q400)
# ============================

WINDOW = [
    # ROW_NUMBER with complex WHERE filter
    ("""SELECT _timestamp, visitor_session_id, action_category, page_slug, exception_message, ROW_NUMBER() OVER (PARTITION BY visitor_session_id ORDER BY _timestamp) AS event_seq FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category IN ('performanceMetric', 'navigation') AND visitor_session_id IS NOT NULL"""),

    # RANK with platform grouping
    ("""SELECT page_slug, os_platform, COUNT(*) AS cnt, RANK() OVER (PARTITION BY os_platform ORDER BY COUNT(*) DESC) AS popularity_rank FROM "{stream}" WHERE action_category = 'navigation' AND os_platform IN ('Android 14', 'iOS 17.4', 'Windows 11') GROUP BY page_slug, os_platform"""),

    # LAG with multi-condition filter
    ("""SELECT _timestamp, action_category, latency_ms, LAG(latency_ms, 1) OVER (ORDER BY _timestamp) AS prev_latency, latency_ms - LAG(latency_ms, 1) OVER (ORDER BY _timestamp) AS latency_change FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 AND page_slug = 'itemPage'"""),

    # ROW_NUMBER with subquery + WHERE
    ("""SELECT * FROM (SELECT _timestamp, visitor_session_id, action_category, page_slug, error_code, ROW_NUMBER() OVER (PARTITION BY visitor_session_id ORDER BY _timestamp DESC) AS rn FROM "{stream}" WHERE org_name = 'warehouse-east' AND action_category = 'performanceMetric') WHERE rn <= 3"""),

    # SUM OVER window with PARTITION
    ("""SELECT _timestamp, page_slug, COUNT(*) AS cnt, SUM(COUNT(*)) OVER (PARTITION BY page_slug ORDER BY _timestamp) AS cumulative_count FROM "{stream}" WHERE action_category = 'navigation' AND page_slug IN ('itemPage', 'cartPage') GROUP BY _timestamp, page_slug"""),

    # FIRST_VALUE + LAST_VALUE
    ("""SELECT DISTINCT visitor_session_id, FIRST_VALUE(page_slug) OVER (PARTITION BY visitor_session_id ORDER BY _timestamp) AS first_page, LAST_VALUE(page_slug) OVER (PARTITION BY visitor_session_id ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_page FROM "{stream}" WHERE action_category = 'navigation' AND visitor_session_id IS NOT NULL"""),

    # DENSE_RANK with platform + error grouping
    ("""SELECT error_code, COUNT(*) AS cnt, DENSE_RANK() OVER (ORDER BY COUNT(*) DESC) AS error_rank FROM "{stream}" WHERE action_category = 'performanceMetric' AND error_code IS NOT NULL GROUP BY error_code"""),

    # NTILE with complex WHERE
    ("""SELECT _timestamp, visitor_session_id, latency_ms, NTILE(4) OVER (ORDER BY latency_ms) AS latency_quartile FROM "{stream}" WHERE action_category = 'performanceMetric' AND latency_ms > 0 AND page_slug = 'itemPage' AND org_name = 'warehouse-east'"""),
]

# ── Assemble ──────────────────────────────────────────────────────────────

qid = 201
for cat_name, queries in [
    ("aggregation", AGGREGATION),
    ("basic_select", BASIC_SELECT),
    ("combined", COMBINED),
    ("cte_subquery", CTE_SUBQUERY),
    ("date_time", DATE_TIME),
    ("full_text_search", FULL_TEXT_SEARCH),
    ("histogram", HISTOGRAM),
    ("math_functions", MATH_FUNCTIONS),
    ("pagination", PAGINATION),
    ("string_functions", STRING_FUNCTIONS),
    ("union", UNION),
    ("window", WINDOW),
]:
    for sql in queries:
        entry = make_entry(f"Q{qid:03d}", cat_name, sql)
        QUERIES.append(entry)
        qid += 1

# ── Append to JSON files ──────────────────────────────────────────────────

def main():
    """Append Q201-Q400 entries to the 12 category JSON files."""
    categories = [
        ("aggregation", AGGREGATION),
        ("basic_select", BASIC_SELECT),
        ("combined", COMBINED),
        ("cte_subquery", CTE_SUBQUERY),
        ("date_time", DATE_TIME),
        ("full_text_search", FULL_TEXT_SEARCH),
        ("histogram", HISTOGRAM),
        ("math_functions", MATH_FUNCTIONS),
        ("pagination", PAGINATION),
        ("string_functions", STRING_FUNCTIONS),
        ("union", UNION),
        ("window", WINDOW),
    ]

    for cat_name, queries in categories:
        fp = QUERIES_DIR / f"{cat_name}.json"
        if not fp.exists():
            print(f"WARNING: {fp} not found — skipping {cat_name}")
            continue

        with open(fp) as f:
            data = json.load(f)

        new_entries = [e for e in QUERIES if e["category"] == cat_name]
        data["queries"].extend(new_entries)

        with open(fp, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")

        print(f"{cat_name}: appended {len(new_entries)} queries ({new_entries[0]['id']}-{new_entries[-1]['id']})")

    print(f"\nTotal new queries: {len(QUERIES)}")
    print("Done. Run compute_counts.py next.")

if __name__ == "__main__":
    main()

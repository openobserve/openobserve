"""Generate Q511-Q556 queries from june7.sql production patterns.

Adapts real-world SQL patterns to use the existing FIELD_POOL fields
from data_gen.py.  Run from the repo root:

    python3 tests/test-data/query-agent/gen_q511_q556.py

WARNING: This script is NOT idempotent. Running it multiple times will
append duplicate queries to the JSON files. Check that the target query
IDs do not already exist before running.
"""

import json
from pathlib import Path

QUERIES_DIR = Path(__file__).parent / "queries"


def toff(qi):
    """Standard time_offset for a query index.
    Each query gets its own non-overlapping 60-second window:
    start_offset = (qi-1)*60M - 1M  (1s safety margin before)
    end_offset   = (qi-1)*60M + 73M (covers 5 records at 18s spacing + margin)
    """
    base = (qi - 1) * 60_000_000
    return {"start_offset": base - 1_000_000, "end_offset": base + 73_000_000}


def toff_wide(qi):
    """Wider window for queries that need more margin (histogram, etc.)."""
    base = (qi - 1) * 60_000_000
    return {"start_offset": base - 1_000_000, "end_offset": base + 163_000_000}


# ============================================================
# 46 new queries organised by category
# ============================================================

NEW_QUERIES = {
    # ── string_functions (10 queries: Q511-Q520) ────────────────
    "string_functions": [
        {
            "id": "Q511",
            "sql": (
                'SELECT spath(request_payload, \'message.endpoint\') AS endpoint, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case(request_payload, 'endpoint') "
                'GROUP BY endpoint ORDER BY cnt DESC LIMIT 5'
            ),
            "category": "string_functions",
            "time_offset": toff(511),
        },
        {
            "id": "Q512",
            "sql": (
                'SELECT spath(request_payload, \'message.status\') AS msg_status, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case(request_payload, 'status') "
                'GROUP BY msg_status ORDER BY cnt DESC LIMIT 5'
            ),
            "category": "string_functions",
            "time_offset": toff(512),
        },
        {
            "id": "Q513",
            "sql": (
                'SELECT split_part(exception_message, chr(32), 1) AS first_word, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY first_word ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(513),
        },
        {
            "id": "Q514",
            "sql": (
                'SELECT COALESCE(bot_flag, info_tag, passthrough_flag, '
                "CAST(auth_result AS VARCHAR)) AS fallback_tag, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY fallback_tag ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(514),
        },
        {
            "id": "Q515",
            "sql": (
                'SELECT CONCAT(component_name, \'/\', COALESCE(route_key, \'no-route\'), '
                "' (', scan_category, ')') AS full_route, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY full_route ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(515),
        },
        {
            "id": "Q516",
            "sql": (
                'SELECT '
                'CASE '
                'WHEN length(CONCAT(COALESCE(exception_message, \'\'), '
                "COALESCE(log_message, ''))) < 50 THEN 'short' "
                'WHEN length(CONCAT(COALESCE(exception_message, \'\'), '
                "COALESCE(log_message, ''))) < 100 THEN 'medium' "
                "ELSE 'long' END AS msg_class, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY msg_class ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(516),
        },
        {
            "id": "Q517",
            "sql": (
                'SELECT CAST(tag_a AS VARCHAR) || \'-\' || CAST(tag_b AS VARCHAR) '
                'AS combined_tag, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY combined_tag ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(517),
        },
        {
            "id": "Q518",
            "sql": (
                'SELECT UPPER(COALESCE(org_name, site_name, '
                "region_code, 'UNKNOWN')) AS location, "
                'LOWER(scan_category) AS scan_type, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY location, scan_type ORDER BY cnt DESC LIMIT 15'
            ),
            "category": "string_functions",
            "time_offset": toff(518),
        },
        {
            "id": "Q519",
            "sql": (
                "SELECT REPLACE(REPLACE(COALESCE(page_url, endpoint_path, '/'), "
                "'https://', ''), 'http://', '') AS clean_path, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE page_url IS NOT NULL OR endpoint_path IS NOT NULL '
                'GROUP BY clean_path ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(519),
        },
        {
            "id": "Q520",
            "sql": (
                'SELECT TRIM(COALESCE(build_signature, build_version)) AS build_id, '
                'SUBSTRING(COALESCE(build_signature, build_version), 1, 4) AS prefix, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY build_id, prefix ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(520),
        },
    ],

    # ── date_time (6 queries: Q521-Q526) ───────────────────────
    "date_time": [
        {
            "id": "Q521",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp - arrow_cast(360000000, \'Int64\') AS earlier_ts, '
                '_timestamp + arrow_cast(60000000, \'Int64\') AS later_ts, '
                'latency_ms '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(521),
        },
        {
            "id": "Q522",
            "sql": (
                'SELECT date_trunc(\'minute\', _timestamp) AS minute_bucket, '
                'COUNT(*) AS cnt, '
                'MAX(latency_ms) AS max_latency '
                'FROM "{stream}" '
                'GROUP BY minute_bucket ORDER BY minute_bucket ASC'
            ),
            "category": "date_time",
            "time_offset": toff(522),
        },
        {
            "id": "Q523",
            "sql": (
                "SELECT _timestamp, "
                "to_timestamp_micros(MAX(_timestamp)) AS max_ts_converted, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _timestamp ORDER BY _timestamp ASC LIMIT 5'
            ),
            "category": "date_time",
            "time_offset": toff(523),
        },
        {
            "id": "Q524",
            "sql": (
                'SELECT (_timestamp / 30000000) * 30000000 AS thirty_sec_bucket, '
                'COUNT(*) AS cnt, '
                'MIN(latency_ms) AS min_lat, '
                'MAX(latency_ms) AS max_lat '
                'FROM "{stream}" '
                'GROUP BY thirty_sec_bucket ORDER BY thirty_sec_bucket ASC'
            ),
            "category": "date_time",
            "time_offset": toff(524),
        },
        {
            "id": "Q525",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp - (_timestamp % 60000000) AS rounded_minute, '
                'latency_ms, throughput_rate '
                'FROM "{stream}" '
                'WHERE latency_ms > 100 '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(525),
        },
        {
            "id": "Q526",
            "sql": (
                'SELECT _timestamp, '
                'CAST((_timestamp - LAG(_timestamp) OVER (ORDER BY _timestamp)) '
                'AS BIGINT) / 1000 AS gap_ms, '
                'latency_ms '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 5'
            ),
            "category": "date_time",
            "time_offset": toff(526),
        },
    ],

    # ── histogram (7 queries: Q527-Q533) ───────────────────────
    "histogram": [
        {
            "id": "Q527",
            "sql": (
                'SELECT histogram(_timestamp, \'1 minute\') AS _time, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(527),
        },
        {
            "id": "Q528",
            "sql": (
                'SELECT histogram(_timestamp, \'30 second\') AS _time, '
                'component_name, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, component_name '
                'ORDER BY _time ASC, cnt DESC LIMIT 20'
            ),
            "category": "histogram",
            "time_offset": toff_wide(528),
        },
        {
            "id": "Q529",
            "sql": (
                'SELECT histogram(_timestamp, \'1 minute\') AS _time, '
                'COALESCE(scan_category, \'unknown\') AS scan_type, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_latency '
                'FROM "{stream}" '
                'GROUP BY _time, scan_type ORDER BY _time ASC, cnt DESC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(529),
        },
        {
            "id": "Q530",
            "sql": (
                'SELECT histogram(_timestamp, \'1 minute\') AS _time, '
                "COUNT(*) FILTER (WHERE response_code >= 400) AS error_count, "
                "COUNT(*) FILTER (WHERE response_code < 400) AS success_count, "
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(530),
        },
        {
            "id": "Q531",
            "sql": (
                'SELECT histogram(_timestamp, \'1 minute\') AS _time, '
                'SUM(CASE WHEN CAST(latency_ms AS FLOAT) > 500 '
                'THEN 1 ELSE 0 END) AS slow_count, '
                'SUM(CASE WHEN CAST(latency_ms AS FLOAT) <= 500 '
                'THEN 1 ELSE 0 END) AS fast_count '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(531),
        },
        {
            "id": "Q532",
            "sql": (
                'SELECT histogram(_timestamp, \'1 minute\') AS _time, '
                'CASE '
                "WHEN auth_result = 'pass' THEN 'authenticated' "
                "WHEN auth_result = 'fail' THEN 'failed' "
                "ELSE 'other' END AS auth_class, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, auth_class ORDER BY _time ASC, cnt DESC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(532),
        },
        {
            "id": "Q533",
            "sql": (
                'SELECT histogram(_timestamp, \'1 minute\') AS _time, '
                'COALESCE(info_tag, bot_flag) AS tag_info, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, tag_info ORDER BY _time ASC, cnt DESC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(533),
        },
    ],

    # ── combined (6 queries: Q534-Q539) ────────────────────────
    "combined": [
        {
            "id": "Q534",
            "sql": (
                'SELECT '
                'CASE '
                "WHEN auth_result = 'pass' AND response_code < 400 THEN 'success' "
                "WHEN auth_result = 'pass' AND response_code >= 400 THEN 'app_error' "
                "WHEN auth_result IN ('fail', 'denied') THEN 'auth_failure' "
                "ELSE 'unknown' END AS outcome_class, "
                'COUNT(*) AS cnt, '
                'COUNT(DISTINCT COALESCE(org_name, site_name)) AS distinct_tenants '
                'FROM "{stream}" '
                'GROUP BY outcome_class ORDER BY cnt DESC'
            ),
            "category": "combined",
            "time_offset": toff(534),
        },
        {
            "id": "Q535",
            "sql": (
                'SELECT '
                'COALESCE(scan_category, \'none\') AS scan_type, '
                'CASE '
                "WHEN CHAR_LENGTH(COALESCE(exception_message, '')) > 40 THEN 'long_error' "
                "WHEN CHAR_LENGTH(COALESCE(exception_message, '')) > 0 THEN 'short_error' "
                "ELSE 'no_error' END AS error_class, "
                'COUNT(*) AS cnt, '
                'ROUND(CAST(COUNT(*) AS FLOAT) * 100.0 / '
                'SUM(COUNT(*)) OVER (PARTITION BY COALESCE(scan_category, \'none\')), 1) '
                'AS pct_within_scan '
                'FROM "{stream}" '
                'GROUP BY scan_type, error_class ORDER BY scan_type, cnt DESC'
            ),
            "category": "combined",
            "time_offset": toff(535),
        },
        {
            "id": "Q536",
            "sql": (
                'SELECT '
                'device_type, '
                'page_slug, '
                'COUNT(*) AS page_views, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp, '
                'AVG(CAST(inp_micros AS FLOAT)) AS avg_inp, '
                'AVG(CAST(cls_score AS FLOAT)) AS avg_cls '
                'FROM "{stream}" '
                'WHERE device_type IS NOT NULL '
                'GROUP BY device_type, page_slug '
                'ORDER BY page_views DESC LIMIT 10'
            ),
            "category": "combined",
            "time_offset": toff(536),
        },
        {
            "id": "Q537",
            "sql": (
                'SELECT '
                'tag_b AS severity, '
                "SUM(CASE WHEN re_match(exception_message, "
                "'NullPointer|Timeout|Resource') THEN 1 ELSE 0 END) AS infra_errors, "
                "SUM(CASE WHEN re_match(exception_message, "
                "'Security|Validation|Configuration') THEN 1 ELSE 0 END) AS app_errors, "
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY severity ORDER BY total DESC'
            ),
            "category": "combined",
            "time_offset": toff(537),
        },
        {
            "id": "Q538",
            "sql": (
                'SELECT '
                'CAST(COALESCE(bot_flag, info_tag, \'none\') AS VARCHAR) AS flag_status, '
                'CASE '
                "WHEN threat_flag = 'true' THEN 'threat' "
                'WHEN passthrough_flag = \'true\' THEN \'passthrough\' '
                "ELSE 'normal' END AS traffic_type, "
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'GROUP BY flag_status, traffic_type ORDER BY cnt DESC'
            ),
            "category": "combined",
            "time_offset": toff(538),
        },
        {
            "id": "Q539",
            "sql": (
                'SELECT '
                'region_code, '
                'COUNT(*) AS total_events, '
                "COUNT(*) FILTER (WHERE auth_result = 'fail') AS auth_failures, "
                "ROUND(CAST(COUNT(*) FILTER (WHERE auth_result = 'fail') AS FLOAT) "
                '* 100.0 / NULLIF(COUNT(*), 0), 2) AS failure_pct '
                'FROM "{stream}" '
                'GROUP BY region_code '
                'HAVING COUNT(*) > 1 '
                'ORDER BY failure_pct DESC'
            ),
            "category": "combined",
            "time_offset": toff(539),
        },
    ],

    # ── full_text_search (5 queries: Q540-Q544) ────────────────
    "full_text_search": [
        {
            "id": "Q540",
            "sql": (
                'SELECT _timestamp, exception_message, log_message '
                'FROM "{stream}" '
                "WHERE re_match(exception_message, 'NullPointer|Timeout|Security') "
                "AND re_not_match(exception_message, 'Network') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(540),
        },
        {
            "id": "Q541",
            "sql": (
                'SELECT _timestamp, request_payload '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case(request_payload, 'endpoint') "
                "AND NOT str_match_ignore_case(request_payload, 'failed') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(541),
        },
        {
            "id": "Q542",
            "sql": (
                'SELECT _timestamp, COALESCE(exception_message, log_message) AS msg '
                'FROM "{stream}" '
                "WHERE regexp_like(COALESCE(exception_message, log_message), "
                "'.*Exception.*') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(542),
        },
        {
            "id": "Q543",
            "sql": (
                "SELECT _timestamp, log_message "
                'FROM "{stream}" '
                "WHERE match_all('ACK batch') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(543),
        },
        {
            "id": "Q544",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(exception_message, log_message, log) AS searchable_text '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case("
                "COALESCE(exception_message, log_message, log), 'error') "
                "AND COALESCE(exception_message, log_message, log) IS NOT NULL "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(544),
        },
    ],

    # ── cte_subquery (4 queries: Q545-Q548) ────────────────────
    "cte_subquery": [
        {
            "id": "Q545",
            "sql": (
                'WITH endpoint_stats AS ('
                'SELECT spath(request_payload, \'message.endpoint\') AS endpoint, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case(request_payload, 'endpoint') "
                'GROUP BY endpoint '
                ') '
                'SELECT endpoint, cnt '
                'FROM endpoint_stats '
                'WHERE cnt > 0 '
                'ORDER BY cnt DESC LIMIT 5'
            ),
            "category": "cte_subquery",
            "time_offset": toff(545),
        },
        {
            "id": "Q546",
            "sql": (
                'WITH resolved AS ('
                'SELECT _timestamp, '
                'COALESCE(org_name, site_name, region_code) AS tenant, '
                'COALESCE(latency_ms, lcp_micros) AS response_time, '
                'COALESCE(response_code, 0) AS status '
                'FROM "{stream}" '
                ') '
                'SELECT tenant, '
                'COUNT(*) AS reqs, '
                'AVG(CAST(response_time AS FLOAT)) AS avg_rt, '
                "SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors "
                'FROM resolved '
                'GROUP BY tenant ORDER BY reqs DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(546),
        },
        {
            "id": "Q547",
            "sql": (
                'WITH base AS ('
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'GROUP BY component_name '
                ') '
                'SELECT component_name, avg_lat, '
                'CASE '
                'WHEN avg_lat < 500 THEN \'fast\' '
                'WHEN avg_lat < 1500 THEN \'moderate\' '
                "ELSE 'slow' END AS perf_tier "
                'FROM base ORDER BY avg_lat DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(547),
        },
        {
            "id": "Q548",
            "sql": (
                'SELECT component_name, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms > ('
                'SELECT AVG(CAST(latency_ms AS FLOAT)) FROM "{stream}"'
                ') '
                'GROUP BY component_name '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(548),
        },
    ],

    # ── window (2 queries: Q549-Q550) ──────────────────────────
    "window": [
        {
            "id": "Q549",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'LAG(latency_ms) OVER (PARTITION BY component_name '
                'ORDER BY _timestamp) AS prev_latency, '
                'latency_ms - LAG(latency_ms) OVER (PARTITION BY component_name '
                'ORDER BY _timestamp) AS latency_delta '
                'FROM "{stream}" '
                'ORDER BY component_name, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(549),
        },
        {
            "id": "Q550",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(scan_category, \'unknown\') AS scan_type, '
                'latency_ms, '
                'NTILE(4) OVER (PARTITION BY COALESCE(scan_category, \'unknown\') '
                'ORDER BY latency_ms) AS latency_quartile '
                'FROM "{stream}" '
                'ORDER BY scan_type, latency_quartile ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(550),
        },
    ],

    # ── aggregation (2 queries: Q551-Q552) ─────────────────────
    "aggregation": [
        {
            "id": "Q551",
            "sql": (
                'SELECT component_name AS val, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE component_name IS NOT NULL '
                'AND component_name != \'\' '
                'GROUP BY val ORDER BY cnt DESC LIMIT 5'
            ),
            "category": "aggregation",
            "time_offset": toff(551),
        },
        {
            "id": "Q552",
            "sql": (
                'SELECT COALESCE(org_name, site_name) AS tenant, '
                'COALESCE(scan_category, \'all\') AS channel, '
                'COUNT(*) AS reqs, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_latency '
                'FROM "{stream}" '
                'WHERE org_name IS NOT NULL OR site_name IS NOT NULL '
                'GROUP BY tenant, channel ORDER BY reqs DESC LIMIT 15'
            ),
            "category": "aggregation",
            "time_offset": toff(552),
        },
    ],

    # ── cross_stream (1 query: Q553) ───────────────────────────
    "cross_stream": [
        {
            "id": "Q553",
            "sql": (
                'SELECT a.facility_zone, '
                'a.pallet_id AS pallet_a, '
                'b.pallet_id AS pallet_b, '
                'a.throughput_rate AS rate_a, '
                'b.throughput_rate AS rate_b '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.control_center = b.control_center '
                'WHERE a.throughput_rate > 300 '
                'ORDER BY a.throughput_rate DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(553),
        },
    ],

    # ── basic_select (2 queries: Q554-Q555) ────────────────────
    "basic_select": [
        {
            "id": "Q554",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(bot_flag, info_tag, passthrough_flag, '
                "'clean') AS security_tag, "
                'CAST(COALESCE(lcp_micros, inp_micros, latency_ms) AS FLOAT) '
                'AS perf_value, '
                'device_type, page_slug '
                'FROM "{stream}" '
                'ORDER BY perf_value DESC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(554),
        },
        {
            "id": "Q555",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(exception_message, log_message) AS msg, '
                'COALESCE(response_code, 0) AS status, '
                'latency_ms '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY latency_ms DESC NULLS LAST LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(555),
        },
    ],

    # ── union (1 query: Q556) ──────────────────────────────────
    "union": [
        {
            "id": "Q556",
            "sql": (
                'SELECT component_name AS source, '
                'latency_ms AS metric, '
                "'latency' AS metric_type "
                'FROM "{stream}" '
                'WHERE latency_ms > 500 '
                'UNION ALL '
                'SELECT component_name AS source, '
                'lcp_micros AS metric, '
                "'lcp' AS metric_type "
                'FROM "{stream}" '
                'WHERE lcp_micros > 1000000 '
                'ORDER BY metric_type, metric DESC LIMIT 15'
            ),
            "category": "union",
            "time_offset": toff(556),
        },
    ],
}


# ============================================================
# Append to category JSON files
# ============================================================

def main():
    added = 0
    for category, queries in NEW_QUERIES.items():
        path = QUERIES_DIR / f"{category}.json"
        if not path.exists():
            print(f"  SKIP: {path} does not exist")
            continue

        data = json.loads(path.read_text())
        existing_ids = {q["id"] for q in data["queries"]}

        for q in queries:
            if q["id"] in existing_ids:
                print(f"  SKIP: {q['id']} already exists in {category}.json")
                continue
            data["queries"].append(q)
            added += 1

        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  {category}.json: appended {len(queries)} queries")

    print(f"\nAdded {added} queries total.")

    # Verify
    total = 0
    all_ids = []
    for f in sorted(QUERIES_DIR.glob("*.json")):
        data = json.loads(f.read_text())
        total += len(data["queries"])
        all_ids.extend(q["id"] for q in data["queries"])

    print(f"Total queries now: {total}")

    # Check for duplicate IDs
    seen = set()
    dups = set()
    for qid in all_ids:
        if qid in seen:
            dups.add(qid)
        seen.add(qid)
    if dups:
        print(f"DUPLICATE IDs: {dups}")
    else:
        print("No duplicate IDs found.")


if __name__ == "__main__":
    main()

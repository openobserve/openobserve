"""Generate 50 CTE + match_all sentinel queries (Q1003-Q1052) for the
match_all FST projection rewrite path.

Mirrors structural patterns commonly seen in production customer queries
(fan-out UNION ALL with per-branch match_all + regex, multi-CTE nested,
CSE-triggering scalar wrappers on the FST field) but uses only the
test fixture schema — no customer identifiers, values, or tokens.

Run:
  cd tests/test-data/query-agent && python3 gen_q1003_q1052.py
"""
import json
from pathlib import Path

Q_FILE = Path(__file__).parent / "queries" / "full_text_search.json"

# Wide window covering all 5000 records (1000 query slots * 5 records each)
WIDE_WINDOW = {"start_offset": 0, "end_offset": 60_100_000_000}

# Narrower windows for queries where we want smaller aggregations
MID_WINDOW = {"start_offset": 0, "end_offset": 6_000_000_000}  # ~500 records
NARROW_WINDOW = {"start_offset": 0, "end_offset": 1_200_000_000}  # ~100 records


def q(qid, sql, cols, window=MID_WINDOW):
    return {
        "id": qid,
        "sql": sql,
        "category": "full_text_search",
        "expected": {"columns": cols},
        "time_offset": window,
    }


QUERIES = []


# ── Family A: subquery + match_all + GROUP BY (Q1003-Q1012) ─────────────────
# Simple inline-view shapes with match_all in the inner scope.

QUERIES.append(q("Q1003",
    "SELECT http_method, COUNT(*) AS n FROM ("
    "SELECT http_method FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND resource_path LIKE '%/logs/warehouse/%'"
    ") s GROUP BY http_method ORDER BY n DESC, http_method ASC LIMIT 20",
    ["http_method", "n"]))

QUERIES.append(q("Q1004",
    "SELECT facility_zone, cnt FROM ("
    "SELECT facility_zone, COUNT(*) AS cnt FROM \"{stream}\" "
    "WHERE match_all('event') GROUP BY facility_zone"
    ") s WHERE cnt > 1 ORDER BY cnt DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "cnt"]))

QUERIES.append(q("Q1005",
    "SELECT tag_a, COUNT(*) AS n FROM ("
    "SELECT tag_a FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND log_message LIKE '%warehouse%'"
    ") s GROUP BY tag_a ORDER BY n DESC, tag_a ASC LIMIT 10",
    ["tag_a", "n"]))

QUERIES.append(q("Q1006",
    "SELECT component_name, avg_lat FROM ("
    "SELECT component_name, AVG(CAST(latency_ms AS FLOAT)) AS avg_lat "
    "FROM \"{stream}\" WHERE match_all('warehouse') GROUP BY component_name"
    ") s ORDER BY avg_lat DESC, component_name ASC LIMIT 10",
    ["component_name", "avg_lat"]))

QUERIES.append(q("Q1007",
    "SELECT region_code, COUNT(*) AS c FROM ("
    "SELECT region_code FROM \"{stream}\" "
    "WHERE match_all('record') AND resource_path LIKE '%warehouse%'"
    ") s GROUP BY region_code ORDER BY c DESC, region_code ASC LIMIT 10",
    ["region_code", "c"]))

QUERIES.append(q("Q1008",
    "SELECT scan_category, COUNT(DISTINCT task_id) AS unique_tasks FROM ("
    "SELECT scan_category, task_id FROM \"{stream}\" "
    "WHERE match_all('warehouse')"
    ") s GROUP BY scan_category ORDER BY unique_tasks DESC, scan_category ASC LIMIT 10",
    ["scan_category", "unique_tasks"]))

QUERIES.append(q("Q1009",
    "SELECT sorter_model, SUM(throughput_rate) AS total FROM ("
    "SELECT sorter_model, throughput_rate FROM \"{stream}\" "
    "WHERE match_all('event') AND throughput_rate IS NOT NULL"
    ") s GROUP BY sorter_model ORDER BY total DESC, sorter_model ASC LIMIT 10",
    ["sorter_model", "total"]))

QUERIES.append(q("Q1010",
    "SELECT operation_mode, COUNT(*) AS cnt FROM ("
    "SELECT operation_mode FROM \"{stream}\" "
    "WHERE match_all('ACK') AND log LIKE '%batch%'"
    ") s GROUP BY operation_mode ORDER BY cnt DESC, operation_mode ASC LIMIT 10",
    ["operation_mode", "cnt"]))

QUERIES.append(q("Q1011",
    "SELECT conveyor_lane, COUNT(*) AS n FROM ("
    "SELECT conveyor_lane FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND response_code = 200"
    ") s GROUP BY conveyor_lane ORDER BY n DESC, conveyor_lane ASC LIMIT 10",
    ["conveyor_lane", "n"]))

QUERIES.append(q("Q1012",
    "SELECT app_label, cnt FROM ("
    "SELECT app_label, COUNT(*) AS cnt FROM \"{stream}\" "
    "WHERE match_all('event') GROUP BY app_label"
    ") s ORDER BY cnt DESC, app_label ASC LIMIT 10",
    ["app_label", "cnt"]))


# ── Family B: CTE with fan-out UNION ALL + match_all per branch (Q1013-Q1027) ─
# Mirrors the dominant customer shape. Each branch has match_all + optional
# LIKE/regexp_match filter, all consolidated in an outer aggregation.

QUERIES.append(q("Q1013",
    "WITH combined AS ("
    "SELECT facility_zone, 'primary' AS src FROM \"{stream}\" WHERE match_all('warehouse') "
    "UNION ALL "
    "SELECT facility_zone, 'secondary' AS src FROM \"{stream}\" WHERE match_all('event')"
    ") SELECT src, facility_zone, COUNT(*) AS cnt FROM combined "
    "GROUP BY src, facility_zone ORDER BY cnt DESC, src ASC, facility_zone ASC LIMIT 20",
    ["src", "facility_zone", "cnt"]))

QUERIES.append(q("Q1014",
    "WITH branched AS ("
    "SELECT facility_zone, 'GET' AS m FROM \"{stream}\" WHERE match_all('warehouse') AND log_message LIKE 'GET %' "
    "UNION ALL "
    "SELECT facility_zone, 'POST' AS m FROM \"{stream}\" WHERE match_all('warehouse') AND log_message LIKE 'POST %' "
    "UNION ALL "
    "SELECT facility_zone, 'INFO' AS m FROM \"{stream}\" WHERE match_all('warehouse') AND log_message LIKE 'INFO:%'"
    ") SELECT m, COUNT(*) AS cnt FROM branched GROUP BY m ORDER BY cnt DESC, m ASC LIMIT 10",
    ["m", "cnt"]))

QUERIES.append(q("Q1015",
    "WITH by_lane AS ("
    "SELECT conveyor_lane, 'A' AS bucket FROM \"{stream}\" WHERE match_all('warehouse') AND conveyor_lane = 'LANE-A' "
    "UNION ALL "
    "SELECT conveyor_lane, 'B' FROM \"{stream}\" WHERE match_all('warehouse') AND conveyor_lane = 'LANE-B' "
    "UNION ALL "
    "SELECT conveyor_lane, 'C' FROM \"{stream}\" WHERE match_all('warehouse') AND conveyor_lane = 'LANE-C' "
    "UNION ALL "
    "SELECT conveyor_lane, 'D' FROM \"{stream}\" WHERE match_all('warehouse') AND conveyor_lane = 'LANE-D'"
    ") SELECT bucket, COUNT(*) AS n FROM by_lane GROUP BY bucket ORDER BY bucket ASC LIMIT 10",
    ["bucket", "n"]))

QUERIES.append(q("Q1016",
    "WITH filtered AS ("
    "SELECT facility_zone FROM \"{stream}\" WHERE match_all('warehouse') AND regexp_match(log_message, 'GET') IS NOT NULL "
    "UNION ALL "
    "SELECT facility_zone FROM \"{stream}\" WHERE match_all('warehouse') AND regexp_match(log_message, 'POST') IS NOT NULL "
    "UNION ALL "
    "SELECT facility_zone FROM \"{stream}\" WHERE match_all('warehouse') AND regexp_match(log_message, 'ERROR') IS NOT NULL"
    ") SELECT facility_zone, COUNT(*) AS cnt FROM filtered "
    "GROUP BY facility_zone ORDER BY cnt DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "cnt"]))

QUERIES.append(q("Q1017",
    "WITH zones AS ("
    "SELECT facility_zone, 'z1' AS tier FROM \"{stream}\" WHERE match_all('event') AND facility_zone = 'ZONE-1' "
    "UNION ALL "
    "SELECT facility_zone, 'z2' FROM \"{stream}\" WHERE match_all('event') AND facility_zone = 'ZONE-2' "
    "UNION ALL "
    "SELECT facility_zone, 'z3' FROM \"{stream}\" WHERE match_all('event') AND facility_zone = 'ZONE-3'"
    ") SELECT tier, COUNT(DISTINCT facility_zone) AS uniq FROM zones GROUP BY tier ORDER BY tier ASC LIMIT 10",
    ["tier", "uniq"]))

QUERIES.append(q("Q1018",
    "WITH combined AS ("
    "SELECT pallet_id, region_code FROM \"{stream}\" WHERE match_all('warehouse') AND pallet_id IS NOT NULL "
    "UNION ALL "
    "SELECT pallet_id, region_code FROM \"{stream}\" WHERE match_all('event') AND pallet_id IS NOT NULL"
    ") SELECT region_code, COUNT(DISTINCT pallet_id) AS uniq FROM combined "
    "GROUP BY region_code ORDER BY uniq DESC, region_code ASC LIMIT 10",
    ["region_code", "uniq"]))

QUERIES.append(q("Q1019",
    "WITH src AS ("
    "SELECT http_method, response_code FROM \"{stream}\" WHERE match_all('warehouse') AND http_method = 'GET' "
    "UNION ALL "
    "SELECT http_method, response_code FROM \"{stream}\" WHERE match_all('warehouse') AND http_method = 'POST' "
    "UNION ALL "
    "SELECT http_method, response_code FROM \"{stream}\" WHERE match_all('warehouse') AND http_method = 'PUT' "
    "UNION ALL "
    "SELECT http_method, response_code FROM \"{stream}\" WHERE match_all('warehouse') AND http_method = 'DELETE'"
    ") SELECT http_method, COUNT(*) AS cnt FROM src "
    "GROUP BY http_method ORDER BY cnt DESC, http_method ASC LIMIT 10",
    ["http_method", "cnt"]))

QUERIES.append(q("Q1020",
    "WITH combined AS ("
    "SELECT tag_a, 'p' AS grp FROM \"{stream}\" WHERE match_all('warehouse') AND tag_a = 'prod' "
    "UNION ALL "
    "SELECT tag_a, 's' FROM \"{stream}\" WHERE match_all('warehouse') AND tag_a = 'staging' "
    "UNION ALL "
    "SELECT tag_a, 'd' FROM \"{stream}\" WHERE match_all('warehouse') AND tag_a = 'dev'"
    ") SELECT grp, COUNT(*) AS n FROM combined GROUP BY grp ORDER BY grp ASC LIMIT 10",
    ["grp", "n"]))

QUERIES.append(q("Q1021",
    "WITH combined AS ("
    "SELECT component_name, latency_ms FROM \"{stream}\" WHERE match_all('warehouse') AND latency_ms < 100 "
    "UNION ALL "
    "SELECT component_name, latency_ms FROM \"{stream}\" WHERE match_all('warehouse') AND latency_ms >= 100 AND latency_ms < 1000 "
    "UNION ALL "
    "SELECT component_name, latency_ms FROM \"{stream}\" WHERE match_all('warehouse') AND latency_ms >= 1000"
    ") SELECT component_name, COUNT(*) AS cnt FROM combined "
    "GROUP BY component_name ORDER BY cnt DESC, component_name ASC LIMIT 10",
    ["component_name", "cnt"]))

QUERIES.append(q("Q1022",
    "WITH types AS ("
    "SELECT record_type, org_name FROM \"{stream}\" WHERE match_all('warehouse') AND record_type = 'scan' "
    "UNION ALL "
    "SELECT record_type, org_name FROM \"{stream}\" WHERE match_all('warehouse') AND record_type = 'sort' "
    "UNION ALL "
    "SELECT record_type, org_name FROM \"{stream}\" WHERE match_all('warehouse') AND record_type = 'merge' "
    "UNION ALL "
    "SELECT record_type, org_name FROM \"{stream}\" WHERE match_all('warehouse') AND record_type = 'track'"
    ") SELECT record_type, COUNT(DISTINCT org_name) AS orgs FROM types "
    "GROUP BY record_type ORDER BY orgs DESC, record_type ASC LIMIT 10",
    ["record_type", "orgs"]))

QUERIES.append(q("Q1023",
    "WITH stmts AS ("
    "SELECT filter_result FROM \"{stream}\" WHERE match_all('warehouse') AND filter_result = 'allow' "
    "UNION ALL "
    "SELECT filter_result FROM \"{stream}\" WHERE match_all('event') AND filter_result = 'block' "
    "UNION ALL "
    "SELECT filter_result FROM \"{stream}\" WHERE match_all('record') AND filter_result IS NOT NULL"
    ") SELECT filter_result, COUNT(*) AS cnt FROM stmts "
    "GROUP BY filter_result ORDER BY cnt DESC, filter_result ASC LIMIT 10",
    ["filter_result", "cnt"]))

QUERIES.append(q("Q1024",
    "WITH src AS ("
    "SELECT guard_mode FROM \"{stream}\" WHERE match_all('warehouse') AND guard_mode = 'active' "
    "UNION ALL "
    "SELECT guard_mode FROM \"{stream}\" WHERE match_all('warehouse') AND guard_mode = 'passive' "
    "UNION ALL "
    "SELECT guard_mode FROM \"{stream}\" WHERE match_all('warehouse') AND guard_mode = 'disabled'"
    ") SELECT guard_mode, COUNT(*) AS cnt FROM src "
    "GROUP BY guard_mode ORDER BY cnt DESC, guard_mode ASC LIMIT 10",
    ["guard_mode", "cnt"]))

QUERIES.append(q("Q1025",
    "WITH src AS ("
    "SELECT auth_result FROM \"{stream}\" WHERE match_all('warehouse') AND auth_result = 'pass' "
    "UNION ALL "
    "SELECT auth_result FROM \"{stream}\" WHERE match_all('event') AND auth_result = 'fail' "
    "UNION ALL "
    "SELECT auth_result FROM \"{stream}\" WHERE match_all('warehouse') AND auth_result = 'denied'"
    ") SELECT auth_result, COUNT(*) AS n FROM src "
    "GROUP BY auth_result ORDER BY n DESC, auth_result ASC LIMIT 10",
    ["auth_result", "n"]))

QUERIES.append(q("Q1026",
    "WITH branches AS ("
    "SELECT issue_type FROM \"{stream}\" WHERE match_all('warehouse') AND issue_type = 'timeout' "
    "UNION ALL "
    "SELECT issue_type FROM \"{stream}\" WHERE match_all('warehouse') AND issue_type = 'overflow' "
    "UNION ALL "
    "SELECT issue_type FROM \"{stream}\" WHERE match_all('warehouse') AND issue_type = 'mismatch' "
    "UNION ALL "
    "SELECT issue_type FROM \"{stream}\" WHERE match_all('warehouse') AND issue_type = 'jam'"
    ") SELECT issue_type, COUNT(*) AS cnt FROM branches "
    "GROUP BY issue_type ORDER BY cnt DESC, issue_type ASC LIMIT 10",
    ["issue_type", "cnt"]))

QUERIES.append(q("Q1027",
    "WITH cats AS ("
    "SELECT scan_category, entity_id FROM \"{stream}\" WHERE match_all('warehouse') AND scan_category = 'inbound' "
    "UNION ALL "
    "SELECT scan_category, entity_id FROM \"{stream}\" WHERE match_all('warehouse') AND scan_category = 'outbound' "
    "UNION ALL "
    "SELECT scan_category, entity_id FROM \"{stream}\" WHERE match_all('warehouse') AND scan_category = 'internal'"
    ") SELECT scan_category, COUNT(DISTINCT entity_id) AS uniq FROM cats "
    "GROUP BY scan_category ORDER BY uniq DESC, scan_category ASC LIMIT 10",
    ["scan_category", "uniq"]))


# ── Family C: CTE + scalar wrapper on log/text field + match_all (CSE trigger) ─
# Q1028-Q1037. The scalar wrapper (trim, upper, split_part, substring) is what
# causes DataFusion's CSE to insert an intermediate ProjectionExec — the exact
# node the fix targets.

QUERIES.append(q("Q1028",
    "WITH extracted AS ("
    "SELECT upper(log) AS msg FROM \"{stream}\" "
    "WHERE resource_path LIKE '%/logs/warehouse/%' AND match_all('warehouse')"
    ") SELECT msg FROM extracted WHERE msg LIKE 'Q%' "
    "ORDER BY msg ASC LIMIT 20",
    ["msg"]))

QUERIES.append(q("Q1029",
    "WITH extracted AS ("
    "SELECT trim(log_message) AS m FROM \"{stream}\" "
    "WHERE resource_path LIKE '%/logs/%' AND match_all('warehouse')"
    ") SELECT m FROM extracted WHERE m IS NOT NULL AND m LIKE '%warehouse%' "
    "ORDER BY m ASC LIMIT 20",
    ["m"]))

QUERIES.append(q("Q1030",
    "WITH parts AS ("
    "SELECT split_part(log, ' ', 1) AS first_token FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND log IS NOT NULL"
    ") SELECT first_token, COUNT(*) AS c FROM parts "
    "GROUP BY first_token ORDER BY c DESC, first_token ASC LIMIT 20",
    ["first_token", "c"]))

QUERIES.append(q("Q1031",
    "WITH lower_log AS ("
    "SELECT lower(log) AS l FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND resource_path LIKE '%/warehouse/%'"
    ") SELECT l FROM lower_log WHERE l LIKE '%event%' "
    "ORDER BY l ASC LIMIT 20",
    ["l"]))

QUERIES.append(q("Q1032",
    "WITH sub AS ("
    "SELECT substring(log, 1, 8) AS prefix FROM \"{stream}\" "
    "WHERE match_all('warehouse')"
    ") SELECT prefix, COUNT(*) AS c FROM sub "
    "GROUP BY prefix ORDER BY c DESC, prefix ASC LIMIT 20",
    ["prefix", "c"]))

QUERIES.append(q("Q1033",
    "WITH parsed AS ("
    "SELECT trim(log) AS api, http_method FROM \"{stream}\" "
    "WHERE resource_path LIKE '%/logs/warehouse/%' AND match_all('warehouse')"
    ") SELECT http_method, COUNT(*) AS c FROM parsed "
    "WHERE api LIKE 'Q%' GROUP BY http_method ORDER BY c DESC, http_method ASC LIMIT 10",
    ["http_method", "c"]))

QUERIES.append(q("Q1034",
    "WITH extracted AS ("
    "SELECT concat(http_method, ':', trim(log)) AS composite FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND http_method IS NOT NULL"
    ") SELECT composite FROM extracted WHERE composite LIKE '%warehouse%' "
    "ORDER BY composite ASC LIMIT 10",
    ["composite"]))

QUERIES.append(q("Q1035",
    "WITH built AS ("
    "SELECT length(log) AS log_len, facility_zone FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND facility_zone IS NOT NULL"
    ") SELECT facility_zone, AVG(CAST(log_len AS FLOAT)) AS avg_len FROM built "
    "GROUP BY facility_zone ORDER BY avg_len DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "avg_len"]))

QUERIES.append(q("Q1036",
    "WITH tokenized AS ("
    "SELECT split_part(log, ' ', 2) AS token FROM \"{stream}\" "
    "WHERE match_all('event') AND log LIKE 'Q%'"
    ") SELECT token, COUNT(*) AS n FROM tokenized "
    "GROUP BY token ORDER BY n DESC, token ASC LIMIT 10",
    ["token", "n"]))

QUERIES.append(q("Q1037",
    "WITH replaced AS ("
    "SELECT regexp_replace(log, 'Q[0-9]+', 'QID') AS masked FROM \"{stream}\" "
    "WHERE match_all('warehouse')"
    ") SELECT masked, COUNT(*) AS c FROM replaced "
    "GROUP BY masked ORDER BY c DESC, masked ASC LIMIT 10",
    ["masked", "c"]))


# ── Family D: Multi-CTE nested + match_all + LIKE/regexp combos (Q1038-Q1047) ─
# Deeper plan trees. Each CTE feeds the next, giving many opportunities for
# intermediate ProjectionExec nodes.

QUERIES.append(q("Q1038",
    "WITH raw_hits AS ("
    "SELECT facility_zone, log, http_method FROM \"{stream}\" WHERE match_all('warehouse')"
    "), filtered AS ("
    "SELECT facility_zone, http_method FROM raw_hits WHERE log LIKE 'Q%'"
    "), grouped AS ("
    "SELECT facility_zone, COUNT(*) AS c FROM filtered GROUP BY facility_zone"
    ") SELECT facility_zone, c FROM grouped ORDER BY c DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "c"]))

QUERIES.append(q("Q1039",
    "WITH s1 AS ("
    "SELECT tag_a, log FROM \"{stream}\" WHERE match_all('warehouse')"
    "), s2 AS ("
    "SELECT tag_a FROM s1 WHERE log LIKE '%warehouse%'"
    "), s3 AS ("
    "SELECT tag_a, COUNT(*) AS n FROM s2 GROUP BY tag_a"
    ") SELECT tag_a, n FROM s3 ORDER BY n DESC, tag_a ASC LIMIT 10",
    ["tag_a", "n"]))

QUERIES.append(q("Q1040",
    "WITH a AS ("
    "SELECT component_name, latency_ms FROM \"{stream}\" WHERE match_all('warehouse')"
    "), b AS ("
    "SELECT component_name, latency_ms FROM a WHERE latency_ms IS NOT NULL"
    "), c AS ("
    "SELECT component_name, AVG(CAST(latency_ms AS FLOAT)) AS avg_lat FROM b GROUP BY component_name"
    ") SELECT component_name, avg_lat FROM c ORDER BY avg_lat DESC, component_name ASC LIMIT 10",
    ["component_name", "avg_lat"]))

QUERIES.append(q("Q1041",
    "WITH src AS ("
    "SELECT facility_zone, log_message FROM \"{stream}\" WHERE match_all('warehouse')"
    "), regexed AS ("
    "SELECT facility_zone FROM src WHERE regexp_match(log_message, 'GET|POST|PUT') IS NOT NULL"
    ") SELECT facility_zone, COUNT(*) AS cnt FROM regexed "
    "GROUP BY facility_zone ORDER BY cnt DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "cnt"]))

QUERIES.append(q("Q1042",
    "WITH s1 AS ("
    "SELECT region_code, org_name, pallet_id FROM \"{stream}\" WHERE match_all('warehouse')"
    "), s2 AS ("
    "SELECT region_code, org_name, pallet_id FROM s1 WHERE pallet_id IS NOT NULL AND org_name IS NOT NULL"
    ") SELECT region_code, COUNT(DISTINCT org_name) AS orgs, COUNT(DISTINCT pallet_id) AS pallets FROM s2 "
    "GROUP BY region_code ORDER BY orgs DESC, region_code ASC LIMIT 10",
    ["region_code", "orgs", "pallets"]))

QUERIES.append(q("Q1043",
    "WITH hits AS ("
    "SELECT sorter_model, throughput_rate, load_factor FROM \"{stream}\" "
    "WHERE match_all('event') AND throughput_rate IS NOT NULL"
    "), buckets AS ("
    "SELECT sorter_model, CASE WHEN load_factor < 50.0 THEN 'low' ELSE 'high' END AS band, throughput_rate FROM hits"
    ") SELECT band, sorter_model, AVG(throughput_rate) AS avg_t FROM buckets "
    "GROUP BY band, sorter_model ORDER BY avg_t DESC, band ASC, sorter_model ASC LIMIT 20",
    ["band", "sorter_model", "avg_t"]))

QUERIES.append(q("Q1044",
    "WITH src AS ("
    "SELECT log, http_method FROM \"{stream}\" WHERE match_all('warehouse')"
    "), trimmed AS ("
    "SELECT trim(log) AS m, http_method FROM src"
    "), filtered AS ("
    "SELECT m, http_method FROM trimmed WHERE m LIKE 'Q%warehouse%'"
    ") SELECT http_method, COUNT(*) AS c FROM filtered "
    "GROUP BY http_method ORDER BY c DESC, http_method ASC LIMIT 10",
    ["http_method", "c"]))

QUERIES.append(q("Q1045",
    "WITH raw AS ("
    "SELECT event_detail, facility_zone FROM \"{stream}\" WHERE match_all('warehouse')"
    "), extracted AS ("
    "SELECT facility_zone, event_detail FROM raw WHERE event_detail IS NOT NULL"
    "), matched AS ("
    "SELECT facility_zone FROM extracted WHERE regexp_match(event_detail, 'batch|segment') IS NOT NULL"
    ") SELECT facility_zone, COUNT(*) AS c FROM matched "
    "GROUP BY facility_zone ORDER BY c DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "c"]))

QUERIES.append(q("Q1046",
    "WITH lvl1 AS ("
    "SELECT api_name, http_method, latency_ms FROM \"{stream}\" WHERE match_all('warehouse')"
    "), lvl2 AS ("
    "SELECT api_name, http_method FROM lvl1 WHERE latency_ms > 50"
    ") SELECT api_name, http_method, COUNT(*) AS n FROM lvl2 "
    "GROUP BY api_name, http_method ORDER BY n DESC, api_name ASC, http_method ASC LIMIT 20",
    ["api_name", "http_method", "n"]))

QUERIES.append(q("Q1047",
    "WITH src AS ("
    "SELECT operation_name, exception_message FROM \"{stream}\" WHERE match_all('warehouse')"
    "), errs AS ("
    "SELECT operation_name FROM src WHERE regexp_match(exception_message, 'Exception') IS NOT NULL"
    ") SELECT operation_name, COUNT(*) AS c FROM errs "
    "GROUP BY operation_name ORDER BY c DESC, operation_name ASC LIMIT 10",
    ["operation_name", "c"]))


# ── Family E: Edge cases (Q1048-Q1052) ────────────────────────────────────
# DISTINCT, HAVING, CASE expressions, IN-list combined with match_all.

QUERIES.append(q("Q1048",
    "SELECT DISTINCT http_method, facility_zone FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND http_method IN ('GET','POST','PUT') "
    "ORDER BY http_method ASC, facility_zone ASC LIMIT 20",
    ["http_method", "facility_zone"]))

QUERIES.append(q("Q1049",
    "WITH grouped AS ("
    "SELECT region_code, COUNT(*) AS c FROM \"{stream}\" "
    "WHERE match_all('warehouse') GROUP BY region_code"
    ") SELECT region_code, c FROM grouped WHERE c > 5 "
    "ORDER BY c DESC, region_code ASC LIMIT 10",
    ["region_code", "c"]))

QUERIES.append(q("Q1050",
    "WITH src AS ("
    "SELECT facility_zone, CASE WHEN response_code >= 500 THEN 'server_err' "
    "WHEN response_code >= 400 THEN 'client_err' ELSE 'ok' END AS status_class "
    "FROM \"{stream}\" WHERE match_all('warehouse')"
    ") SELECT status_class, facility_zone, COUNT(*) AS c FROM src "
    "GROUP BY status_class, facility_zone "
    "ORDER BY c DESC, status_class ASC, facility_zone ASC LIMIT 20",
    ["status_class", "facility_zone", "c"]))

QUERIES.append(q("Q1051",
    "SELECT sorter_model, COUNT(*) AS c FROM \"{stream}\" "
    "WHERE match_all('warehouse') "
    "AND sorter_model IN ('SORT-X1','SORT-A7','SORT-M3','SORT-Q5') "
    "GROUP BY sorter_model HAVING COUNT(*) > 2 "
    "ORDER BY c DESC, sorter_model ASC LIMIT 10",
    ["sorter_model", "c"]))

QUERIES.append(q("Q1052",
    "WITH raw AS ("
    "SELECT tag_b, log_message, latency_ms FROM \"{stream}\" WHERE match_all('warehouse')"
    "), classified AS ("
    "SELECT tag_b, CASE WHEN latency_ms < 100 THEN 'fast' "
    "WHEN latency_ms < 1000 THEN 'medium' ELSE 'slow' END AS bucket "
    "FROM raw WHERE latency_ms IS NOT NULL"
    ") SELECT bucket, tag_b, COUNT(*) AS c FROM classified "
    "GROUP BY bucket, tag_b ORDER BY c DESC, bucket ASC, tag_b ASC LIMIT 20",
    ["bucket", "tag_b", "c"]))


# ── Family F: match_all inside JOINs (Q1053-Q1058) ────────────────────────
# JOIN builders inject their own projections; a distinct code path from
# CTE/UNION propagation. Cross-stream joins use {stream2} (secondary stream
# with same timestamps, different field-value rotation).

QUERIES.append(q("Q1053",
    "WITH a AS ("
    "SELECT facility_zone, COUNT(*) AS c FROM \"{stream}\" "
    "WHERE match_all('warehouse') GROUP BY facility_zone"
    "), b AS ("
    "SELECT facility_zone, COUNT(*) AS c FROM \"{stream}\" "
    "WHERE match_all('event') GROUP BY facility_zone"
    ") SELECT a.facility_zone, a.c AS c1, b.c AS c2 FROM a JOIN b "
    "ON a.facility_zone = b.facility_zone "
    "ORDER BY c1 DESC, a.facility_zone ASC LIMIT 10",
    ["facility_zone", "c1", "c2"]))

QUERIES.append(q("Q1054",
    "WITH a AS ("
    "SELECT facility_zone, COUNT(*) AS c FROM \"{stream}\" "
    "WHERE match_all('warehouse') GROUP BY facility_zone"
    "), b AS ("
    "SELECT facility_zone, COUNT(*) AS c FROM \"{stream}\" "
    "WHERE match_all('ACK') GROUP BY facility_zone"
    ") SELECT a.facility_zone, a.c AS all_c, COALESCE(b.c, 0) AS ack_c "
    "FROM a LEFT JOIN b ON a.facility_zone = b.facility_zone "
    "ORDER BY all_c DESC, a.facility_zone ASC LIMIT 10",
    ["facility_zone", "all_c", "ack_c"]))

QUERIES.append(q("Q1055",
    "WITH fts_a AS ("
    "SELECT facility_zone, COUNT(*) AS a_cnt FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND facility_zone IS NOT NULL "
    "GROUP BY facility_zone"
    "), all_b AS ("
    "SELECT facility_zone, COUNT(*) AS b_cnt FROM \"{stream2}\" "
    "WHERE facility_zone IS NOT NULL GROUP BY facility_zone"
    ") SELECT a.facility_zone, a.a_cnt, b.b_cnt FROM fts_a a "
    "JOIN all_b b ON a.facility_zone = b.facility_zone "
    "ORDER BY a.a_cnt DESC, a.facility_zone ASC LIMIT 10",
    ["facility_zone", "a_cnt", "b_cnt"]))

QUERIES.append(q("Q1056",
    "SELECT outer_t.http_method, outer_t.n FROM ("
    "SELECT http_method, COUNT(*) AS n FROM \"{stream}\" "
    "WHERE match_all('warehouse') GROUP BY http_method"
    ") outer_t JOIN ("
    "SELECT DISTINCT http_method FROM \"{stream}\" WHERE match_all('event')"
    ") inner_t ON outer_t.http_method = inner_t.http_method "
    "ORDER BY outer_t.n DESC, outer_t.http_method ASC LIMIT 10",
    ["http_method", "n"]))

QUERIES.append(q("Q1057",
    "WITH fts AS ("
    "SELECT facility_zone, pallet_id FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND pallet_id IS NOT NULL"
    ") SELECT f.facility_zone, COUNT(DISTINCT f.pallet_id) AS uniq "
    "FROM fts f JOIN fts f2 ON f.facility_zone = f2.facility_zone "
    "GROUP BY f.facility_zone ORDER BY uniq DESC, f.facility_zone ASC LIMIT 10",
    ["facility_zone", "uniq"]))

QUERIES.append(q("Q1058",
    "WITH fts_left AS ("
    "SELECT region_code, COUNT(*) AS l_cnt FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND region_code IS NOT NULL "
    "GROUP BY region_code"
    "), fts_right AS ("
    "SELECT region_code, COUNT(*) AS r_cnt FROM \"{stream2}\" "
    "WHERE match_all('event') AND region_code IS NOT NULL "
    "GROUP BY region_code"
    ") SELECT l.region_code, l.l_cnt, r.r_cnt FROM fts_left l "
    "JOIN fts_right r ON l.region_code = r.region_code "
    "ORDER BY l.l_cnt DESC, l.region_code ASC LIMIT 10",
    ["region_code", "l_cnt", "r_cnt"]))


# ── Family G: match_all + window functions (Q1059-Q1063) ──────────────────
# Window planning inserts its own projections above the filter. Fix's
# ProjectionExec handling has to survive that too.

QUERIES.append(q("Q1059",
    "WITH ranked AS ("
    "SELECT facility_zone, throughput_rate, "
    "ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC, _timestamp) AS rn "
    "FROM \"{stream}\" WHERE match_all('warehouse') AND throughput_rate IS NOT NULL"
    ") SELECT facility_zone, throughput_rate FROM ranked WHERE rn = 1 "
    "ORDER BY throughput_rate DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "throughput_rate"]))

QUERIES.append(q("Q1060",
    "WITH counted AS ("
    "SELECT sorter_model, "
    "COUNT(*) OVER (PARTITION BY sorter_model) AS per_model_count "
    "FROM \"{stream}\" WHERE match_all('warehouse')"
    ") SELECT sorter_model, MAX(per_model_count) AS max_c FROM counted "
    "GROUP BY sorter_model ORDER BY max_c DESC, sorter_model ASC LIMIT 10",
    ["sorter_model", "max_c"]))

QUERIES.append(q("Q1061",
    "WITH ranked AS ("
    "SELECT facility_zone, component_name, latency_ms, "
    "RANK() OVER (PARTITION BY facility_zone ORDER BY latency_ms DESC, _timestamp) AS r "
    "FROM \"{stream}\" WHERE match_all('warehouse') AND latency_ms IS NOT NULL"
    ") SELECT facility_zone, component_name, latency_ms FROM ranked "
    "WHERE r = 1 ORDER BY latency_ms DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "component_name", "latency_ms"]))

QUERIES.append(q("Q1062",
    "WITH windowed AS ("
    "SELECT tag_a, tag_b, "
    "SUM(CAST(payload_size AS BIGINT)) OVER (PARTITION BY tag_a) AS tag_total "
    "FROM \"{stream}\" WHERE match_all('warehouse') AND payload_size IS NOT NULL"
    ") SELECT tag_a, MAX(tag_total) AS max_total FROM windowed "
    "GROUP BY tag_a ORDER BY max_total DESC, tag_a ASC LIMIT 10",
    ["tag_a", "max_total"]))

QUERIES.append(q("Q1063",
    "WITH ranked AS ("
    "SELECT region_code, org_name, "
    "DENSE_RANK() OVER (PARTITION BY region_code ORDER BY org_name) AS dr "
    "FROM \"{stream}\" WHERE match_all('warehouse')"
    ") SELECT region_code, COUNT(DISTINCT dr) AS ranks FROM ranked "
    "GROUP BY region_code ORDER BY ranks DESC, region_code ASC LIMIT 10",
    ["region_code", "ranks"]))


# ── Family H: negated match_all (Q1064-Q1066) ─────────────────────────────
# The rewriter's negation path is a distinct branch. `NOT match_all(...)`
# should return rows that don't match the FTS term.

QUERIES.append(q("Q1064",
    "SELECT facility_zone, COUNT(*) AS cnt FROM \"{stream}\" "
    "WHERE NOT match_all('error') AND facility_zone IS NOT NULL "
    "GROUP BY facility_zone ORDER BY cnt DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "cnt"]))

QUERIES.append(q("Q1065",
    "WITH has_warehouse AS ("
    "SELECT facility_zone, log FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND NOT match_all('error')"
    ") SELECT facility_zone, COUNT(*) AS c FROM has_warehouse "
    "GROUP BY facility_zone ORDER BY c DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "c"]))

QUERIES.append(q("Q1066",
    "WITH pos AS ("
    "SELECT facility_zone, 'w' AS src FROM \"{stream}\" WHERE match_all('warehouse')"
    "), neg AS ("
    "SELECT facility_zone, 'n' AS src FROM \"{stream}\" WHERE NOT match_all('error')"
    ") SELECT src, COUNT(*) AS c FROM ("
    "SELECT * FROM pos UNION ALL SELECT * FROM neg"
    ") u GROUP BY src ORDER BY src ASC LIMIT 10",
    ["src", "c"]))


# ── Family I: multiple match_all in same query (Q1067-Q1069) ──────────────
# Two FST fields injected simultaneously; tests projection layering when
# the rewriter runs against multiple match_all invocations.

QUERIES.append(q("Q1067",
    "SELECT facility_zone, COUNT(*) AS both_cnt FROM \"{stream}\" "
    "WHERE match_all('warehouse') AND match_all('event') "
    "GROUP BY facility_zone ORDER BY both_cnt DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "both_cnt"]))

QUERIES.append(q("Q1068",
    "SELECT facility_zone, COUNT(*) AS or_cnt FROM \"{stream}\" "
    "WHERE match_all('warehouse') OR match_all('error') "
    "GROUP BY facility_zone ORDER BY or_cnt DESC, facility_zone ASC LIMIT 10",
    ["facility_zone", "or_cnt"]))

QUERIES.append(q("Q1069",
    "SELECT http_method, COUNT(*) AS cnt FROM \"{stream}\" "
    "WHERE (match_all('warehouse') OR match_all('event')) "
    "AND http_method IN ('GET','POST','PUT','DELETE') "
    "GROUP BY http_method ORDER BY cnt DESC, http_method ASC LIMIT 10",
    ["http_method", "cnt"]))


# ── Family J: histogram + match_all (Q1070-Q1072) ─────────────────────────
# Time-series over FTS results — a real customer pattern. Histogram
# planning is another optimizer pass that can shift plan structure.

QUERIES.append(q("Q1070",
    "SELECT histogram(_timestamp, '5 minute') AS bucket, COUNT(*) AS hits "
    "FROM \"{stream}\" WHERE match_all('warehouse') "
    "GROUP BY bucket ORDER BY bucket ASC LIMIT 20",
    ["bucket", "hits"]))

QUERIES.append(q("Q1071",
    "WITH bucketed AS ("
    "SELECT histogram(_timestamp, '10 minute') AS bucket, facility_zone "
    "FROM \"{stream}\" WHERE match_all('warehouse') AND facility_zone IS NOT NULL"
    ") SELECT bucket, facility_zone, COUNT(*) AS n FROM bucketed "
    "GROUP BY bucket, facility_zone ORDER BY bucket ASC, n DESC LIMIT 30",
    ["bucket", "facility_zone", "n"]))

QUERIES.append(q("Q1072",
    "SELECT bucket, avg_lat FROM ("
    "SELECT histogram(_timestamp, '15 minute') AS bucket, "
    "AVG(CAST(latency_ms AS FLOAT)) AS avg_lat "
    "FROM \"{stream}\" WHERE match_all('warehouse') AND latency_ms IS NOT NULL "
    "GROUP BY bucket"
    ") s ORDER BY bucket ASC LIMIT 20",
    ["bucket", "avg_lat"]))


def main():
    with open(Q_FILE) as f:
        data = json.load(f)

    existing = {q["id"] for q in data["queries"]}
    to_add = [q for q in QUERIES if q["id"] not in existing]

    if not to_add:
        print("All queries already present, nothing to add.")
        return

    data["queries"].extend(to_add)

    with open(Q_FILE, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"Added {len(to_add)} queries (out of {len(QUERIES)} defined).")
    print(f"full_text_search.json now has {len(data['queries'])} queries.")


if __name__ == "__main__":
    main()

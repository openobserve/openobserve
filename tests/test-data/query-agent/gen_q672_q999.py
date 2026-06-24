"""Generate Q672-Q999 queries — 328 complex queries to reach 1,000 total.

Targets DataFusion-upgrade-fragile areas: correlated subqueries, 3-stream
joins, window + DISTINCT / FTS combos, deep CTE chains, INTERSECT/EXCEPT,
and diverse histogram/aggregation patterns.

Run from the repo root:
    python3 tests/test-data/query-agent/gen_q672_q999.py

NOTE: Idempotent — re-running skips all existing queries (checks for existing query IDs before appending).

SQL placeholders:
    {stream}  — replaced at runtime with the primary test stream name
    {stream2} — replaced at runtime with the secondary cross-stream name
These are substituted by the test harness / DuckDB oracle before execution.
"""

import json
from pathlib import Path

QUERIES_DIR = Path(__file__).parent / "queries"


def toff(qi):
    """Standard 60-second window for query *qi*.

    Each query owns a ~60 s slice of the timeline starting at
    ``(qi - 1) * 60_000_000`` µs.  A 1 s pad before and a 13 s pad
    after the slice are added so histogram bucket edges and late-arriving
    records are captured.

    Magic numbers (all in microseconds):
        60_000_000  — 60 s (one minute)
         1_000_000  —  1 s padding before
        73_000_000  — 60 s + 13 s padding after
    """
    base = (qi - 1) * 60_000_000
    return {"start_offset": base - 1_000_000, "end_offset": base + 73_000_000}


def toff_wide(qi):
    """Wider window for histogram / multi-partition queries.

    Same base slice as :func:`toff` but with ~103 s of padding after
    to accommodate wider histogram bucket ranges and multi-aggregate
    queries that span multiple partitions.

    Magic numbers (all in microseconds):
        60_000_000  — 60 s (one minute)
         1_000_000  —  1 s padding before
       163_000_000  — 60 s + 103 s padding after
    """
    base = (qi - 1) * 60_000_000
    return {"start_offset": base - 1_000_000, "end_offset": base + 163_000_000}


# =========================================================================
# 328 new queries organised by category
# =========================================================================

NEW_QUERIES = {
    # ── cross_stream (45 queries: Q672-Q716) ──────────────────────────
    "cross_stream": [
        # -- 3-stream joins (high priority: tests HashJoinExec + RemoteScan) --
        {
            "id": "Q672",
            "sql": (
                'SELECT a.pallet_id AS pallet_a, b.pallet_id AS pallet_b, '
                'c.pallet_id AS pallet_c, '
                'a.throughput_rate AS rate_a, '
                'b.throughput_rate AS rate_b, '
                'c.load_factor AS load_c '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b ON a.facility_zone = b.facility_zone '
                'JOIN "{stream}" c ON a.control_center = c.control_center '
                'AND a.pallet_id != c.pallet_id '
                'WHERE a.throughput_rate > 300 '
                'ORDER BY a.throughput_rate DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(672),
        },
        {
            "id": "Q673",
            "sql": (
                'SELECT a.component_name, a.region_code, '
                'b.region_code AS region_b, '
                'COUNT(*) AS join_cnt, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat_a, '
                'AVG(CAST(b.latency_ms AS FLOAT)) AS avg_lat_b '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.operation_mode = b.operation_mode '
                'GROUP BY a.component_name, a.region_code, b.region_code '
                'ORDER BY join_cnt DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(673),
        },
        {
            "id": "Q674",
            "sql": (
                'SELECT a.org_name, a.site_name, b.org_name AS org_b, '
                'a.throughput_rate, b.load_factor, '
                'a.cell_temp, b.cell_temp AS temp_b '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.control_center = b.control_center '
                'AND a.conveyor_lane = b.conveyor_lane '
                'WHERE a.throughput_rate > 200 '
                'ORDER BY a.throughput_rate DESC, b.load_factor ASC NULLS LAST '
                'LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(674),
        },
        # -- Correlated EXISTS between streams --
        {
            "id": "Q675",
            "sql": (
                'SELECT a._timestamp, a.pallet_id, a.facility_zone, '
                'a.throughput_rate '
                'FROM "{stream}" a '
                'WHERE EXISTS ('
                'SELECT 1 FROM "{stream2}" b '
                'WHERE b.facility_zone = a.facility_zone '
                'AND b.throughput_rate > a.throughput_rate'
                ') '
                'ORDER BY a._timestamp ASC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(675),
        },
        {
            "id": "Q676",
            "sql": (
                'SELECT a.pallet_id, a.load_factor, a.operation_mode '
                'FROM "{stream}" a '
                'WHERE a.load_factor > ('
                'SELECT AVG(b.load_factor) FROM "{stream2}" b '
                'WHERE b.facility_zone = a.facility_zone'
                ') '
                'ORDER BY a.load_factor DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(676),
        },
        {
            "id": "Q677",
            "sql": (
                'SELECT a.component_name, a.latency_ms '
                'FROM "{stream}" a '
                'WHERE NOT EXISTS ('
                'SELECT 1 FROM "{stream2}" b '
                'WHERE b.component_name = a.component_name '
                'AND b.latency_ms < a.latency_ms'
                ') '
                'ORDER BY a.latency_ms DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(677),
        },
        # -- Semi / anti joins with IN / NOT IN --
        {
            "id": "Q678",
            "sql": (
                'SELECT facility_zone, pallet_id, throughput_rate '
                'FROM "{stream}" '
                'WHERE facility_zone IN ('
                'SELECT facility_zone FROM "{stream2}" '
                'WHERE load_factor > 50.0'
                ') '
                'ORDER BY throughput_rate DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(678),
        },
        {
            "id": "Q679",
            "sql": (
                'SELECT control_center, sorter_model '
                'FROM "{stream}" '
                'WHERE control_center NOT IN ('
                'SELECT control_center FROM "{stream2}" '
                'WHERE throughput_rate < 200.0'
                ') '
                'GROUP BY control_center, sorter_model '
                'ORDER BY control_center LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(679),
        },
        {
            "id": "Q680",
            "sql": (
                'SELECT a.operation_mode, a.facility_zone, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" a '
                'WHERE a.conveyor_lane IN ('
                'SELECT b.conveyor_lane FROM "{stream2}" b '
                'WHERE b.charge_remaining > 40.0'
                ') '
                'GROUP BY a.operation_mode, a.facility_zone '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(680),
        },
        # -- FULL OUTER JOIN --
        {
            "id": "Q681",
            "sql": (
                'SELECT COALESCE(a.facility_zone, b.facility_zone) AS zone, '
                'a.throughput_rate AS rate_a, '
                'b.load_factor AS load_b, '
                'a.sorter_model, b.sorter_model AS sorter_b '
                'FROM "{stream}" a '
                'FULL OUTER JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.control_center = b.control_center '
                'ORDER BY zone LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(681),
        },
        {
            "id": "Q682",
            "sql": (
                'SELECT COALESCE(a.component_name, b.component_name) AS comp, '
                'COALESCE(a.region_code, b.region_code) AS region, '
                'COUNT(a._timestamp) AS cnt_a, '
                'COUNT(b._timestamp) AS cnt_b '
                'FROM "{stream}" a '
                'FULL OUTER JOIN "{stream2}" b '
                'ON a.component_name = b.component_name '
                'AND a.scan_category = b.scan_category '
                'GROUP BY comp, region '
                'ORDER BY cnt_a DESC NULLS LAST LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(682),
        },
        # -- CROSS JOIN with conditions --
        {
            "id": "Q683",
            "sql": (
                'SELECT a.pallet_id AS pallet_a, b.pallet_id AS pallet_b, '
                'a.throughput_rate, b.load_factor, '
                'a.throughput_rate * b.load_factor AS combined_score '
                'FROM ('
                'SELECT pallet_id, throughput_rate, facility_zone '
                'FROM "{stream}" WHERE throughput_rate > 300 '
                'ORDER BY throughput_rate DESC LIMIT 5'
                ') a '
                'CROSS JOIN ('
                'SELECT pallet_id, load_factor, facility_zone '
                'FROM "{stream2}" WHERE load_factor > 40.0 '
                'ORDER BY load_factor DESC LIMIT 5'
                ') b '
                'WHERE a.facility_zone != b.facility_zone '
                'ORDER BY combined_score DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(683),
        },
        {
            "id": "Q684",
            "sql": (
                'SELECT a.component_name, b.region_code, '
                'COUNT(*) AS pair_cnt '
                'FROM "{stream}" a '
                'CROSS JOIN "{stream2}" b '
                'WHERE a.latency_ms IS NOT NULL '
                'AND b.latency_ms IS NOT NULL '
                'AND a.component_name != b.component_name '
                'GROUP BY a.component_name, b.region_code '
                'ORDER BY pair_cnt DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(684),
        },
        # -- JOIN + window function --
        {
            "id": "Q685",
            "sql": (
                'SELECT a.facility_zone, a.pallet_id, '
                'a.throughput_rate, b.load_factor, '
                'RANK() OVER ('
                'PARTITION BY a.facility_zone '
                'ORDER BY a.throughput_rate DESC'
                ') AS rank_in_zone '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.control_center = b.control_center '
                'ORDER BY a.facility_zone, rank_in_zone LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(685),
        },
        {
            "id": "Q686",
            "sql": (
                'SELECT a.component_name, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat_a, '
                'AVG(CAST(b.latency_ms AS FLOAT)) AS avg_lat_b, '
                'AVG(CAST(a.latency_ms AS FLOAT)) - '
                'AVG(CAST(b.latency_ms AS FLOAT)) AS diff '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.component_name = b.component_name '
                'AND a.region_code = b.region_code '
                'WHERE a.latency_ms IS NOT NULL '
                'GROUP BY a.component_name '
                'ORDER BY ABS(diff) DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(686),
        },
        # -- JOIN with aggregation in subquery --
        {
            "id": "Q687",
            "sql": (
                'WITH zone_stats AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate, '
                'MAX(throughput_rate) AS max_rate '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'zone_stats2 AS ('
                'SELECT facility_zone, '
                'AVG(load_factor) AS avg_load, '
                'MIN(load_factor) AS min_load '
                'FROM "{stream2}" GROUP BY facility_zone'
                ') '
                'SELECT z.facility_zone, '
                'z.avg_rate, z.max_rate, '
                'z2.avg_load, z2.min_load, '
                'z.avg_rate / NULLIF(z2.avg_load, 0) AS rate_per_load '
                'FROM zone_stats z '
                'JOIN zone_stats2 z2 ON z.facility_zone = z2.facility_zone '
                'ORDER BY rate_per_load DESC'
            ),
            "category": "cross_stream",
            "time_offset": toff(687),
        },
        {
            "id": "Q688",
            "sql": (
                'SELECT a.facility_zone, a.control_center, '
                'a.pallet_id, a.throughput_rate, '
                'z2.max_load, '
                'a.throughput_rate / NULLIF(z2.max_load, 0) AS efficiency '
                'FROM "{stream}" a '
                'JOIN ('
                'SELECT facility_zone, MAX(load_factor) AS max_load '
                'FROM "{stream2}" GROUP BY facility_zone'
                ') z2 ON a.facility_zone = z2.facility_zone '
                'WHERE a.throughput_rate > 200 '
                'ORDER BY efficiency DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(688),
        },
        # -- Self-reference across streams (same stream as different alias) --
        {
            "id": "Q689",
            "sql": (
                'SELECT a.facility_zone, '
                'a.throughput_rate AS rate_a, '
                'b.throughput_rate AS rate_b, '
                'ABS(a.throughput_rate - b.throughput_rate) AS rate_diff '
                'FROM "{stream}" a '
                'JOIN "{stream}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a._timestamp < b._timestamp '
                'WHERE a.throughput_rate > 200 '
                'AND b.throughput_rate > 200 '
                'ORDER BY rate_diff DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(689),
        },
        {
            "id": "Q690",
            "sql": (
                'SELECT a.control_center, '
                'a.load_factor AS load_a, '
                'b.load_factor AS load_b, '
                'a.load_factor + b.load_factor AS total_load '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.control_center = b.control_center '
                'JOIN "{stream}" c '
                'ON a.facility_zone = c.facility_zone '
                'AND a.operation_mode = c.operation_mode '
                'WHERE a.load_factor > 30 '
                'AND b.load_factor > 30 '
                'ORDER BY total_load DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(690),
        },
        # -- Anti join with aggregation --
        {
            "id": "Q691",
            "sql": (
                'SELECT a.component_name, '
                'COUNT(*) AS solo_cnt, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" a '
                'WHERE a.component_name NOT IN ('
                'SELECT DISTINCT b.component_name FROM "{stream2}" b '
                'WHERE b.latency_ms > 500'
                ') '
                'GROUP BY a.component_name '
                'ORDER BY solo_cnt DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(691),
        },
        # -- JOIN on nullable columns --
        {
            "id": "Q692",
            "sql": (
                'SELECT COALESCE(a.info_tag, \'none\') AS tag_a, '
                'COALESCE(b.info_tag, \'none\') AS tag_b, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.variant_tag = b.variant_tag '
                'GROUP BY COALESCE(a.info_tag, \'none\'), COALESCE(b.info_tag, \'none\') '
                'ORDER BY cnt DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(692),
        },
        {
            "id": "Q693",
            "sql": (
                'SELECT a.org_name, b.org_name AS org_b, '
                'a.threat_flag, b.threat_flag AS threat_b, '
                'COUNT(*) AS pair_cnt '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'WHERE a.threat_flag IS NOT NULL '
                'OR b.threat_flag IS NOT NULL '
                'GROUP BY a.org_name, b.org_name, '
                'a.threat_flag, b.threat_flag '
                'ORDER BY pair_cnt DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(693),
        },
        # -- Right join --
        {
            "id": "Q694",
            "sql": (
                'SELECT COALESCE(a.pallet_id, \'no-match\') AS pallet_a, '
                'b.pallet_id AS pallet_b, '
                'a.throughput_rate, b.load_factor '
                'FROM "{stream}" a '
                'RIGHT JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.sorter_model = b.sorter_model '
                'ORDER BY b.load_factor DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(694),
        },
        # -- Double self-join + stream2 --
        {
            "id": "Q695",
            "sql": (
                'SELECT a.pallet_id, a.facility_zone, '
                'b.pallet_id AS peer, '
                'c.pallet_id AS cross_peer, '
                'a.throughput_rate, '
                'c.load_factor '
                'FROM "{stream}" a '
                'JOIN "{stream}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.pallet_id < b.pallet_id '
                'JOIN "{stream2}" c '
                'ON b.facility_zone = c.facility_zone '
                'WHERE a.throughput_rate > 300 '
                'ORDER BY a.throughput_rate DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(695),
        },
        # -- Multi-condition join + aggregation --
        {
            "id": "Q696",
            "sql": (
                'SELECT a.operation_mode, a.facility_zone, '
                'COUNT(*) AS matches, '
                'SUM(a.throughput_rate) AS total_rate, '
                'SUM(b.load_factor) AS total_load, '
                'SUM(a.item_count) AS total_items '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.operation_mode = b.operation_mode '
                'AND a.conveyor_lane = b.conveyor_lane '
                'GROUP BY a.operation_mode, a.facility_zone '
                'HAVING COUNT(*) > 0 '
                'ORDER BY total_rate DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(696),
        },
        # -- JOIN + DISTINCT --
        {
            "id": "Q697",
            "sql": (
                'SELECT DISTINCT a.facility_zone, a.control_center, '
                'a.sorter_model, b.conveyor_lane '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'ORDER BY a.facility_zone, a.control_center LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(697),
        },
        # -- Correlated NOT EXISTS --
        {
            "id": "Q698",
            "sql": (
                'SELECT a.org_name, a.component_name, a.latency_ms '
                'FROM "{stream}" a '
                'WHERE NOT EXISTS ('
                'SELECT 1 FROM "{stream2}" b '
                'WHERE b.component_name = a.component_name '
                'AND b.latency_ms > a.latency_ms '
                ') '
                'AND a.latency_ms > 100 '
                'ORDER BY a.latency_ms ASC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(698),
        },
        # -- CTE-based cross-stream merge --
        {
            "id": "Q699",
            "sql": (
                'WITH stream_a AS ('
                'SELECT facility_zone, pallet_id, throughput_rate, '
                'operation_mode '
                'FROM "{stream}" WHERE throughput_rate > 200'
                '), '
                'stream_b AS ('
                'SELECT facility_zone, pallet_id, load_factor, '
                'operation_mode '
                'FROM "{stream2}" WHERE load_factor > 30'
                ') '
                'SELECT a.facility_zone, '
                'a.pallet_id AS pallet_a, '
                'b.pallet_id AS pallet_b, '
                'a.throughput_rate, b.load_factor '
                'FROM stream_a a '
                'INNER JOIN stream_b b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.operation_mode = b.operation_mode '
                'ORDER BY a.throughput_rate DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(699),
        },
        # -- Cross-stream window + aggregation --
        {
            "id": "Q700",
            "sql": (
                'SELECT a.facility_zone, '
                'COUNT(*) AS join_rows, '
                'AVG(CAST(a.throughput_rate AS FLOAT)) AS avg_rate, '
                'STDDEV(CAST(a.throughput_rate AS FLOAT)) AS std_rate, '
                'AVG(CAST(b.load_factor AS FLOAT)) AS avg_load '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.control_center = b.control_center '
                'GROUP BY a.facility_zone '
                'HAVING COUNT(*) > 0 '
                'ORDER BY avg_rate DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(700),
        },
        # -- EXISTS with COUNT comparison --
        {
            "id": "Q701",
            "sql": (
                'SELECT a.region_code, '
                'COUNT(*) AS stream_a_cnt, '
                'SUM(CASE WHEN EXISTS ('
                'SELECT 1 FROM "{stream2}" b '
                'WHERE b.region_code = a.region_code '
                'AND b.latency_ms > 500'
                ') THEN 1 ELSE 0 END) AS has_high_lat_b '
                'FROM "{stream}" a '
                'GROUP BY a.region_code '
                'ORDER BY stream_a_cnt DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(701),
        },
        # -- Complex 3-table join with NULL handling --
        {
            "id": "Q702",
            "sql": (
                'SELECT COALESCE(a.facility_zone, b.facility_zone) AS zone, '
                'a.pallet_id, b.pallet_id AS pallet_b, '
                'c.pallet_id AS pallet_c, '
                'a.throughput_rate, b.load_factor, c.cell_temp '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'LEFT JOIN "{stream}" c '
                'ON a.control_center = c.control_center '
                'AND a.pallet_id < c.pallet_id '
                'ORDER BY zone, a.throughput_rate DESC NULLS LAST LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(702),
        },
        # -- Remaining cross-stream queries --
        {
            "id": "Q703",
            "sql": (
                'SELECT a.facility_zone, '
                'COUNT(DISTINCT a.pallet_id) AS distinct_pallets_a, '
                'COUNT(DISTINCT b.pallet_id) AS distinct_pallets_b, '
                'MAX(a.throughput_rate) AS peak_rate, '
                'MIN(b.load_factor) AS min_load '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'GROUP BY a.facility_zone '
                'ORDER BY peak_rate DESC'
            ),
            "category": "cross_stream",
            "time_offset": toff(703),
        },
        {
            "id": "Q704",
            "sql": (
                'SELECT a.sorter_model, a.conveyor_lane, '
                'b.sorter_model AS sorter_b, b.conveyor_lane AS lane_b, '
                'APPROX_DISTINCT(a.pallet_id) AS approx_pallets, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.operation_mode = b.operation_mode '
                'GROUP BY a.sorter_model, a.conveyor_lane, '
                'b.sorter_model, b.conveyor_lane '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(704),
        },
        {
            "id": "Q705",
            "sql": (
                'SELECT a.component_name, a.scan_category, '
                'b.scan_category AS scan_b, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.component_name = b.component_name '
                'WHERE a.latency_ms IS NOT NULL '
                'AND b.latency_ms IS NOT NULL '
                'GROUP BY a.component_name, a.scan_category, b.scan_category '
                'HAVING COUNT(*) > 0 '
                'ORDER BY avg_lat DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(705),
        },
        {
            "id": "Q706",
            "sql": (
                'WITH ranked_a AS ('
                'SELECT *, ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone ORDER BY throughput_rate DESC'
                ') AS rn '
                'FROM "{stream}" WHERE throughput_rate > 200'
                '), '
                'ranked_b AS ('
                'SELECT *, ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone ORDER BY load_factor DESC'
                ') AS rn '
                'FROM "{stream2}" WHERE load_factor > 30'
                ') '
                'SELECT a.facility_zone, a.pallet_id, b.pallet_id AS pallet_b, '
                'a.throughput_rate, b.load_factor '
                'FROM ranked_a a '
                'JOIN ranked_b b '
                'ON a.facility_zone = b.facility_zone AND a.rn = b.rn '
                'WHERE a.rn <= 3 '
                'ORDER BY a.facility_zone, a.rn LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(706),
        },
        {
            "id": "Q707",
            "sql": (
                'SELECT a.facility_zone, '
                'SUM(a.throughput_rate) AS total_rate_a, '
                'SUM(b.throughput_rate) AS total_rate_b, '
                'SUM(a.throughput_rate) / NULLIF(SUM(b.throughput_rate), 0) '
                'AS rate_ratio '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'GROUP BY a.facility_zone '
                'HAVING SUM(b.throughput_rate) > 0 '
                'ORDER BY rate_ratio DESC'
            ),
            "category": "cross_stream",
            "time_offset": toff(707),
        },
        {
            "id": "Q708",
            "sql": (
                'SELECT a.pallet_id, a.operation_mode, '
                'a.throughput_rate, '
                'COUNT(b._timestamp) AS matches_in_b '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.operation_mode = b.operation_mode '
                'AND a.facility_zone = b.facility_zone '
                'GROUP BY a.pallet_id, a.operation_mode, a.throughput_rate '
                'ORDER BY matches_in_b DESC, a.throughput_rate DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(708),
        },
        {
            "id": "Q709",
            "sql": (
                'SELECT a.tag_b AS severity, '
                'b.filter_result, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat_a, '
                'AVG(CAST(b.latency_ms AS FLOAT)) AS avg_lat_b '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.control_center = b.control_center '
                'WHERE a.latency_ms IS NOT NULL '
                'GROUP BY a.tag_b, b.filter_result '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "cross_stream",
            "time_offset": toff(709),
        },
        {
            "id": "Q710",
            "sql": (
                'SELECT a.facility_zone, b.facility_zone AS zone_b, '
                'a._timestamp, b._timestamp AS ts_b, '
                'a.throughput_rate, b.load_factor '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.control_center = b.control_center '
                'AND a.conveyor_lane != b.conveyor_lane '
                'ORDER BY a._timestamp ASC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(710),
        },
        {
            "id": "Q711",
            "sql": (
                'SELECT a.org_name, '
                'AVG(CAST(a.throughput_rate AS FLOAT)) AS avg_rate, '
                'AVG(CAST(b.load_factor AS FLOAT)) AS avg_load, '
                'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.throughput_rate) '
                'AS median_rate '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.org_name = b.org_name '
                'WHERE a.throughput_rate > 100 '
                'GROUP BY a.org_name '
                'ORDER BY avg_rate DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(711),
        },
        {
            "id": "Q712",
            "sql": (
                'WITH zone_agg AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate, '
                'AVG(load_factor) AS avg_load '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'zone_agg2 AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate2, '
                'AVG(load_factor) AS avg_load2 '
                'FROM "{stream2}" GROUP BY facility_zone'
                ') '
                'SELECT z.facility_zone, '
                'z.avg_rate, z2.avg_rate2, '
                'CASE '
                'WHEN z.avg_rate > z2.avg_rate2 THEN \'stream1_faster\' '
                'WHEN z.avg_rate < z2.avg_rate2 THEN \'stream2_faster\' '
                'ELSE \'equal\' END AS comparison '
                'FROM zone_agg z '
                'JOIN zone_agg2 z2 ON z.facility_zone = z2.facility_zone '
                'ORDER BY z.facility_zone'
            ),
            "category": "cross_stream",
            "time_offset": toff(712),
        },
        {
            "id": "Q713",
            "sql": (
                'SELECT a.component_name, a.region_code, '
                'a.scan_category, b.scan_category AS scan_b, '
                'a.latency_ms, b.latency_ms AS lat_b, '
                'CASE '
                'WHEN a.latency_ms > b.latency_ms THEN \'a_slower\' '
                'WHEN a.latency_ms < b.latency_ms THEN \'b_slower\' '
                'ELSE \'equal\' END AS lat_comparison '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.component_name = b.component_name '
                'AND a.region_code = b.region_code '
                'WHERE a.latency_ms IS NOT NULL '
                'AND b.latency_ms IS NOT NULL '
                'ORDER BY a.latency_ms DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(713),
        },
        {
            "id": "Q714",
            "sql": (
                'SELECT a.auth_result, b.auth_result AS auth_b, '
                'COUNT(*) AS cnt, '
                'SUM(CASE WHEN a.response_code >= 400 THEN 1 ELSE 0 END) '
                'AS errors_a, '
                'SUM(CASE WHEN b.response_code >= 400 THEN 1 ELSE 0 END) '
                'AS errors_b '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'GROUP BY a.auth_result, b.auth_result '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(714),
        },
        {
            "id": "Q715",
            "sql": (
                'SELECT a.pallet_id, '
                'ARRAY_AGG(DISTINCT b.pallet_id) AS peers_in_b, '
                'COUNT(DISTINCT b.pallet_id) AS peer_count '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a.control_center = b.control_center '
                'AND a.pallet_id != b.pallet_id '
                'GROUP BY a.pallet_id '
                'ORDER BY peer_count DESC LIMIT 10'
            ),
            "category": "cross_stream",
            "time_offset": toff(715),
        },
        {
            "id": "Q716",
            "sql": (
                'SELECT a.device_type, b.device_type AS device_b, '
                'a.page_slug, b.page_slug AS slug_b, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(a.lcp_micros AS FLOAT)) AS avg_lcp_a, '
                'AVG(CAST(b.lcp_micros AS FLOAT)) AS avg_lcp_b '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'WHERE a.device_type IS NOT NULL '
                'AND b.device_type IS NOT NULL '
                'GROUP BY a.device_type, b.device_type, '
                'a.page_slug, b.page_slug '
                'ORDER BY cnt DESC LIMIT 15'
            ),
            "category": "cross_stream",
            "time_offset": toff(716),
        },
    ],

    # ── window (40 queries: Q717-Q756) ───────────────────────────────
    "window": [
        # -- DISTINCT + multiple windows --
        {
            "id": "Q717",
            "sql": (
                'SELECT DISTINCT facility_zone, '
                'FIRST_VALUE(throughput_rate) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp'
                ') AS first_rate, '
                'LAST_VALUE(throughput_rate) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING'
                ') AS last_rate '
                'FROM "{stream}" '
                'ORDER BY facility_zone'
            ),
            "category": "window",
            "time_offset": toff(717),
        },
        {
            "id": "Q718",
            "sql": (
                'SELECT DISTINCT operation_mode, '
                'FIRST_VALUE(load_factor) OVER ('
                'PARTITION BY operation_mode ORDER BY _timestamp'
                ') AS first_load, '
                'NTH_VALUE(load_factor, 3) OVER ('
                'PARTITION BY operation_mode ORDER BY _timestamp '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING'
                ') AS third_load '
                'FROM "{stream}" '
                'ORDER BY operation_mode'
            ),
            "category": "window",
            "time_offset": toff(718),
        },
        # -- Multiple windows with different PARTITION BY --
        {
            "id": "Q719",
            "sql": (
                'SELECT _timestamp, component_name, region_code, latency_ms, '
                'AVG(latency_ms) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp '
                'ROWS BETWEEN 3 PRECEDING AND CURRENT ROW'
                ') AS comp_rolling_avg, '
                'AVG(latency_ms) OVER ('
                'PARTITION BY region_code ORDER BY _timestamp '
                'ROWS BETWEEN 3 PRECEDING AND CURRENT ROW'
                ') AS region_rolling_avg, '
                'MAX(latency_ms) OVER ('
                'PARTITION BY component_name'
                ') AS comp_max '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(719),
        },
        {
            "id": "Q720",
            "sql": (
                'SELECT _timestamp, facility_zone, operation_mode, '
                'throughput_rate, load_factor, '
                'RANK() OVER (PARTITION BY facility_zone '
                'ORDER BY throughput_rate DESC) AS zone_rank, '
                'DENSE_RANK() OVER (PARTITION BY operation_mode '
                'ORDER BY load_factor DESC) AS mode_dense_rank, '
                'PERCENT_RANK() OVER (PARTITION BY facility_zone '
                'ORDER BY throughput_rate DESC) AS zone_pct_rank '
                'FROM "{stream}" '
                'ORDER BY facility_zone, zone_rank LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(720),
        },
        # -- Window + window in subquery --
        {
            "id": "Q721",
            "sql": (
                'SELECT facility_zone, operation_mode, '
                'avg_tput, rn '
                'FROM ('
                'SELECT facility_zone, operation_mode, '
                'AVG(throughput_rate) OVER ('
                'PARTITION BY facility_zone, operation_mode'
                ') AS avg_tput, '
                'ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone '
                'ORDER BY throughput_rate DESC'
                ') AS rn '
                'FROM "{stream}"'
                ') sub '
                'WHERE rn <= 3 '
                'ORDER BY facility_zone, rn'
            ),
            "category": "window",
            "time_offset": toff(721),
        },
        # -- Named WINDOW clause --
        {
            "id": "Q722",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'AVG(latency_ms) OVER w AS rolling_avg, '
                'MIN(latency_ms) OVER w AS rolling_min, '
                'MAX(latency_ms) OVER w AS rolling_max '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'WINDOW w AS (PARTITION BY component_name ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING) '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(722),
        },
        {
            "id": "Q723",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate, '
                'SUM(throughput_rate) OVER w AS cum_sum, '
                'AVG(throughput_rate) OVER w AS cum_avg '
                'FROM "{stream}" '
                'WINDOW w AS (PARTITION BY facility_zone ORDER BY _timestamp '
                'ROWS UNBOUNDED PRECEDING) '
                'ORDER BY facility_zone, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(723),
        },
        # -- LAG / LEAD with complex offsets --
        {
            "id": "Q724",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'LAG(latency_ms, 1) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp'
                ') AS prev_lat, '
                'LEAD(latency_ms, 1) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp'
                ') AS next_lat, '
                'latency_ms - LAG(latency_ms, 1) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp'
                ') AS delta '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY component_name, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(724),
        },
        {
            "id": "Q725",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate, '
                'LAG(throughput_rate, 2) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp'
                ') AS two_back, '
                'LEAD(throughput_rate, 2) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp'
                ') AS two_forward, '
                'throughput_rate - LAG(throughput_rate, 1) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp'
                ') AS step_change '
                'FROM "{stream}" '
                'ORDER BY facility_zone, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(725),
        },
        # -- Window with CASE --
        {
            "id": "Q726",
            "sql": (
                'SELECT _timestamp, sorter_model, facility_zone, '
                'throughput_rate, load_factor, '
                'SUM(CASE WHEN throughput_rate > 400 THEN 1 ELSE 0 END) '
                'OVER (PARTITION BY sorter_model ORDER BY _timestamp '
                'ROWS UNBOUNDED PRECEDING) AS high_rate_cnt, '
                'AVG(CASE WHEN load_factor > 50 THEN load_factor END) '
                'OVER (PARTITION BY sorter_model ORDER BY _timestamp '
                'ROWS UNBOUNDED PRECEDING) AS avg_high_load '
                'FROM "{stream}" '
                'ORDER BY sorter_model, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(726),
        },
        # -- NTILE and CUME_DIST --
        {
            "id": "Q727",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'NTILE(5) OVER (ORDER BY latency_ms) AS latency_quintile, '
                'CUME_DIST() OVER (ORDER BY latency_ms) AS latency_cume_dist '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY latency_ms ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(727),
        },
        {
            "id": "Q728",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate, '
                'NTILE(3) OVER (PARTITION BY facility_zone '
                'ORDER BY throughput_rate) AS tput_tertile, '
                'CUME_DIST() OVER (PARTITION BY facility_zone '
                'ORDER BY throughput_rate) AS tput_cume_dist '
                'FROM "{stream}" '
                'ORDER BY facility_zone, throughput_rate ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(728),
        },
        # -- Window over aggregation (nested) --
        {
            "id": "Q729",
            "sql": (
                'SELECT facility_zone, component_name, cnt, '
                'RANK() OVER (PARTITION BY facility_zone '
                'ORDER BY cnt DESC) AS rank_by_cnt, '
                'SUM(cnt) OVER (PARTITION BY facility_zone) AS zone_total '
                'FROM ('
                'SELECT facility_zone, component_name, COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY facility_zone, component_name'
                ') agg '
                'ORDER BY facility_zone, rank_by_cnt LIMIT 12'
            ),
            "category": "window",
            "time_offset": toff(729),
        },
        {
            "id": "Q730",
            "sql": (
                'SELECT region_code, component_name, avg_lat, '
                'ROW_NUMBER() OVER (PARTITION BY region_code '
                'ORDER BY avg_lat DESC) AS lat_rank, '
                'AVG(avg_lat) OVER (PARTITION BY region_code) AS region_avg '
                'FROM ('
                'SELECT region_code, component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'GROUP BY region_code, component_name'
                ') sub '
                'ORDER BY region_code, lat_rank LIMIT 12'
            ),
            "category": "window",
            "time_offset": toff(730),
        },
        # -- ROWS BETWEEN with various ranges --
        {
            "id": "Q731",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate, '
                'AVG(throughput_rate) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp '
                'ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING'
                ') AS three_point_avg, '
                'MIN(throughput_rate) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'
                ') AS running_min, '
                'MAX(throughput_rate) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp '
                'ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING'
                ') AS future_max '
                'FROM "{stream}" '
                'ORDER BY facility_zone, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(731),
        },
        # -- Window + COALESCE in PARTITION BY --
        {
            "id": "Q732",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(scan_category, \'unknown\') AS scan_type, '
                'latency_ms, '
                'ROW_NUMBER() OVER ('
                'PARTITION BY COALESCE(scan_category, \'unknown\') '
                'ORDER BY latency_ms'
                ') AS rn_by_scan, '
                'AVG(latency_ms) OVER ('
                'PARTITION BY COALESCE(scan_category, \'unknown\')'
                ') AS avg_by_scan '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY scan_type, rn_by_scan LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(732),
        },
        # -- Window FTS combo (like Q661) --
        {
            "id": "Q733",
            "sql": (
                'SELECT _timestamp, log, component_name, '
                "match_all('warehouse') AS has_warehouse, "
                'ROW_NUMBER() OVER (PARTITION BY component_name '
                'ORDER BY _timestamp) AS rn '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'ORDER BY component_name, rn LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(733),
        },
        {
            "id": "Q734",
            "sql": (
                'SELECT component_name, '
                "SUM(CASE WHEN match_all('error') THEN 1 ELSE 0 END) "
                'AS error_hits, '
                'COUNT(*) AS total_hits, '
                'RANK() OVER (ORDER BY '
                "SUM(CASE WHEN match_all('error') THEN 1 ELSE 0 END) DESC"
                ') AS error_rank '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'ORDER BY error_rank LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(734),
        },
        # -- NTH_VALUE --
        {
            "id": "Q735",
            "sql": (
                'SELECT DISTINCT facility_zone, '
                'NTH_VALUE(throughput_rate, 2) OVER ('
                'PARTITION BY facility_zone ORDER BY throughput_rate DESC '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING'
                ') AS second_highest_rate, '
                'NTH_VALUE(load_factor, 2) OVER ('
                'PARTITION BY facility_zone ORDER BY load_factor DESC '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING'
                ') AS second_highest_load '
                'FROM "{stream}" '
                'ORDER BY facility_zone'
            ),
            "category": "window",
            "time_offset": toff(735),
        },
        # -- Window + FILTER-style CASE aggregation --
        {
            "id": "Q736",
            "sql": (
                'SELECT facility_zone, operation_mode, '
                'SUM(throughput_rate) AS total_rate, '
                'SUM(throughput_rate) * 100.0 / '
                'NULLIF(SUM(SUM(throughput_rate)) OVER ('
                'PARTITION BY facility_zone), 0) AS pct_of_zone '
                'FROM "{stream}" '
                'GROUP BY facility_zone, operation_mode '
                'ORDER BY facility_zone, pct_of_zone DESC'
            ),
            "category": "window",
            "time_offset": toff(736),
        },
        # -- CTE + window --
        {
            "id": "Q737",
            "sql": (
                'WITH base AS ('
                'SELECT _timestamp, facility_zone, operation_mode, '
                'throughput_rate, load_factor '
                'FROM "{stream}" '
                'WHERE throughput_rate > 100'
                ') '
                'SELECT *, '
                'AVG(throughput_rate) OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW'
                ') AS rolling_avg '
                'FROM base '
                'ORDER BY facility_zone, _timestamp ASC LIMIT 12'
            ),
            "category": "window",
            "time_offset": toff(737),
        },
        # -- Multi-window nested in subquery with outer aggregation --
        {
            "id": "Q738",
            "sql": (
                'SELECT facility_zone, rn, '
                'COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM ('
                'SELECT facility_zone, throughput_rate, '
                'ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone '
                'ORDER BY throughput_rate DESC'
                ') AS rn '
                'FROM "{stream}"'
                ') ranked '
                'WHERE rn <= 3 '
                'GROUP BY facility_zone, rn '
                'ORDER BY facility_zone, rn'
            ),
            "category": "window",
            "time_offset": toff(738),
        },
        # -- LEAD with offset expression --
        {
            "id": "Q739",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'LAG(latency_ms, 2, 0) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp'
                ') AS prev2_lat, '
                'LEAD(latency_ms, 2, 0) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp'
                ') AS next2_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY component_name, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(739),
        },
        {
            "id": "Q740",
            "sql": (
                'SELECT _timestamp, facility_zone, '
                'throughput_rate, load_factor, '
                'ROW_NUMBER() OVER (ORDER BY _timestamp) AS global_seq, '
                'SUM(throughput_rate) OVER (ORDER BY _timestamp) AS cum_tput, '
                'AVG(load_factor) OVER (ORDER BY _timestamp '
                'ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) AS trailing_avg '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(740),
        },
        # -- More complex window functions --
        {
            "id": "Q741",
            "sql": (
                'SELECT _timestamp, conveyor_lane, facility_zone, '
                'throughput_rate, '
                'FIRST_VALUE(throughput_rate) OVER ('
                'PARTITION BY conveyor_lane ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING'
                ') AS window_first, '
                'LAST_VALUE(throughput_rate) OVER ('
                'PARTITION BY conveyor_lane ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING'
                ') AS window_last '
                'FROM "{stream}" '
                'ORDER BY conveyor_lane, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(741),
        },
        {
            "id": "Q742",
            "sql": (
                'SELECT _timestamp, pallet_id, cell_temp, '
                'cell_temp - LAG(cell_temp) OVER (PARTITION BY pallet_id '
                'ORDER BY _timestamp) AS temp_delta, '
                'AVG(cell_temp) OVER (PARTITION BY pallet_id '
                'ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS rolling_temp '
                'FROM "{stream}" '
                'ORDER BY pallet_id, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(742),
        },
        {
            "id": "Q743",
            "sql": (
                'SELECT _timestamp, component_name, region_code, latency_ms, '
                'SUM(latency_ms) OVER (PARTITION BY component_name '
                'ORDER BY _timestamp) AS cum_lat, '
                'COUNT(*) OVER (PARTITION BY component_name '
                'ORDER BY _timestamp) AS running_cnt, '
                'AVG(latency_ms) OVER (PARTITION BY component_name) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY component_name, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(743),
        },
        {
            "id": "Q744",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(bot_flag, passthrough_flag) AS flag_status, '
                'latency_ms, '
                'ROW_NUMBER() OVER (PARTITION BY '
                'COALESCE(bot_flag, passthrough_flag) '
                'ORDER BY latency_ms DESC) AS rn '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY flag_status, rn LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(744),
        },
        {
            "id": "Q745",
            "sql": (
                'SELECT _timestamp, operation_mode, '
                'throughput_rate, charge_remaining, '
                'RANK() OVER (PARTITION BY operation_mode '
                'ORDER BY throughput_rate DESC, charge_remaining DESC) '
                'AS combined_rank, '
                'DENSE_RANK() OVER (PARTITION BY operation_mode '
                'ORDER BY throughput_rate DESC) AS tput_rank '
                'FROM "{stream}" '
                'ORDER BY operation_mode, combined_rank LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(745),
        },
        {
            "id": "Q746",
            "sql": (
                'SELECT _timestamp, facility_zone, sorter_model, '
                'throughput_rate, '
                'ROUND(throughput_rate / NULLIF('
                'FIRST_VALUE(throughput_rate) OVER ('
                'PARTITION BY facility_zone, sorter_model '
                'ORDER BY _timestamp), 0), 3) AS relative_to_first '
                'FROM "{stream}" '
                'ORDER BY facility_zone, sorter_model, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(746),
        },
        {
            "id": "Q747",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'LAG(latency_ms, 1) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp) AS prev_lat, '
                'latency_ms - LAG(latency_ms, 1) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp) AS delta, '
                'CASE WHEN latency_ms > LAG(latency_ms, 1) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp) '
                "THEN 'increased' ELSE 'decreased' END AS trend "
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY component_name, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(747),
        },
        {
            "id": "Q748",
            "sql": (
                'SELECT facility_zone, avg_tput, '
                'LAG(avg_tput) OVER (ORDER BY avg_tput DESC) AS prev_avg, '
                'avg_tput - LAG(avg_tput) OVER (ORDER BY avg_tput DESC) '
                'AS drop_from_prev '
                'FROM ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_tput '
                'FROM "{stream}" GROUP BY facility_zone'
                ') zone_avgs '
                'ORDER BY avg_tput DESC'
            ),
            "category": "window",
            "time_offset": toff(748),
        },
        {
            "id": "Q749",
            "sql": (
                'SELECT _timestamp, pallet_id, throughput_rate, '
                'SUM(throughput_rate) OVER ('
                'ORDER BY _timestamp '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'
                ') AS running_total, '
                'AVG(throughput_rate) OVER ('
                'ORDER BY _timestamp '
                'ROWS BETWEEN 4 PRECEDING AND CURRENT ROW'
                ') AS trailing_5pt_avg '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(749),
        },
        {
            "id": "Q750",
            "sql": (
                'SELECT _timestamp, component_name, region_code, latency_ms, '
                'AVG(latency_ms) OVER w1 AS comp_avg, '
                'AVG(latency_ms) OVER w2 AS region_avg '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'WINDOW w1 AS (PARTITION BY component_name '
                'ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING), '
                'w2 AS (PARTITION BY region_code '
                'ORDER BY _timestamp '
                'ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING) '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(750),
        },
        # -- More window + DISTINCT variants --
        {
            "id": "Q751",
            "sql": (
                'SELECT DISTINCT control_center, '
                'FIRST_VALUE(sorter_model) OVER ('
                'PARTITION BY control_center ORDER BY _timestamp'
                ') AS first_sorter, '
                'LAST_VALUE(sorter_model) OVER ('
                'PARTITION BY control_center ORDER BY _timestamp '
                'ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING'
                ') AS last_sorter '
                'FROM "{stream}" '
                'ORDER BY control_center'
            ),
            "category": "window",
            "time_offset": toff(751),
        },
        {
            "id": "Q752",
            "sql": (
                'SELECT DISTINCT component_name, region_code, '
                'MAX(latency_ms) OVER (PARTITION BY component_name) AS max_lat, '
                'MIN(latency_ms) OVER (PARTITION BY component_name) AS min_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY component_name, region_code LIMIT 12'
            ),
            "category": "window",
            "time_offset": toff(752),
        },
        {
            "id": "Q753",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate, '
                'LAG(throughput_rate) OVER (PARTITION BY facility_zone '
                'ORDER BY _timestamp) AS prev_rate, '
                'LEAD(throughput_rate) OVER (PARTITION BY facility_zone '
                'ORDER BY _timestamp) AS next_rate, '
                'AVG(throughput_rate) OVER (PARTITION BY facility_zone '
                'ORDER BY _timestamp '
                'ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS smooth_rate '
                'FROM "{stream}" '
                'ORDER BY facility_zone, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(753),
        },
        {
            "id": "Q754",
            "sql": (
                'SELECT operation_mode, auth_result, avg_lat, '
                'RANK() OVER (PARTITION BY operation_mode '
                'ORDER BY avg_lat DESC) AS rk '
                'FROM ('
                'SELECT operation_mode, auth_result, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY operation_mode, auth_result'
                ') sub '
                'ORDER BY operation_mode, rk LIMIT 12'
            ),
            "category": "window",
            "time_offset": toff(754),
        },
        {
            "id": "Q755",
            "sql": (
                'SELECT facility_zone, operation_mode, cnt, '
                'SUM(cnt) OVER (PARTITION BY facility_zone) AS zone_total, '
                'ROUND(CAST(cnt AS FLOAT) * 100.0 / '
                'NULLIF(SUM(cnt) OVER (PARTITION BY facility_zone), 0), 2) '
                'AS pct '
                'FROM ('
                'SELECT facility_zone, operation_mode, COUNT(*) AS cnt '
                'FROM "{stream}" GROUP BY facility_zone, operation_mode'
                ') agg '
                'ORDER BY facility_zone, pct DESC'
            ),
            "category": "window",
            "time_offset": toff(755),
        },
        {
            "id": "Q756",
            "sql": (
                'SELECT _timestamp, pallet_id, '
                'throughput_rate, load_factor, '
                'STDDEV(throughput_rate) OVER ('
                'PARTITION BY pallet_id ORDER BY _timestamp '
                'ROWS BETWEEN 3 PRECEDING AND CURRENT ROW'
                ') AS rolling_stddev, '
                'AVG(load_factor) OVER ('
                'PARTITION BY pallet_id ORDER BY _timestamp '
                'ROWS BETWEEN 3 PRECEDING AND CURRENT ROW'
                ') AS rolling_load '
                'FROM "{stream}" '
                'ORDER BY pallet_id, _timestamp ASC LIMIT 10'
            ),
            "category": "window",
            "time_offset": toff(756),
        },
    ],

    # ── cte_subquery (35 queries: Q757-Q791) ─────────────────────────
    "cte_subquery": [
        # -- 3+ CTE chain --
        {
            "id": "Q757",
            "sql": (
                'WITH cte1 AS ('
                'SELECT _timestamp, facility_zone, operation_mode, '
                'throughput_rate, load_factor '
                'FROM "{stream}" WHERE throughput_rate > 100'
                '), '
                'cte2 AS ('
                'SELECT cte1.*, '
                'AVG(cte1.throughput_rate) OVER ('
                'PARTITION BY cte1.facility_zone) AS zone_avg '
                'FROM cte1'
                '), '
                'cte3 AS ('
                'SELECT *, '
                'CASE WHEN throughput_rate > zone_avg '
                "THEN 'above_avg' ELSE 'below_avg' END AS perf_tier "
                'FROM cte2'
                ') '
                'SELECT perf_tier, COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate, '
                'AVG(load_factor) AS avg_load '
                'FROM cte3 '
                'GROUP BY perf_tier ORDER BY cnt DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(757),
        },
        {
            "id": "Q758",
            "sql": (
                'WITH base AS ('
                'SELECT * FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL'
                '), '
                'ranked AS ('
                'SELECT *, '
                'ROW_NUMBER() OVER (PARTITION BY component_name '
                'ORDER BY latency_ms DESC) AS rn '
                'FROM base'
                '), '
                'top3 AS ('
                'SELECT component_name, latency_ms, rn '
                'FROM ranked WHERE rn <= 3'
                ') '
                'SELECT component_name, '
                'AVG(latency_ms) AS avg_top3_lat, '
                'COUNT(*) AS top3_cnt '
                'FROM top3 '
                'GROUP BY component_name ORDER BY avg_top3_lat DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(758),
        },
        {
            "id": "Q759",
            "sql": (
                'WITH cte1 AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate, '
                'AVG(load_factor) AS avg_load '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'cte2 AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate2 '
                'FROM "{stream2}" GROUP BY facility_zone'
                '), '
                'cte3 AS ('
                'SELECT c1.facility_zone, '
                'c1.avg_rate, c1.avg_load, '
                'c2.avg_rate2, '
                'c1.avg_rate / NULLIF(c2.avg_rate2, 0) AS ratio '
                'FROM cte1 c1 '
                'LEFT JOIN cte2 c2 '
                'ON c1.facility_zone = c2.facility_zone'
                ') '
                'SELECT * FROM cte3 ORDER BY ratio DESC NULLS LAST'
            ),
            "category": "cte_subquery",
            "time_offset": toff(759),
        },
        # -- Scalar subquery in SELECT --
        {
            "id": "Q760",
            "sql": (
                'SELECT facility_zone, '
                'COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate, '
                '(SELECT AVG(throughput_rate) FROM "{stream}") '
                'AS global_avg_rate '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY avg_rate DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(760),
        },
        {
            "id": "Q761",
            "sql": (
                'SELECT component_name, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                '(SELECT AVG(CAST(latency_ms AS FLOAT)) FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL) AS global_avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(761),
        },
        # -- Correlated subquery in SELECT --
        {
            "id": "Q762",
            "sql": (
                'SELECT a.component_name, a.latency_ms, '
                '(SELECT AVG(CAST(b.latency_ms AS FLOAT)) '
                'FROM "{stream2}" b '
                'WHERE b.component_name = a.component_name'
                ') AS avg_in_other_stream '
                'FROM "{stream}" a '
                'WHERE a.latency_ms IS NOT NULL '
                'ORDER BY a.latency_ms DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(762),
        },
        # -- Correlated EXISTS from data_gen memory --
        {
            "id": "Q763",
            "sql": (
                'SELECT a._timestamp, a.facility_zone, a.throughput_rate '
                'FROM "{stream}" a '
                'WHERE EXISTS ('
                'SELECT 1 FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone '
                'AND b.throughput_rate > a.throughput_rate '
                'AND b._timestamp > a._timestamp'
                ') '
                'ORDER BY a._timestamp ASC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(763),
        },
        {
            "id": "Q764",
            "sql": (
                'SELECT a.component_name, a.region_code, a.latency_ms '
                'FROM "{stream}" a '
                'WHERE a.latency_ms > ('
                'SELECT AVG(CAST(b.latency_ms AS FLOAT)) '
                'FROM "{stream}" b '
                'WHERE b.region_code = a.region_code'
                ') '
                'ORDER BY a.latency_ms DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(764),
        },
        {
            "id": "Q765",
            "sql": (
                'SELECT a.pallet_id, a.facility_zone, a.load_factor '
                'FROM "{stream}" a '
                'WHERE a.load_factor = ('
                'SELECT MAX(b.load_factor) FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone'
                ') '
                'ORDER BY a.facility_zone, a.pallet_id LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(765),
        },
        # -- Subquery in HAVING --
        {
            "id": "Q766",
            "sql": (
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'HAVING AVG(throughput_rate) > ('
                'SELECT AVG(throughput_rate) FROM "{stream}"'
                ') '
                'ORDER BY avg_rate DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(766),
        },
        {
            "id": "Q767",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'HAVING AVG(CAST(latency_ms AS FLOAT)) > ('
                'SELECT PERCENTILE_CONT(0.5) WITHIN GROUP '
                '(ORDER BY latency_ms) FROM "{stream}"'
                ') '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(767),
        },
        # -- Complex CTE with self-join --
        {
            "id": "Q768",
            "sql": (
                'WITH paired AS ('
                'SELECT a.facility_zone AS zone_a, '
                'b.facility_zone AS zone_b, '
                'a.throughput_rate AS rate_a, '
                'b.throughput_rate AS rate_b '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone < b.facility_zone'
                ') '
                'SELECT zone_a, zone_b, '
                'AVG(rate_a) AS avg_a, '
                'AVG(rate_b) AS avg_b, '
                'AVG(rate_a + rate_b) AS combined_avg '
                'FROM paired '
                'GROUP BY zone_a, zone_b '
                'ORDER BY combined_avg DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(768),
        },
        # -- CTE + UNION in CTE chain --
        {
            "id": "Q769",
            "sql": (
                'WITH high_rate AS ('
                'SELECT pallet_id, facility_zone, throughput_rate '
                'FROM "{stream}" WHERE throughput_rate > 500'
                '), '
                'low_rate AS ('
                'SELECT pallet_id, facility_zone, throughput_rate '
                'FROM "{stream}" WHERE throughput_rate < 200'
                '), '
                'combined AS ('
                "SELECT *, 'high' AS tier FROM high_rate "
                'UNION ALL '
                "SELECT *, 'low' AS tier FROM low_rate"
                ') '
                'SELECT tier, COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM combined '
                'GROUP BY tier ORDER BY tier'
            ),
            "category": "cte_subquery",
            "time_offset": toff(769),
        },
        # -- Deep nesting with IN --
        {
            "id": "Q770",
            "sql": (
                'SELECT facility_zone, sorter_model, throughput_rate '
                'FROM "{stream}" a '
                'WHERE throughput_rate > ('
                'SELECT AVG(throughput_rate) FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone '
                'AND b.facility_zone IN ('
                'SELECT facility_zone FROM "{stream2}" '
                'WHERE load_factor > 50'
                ')'
                ') '
                'ORDER BY throughput_rate DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(770),
        },
        # -- Scalar subquery with multiple columns --
        {
            "id": "Q771",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'COUNT(*) AS cnt, '
                '(SELECT MAX(latency_ms) FROM "{stream}" b '
                'WHERE b.component_name = a.component_name) AS max_lat, '
                '(SELECT MIN(latency_ms) FROM "{stream}" b '
                'WHERE b.component_name = a.component_name) AS min_lat '
                'FROM "{stream}" a '
                'WHERE a.latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(771),
        },
        # -- CTE then multiple subqueries --
        {
            "id": "Q772",
            "sql": (
                'WITH zone_baseline AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS baseline_rate, '
                'STDDEV(throughput_rate) AS std_rate '
                'FROM "{stream}" GROUP BY facility_zone'
                ') '
                'SELECT a.facility_zone, a.pallet_id, a.throughput_rate, '
                'zb.baseline_rate, zb.std_rate, '
                'a.throughput_rate - zb.baseline_rate AS deviation '
                'FROM "{stream}" a '
                'JOIN zone_baseline zb ON a.facility_zone = zb.facility_zone '
                'WHERE a.throughput_rate > zb.baseline_rate + zb.std_rate '
                'ORDER BY deviation DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(772),
        },
        # -- NOT EXISTS with correlated reference --
        {
            "id": "Q773",
            "sql": (
                'SELECT a.pallet_id, a.facility_zone, a.throughput_rate '
                'FROM "{stream}" a '
                'WHERE NOT EXISTS ('
                'SELECT 1 FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone '
                'AND b.throughput_rate > a.throughput_rate '
                'AND b._timestamp > a._timestamp'
                ') '
                'ORDER BY a.facility_zone, a.throughput_rate DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(773),
        },
        # -- CTE referencing another CTE twice --
        {
            "id": "Q774",
            "sql": (
                'WITH base AS ('
                'SELECT _timestamp, facility_zone, component_name, '
                'throughput_rate, latency_ms '
                'FROM "{stream}"'
                '), '
                'zone_stats AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_tput, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM base GROUP BY facility_zone'
                '), '
                'global_stats AS ('
                'SELECT AVG(avg_tput) AS global_avg_tput, '
                'AVG(avg_lat) AS global_avg_lat '
                'FROM zone_stats'
                ') '
                'SELECT zs.facility_zone, zs.avg_tput, zs.avg_lat, '
                'CASE WHEN zs.avg_tput > gs.global_avg_tput '
                "THEN 'above_global' ELSE 'below_global' END AS tput_vs_global, "
                'CASE WHEN zs.avg_lat < gs.global_avg_lat '
                "THEN 'faster_than_global' ELSE 'slower_than_global' END "
                'AS lat_vs_global '
                'FROM zone_stats zs '
                'CROSS JOIN global_stats gs '
                'ORDER BY zs.facility_zone'
            ),
            "category": "cte_subquery",
            "time_offset": toff(774),
        },
        # -- Complex subquery chain --
        {
            "id": "Q775",
            "sql": (
                'SELECT org_name, region_code, avg_lat, rn '
                'FROM ('
                'SELECT org_name, region_code, avg_lat, '
                'ROW_NUMBER() OVER (PARTITION BY region_code '
                'ORDER BY avg_lat ASC) AS rn '
                'FROM ('
                'SELECT org_name, region_code, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'AND org_name IS NOT NULL '
                'AND region_code IS NOT NULL '
                'GROUP BY org_name, region_code'
                ') mid'
                ') outer_q '
                'WHERE rn <= 2 '
                'ORDER BY region_code, rn LIMIT 12'
            ),
            "category": "cte_subquery",
            "time_offset": toff(775),
        },
        # -- Subquery in FROM clause --
        {
            "id": "Q776",
            "sql": (
                'SELECT sq.facility_zone, sq.mode, '
                'COUNT(*) AS cnt, '
                'SUM(sq.total_rate) AS total_rate '
                'FROM ('
                'SELECT facility_zone, operation_mode AS mode, '
                'SUM(throughput_rate) AS total_rate '
                'FROM "{stream}" GROUP BY facility_zone, operation_mode'
                ') sq '
                'GROUP BY sq.facility_zone, sq.mode '
                'ORDER BY total_rate DESC LIMIT 12'
            ),
            "category": "cte_subquery",
            "time_offset": toff(776),
        },
        # -- CTE with conditional aggregation --
        {
            "id": "Q777",
            "sql": (
                'WITH tagged AS ('
                'SELECT *, '
                'CASE '
                'WHEN throughput_rate >= 500 THEN \'high\' '
                'WHEN throughput_rate >= 300 THEN \'medium\' '
                "ELSE 'low' END AS perf_class "
                'FROM "{stream}"'
                ') '
                'SELECT facility_zone, perf_class, '
                'COUNT(*) AS cnt, '
                'AVG(load_factor) AS avg_load, '
                'AVG(cell_temp) AS avg_temp '
                'FROM tagged '
                'GROUP BY facility_zone, perf_class '
                'ORDER BY facility_zone, perf_class'
            ),
            "category": "cte_subquery",
            "time_offset": toff(777),
        },
        # -- Subquery with self-join inside CTE --
        {
            "id": "Q778",
            "sql": (
                'WITH self_joined AS ('
                'SELECT a.facility_zone, a.pallet_id AS pallet_a, '
                'b.pallet_id AS pallet_b, '
                'a.throughput_rate AS rate_a, '
                'b.throughput_rate AS rate_b '
                'FROM "{stream}" a '
                'JOIN "{stream}" b '
                'ON a.facility_zone = b.facility_zone '
                'AND a._timestamp < b._timestamp'
                ') '
                'SELECT facility_zone, '
                'COUNT(*) AS pair_cnt, '
                'AVG(CAST(rate_a AS FLOAT) + CAST(rate_b AS FLOAT)) '
                'AS avg_pair_rate '
                'FROM self_joined '
                'GROUP BY facility_zone '
                'ORDER BY pair_cnt DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(778),
        },
        {
            "id": "Q779",
            "sql": (
                'WITH cte1 AS ('
                'SELECT component_name, region_code, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name, region_code'
                '), '
                'cte2 AS ('
                'SELECT *, '
                'RANK() OVER (ORDER BY avg_lat DESC) AS global_rank '
                'FROM cte1'
                ') '
                'SELECT * FROM cte2 '
                'WHERE global_rank <= 3 '
                'ORDER BY global_rank'
            ),
            "category": "cte_subquery",
            "time_offset": toff(779),
        },
        {
            "id": "Q780",
            "sql": (
                'SELECT a.facility_zone, '
                'a.throughput_rate, '
                '(SELECT COUNT(*) FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone '
                'AND b.throughput_rate > a.throughput_rate'
                ') AS better_cnt '
                'FROM "{stream}" a '
                'ORDER BY a.facility_zone, better_cnt LIMIT 12'
            ),
            "category": "cte_subquery",
            "time_offset": toff(780),
        },
        # -- Remaining CTE/subquery queries --
        {
            "id": "Q781",
            "sql": (
                'WITH base AS ('
                'SELECT _timestamp, component_name, latency_ms, '
                'response_code '
                'FROM "{stream}" WHERE latency_ms IS NOT NULL'
                '), '
                'error_base AS ('
                'SELECT _timestamp, component_name, latency_ms '
                'FROM base WHERE response_code >= 400'
                '), '
                'success_base AS ('
                'SELECT _timestamp, component_name, latency_ms '
                'FROM base WHERE response_code < 400'
                ') '
                'SELECT '
                'COALESCE(e.component_name, s.component_name) AS component_name, '
                'AVG(CAST(e.latency_ms AS FLOAT)) AS avg_error_lat, '
                'AVG(CAST(s.latency_ms AS FLOAT)) AS avg_success_lat, '
                'COUNT(e._timestamp) AS error_cnt, '
                'COUNT(s._timestamp) AS success_cnt '
                'FROM error_base e '
                'FULL OUTER JOIN success_base s '
                'ON e.component_name = s.component_name '
                'GROUP BY COALESCE(e.component_name, s.component_name) '
                'ORDER BY error_cnt DESC NULLS LAST LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(781),
        },
        {
            "id": "Q782",
            "sql": (
                'WITH ranked AS ('
                'SELECT *, '
                'ROW_NUMBER() OVER (PARTITION BY facility_zone '
                'ORDER BY throughput_rate DESC) AS rn '
                'FROM "{stream}"'
                ') '
                'SELECT facility_zone, '
                'MAX(CASE WHEN rn = 1 THEN pallet_id END) AS top_pallet, '
                'MAX(CASE WHEN rn = 1 THEN throughput_rate END) AS top_rate, '
                'MAX(CASE WHEN rn = 2 THEN throughput_rate END) AS second_rate, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM ranked '
                'GROUP BY facility_zone '
                'ORDER BY top_rate DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(782),
        },
        {
            "id": "Q783",
            "sql": (
                'SELECT component_name, cnt, avg_lat '
                'FROM ('
                'SELECT component_name, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'RANK() OVER (ORDER BY COUNT(*) DESC) AS cnt_rank '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name'
                ') sub '
                'WHERE cnt_rank <= 5 '
                'ORDER BY cnt DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(783),
        },
        {
            "id": "Q784",
            "sql": (
                'SELECT a.pallet_id, a.facility_zone, '
                'a.throughput_rate, '
                'a.throughput_rate / NULLIF('
                '(SELECT AVG(b.throughput_rate) '
                'FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone), 0'
                ') AS relative_rate '
                'FROM "{stream}" a '
                'ORDER BY relative_rate DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(784),
        },
        {
            "id": "Q785",
            "sql": (
                'WITH zone_records AS ('
                'SELECT facility_zone, '
                'COUNT(*) AS record_cnt, '
                'SUM(throughput_rate) AS total_rate, '
                'SUM(load_factor) AS total_load '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'mode_records AS ('
                'SELECT facility_zone, operation_mode, '
                'COUNT(*) AS mode_cnt '
                'FROM "{stream}" GROUP BY facility_zone, operation_mode'
                ') '
                'SELECT zr.facility_zone, '
                'zr.record_cnt, zr.total_rate, '
                'mr.operation_mode, mr.mode_cnt '
                'FROM zone_records zr '
                'JOIN mode_records mr '
                'ON zr.facility_zone = mr.facility_zone '
                'ORDER BY zr.total_rate DESC LIMIT 12'
            ),
            "category": "cte_subquery",
            "time_offset": toff(785),
        },
        {
            "id": "Q786",
            "sql": (
                'WITH chunked AS ('
                'SELECT _timestamp, component_name, latency_ms, '
                'NTILE(4) OVER (ORDER BY _timestamp) AS time_chunk '
                'FROM "{stream}" WHERE latency_ms IS NOT NULL'
                ') '
                'SELECT time_chunk, component_name, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM chunked '
                'GROUP BY time_chunk, component_name '
                'ORDER BY time_chunk, cnt DESC LIMIT 15'
            ),
            "category": "cte_subquery",
            "time_offset": toff(786),
        },
        {
            "id": "Q787",
            "sql": (
                'SELECT facility_zone, operation_mode, '
                'SUM(throughput_rate) AS total_rate '
                'FROM "{stream}" a '
                'WHERE a.throughput_rate > ('
                'SELECT AVG(b.throughput_rate) * 0.5 '
                'FROM "{stream}" b '
                'WHERE b.facility_zone = a.facility_zone'
                ') '
                'GROUP BY facility_zone, operation_mode '
                'ORDER BY total_rate DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(787),
        },
        {
            "id": "Q788",
            "sql": (
                'WITH sub AS ('
                'SELECT component_name, region_code, latency_ms, '
                'response_code, '
                'CASE WHEN response_code >= 400 THEN 1 ELSE 0 END AS is_error '
                'FROM "{stream}" WHERE latency_ms IS NOT NULL'
                ') '
                'SELECT component_name, region_code, '
                'COUNT(*) AS total, '
                'SUM(is_error) AS errors, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'AVG(CASE WHEN is_error = 1 '
                'THEN CAST(latency_ms AS FLOAT) END) AS avg_error_lat '
                'FROM sub '
                'GROUP BY component_name, region_code '
                'ORDER BY errors DESC, total DESC LIMIT 12'
            ),
            "category": "cte_subquery",
            "time_offset": toff(788),
        },
        {
            "id": "Q789",
            "sql": (
                'SELECT a.component_name, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat, '
                'AVG(CAST(b.latency_ms AS FLOAT)) AS avg_lat_stream2, '
                '(SELECT AVG(CAST(latency_ms AS FLOAT)) FROM "{stream}") '
                'AS global_avg '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.component_name = b.component_name '
                'AND a.region_code = b.region_code '
                'WHERE a.latency_ms IS NOT NULL '
                'GROUP BY a.component_name '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "cte_subquery",
            "time_offset": toff(789),
        },
        {
            "id": "Q790",
            "sql": (
                'WITH agg AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'agg2 AS ('
                'SELECT facility_zone, '
                'AVG(load_factor) AS avg_load '
                'FROM "{stream2}" GROUP BY facility_zone'
                ') '
                'SELECT COALESCE(a.facility_zone, a2.facility_zone) AS zone, '
                'a.avg_rate, a2.avg_load '
                'FROM agg a '
                'FULL OUTER JOIN agg2 a2 '
                'ON a.facility_zone = a2.facility_zone '
                'ORDER BY zone'
            ),
            "category": "cte_subquery",
            "time_offset": toff(790),
        },
        {
            "id": "Q791",
            "sql": (
                'WITH base AS ('
                'SELECT _timestamp, facility_zone, operation_mode, '
                'throughput_rate, load_factor, cell_temp '
                'FROM "{stream}"'
                '), '
                'normalized AS ('
                'SELECT *, '
                '(throughput_rate - MIN(throughput_rate) OVER ()) / '
                'NULLIF(MAX(throughput_rate) OVER () - '
                'MIN(throughput_rate) OVER (), 0) AS norm_rate '
                'FROM base'
                ') '
                'SELECT facility_zone, operation_mode, '
                'AVG(norm_rate) AS avg_norm_rate, '
                'AVG(load_factor) AS avg_load, '
                'AVG(cell_temp) AS avg_temp '
                'FROM normalized '
                'GROUP BY facility_zone, operation_mode '
                'ORDER BY avg_norm_rate DESC'
            ),
            "category": "cte_subquery",
            "time_offset": toff(791),
        },
    ],

    # ── full_text_search (30 queries: Q792-Q821) ────────────────────
    "full_text_search": [
        # -- match_all + GROUP BY + HAVING --
        {
            "id": "Q792",
            "sql": (
                'SELECT component_name, COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'GROUP BY component_name '
                'HAVING COUNT(*) >= 1 '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(792),
        },
        {
            "id": "Q793",
            "sql": (
                'SELECT facility_zone, '
                "COUNT(*) FILTER (WHERE match_all('error')) AS error_hits, "
                "COUNT(*) FILTER (WHERE match_all('ACK')) AS ack_hits, "
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY total DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(793),
        },
        {
            "id": "Q794",
            "sql": (
                'SELECT facility_zone, COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'GROUP BY facility_zone '
                'HAVING AVG(throughput_rate) > 200 '
                'ORDER BY avg_rate DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(794),
        },
        # -- match_all + window --
        {
            "id": "Q795",
            "sql": (
                'SELECT _timestamp, log, facility_zone, '
                "match_all('ACK batch') AS has_ack, "
                'ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp'
                ') AS rn '
                'FROM "{stream}" '
                "WHERE match_all('ACK batch') "
                'ORDER BY facility_zone, rn LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(795),
        },
        {
            "id": "Q796",
            "sql": (
                'SELECT facility_zone, '
                "SUM(CASE WHEN match_all('error') THEN 1 ELSE 0 END) "
                'AS error_matches, '
                'COUNT(*) AS total, '
                'RANK() OVER (ORDER BY '
                "SUM(CASE WHEN match_all('error') THEN 1 ELSE 0 END) DESC"
                ') AS error_rank '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY error_rank LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(796),
        },
        # -- match_all in CTE --
        {
            "id": "Q797",
            "sql": (
                'WITH fts_hits AS ('
                'SELECT _timestamp, facility_zone, throughput_rate, log '
                'FROM "{stream}" '
                "WHERE match_all('warehouse')"
                ') '
                'SELECT facility_zone, '
                'COUNT(*) AS hit_cnt, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM fts_hits '
                'GROUP BY facility_zone '
                'ORDER BY hit_cnt DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(797),
        },
        {
            "id": "Q798",
            "sql": (
                'WITH fts_base AS ('
                'SELECT * FROM "{stream}" '
                "WHERE match_all('warehouse')"
                '), '
                'fts_ranked AS ('
                'SELECT *, ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone ORDER BY _timestamp'
                ') AS rn '
                'FROM fts_base'
                ') '
                'SELECT facility_zone, '
                'MAX(CASE WHEN rn = 1 THEN log END) AS first_hit, '
                'MAX(CASE WHEN rn = 2 THEN log END) AS second_hit, '
                'COUNT(*) AS total_hits '
                'FROM fts_ranked '
                'GROUP BY facility_zone '
                'ORDER BY total_hits DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(798),
        },
        # -- match_all + JOIN --
        {
            "id": "Q799",
            "sql": (
                'SELECT a.facility_zone, a.pallet_id, '
                "match_all('warehouse') AS match_a, "
                'b.load_factor '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                "WHERE match_all('warehouse') "
                'ORDER BY a._timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(799),
        },
        {
            "id": "Q800",
            "sql": (
                'SELECT a.component_name, '
                'COUNT(*) AS join_cnt, '
                "SUM(CASE WHEN match_all('error') THEN 1 ELSE 0 END) "
                'AS fts_errors '
                'FROM "{stream}" a '
                'LEFT JOIN "{stream2}" b '
                'ON a.component_name = b.component_name '
                'GROUP BY a.component_name '
                'ORDER BY fts_errors DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(800),
        },
        # -- Multiple match_all conditions --
        {
            "id": "Q801",
            "sql": (
                'SELECT _timestamp, log, '
                "match_all('warehouse') AS has_wh, "
                "match_all('error') AS has_error, "
                "match_all('ACK') AS has_ack "
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                "OR match_all('error') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(801),
        },
        {
            "id": "Q802",
            "sql": (
                'SELECT '
                "SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END) "
                'AS wh_hits, '
                "SUM(CASE WHEN match_all('error') THEN 1 ELSE 0 END) "
                'AS error_hits, '
                "SUM(CASE WHEN match_all('ACK batch') THEN 1 ELSE 0 END) "
                'AS ack_hits '
                'FROM "{stream}"'
            ),
            "category": "full_text_search",
            "time_offset": toff(802),
        },
        # -- re_match combined with match_all --
        {
            "id": "Q803",
            "sql": (
                'SELECT _timestamp, log, exception_message '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                "AND re_match(exception_message, 'NullPointer|Timeout') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(803),
        },
        {
            "id": "Q804",
            "sql": (
                'SELECT _timestamp, log_message, component_name '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                "AND str_match_ignore_case(log_message, 'error') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(804),
        },
        # -- FTS + aggregation + HAVING --
        {
            "id": "Q805",
            "sql": (
                'SELECT operation_mode, '
                'COUNT(*) AS cnt, '
                "APPROX_DISTINCT(component_name) AS distinct_components "
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'GROUP BY operation_mode '
                'HAVING COUNT(*) > 0 '
                'ORDER BY cnt DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(805),
        },
        {
            "id": "Q806",
            "sql": (
                'SELECT region_code, scan_category, '
                'COUNT(*) AS fts_hits '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'AND region_code IS NOT NULL '
                'GROUP BY region_code, scan_category '
                'ORDER BY fts_hits DESC LIMIT 12'
            ),
            "category": "full_text_search",
            "time_offset": toff(806),
        },
        # -- FTS with window + aggregation combo --
        {
            "id": "Q807",
            "sql": (
                'SELECT component_name, '
                "SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END) "
                'AS wh_cnt, '
                "SUM(CASE WHEN re_match(exception_message, "
                "'NullPointer|Timeout') THEN 1 ELSE 0 END) AS error_cnt, "
                'COUNT(*) AS total, '
                'RANK() OVER (ORDER BY COUNT(*) DESC) AS total_rank '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'ORDER BY total_rank LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(807),
        },
        # -- regexp_like + match_all --
        {
            "id": "Q808",
            "sql": (
                'SELECT _timestamp, COALESCE(exception_message, log_message) AS msg '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                "AND regexp_like(COALESCE(exception_message, log_message), "
                "'.*Exception.*') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(808),
        },
        # -- More FTS variants --
        {
            "id": "Q809",
            "sql": (
                'SELECT _timestamp, log, component_name, latency_ms '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'AND latency_ms > 100 '
                'ORDER BY latency_ms DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(809),
        },
        {
            "id": "Q810",
            "sql": (
                'SELECT facility_zone, control_center, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                "OR str_match_ignore_case(event_detail, 'batch') "
                'GROUP BY facility_zone, control_center '
                'HAVING COUNT(*) > 0 '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "full_text_search",
            "time_offset": toff(810),
        },
        {
            "id": "Q811",
            "sql": (
                'SELECT _timestamp, log, '
                "match_all('warehouse') AS is_match, "
                'ROW_NUMBER() OVER (ORDER BY _timestamp) AS seq '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                "OR match_all('error') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(811),
        },
        {
            "id": "Q812",
            "sql": (
                'WITH fts_set AS ('
                'SELECT _timestamp, component_name, latency_ms, log '
                'FROM "{stream}" '
                "WHERE match_all('warehouse')"
                '), '
                'non_fts_set AS ('
                'SELECT _timestamp, component_name, latency_ms, log '
                'FROM "{stream}" '
                "WHERE NOT match_all('warehouse')"
                ') '
                "SELECT 'fts' AS source, "
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM fts_set '
                'UNION ALL '
                "SELECT 'non_fts' AS source, "
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM non_fts_set'
            ),
            "category": "full_text_search",
            "time_offset": toff(812),
        },
        {
            "id": "Q813",
            "sql": (
                'SELECT a.facility_zone, '
                'COUNT(*) AS fts_join_cnt, '
                'AVG(CAST(a.throughput_rate AS FLOAT)) AS avg_rate '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                "WHERE match_all('warehouse') "
                'GROUP BY a.facility_zone '
                'ORDER BY fts_join_cnt DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(813),
        },
        {
            "id": "Q814",
            "sql": (
                'SELECT _timestamp, event_detail, ack_detail '
                'FROM "{stream}" '
                "WHERE match_all('batch') "
                "AND str_match_ignore_case(event_detail, 'batch') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(814),
        },
        {
            "id": "Q815",
            "sql": (
                'SELECT COALESCE(scan_category, \'unknown\') AS scan_type, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'OR LOWER(COALESCE(exception_message, \'\')) '
                "LIKE '%exception%' "
                'GROUP BY scan_type '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(815),
        },
        {
            "id": "Q816",
            "sql": (
                'SELECT _timestamp, log_message, '
                "COALESCE(match_all('error'), FALSE) AS has_error "
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(816),
        },
        {
            "id": "Q817",
            "sql": (
                'SELECT component_name, region_code, '
                "COUNT(*) FILTER (WHERE match_all('warehouse')) AS wh_hits, "
                "COUNT(*) FILTER (WHERE match_all('error')) AS error_hits "
                'FROM "{stream}" '
                'GROUP BY component_name, region_code '
                'ORDER BY wh_hits DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(817),
        },
        {
            "id": "Q818",
            "sql": (
                'SELECT a.org_name, '
                "SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END) "
                'AS a_fts, '
                "SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END) "
                'AS b_fts '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.org_name = b.org_name '
                'GROUP BY a.org_name '
                'ORDER BY a_fts DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(818),
        },
        {
            "id": "Q819",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(exception_message, log_message, log) AS text_field, '
                "match_all('warehouse') AS hits_wh "
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(819),
        },
        {
            "id": "Q820",
            "sql": (
                'SELECT tag_b, '
                'COUNT(*) AS cnt, '
                "SUM(CASE WHEN re_match(COALESCE(exception_message, ''), "
                "'NullPointer|Timeout|Security') THEN 1 ELSE 0 END) "
                'AS matched_errors '
                'FROM "{stream}" '
                "WHERE match_all('warehouse') "
                'OR LENGTH(COALESCE(exception_message, \'\')) > 10 '
                'GROUP BY tag_b '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "full_text_search",
            "time_offset": toff(820),
        },
        {
            "id": "Q821",
            "sql": (
                'WITH fts_data AS ('
                'SELECT _timestamp, facility_zone, throughput_rate, '
                'component_name '
                'FROM "{stream}" '
                "WHERE match_all('warehouse')"
                ') '
                'SELECT facility_zone, '
                'MAX(throughput_rate) AS peak_rate, '
                'APPROX_DISTINCT(component_name) AS distinct_comps '
                'FROM fts_data '
                'GROUP BY facility_zone '
                'ORDER BY peak_rate DESC'
            ),
            "category": "full_text_search",
            "time_offset": toff(821),
        },
    ],

    # ── union (28 queries: Q822-Q849) ────────────────────────────────
    "union": [
        {
            "id": "Q822",
            "sql": (
                'SELECT facility_zone AS zone, '
                "throughput_rate AS metric, 'rate' AS metric_type "
                'FROM "{stream}" WHERE throughput_rate > 300 '
                'UNION ALL '
                'SELECT facility_zone AS zone, '
                "CAST(load_factor AS BIGINT) AS metric, 'load' AS metric_type "
                'FROM "{stream}" WHERE load_factor > 50 '
                'ORDER BY metric_type, metric DESC LIMIT 15'
            ),
            "category": "union",
            "time_offset": toff(822),
        },
        {
            "id": "Q823",
            "sql": (
                'SELECT pallet_id FROM "{stream}" '
                'WHERE throughput_rate > 400 '
                'INTERSECT '
                'SELECT pallet_id FROM "{stream2}" '
                'WHERE load_factor > 30 '
                'ORDER BY pallet_id LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(823),
        },
        {
            "id": "Q824",
            "sql": (
                'SELECT facility_zone FROM "{stream}" '
                'WHERE throughput_rate > 500 '
                'EXCEPT '
                'SELECT facility_zone FROM "{stream2}" '
                'WHERE load_factor < 40 '
                'ORDER BY facility_zone'
            ),
            "category": "union",
            "time_offset": toff(824),
        },
        {
            "id": "Q825",
            "sql": (
                'SELECT facility_zone AS zone, '
                "sorter_model AS model, 'stream1' AS origin "
                'FROM "{stream}" WHERE throughput_rate > 300 '
                'UNION ALL '
                'SELECT facility_zone AS zone, '
                "sorter_model AS model, 'stream2' AS origin "
                'FROM "{stream2}" WHERE load_factor > 40 '
                'ORDER BY zone, origin LIMIT 15'
            ),
            "category": "union",
            "time_offset": toff(825),
        },
        {
            "id": "Q826",
            "sql": (
                'SELECT component_name AS comp, '
                "AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, "
                "'stream1' AS src "
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'UNION ALL '
                'SELECT component_name AS comp, '
                "AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, "
                "'stream2' AS src "
                'FROM "{stream2}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'ORDER BY avg_lat DESC LIMIT 15'
            ),
            "category": "union",
            "time_offset": toff(826),
        },
        {
            "id": "Q827",
            "sql": (
                'SELECT control_center AS cc FROM "{stream}" '
                'WHERE operation_mode = \'auto\' '
                'INTERSECT '
                'SELECT control_center AS cc FROM "{stream2}" '
                'WHERE operation_mode = \'auto\' '
                'ORDER BY cc'
            ),
            "category": "union",
            "time_offset": toff(827),
        },
        {
            "id": "Q828",
            "sql": (
                'SELECT sorter_model FROM "{stream}" '
                'WHERE facility_zone IN (\'ZONE-1\', \'ZONE-2\') '
                'EXCEPT '
                'SELECT sorter_model FROM "{stream2}" '
                'WHERE facility_zone IN (\'ZONE-3\', \'ZONE-4\') '
                'ORDER BY sorter_model LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(828),
        },
        # -- Nested set operations --
        {
            "id": "Q829",
            "sql": (
                'SELECT facility_zone FROM ('
                'SELECT facility_zone FROM "{stream}" '
                'WHERE throughput_rate > 400 '
                'UNION ALL '
                'SELECT facility_zone FROM "{stream2}" '
                'WHERE load_factor > 40'
                ') combined '
                'GROUP BY facility_zone '
                'HAVING COUNT(*) > 1 '
                'ORDER BY facility_zone'
            ),
            "category": "union",
            "time_offset": toff(829),
        },
        {
            "id": "Q830",
            "sql": (
                'WITH set_a AS ('
                'SELECT org_name FROM "{stream}" '
                'WHERE throughput_rate > 200'
                '), '
                'set_b AS ('
                'SELECT org_name FROM "{stream2}" '
                'WHERE load_factor > 30'
                ') '
                'SELECT org_name FROM set_a '
                'INTERSECT '
                'SELECT org_name FROM set_b '
                'ORDER BY org_name LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(830),
        },
        {
            "id": "Q831",
            "sql": (
                'SELECT facility_zone, SUM(cnt) AS total '
                'FROM ('
                'SELECT facility_zone, COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE throughput_rate > 200 '
                'GROUP BY facility_zone '
                'UNION ALL '
                'SELECT facility_zone, COUNT(*) AS cnt '
                'FROM "{stream2}" '
                'WHERE load_factor > 30 '
                'GROUP BY facility_zone'
                ') combined '
                'GROUP BY facility_zone '
                'ORDER BY total DESC'
            ),
            "category": "union",
            "time_offset": toff(831),
        },
        {
            "id": "Q832",
            "sql": (
                'SELECT pallet_id, '
                "SUM(throughput_rate) AS total_rate "
                'FROM ('
                'SELECT pallet_id, throughput_rate FROM "{stream}" '
                'UNION ALL '
                'SELECT pallet_id, throughput_rate FROM "{stream2}"'
                ') combined '
                'GROUP BY pallet_id '
                'ORDER BY total_rate DESC LIMIT 12'
            ),
            "category": "union",
            "time_offset": toff(832),
        },
        {
            "id": "Q833",
            "sql": (
                'WITH top_stream1 AS ('
                'SELECT facility_zone, throughput_rate '
                'FROM "{stream}" WHERE throughput_rate > 400'
                '), '
                'top_stream2 AS ('
                'SELECT facility_zone, load_factor AS metric '
                'FROM "{stream2}" WHERE load_factor > 50'
                ') '
                'SELECT facility_zone, '
                "AVG(CAST(throughput_rate AS FLOAT)) AS avg_rate, "
                'COUNT(*) AS top_count '
                'FROM ('
                'SELECT facility_zone, throughput_rate FROM top_stream1 '
                'UNION ALL '
                'SELECT facility_zone, 0 AS throughput_rate '
                'FROM top_stream2'
                ') u '
                'GROUP BY facility_zone '
                'ORDER BY avg_rate DESC'
            ),
            "category": "union",
            "time_offset": toff(833),
        },
        {
            "id": "Q834",
            "sql": (
                'SELECT component_name FROM "{stream}" '
                'WHERE latency_ms > 500 '
                'INTERSECT '
                'SELECT component_name FROM "{stream}" '
                'WHERE response_code >= 400 '
                'ORDER BY component_name LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(834),
        },
        {
            "id": "Q835",
            "sql": (
                'SELECT component_name FROM "{stream}" '
                'WHERE latency_ms > 500 '
                'EXCEPT '
                'SELECT component_name FROM "{stream}" '
                'WHERE response_code >= 400 '
                'ORDER BY component_name LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(835),
        },
        {
            "id": "Q836",
            "sql": (
                'SELECT conveyor_lane, sorter_model FROM "{stream}" '
                'WHERE facility_zone = \'ZONE-1\' '
                'UNION ALL '
                'SELECT conveyor_lane, sorter_model FROM "{stream}" '
                'WHERE facility_zone = \'ZONE-3\' '
                'UNION ALL '
                'SELECT conveyor_lane, sorter_model FROM "{stream2}" '
                'WHERE facility_zone = \'ZONE-2\' '
                'ORDER BY conveyor_lane, sorter_model LIMIT 12'
            ),
            "category": "union",
            "time_offset": toff(836),
        },
        {
            "id": "Q837",
            "sql": (
                'SELECT operation_mode, SUM(cnt) AS total_ops '
                'FROM ('
                'SELECT operation_mode, COUNT(*) AS cnt '
                'FROM "{stream}" GROUP BY operation_mode '
                'UNION ALL '
                'SELECT operation_mode, COUNT(*) AS cnt '
                'FROM "{stream2}" GROUP BY operation_mode'
                ') merged '
                'GROUP BY operation_mode '
                'ORDER BY total_ops DESC'
            ),
            "category": "union",
            "time_offset": toff(837),
        },
        {
            "id": "Q838",
            "sql": (
                'WITH high AS ('
                'SELECT pallet_id, throughput_rate '
                "FROM \"{stream}\" WHERE throughput_rate >= 500), "
                'medium AS ('
                'SELECT pallet_id, throughput_rate '
                "FROM \"{stream}\" WHERE throughput_rate BETWEEN 300 AND 499), "
                'low AS ('
                'SELECT pallet_id, throughput_rate '
                "FROM \"{stream}\" WHERE throughput_rate < 300) "
                "SELECT 'high' AS tier, COUNT(*) AS cnt FROM high "
                'UNION ALL '
                "SELECT 'medium' AS tier, COUNT(*) AS cnt FROM medium "
                'UNION ALL '
                "SELECT 'low' AS tier, COUNT(*) AS cnt FROM low "
                'ORDER BY tier'
            ),
            "category": "union",
            "time_offset": toff(838),
        },
        {
            "id": "Q839",
            "sql": (
                'SELECT facility_zone, COUNT(*) AS cnt '
                'FROM ('
                'SELECT facility_zone FROM "{stream}" '
                'WHERE match_all(\'warehouse\') '
                'UNION ALL '
                'SELECT facility_zone FROM "{stream}" '
                'WHERE match_all(\'error\')'
                ') fts_hits '
                'GROUP BY facility_zone '
                'ORDER BY cnt DESC'
            ),
            "category": "union",
            "time_offset": toff(839),
        },
        # -- More UNION/INTERSECT/EXCEPT variants --
        {
            "id": "Q840",
            "sql": (
                'WITH a AS ('
                'SELECT region_code, component_name '
                'FROM "{stream}" WHERE latency_ms > 500'
                '), '
                'b AS ('
                'SELECT region_code, component_name '
                'FROM "{stream2}" WHERE latency_ms > 300'
                ') '
                'SELECT region_code, component_name FROM a '
                'INTERSECT '
                'SELECT region_code, component_name FROM b '
                'ORDER BY region_code LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(840),
        },
        {
            "id": "Q841",
            "sql": (
                'SELECT org_name, COUNT(*) AS cnt '
                'FROM ('
                'SELECT org_name FROM "{stream}" '
                'WHERE throughput_rate > 200 '
                'UNION ALL '
                'SELECT org_name FROM "{stream2}" '
                'WHERE load_factor > 30'
                ') merged '
                'WHERE org_name IS NOT NULL '
                'GROUP BY org_name '
                'HAVING COUNT(*) > 1 '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(841),
        },
        {
            "id": "Q842",
            "sql": (
                'SELECT a.pallet_id FROM "{stream}" a '
                'WHERE a.throughput_rate > 300 '
                'INTERSECT '
                'SELECT b.pallet_id FROM "{stream2}" b '
                'WHERE b.load_factor > 40 '
                'ORDER BY pallet_id LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(842),
        },
        {
            "id": "Q843",
            "sql": (
                'SELECT pallet_id, MAX(metric) AS peak '
                'FROM ('
                'SELECT pallet_id, throughput_rate AS metric '
                'FROM "{stream}" '
                'UNION ALL '
                'SELECT pallet_id, load_factor AS metric '
                'FROM "{stream2}"'
                ') u '
                'GROUP BY pallet_id '
                'ORDER BY peak DESC LIMIT 12'
            ),
            "category": "union",
            "time_offset": toff(843),
        },
        {
            "id": "Q844",
            "sql": (
                'WITH all_records AS ('
                'SELECT _timestamp, facility_zone, throughput_rate '
                'FROM "{stream}" '
                'UNION ALL '
                'SELECT _timestamp, facility_zone, throughput_rate '
                'FROM "{stream2}"'
                ') '
                'SELECT facility_zone, '
                'COUNT(*) AS total_cnt, '
                'AVG(throughput_rate) AS avg_rate, '
                'MAX(throughput_rate) AS peak_rate '
                'FROM all_records '
                'GROUP BY facility_zone '
                'ORDER BY peak_rate DESC'
            ),
            "category": "union",
            "time_offset": toff(844),
        },
        {
            "id": "Q845",
            "sql": (
                'SELECT component_name, SUM(cnt) AS total '
                'FROM ('
                'SELECT component_name, COUNT(*) AS cnt '
                'FROM "{stream}" GROUP BY component_name '
                'UNION ALL '
                'SELECT component_name, COUNT(*) AS cnt '
                'FROM "{stream2}" GROUP BY component_name'
                ') merged '
                'GROUP BY component_name '
                'ORDER BY total DESC LIMIT 12'
            ),
            "category": "union",
            "time_offset": toff(845),
        },
        {
            "id": "Q846",
            "sql": (
                'WITH s1 AS ('
                'SELECT facility_zone, operation_mode '
                'FROM "{stream}" WHERE throughput_rate > 300'
                '), '
                's2 AS ('
                'SELECT facility_zone, operation_mode '
                'FROM "{stream2}" WHERE load_factor > 40'
                ') '
                'SELECT facility_zone, operation_mode FROM s1 '
                'UNION '
                'SELECT facility_zone, operation_mode FROM s2 '
                'ORDER BY facility_zone, operation_mode LIMIT 12'
            ),
            "category": "union",
            "time_offset": toff(846),
        },
        {
            "id": "Q847",
            "sql": (
                'SELECT conveyor_lane FROM "{stream}" '
                'WHERE facility_zone = \'ZONE-1\' '
                'INTERSECT '
                'SELECT conveyor_lane FROM "{stream2}" '
                'WHERE facility_zone = \'ZONE-2\' '
                'ORDER BY conveyor_lane'
            ),
            "category": "union",
            "time_offset": toff(847),
        },
        {
            "id": "Q848",
            "sql": (
                'SELECT tag_a AS tag FROM "{stream}" '
                'WHERE throughput_rate > 300 '
                'UNION '
                'SELECT tag_b AS tag FROM "{stream2}" '
                'WHERE load_factor > 40 '
                'ORDER BY tag LIMIT 10'
            ),
            "category": "union",
            "time_offset": toff(848),
        },
        {
            "id": "Q849",
            "sql": (
                'WITH agg AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_val, '
                "'rate' AS val_type "
                'FROM "{stream}" GROUP BY facility_zone '
                'UNION ALL '
                'SELECT facility_zone, '
                "AVG(CAST(load_factor AS FLOAT)) AS avg_val, "
                "'load' AS val_type "
                'FROM "{stream2}" GROUP BY facility_zone'
                ') '
                'SELECT facility_zone, val_type, avg_val, '
                'RANK() OVER (PARTITION BY val_type '
                'ORDER BY avg_val DESC) AS rk '
                'FROM agg '
                'ORDER BY val_type, rk LIMIT 12'
            ),
            "category": "union",
            "time_offset": toff(849),
        },
    ],

    # ── aggregation (28 queries: Q850-Q877) ─────────────────────────
    "aggregation": [
        {
            "id": "Q850",
            "sql": (
                'SELECT component_name, '
                "COUNT(*) FILTER (WHERE response_code >= 400) AS errors, "
                "COUNT(*) FILTER (WHERE response_code < 400) AS successes, "
                "COUNT(*) FILTER (WHERE latency_ms > 1000) AS slow_reqs, "
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'ORDER BY errors DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(850),
        },
        {
            "id": "Q851",
            "sql": (
                'SELECT facility_zone, operation_mode, '
                "COUNT(*) FILTER (WHERE throughput_rate > 500) AS high_rate, "
                "COUNT(*) FILTER (WHERE throughput_rate BETWEEN 200 AND 500) "
                'AS mid_rate, '
                "COUNT(*) FILTER (WHERE throughput_rate < 200) AS low_rate "
                'FROM "{stream}" '
                'GROUP BY facility_zone, operation_mode '
                'ORDER BY high_rate DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(851),
        },
        {
            "id": "Q852",
            "sql": (
                'SELECT component_name, '
                'COUNT(*) AS cnt, '
                "COUNT(*) FILTER (WHERE auth_result = 'pass') AS passed, "
                "COUNT(*) FILTER (WHERE auth_result IN ('fail', 'denied')) "
                'AS failed, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(852),
        },
        # -- HAVING with complex conditions --
        {
            "id": "Q853",
            "sql": (
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate, '
                'STDDEV(throughput_rate) AS std_rate, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'HAVING AVG(throughput_rate) > 100 '
                'AND COUNT(*) >= 1 '
                'AND STDDEV(throughput_rate) > 0 '
                'ORDER BY avg_rate DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(853),
        },
        {
            "id": "Q854",
            "sql": (
                'SELECT region_code, scan_category, '
                'COUNT(*) AS cnt, '
                'MAX(latency_ms) AS max_lat, '
                'MIN(latency_ms) AS min_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'AND region_code IS NOT NULL '
                'GROUP BY region_code, scan_category '
                'HAVING MAX(latency_ms) - MIN(latency_ms) > 100 '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(854),
        },
        {
            "id": "Q855",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'COUNT(*) AS cnt, '
                'SUM(CASE WHEN response_code >= 400 THEN 1 ELSE 0 END) '
                'AS error_cnt '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'HAVING SUM(CASE WHEN response_code >= 400 THEN 1 ELSE 0 END) '
                '> 0 '
                'ORDER BY error_cnt DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(855),
        },
        # -- Multiple DISTINCT aggregates --
        {
            "id": "Q856",
            "sql": (
                'SELECT facility_zone, '
                'COUNT(DISTINCT pallet_id) AS distinct_pallets, '
                'COUNT(DISTINCT sorter_model) AS distinct_sorters, '
                'COUNT(DISTINCT operation_mode) AS distinct_modes, '
                'COUNT(*) AS total_rows '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY distinct_pallets DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(856),
        },
        {
            "id": "Q857",
            "sql": (
                'SELECT region_code, '
                'COUNT(DISTINCT component_name) AS distinct_comps, '
                'COUNT(DISTINCT scan_category) AS distinct_scans, '
                'APPROX_DISTINCT(org_name) AS approx_orgs, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE region_code IS NOT NULL '
                'GROUP BY region_code '
                'ORDER BY distinct_comps DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(857),
        },
        # -- Approximate functions --
        {
            "id": "Q858",
            "sql": (
                'SELECT facility_zone, '
                'APPROX_DISTINCT(pallet_id) AS approx_pallets, '
                'APPROX_PERCENTILE_CONT(CAST(throughput_rate AS FLOAT), 0.5) '
                'AS median_rate, '
                'APPROX_PERCENTILE_CONT(CAST(throughput_rate AS FLOAT), 0.9) '
                'AS p90_rate '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY median_rate DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(858),
        },
        {
            "id": "Q859",
            "sql": (
                'SELECT component_name, '
                'APPROX_DISTINCT(region_code) AS approx_regions, '
                'APPROX_PERCENTILE_CONT(CAST(latency_ms AS FLOAT), 0.95) '
                'AS p95_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'HAVING APPROX_DISTINCT(region_code) > 0 '
                'ORDER BY p95_lat DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(859),
        },
        # -- GROUP BY with CASE --
        {
            "id": "Q860",
            "sql": (
                'SELECT CASE '
                'WHEN throughput_rate >= 500 THEN \'high\' '
                'WHEN throughput_rate >= 300 THEN \'medium\' '
                "ELSE 'low' END AS perf_tier, "
                'CASE '
                "WHEN auth_result = 'pass' THEN 'authenticated' "
                "ELSE 'other' END AS auth_class, "
                'COUNT(*) AS cnt, '
                'AVG(load_factor) AS avg_load '
                'FROM "{stream}" '
                'GROUP BY perf_tier, auth_class '
                'ORDER BY perf_tier, auth_class'
            ),
            "category": "aggregation",
            "time_offset": toff(860),
        },
        {
            "id": "Q861",
            "sql": (
                'SELECT COALESCE(scan_category, \'unknown\') AS scan_type, '
                'CASE '
                "WHEN CHAR_LENGTH(COALESCE(exception_message, '')) > 30 "
                "THEN 'long_error' "
                "WHEN CHAR_LENGTH(COALESCE(exception_message, '')) > 0 "
                "THEN 'short_error' "
                "ELSE 'no_error' END AS error_class, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY scan_type, error_class '
                'ORDER BY scan_type, cnt DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(861),
        },
        # -- Aggregation with STRING_AGG --
        {
            "id": "Q862",
            "sql": (
                'SELECT operation_mode, '
                'STRING_AGG(DISTINCT CAST(sorter_model AS VARCHAR), '
                "', ') AS sorters, "
                'COUNT(DISTINCT sorter_model) AS sorter_count '
                'FROM "{stream}" '
                'GROUP BY operation_mode '
                'ORDER BY sorter_count DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(862),
        },
        {
            "id": "Q863",
            "sql": (
                'SELECT facility_zone, '
                'ARRAY_AGG(DISTINCT pallet_id) AS pallets, '
                'COUNT(DISTINCT pallet_id) AS pallet_count '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY pallet_count DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(863),
        },
        # -- Aggregation over JOIN --
        {
            "id": "Q864",
            "sql": (
                'SELECT a.facility_zone, '
                'COUNT(DISTINCT a.pallet_id) AS pallets_a, '
                'COUNT(DISTINCT b.pallet_id) AS pallets_b, '
                'AVG(a.throughput_rate) AS avg_rate_a, '
                'AVG(b.throughput_rate) AS avg_rate_b '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.facility_zone = b.facility_zone '
                'GROUP BY a.facility_zone '
                'ORDER BY avg_rate_a DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(864),
        },
        {
            "id": "Q865",
            "sql": (
                'SELECT a.operation_mode, a.control_center, '
                'SUM(a.throughput_rate) AS total_rate, '
                'SUM(b.load_factor) AS total_load, '
                'COUNT(*) AS join_cnt '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.control_center = b.control_center '
                'GROUP BY a.operation_mode, a.control_center '
                'ORDER BY total_rate DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(865),
        },
        # -- Group with COALESCE and NULL handling --
        {
            "id": "Q866",
            "sql": (
                'SELECT COALESCE(info_tag, bot_flag, \'none\') AS flag, '
                'COALESCE(variant_tag, \'control\') AS variant, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(COALESCE(latency_ms, lcp_micros) AS FLOAT)) '
                'AS avg_response '
                'FROM "{stream}" '
                'GROUP BY flag, variant '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(866),
        },
        {
            "id": "Q867",
            "sql": (
                'SELECT COALESCE(bot_flag, \'clean\') AS bot_status, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'MAX(CAST(latency_ms AS FLOAT)) AS max_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY bot_status '
                'ORDER BY cnt DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(867),
        },
        # -- Complex aggregation patterns --
        {
            "id": "Q868",
            "sql": (
                'SELECT tag_b AS severity, '
                'COUNT(*) AS total, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) '
                'AS median_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY severity '
                'ORDER BY total DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(868),
        },
        {
            "id": "Q869",
            "sql": (
                'SELECT device_type, page_slug, '
                'COUNT(*) AS views, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp, '
                'AVG(CAST(inp_micros AS FLOAT)) AS avg_inp, '
                'AVG(CAST(cls_score AS FLOAT)) AS avg_cls '
                'FROM "{stream}" '
                'WHERE device_type IS NOT NULL '
                'AND page_slug IS NOT NULL '
                'GROUP BY device_type, page_slug '
                'ORDER BY views DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(869),
        },
        {
            "id": "Q870",
            "sql": (
                'SELECT org_name, '
                'SUM(throughput_rate) AS total_rate, '
                'SUM(item_count) AS total_items, '
                'AVG(defect_limit) AS avg_defect_limit, '
                'SUM(throughput_rate) / NULLIF(SUM(item_count), 0) '
                'AS rate_per_item '
                'FROM "{stream}" '
                'WHERE org_name IS NOT NULL '
                'GROUP BY org_name '
                'ORDER BY total_rate DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(870),
        },
        {
            "id": "Q871",
            "sql": (
                'SELECT region_code, '
                'COUNT(*) AS events, '
                "SUM(CASE WHEN auth_result = 'fail' THEN 1 ELSE 0 END) "
                'AS failures, '
                "ROUND(CAST(SUM(CASE WHEN auth_result = 'fail' "
                'THEN 1 ELSE 0 END) AS FLOAT) * 100.0 / '
                'NULLIF(COUNT(*), 0), 2) AS failure_pct '
                'FROM "{stream}" '
                'WHERE region_code IS NOT NULL '
                'GROUP BY region_code '
                'HAVING COUNT(*) > 1 '
                'ORDER BY failure_pct DESC NULLS LAST LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(871),
        },
        {
            "id": "Q872",
            "sql": (
                'SELECT component_name, '
                'SUM(latency_ms) AS total_lat, '
                'AVG(latency_ms) AS avg_lat, '
                'STDDEV(latency_ms) AS std_lat, '
                "STDDEV(latency_ms) / NULLIF(AVG(latency_ms), 0) AS cv "
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'HAVING COUNT(*) > 1 '
                'ORDER BY cv DESC NULLS LAST LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(872),
        },
        {
            "id": "Q873",
            "sql": (
                'SELECT COALESCE(guard_mode, \'unknown\') AS mode, '
                'COALESCE(record_type, \'unknown\') AS rtype, '
                'COUNT(*) AS cnt, '
                'MIN(latency_ms) AS min_lat, '
                'MAX(latency_ms) AS max_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY mode, rtype '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(873),
        },
        {
            "id": "Q874",
            "sql": (
                'SELECT app_label, '
                'COUNT(*) AS total, '
                "COUNT(*) FILTER (WHERE match_all('error')) AS fts_errors, "
                'AVG(CAST(throughput_rate AS FLOAT)) AS avg_rate '
                'FROM "{stream}" '
                'WHERE app_label IS NOT NULL '
                'GROUP BY app_label '
                'ORDER BY total DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(874),
        },
        {
            "id": "Q875",
            "sql": (
                'SELECT conveyor_lane, '
                'SUM(throughput_rate) AS total_rate, '
                'SUM(load_factor) AS total_load, '
                'ROUND(AVG(cell_temp), 2) AS avg_temp, '
                'COUNT(DISTINCT pallet_id) AS distinct_pallets '
                'FROM "{stream}" '
                'GROUP BY conveyor_lane '
                'ORDER BY total_rate DESC'
            ),
            "category": "aggregation",
            "time_offset": toff(875),
        },
        {
            "id": "Q876",
            "sql": (
                'SELECT facility_zone, sorter_model, '
                'MAX(throughput_rate) - MIN(throughput_rate) AS rate_range, '
                'MAX(load_factor) - MIN(load_factor) AS load_range, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY facility_zone, sorter_model '
                'ORDER BY rate_range DESC LIMIT 12'
            ),
            "category": "aggregation",
            "time_offset": toff(876),
        },
        {
            "id": "Q877",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp, '
                'AVG(CAST(inp_micros AS FLOAT)) AS avg_inp '
                'FROM "{stream}" '
                'WHERE component_name IS NOT NULL '
                'GROUP BY component_name '
                'HAVING AVG(CAST(latency_ms AS FLOAT)) > 0 '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "aggregation",
            "time_offset": toff(877),
        },
    ],

    # ── date_time (23 queries: Q878-Q900) ───────────────────────────
    "date_time": [
        {
            "id": "Q878",
            "sql": (
                'SELECT _timestamp, '
                'date_trunc(\'minute\', _timestamp) AS minute_trunc, '
                '(_timestamp / 30000000) * 30000000 AS thirty_sec_bucket, '
                'latency_ms '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(878),
        },
        {
            "id": "Q879",
            "sql": (
                'SELECT '
                '(_timestamp / 60000000) * 60000000 AS minute_bucket, '
                'COUNT(*) AS cnt, '
                'AVG(latency_ms) AS avg_lat, '
                'MAX(latency_ms) AS max_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY minute_bucket '
                'ORDER BY minute_bucket ASC'
            ),
            "category": "date_time",
            "time_offset": toff(879),
        },
        {
            "id": "Q880",
            "sql": (
                'SELECT _timestamp, '
                'to_timestamp_micros(_timestamp) AS ts_converted, '
                'latency_ms '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(880),
        },
        {
            "id": "Q881",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp + arrow_cast(3600000000, \'Int64\') AS future_ts, '
                '_timestamp - arrow_cast(3600000000, \'Int64\') AS past_ts '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(881),
        },
        {
            "id": "Q882",
            "sql": (
                'SELECT _timestamp, '
                '(_timestamp - LAG(_timestamp) OVER (ORDER BY _timestamp)) '
                '/ 1000 AS gap_ms '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(882),
        },
        {
            "id": "Q883",
            "sql": (
                'SELECT _timestamp, '
                'date_trunc(\'hour\', _timestamp) AS hour_bucket, '
                'COUNT(*) OVER (PARTITION BY '
                'date_trunc(\'hour\', _timestamp)) AS cnt_in_hour, '
                'throughput_rate '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(883),
        },
        {
            "id": "Q884",
            "sql": (
                'SELECT date_trunc(\'minute\', _timestamp) AS minute_bucket, '
                'component_name, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY minute_bucket, component_name '
                'ORDER BY minute_bucket ASC, cnt DESC LIMIT 15'
            ),
            "category": "date_time",
            "time_offset": toff(884),
        },
        {
            "id": "Q885",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp - (_timestamp % 30000000) AS aligned_30s, '
                'lead(_timestamp, 1) OVER (ORDER BY _timestamp) '
                '- _timestamp AS lead_gap '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(885),
        },
        {
            "id": "Q886",
            "sql": (
                'SELECT EXTRACT(HOUR FROM to_timestamp_micros(_timestamp)) '
                'AS hour_of_day, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY hour_of_day '
                'ORDER BY hour_of_day'
            ),
            "category": "date_time",
            "time_offset": toff(886),
        },
        {
            "id": "Q887",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp / 1000000 AS epoch_seconds, '
                '(_timestamp / 1000000) % 60 AS second_of_minute '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(887),
        },
        {
            "id": "Q888",
            "sql": (
                'SELECT (_timestamp / 3600000000) * 3600000000 AS hour_bucket, '
                'COUNT(*) AS cnt, '
                'SUM(throughput_rate) AS total_rate '
                'FROM "{stream}" '
                'GROUP BY hour_bucket '
                'ORDER BY hour_bucket ASC'
            ),
            "category": "date_time",
            "time_offset": toff(888),
        },
        {
            "id": "Q889",
            "sql": (
                'SELECT _timestamp, '
                'date_trunc(\'second\', _timestamp) AS second_trunc, '
                'latency_ms, throughput_rate '
                'FROM "{stream}" '
                'WHERE throughput_rate > 200 '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(889),
        },
        {
            "id": "Q890",
            "sql": (
                'SELECT '
                '(_timestamp / 15000000) * 15000000 AS fifteen_sec_bucket, '
                'facility_zone, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY fifteen_sec_bucket, facility_zone '
                'ORDER BY fifteen_sec_bucket ASC LIMIT 15'
            ),
            "category": "date_time",
            "time_offset": toff(890),
        },
        {
            "id": "Q891",
            "sql": (
                'SELECT _timestamp, '
                'to_timestamp_micros(_timestamp) AS ts_dt, '
                'arrow_cast(to_timestamp_micros(_timestamp), '
                "'Timestamp(Nanosecond, None)') AS ts_ns "
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(891),
        },
        {
            "id": "Q892",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp - MIN(_timestamp) OVER () AS offset_from_start, '
                'throughput_rate '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(892),
        },
        {
            "id": "Q893",
            "sql": (
                'SELECT _timestamp, '
                '(_timestamp / 60000000) * 60000000 AS minute_bucket, '
                'MAX(throughput_rate) OVER (PARTITION BY '
                '(_timestamp / 60000000) * 60000000) AS peak_in_minute '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(893),
        },
        {
            "id": "Q894",
            "sql": (
                'SELECT date_trunc(\'minute\', _timestamp) AS minute_bucket, '
                'COALESCE(operation_mode, \'unknown\') AS mode, '
                'COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM "{stream}" '
                'GROUP BY minute_bucket, mode '
                'ORDER BY minute_bucket ASC, cnt DESC LIMIT 15'
            ),
            "category": "date_time",
            "time_offset": toff(894),
        },
        {
            "id": "Q895",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp + (latency_ms * 1000) AS response_ts, '
                'latency_ms '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(895),
        },
        {
            "id": "Q896",
            "sql": (
                'SELECT '
                '(_timestamp / 120000000) * 120000000 AS two_min_bucket, '
                'COUNT(*) AS cnt, '
                'MAX(latency_ms) AS max_lat, '
                'MIN(latency_ms) AS min_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY two_min_bucket '
                'ORDER BY two_min_bucket ASC'
            ),
            "category": "date_time",
            "time_offset": toff(896),
        },
        {
            "id": "Q897",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp / 1000000 AS epoch_seconds, '
                '(_timestamp / 1000000) / 60 AS epoch_minutes '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(897),
        },
        {
            "id": "Q898",
            "sql": (
                'SELECT date_trunc(\'second\', _timestamp) AS second_bucket, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY second_bucket '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(898),
        },
        {
            "id": "Q899",
            "sql": (
                'WITH time_data AS ('
                'SELECT _timestamp, '
                '_timestamp - MIN(_timestamp) OVER () AS rel_time, '
                'throughput_rate '
                'FROM "{stream}"'
                ') '
                'SELECT _timestamp, rel_time / 1000 AS rel_ms, throughput_rate '
                'FROM time_data '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(899),
        },
        {
            "id": "Q900",
            "sql": (
                'SELECT _timestamp, '
                '_timestamp - LAG(_timestamp) OVER ('
                'PARTITION BY component_name ORDER BY _timestamp) '
                'AS comp_gap, '
                'component_name, latency_ms '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY component_name, _timestamp ASC LIMIT 10'
            ),
            "category": "date_time",
            "time_offset": toff(900),
        },
    ],

    # ── histogram (22 queries: Q901-Q922) ───────────────────────────
    "histogram": [
        {
            "id": "Q901",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(901),
        },
        {
            "id": "Q902",
            "sql": (
                "SELECT histogram(_timestamp, '30 second') AS _time, "
                'facility_zone, COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, facility_zone '
                'ORDER BY _time ASC, cnt DESC LIMIT 20'
            ),
            "category": "histogram",
            "time_offset": toff_wide(902),
        },
        {
            "id": "Q903",
            "sql": (
                "SELECT histogram(_timestamp, '2 minute') AS _time, "
                "COUNT(*) FILTER (WHERE throughput_rate > 300) AS high_rate, "
                "COUNT(*) FILTER (WHERE throughput_rate <= 300) AS low_rate, "
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(903),
        },
        {
            "id": "Q904",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'operation_mode, '
                'AVG(throughput_rate) AS avg_rate, '
                'MAX(throughput_rate) AS peak_rate '
                'FROM "{stream}" '
                'GROUP BY _time, operation_mode '
                'ORDER BY _time ASC, avg_rate DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(904),
        },
        {
            "id": "Q905",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COALESCE(scan_category, \'unknown\') AS scan_type, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, scan_type '
                'ORDER BY _time ASC, cnt DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(905),
        },
        {
            "id": "Q906",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'component_name, '
                "SUM(CASE WHEN response_code >= 400 THEN 1 ELSE 0 END) "
                'AS errors, '
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY _time, component_name '
                'ORDER BY _time ASC, errors DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(906),
        },
        {
            "id": "Q907",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(907),
        },
        {
            "id": "Q908",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'CASE '
                "WHEN auth_result = 'pass' THEN 'authenticated' "
                "WHEN auth_result IN ('fail', 'denied') THEN 'failed' "
                "ELSE 'other' END AS auth_class, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, auth_class '
                'ORDER BY _time ASC, cnt DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(908),
        },
        {
            "id": "Q909",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COALESCE(org_name, site_name) AS tenant, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, tenant '
                'ORDER BY _time ASC, cnt DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(909),
        },
        {
            "id": "Q910",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'SUM(CASE WHEN bot_flag IS NOT NULL THEN 1 ELSE 0 END) '
                'AS bot_flagged, '
                'SUM(CASE WHEN bot_flag IS NULL THEN 1 ELSE 0 END) '
                'AS clean '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(910),
        },
        {
            "id": "Q911",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(*) AS total, '
                "SUM(CASE WHEN re_match(COALESCE(exception_message, ''), "
                "'NullPointer|Timeout|Security') THEN 1 ELSE 0 END) "
                'AS error_count '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(911),
        },
        {
            "id": "Q912",
            "sql": (
                "SELECT histogram(_timestamp, '2 minute') AS _time, "
                'facility_zone, operation_mode, '
                'SUM(throughput_rate) AS total_rate '
                'FROM "{stream}" '
                'GROUP BY _time, facility_zone, operation_mode '
                'ORDER BY _time ASC, total_rate DESC LIMIT 20'
            ),
            "category": "histogram",
            "time_offset": toff_wide(912),
        },
        {
            "id": "Q913",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(*) AS cnt, '
                'AVG(throughput_rate) AS avg_rate, '
                'STDDEV(throughput_rate) AS std_rate '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(913),
        },
        {
            "id": "Q914",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'region_code, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE region_code IS NOT NULL '
                'GROUP BY _time, region_code '
                'ORDER BY _time ASC, cnt DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(914),
        },
        {
            "id": "Q915",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'tag_b AS severity, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY _time, severity '
                'ORDER BY _time ASC, cnt DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(915),
        },
        {
            "id": "Q916",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COALESCE(guard_mode, \'unknown\') AS gmode, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY _time, gmode '
                'ORDER BY _time ASC, cnt DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(916),
        },
        {
            "id": "Q917",
            "sql": (
                'SELECT a._time, a.cnt AS cnt_a, b.cnt AS cnt_b '
                'FROM ('
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" GROUP BY _time'
                ') a '
                'LEFT JOIN ('
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(*) AS cnt '
                'FROM "{stream2}" GROUP BY _time'
                ') b ON a._time = b._time '
                'ORDER BY a._time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(917),
        },
        {
            "id": "Q918",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'COUNT(DISTINCT component_name) AS distinct_comps, '
                'COUNT(DISTINCT region_code) AS distinct_regions '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(918),
        },
        {
            "id": "Q919",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                "SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END) "
                'AS fts_hits, '
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(919),
        },
        {
            "id": "Q920",
            "sql": (
                "SELECT histogram(_timestamp, '30 second') AS _time, "
                'component_name, '
                'APPROX_DISTINCT(region_code) AS approx_regions, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE component_name IS NOT NULL '
                'GROUP BY _time, component_name '
                'ORDER BY _time ASC, cnt DESC LIMIT 20'
            ),
            "category": "histogram",
            "time_offset": toff_wide(920),
        },
        {
            "id": "Q921",
            "sql": (
                "SELECT histogram(_timestamp, '1 minute') AS _time, "
                'device_type, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp, '
                'AVG(CAST(cls_score AS FLOAT)) AS avg_cls '
                'FROM "{stream}" '
                'WHERE device_type IS NOT NULL '
                'GROUP BY _time, device_type '
                'ORDER BY _time ASC, avg_lcp DESC LIMIT 15'
            ),
            "category": "histogram",
            "time_offset": toff_wide(921),
        },
        {
            "id": "Q922",
            "sql": (
                "SELECT histogram(_timestamp, '2 minute') AS _time, "
                "COUNT(*) FILTER (WHERE response_code >= 400) AS error_cnt, "
                "COUNT(*) FILTER (WHERE response_code < 400) AS success_cnt, "
                'ROUND(CAST(COUNT(*) FILTER (WHERE response_code >= 400) '
                'AS FLOAT) * 100.0 / NULLIF(COUNT(*), 0), 2) AS error_pct '
                'FROM "{stream}" '
                'GROUP BY _time ORDER BY _time ASC'
            ),
            "category": "histogram",
            "time_offset": toff_wide(922),
        },
    ],

    # ── string_functions (22 queries: Q923-Q944) ────────────────────
    "string_functions": [
        {
            "id": "Q923",
            "sql": (
                'SELECT '
                'UPPER(COALESCE(component_name, \'unknown\')) AS comp_upper, '
                'LOWER(COALESCE(scan_category, \'none\')) AS scan_lower, '
                'LENGTH(COALESCE(exception_message, \'\')) AS error_len, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY comp_upper, scan_lower, error_len '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "string_functions",
            "time_offset": toff(923),
        },
        {
            "id": "Q924",
            "sql": (
                'SELECT TRIM(COALESCE(build_signature, build_version)) '
                'AS build_id, '
                'SUBSTRING(COALESCE(build_signature, build_version), 1, 4) '
                'AS prefix, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY build_id, prefix '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(924),
        },
        {
            "id": "Q925",
            "sql": (
                'SELECT CONCAT(component_name, \'/\', '
                "COALESCE(route_key, 'no-route'), "
                "' (', scan_category, ')') AS full_route, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY full_route '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(925),
        },
        {
            "id": "Q926",
            "sql": (
                'SELECT REPLACE(REPLACE('
                "COALESCE(page_url, endpoint_path, '/'), "
                "'https://', ''), 'http://', '') AS clean_path, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE page_url IS NOT NULL OR endpoint_path IS NOT NULL '
                'GROUP BY clean_path '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(926),
        },
        {
            "id": "Q927",
            "sql": (
                'SELECT split_part(COALESCE(exception_message, '
                "'Unknown error'), chr(32), 1) AS first_word, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY first_word '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(927),
        },
        {
            "id": "Q928",
            "sql": (
                'SELECT '
                'CASE '
                'WHEN LENGTH(CONCAT(COALESCE(exception_message, \'\'), '
                "COALESCE(log_message, ''))) < 50 THEN 'short' "
                'WHEN LENGTH(CONCAT(COALESCE(exception_message, \'\'), '
                "COALESCE(log_message, ''))) < 100 THEN 'medium' "
                "ELSE 'long' END AS msg_class, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY msg_class '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(928),
        },
        {
            "id": "Q929",
            "sql": (
                'SELECT CAST(tag_a AS VARCHAR) || \'-\' || '
                'CAST(tag_b AS VARCHAR) AS combined_tag, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY combined_tag '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(929),
        },
        {
            "id": "Q930",
            "sql": (
                'SELECT UPPER(COALESCE(org_name, site_name, '
                "region_code, 'UNKNOWN')) AS location, "
                'LOWER(scan_category) AS scan_type, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY location, scan_type '
                'ORDER BY cnt DESC LIMIT 15'
            ),
            "category": "string_functions",
            "time_offset": toff(930),
        },
        {
            "id": "Q931",
            "sql": (
                'SELECT spath(request_payload, \'message.endpoint\') '
                'AS endpoint, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case(request_payload, 'endpoint') "
                'GROUP BY endpoint '
                'ORDER BY cnt DESC LIMIT 5'
            ),
            "category": "string_functions",
            "time_offset": toff(931),
        },
        {
            "id": "Q932",
            "sql": (
                'SELECT spath(request_payload, \'message.status\') '
                'AS msg_status, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                "WHERE str_match_ignore_case(request_payload, 'status') "
                'GROUP BY msg_status '
                'ORDER BY cnt DESC LIMIT 5'
            ),
            "category": "string_functions",
            "time_offset": toff(932),
        },
        {
            "id": "Q933",
            "sql": (
                'SELECT COALESCE(bot_flag, info_tag, passthrough_flag, '
                "CAST(auth_result AS VARCHAR)) AS fallback_tag, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY fallback_tag '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(933),
        },
        {
            "id": "Q934",
            "sql": (
                'SELECT '
                'array_extract('
                "regexp_match(COALESCE(exception_message, ''), "
                "'([A-Za-z]+Exception)'), 1) AS exc_type, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY exc_type '
                'HAVING exc_type IS NOT NULL '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(934),
        },
        {
            "id": "Q935",
            "sql": (
                'SELECT '
                'array_extract('
                "regexp_match(COALESCE(ack_detail, ''), "
                "'batchIdList:([A-Z0-9-]+)'), 1) AS batch_id, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY batch_id '
                'HAVING batch_id IS NOT NULL '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(935),
        },
        {
            "id": "Q936",
            "sql": (
                'SELECT '
                'COALESCE(os_platform, \'unknown\') AS platform, '
                'COALESCE(client_agent, \'unknown\') AS agent, '
                'LENGTH(COALESCE(client_agent, \'\')) AS agent_len, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY platform, agent, agent_len '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "string_functions",
            "time_offset": toff(936),
        },
        {
            "id": "Q937",
            "sql": (
                'SELECT '
                "regexp_like(COALESCE(user_agent_str, ''), 'Mozilla') "
                'AS is_browser, '
                "regexp_like(COALESCE(user_agent_str, ''), 'curl') "
                'AS is_curl, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY is_browser, is_curl '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(937),
        },
        {
            "id": "Q938",
            "sql": (
                'SELECT source_ip, visitor_session_id, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE source_ip IS NOT NULL '
                "AND TRIM(CAST(source_ip AS VARCHAR)) <> '' "
                'AND visitor_session_id IS NOT NULL '
                'AND LENGTH(CAST(visitor_session_id AS VARCHAR)) >= 8 '
                'GROUP BY source_ip, visitor_session_id '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(938),
        },
        {
            "id": "Q939",
            "sql": (
                'SELECT '
                "str_match_ignore_case(event_detail, 'batch') AS has_batch, "
                "str_match_ignore_case(event_detail, 'segment') AS has_segment, "
                "str_match_ignore_case(event_detail, 'track') AS has_track, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY has_batch, has_segment, has_track '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(939),
        },
        {
            "id": "Q940",
            "sql": (
                'SELECT json_get_str(request_payload, \'message.endpoint\') '
                'AS endpoint, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE request_payload IS NOT NULL '
                'GROUP BY endpoint '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(940),
        },
        {
            "id": "Q941",
            "sql": (
                'SELECT '
                'json_get_str(json_get_json(request_payload, \'message\'), '
                "'endpoint') AS nested_endpoint, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE request_payload IS NOT NULL '
                'GROUP BY nested_endpoint '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "string_functions",
            "time_offset": toff(941),
        },
        {
            "id": "Q942",
            "sql": (
                'SELECT datacenter, '
                'COUNT(*) AS cnt, '
                "STRING_AGG(DISTINCT CAST(component_name AS VARCHAR), ', ' "
                'ORDER BY CAST(component_name AS VARCHAR)) AS components '
                'FROM "{stream}" '
                'WHERE datacenter IS NOT NULL '
                'GROUP BY datacenter '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(942),
        },
        {
            "id": "Q943",
            "sql": (
                'SELECT '
                "CASE WHEN str_match_ignore_case("
                "COALESCE(exception_message, log_message), 'timeout') "
                "THEN 'timeout' "
                "WHEN str_match_ignore_case("
                "COALESCE(exception_message, log_message), 'null') "
                "THEN 'null_error' "
                "WHEN str_match_ignore_case("
                "COALESCE(exception_message, log_message), 'security') "
                "THEN 'security' "
                "ELSE 'other' END AS error_category, "
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY error_category '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(943),
        },
        {
            "id": "Q944",
            "sql": (
                'SELECT '
                "re_match(COALESCE(exception_message, ''), '[A-Z][a-z]+Exception') "
                'AS has_java_exc, '
                "re_not_match(COALESCE(exception_message, ''), 'Network') "
                'AS not_network, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY has_java_exc, not_network '
                'ORDER BY cnt DESC'
            ),
            "category": "string_functions",
            "time_offset": toff(944),
        },
    ],

    # ── pagination (20 queries: Q945-Q964) ──────────────────────────
    "pagination": [
        {
            "id": "Q945",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate '
                'FROM "{stream}" '
                'ORDER BY throughput_rate DESC LIMIT 5 OFFSET 0'
            ),
            "category": "pagination",
            "time_offset": toff(945),
        },
        {
            "id": "Q946",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY latency_ms ASC LIMIT 3 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(946),
        },
        {
            "id": "Q947",
            "sql": (
                'SELECT pallet_id, SUM(throughput_rate) AS total_rate '
                'FROM "{stream}" '
                'GROUP BY pallet_id '
                'ORDER BY total_rate DESC LIMIT 3 OFFSET 1'
            ),
            "category": "pagination",
            "time_offset": toff(947),
        },
        {
            "id": "Q948",
            "sql": (
                'SELECT facility_zone, operation_mode, '
                'AVG(throughput_rate) AS avg_rate '
                'FROM "{stream}" '
                'GROUP BY facility_zone, operation_mode '
                'ORDER BY avg_rate DESC LIMIT 5 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(948),
        },
        {
            "id": "Q949",
            "sql": (
                'WITH ranked AS ('
                'SELECT *, ROW_NUMBER() OVER ('
                'ORDER BY throughput_rate DESC) AS rn '
                'FROM "{stream}"'
                ') '
                'SELECT * FROM ranked '
                'WHERE rn BETWEEN 3 AND 5 '
                'ORDER BY rn'
            ),
            "category": "pagination",
            "time_offset": toff(949),
        },
        {
            "id": "Q950",
            "sql": (
                'WITH paged AS ('
                'SELECT *, ROW_NUMBER() OVER ('
                'PARTITION BY facility_zone ORDER BY throughput_rate DESC'
                ') AS rn '
                'FROM "{stream}"'
                ') '
                'SELECT facility_zone, pallet_id, throughput_rate, rn '
                'FROM paged WHERE rn <= 2 '
                'ORDER BY facility_zone, rn LIMIT 10'
            ),
            "category": "pagination",
            "time_offset": toff(950),
        },
        {
            "id": "Q951",
            "sql": (
                'SELECT _timestamp, facility_zone, load_factor '
                'FROM "{stream}" '
                'ORDER BY load_factor DESC NULLS LAST LIMIT 4 OFFSET 1'
            ),
            "category": "pagination",
            "time_offset": toff(951),
        },
        {
            "id": "Q952",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'GROUP BY component_name '
                'ORDER BY avg_lat ASC LIMIT 3 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(952),
        },
        {
            "id": "Q953",
            "sql": (
                'SELECT _timestamp, facility_zone, throughput_rate '
                'FROM "{stream}" '
                'WHERE throughput_rate > 200 '
                'ORDER BY _timestamp ASC LIMIT 2 OFFSET 3'
            ),
            "category": "pagination",
            "time_offset": toff(953),
        },
        {
            "id": "Q954",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms, '
                'response_code '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY response_code ASC, latency_ms DESC '
                'LIMIT 5 OFFSET 0'
            ),
            "category": "pagination",
            "time_offset": toff(954),
        },
        {
            "id": "Q955",
            "sql": (
                'WITH inner_page AS ('
                'SELECT _timestamp, pallet_id, facility_zone, '
                'cell_temp, '
                'RANK() OVER (ORDER BY cell_temp DESC) AS temp_rank '
                'FROM "{stream}" WHERE cell_temp IS NOT NULL'
                ') '
                'SELECT * FROM inner_page '
                'WHERE temp_rank BETWEEN 3 AND 6 '
                'ORDER BY temp_rank'
            ),
            "category": "pagination",
            "time_offset": toff(955),
        },
        {
            "id": "Q956",
            "sql": (
                'SELECT facility_zone, '
                'SUM(throughput_rate) AS total_rate '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY total_rate DESC LIMIT 2 OFFSET 1'
            ),
            "category": "pagination",
            "time_offset": toff(956),
        },
        {
            "id": "Q957",
            "sql": (
                'SELECT _timestamp, conveyor_lane, sorter_model, '
                'throughput_rate '
                'FROM "{stream}" '
                'ORDER BY conveyor_lane ASC, throughput_rate DESC '
                'LIMIT 4 OFFSET 0'
            ),
            "category": "pagination",
            "time_offset": toff(957),
        },
        {
            "id": "Q958",
            "sql": (
                'SELECT component_name, COUNT(*) AS cnt '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'ORDER BY cnt ASC LIMIT 3 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(958),
        },
        {
            "id": "Q959",
            "sql": (
                'SELECT _timestamp, operation_mode, facility_zone, '
                'throughput_rate '
                'FROM "{stream}" '
                'ORDER BY operation_mode ASC, _timestamp DESC '
                'LIMIT 5 OFFSET 0'
            ),
            "category": "pagination",
            "time_offset": toff(959),
        },
        {
            "id": "Q960",
            "sql": (
                'SELECT region_code, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE region_code IS NOT NULL '
                'AND latency_ms IS NOT NULL '
                'GROUP BY region_code '
                'ORDER BY avg_lat DESC LIMIT 3 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(960),
        },
        {
            "id": "Q961",
            "sql": (
                'WITH ranked AS ('
                'SELECT *, '
                'ROW_NUMBER() OVER (PARTITION BY facility_zone '
                'ORDER BY _timestamp) AS rn '
                'FROM "{stream}"'
                ') '
                'SELECT facility_zone, pallet_id, throughput_rate '
                'FROM ranked WHERE rn = 1 '
                'ORDER BY facility_zone LIMIT 10'
            ),
            "category": "pagination",
            "time_offset": toff(961),
        },
        {
            "id": "Q962",
            "sql": (
                'SELECT _timestamp, pallet_id, item_count '
                'FROM "{stream}" '
                'ORDER BY item_count ASC NULLS LAST LIMIT 3 OFFSET 1'
            ),
            "category": "pagination",
            "time_offset": toff(962),
        },
        {
            "id": "Q963",
            "sql": (
                'SELECT org_name, scan_category, COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE org_name IS NOT NULL '
                'GROUP BY org_name, scan_category '
                'ORDER BY cnt DESC LIMIT 4 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(963),
        },
        {
            "id": "Q964",
            "sql": (
                'SELECT _timestamp, component_name, latency_ms '
                'FROM "{stream}" '
                'WHERE latency_ms > 100 '
                'ORDER BY latency_ms ASC LIMIT 2 OFFSET 2'
            ),
            "category": "pagination",
            "time_offset": toff(964),
        },
    ],

    # ── combined (15 queries: Q965-Q979) ────────────────────────────
    "combined": [
        {
            "id": "Q965",
            "sql": (
                'WITH base AS ('
                'SELECT _timestamp, facility_zone, component_name, '
                'throughput_rate, latency_ms, response_code, auth_result '
                'FROM "{stream}"'
                '), '
                'ranked AS ('
                'SELECT *, '
                'RANK() OVER (PARTITION BY facility_zone '
                'ORDER BY throughput_rate DESC) AS rate_rank, '
                'CASE WHEN response_code >= 400 THEN 1 ELSE 0 END '
                'AS is_error '
                'FROM base'
                ') '
                'SELECT facility_zone, '
                'COUNT(*) AS total, '
                'SUM(is_error) AS errors, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'MAX(CASE WHEN rate_rank = 1 THEN throughput_rate END) '
                'AS peak_rate '
                'FROM ranked '
                'GROUP BY facility_zone '
                'ORDER BY peak_rate DESC'
            ),
            "category": "combined",
            "time_offset": toff(965),
        },
        {
            "id": "Q966",
            "sql": (
                'WITH perf AS ('
                'SELECT facility_zone, operation_mode, '
                'AVG(throughput_rate) AS avg_rate, '
                'AVG(load_factor) AS avg_load '
                'FROM "{stream}" '
                'GROUP BY facility_zone, operation_mode'
                '), '
                'perf_ranked AS ('
                'SELECT *, '
                'RANK() OVER (ORDER BY avg_rate DESC) AS global_rank, '
                'RANK() OVER (PARTITION BY operation_mode '
                'ORDER BY avg_rate DESC) AS mode_rank '
                'FROM perf'
                ') '
                'SELECT facility_zone, operation_mode, '
                'avg_rate, avg_load, global_rank, mode_rank '
                'FROM perf_ranked '
                'WHERE global_rank <= 5 OR mode_rank <= 3 '
                'ORDER BY global_rank LIMIT 12'
            ),
            "category": "combined",
            "time_offset": toff(966),
        },
        {
            "id": "Q967",
            "sql": (
                'SELECT '
                'COALESCE(scan_category, \'unknown\') AS scan_type, '
                'CASE '
                "WHEN CHAR_LENGTH(COALESCE(exception_message, '')) > 40 "
                "THEN 'long_error' "
                "WHEN CHAR_LENGTH(COALESCE(exception_message, '')) > 0 "
                "THEN 'short_error' "
                "ELSE 'no_error' END AS error_class, "
                'COUNT(*) AS cnt, '
                'ROUND(CAST(COUNT(*) AS FLOAT) * 100.0 / '
                'SUM(COUNT(*)) OVER (PARTITION BY '
                "COALESCE(scan_category, 'unknown')), 1) AS pct "
                'FROM "{stream}" '
                'GROUP BY scan_type, error_class '
                'ORDER BY scan_type, cnt DESC'
            ),
            "category": "combined",
            "time_offset": toff(967),
        },
        {
            "id": "Q968",
            "sql": (
                'SELECT device_type, page_slug, '
                'COUNT(*) AS page_views, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp, '
                'AVG(CAST(inp_micros AS FLOAT)) AS avg_inp, '
                'AVG(CAST(cls_score AS FLOAT)) AS avg_cls '
                'FROM "{stream}" '
                'WHERE device_type IS NOT NULL '
                'AND page_slug IS NOT NULL '
                'GROUP BY device_type, page_slug '
                'ORDER BY page_views DESC LIMIT 10'
            ),
            "category": "combined",
            "time_offset": toff(968),
        },
        {
            "id": "Q969",
            "sql": (
                'SELECT tag_b AS severity, '
                "SUM(CASE WHEN re_match(exception_message, "
                "'NullPointer|Timeout|Resource') THEN 1 ELSE 0 END) "
                'AS infra_errors, '
                "SUM(CASE WHEN re_match(exception_message, "
                "'Security|Validation|Configuration') THEN 1 ELSE 0 END) "
                'AS app_errors, '
                'COUNT(*) AS total '
                'FROM "{stream}" '
                'GROUP BY severity '
                'ORDER BY total DESC'
            ),
            "category": "combined",
            "time_offset": toff(969),
        },
        {
            "id": "Q970",
            "sql": (
                'SELECT '
                'CASE '
                "WHEN auth_result = 'pass' AND response_code < 400 "
                "THEN 'success' "
                "WHEN auth_result = 'pass' AND response_code >= 400 "
                "THEN 'app_error' "
                "WHEN auth_result IN ('fail', 'denied') "
                "THEN 'auth_failure' "
                "ELSE 'unknown' END AS outcome, "
                'COUNT(*) AS cnt, '
                'COUNT(DISTINCT COALESCE(org_name, site_name)) '
                'AS distinct_tenants '
                'FROM "{stream}" '
                'GROUP BY outcome '
                'ORDER BY cnt DESC'
            ),
            "category": "combined",
            "time_offset": toff(970),
        },
        {
            "id": "Q971",
            "sql": (
                'SELECT COALESCE(bot_flag, info_tag, \'none\') AS flag, '
                'CASE '
                "WHEN threat_flag = 'true' THEN 'threat' "
                "WHEN passthrough_flag = 'true' THEN 'passthrough' "
                "ELSE 'normal' END AS traffic_type, "
                'COUNT(*) AS cnt, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'GROUP BY flag, traffic_type '
                'ORDER BY cnt DESC'
            ),
            "category": "combined",
            "time_offset": toff(971),
        },
        {
            "id": "Q972",
            "sql": (
                'SELECT region_code, '
                'COUNT(*) AS total_events, '
                "COUNT(*) FILTER (WHERE auth_result = 'fail') AS failures, "
                "ROUND(CAST(COUNT(*) FILTER (WHERE auth_result = 'fail') "
                'AS FLOAT) * 100.0 / NULLIF(COUNT(*), 0), 2) AS failure_pct '
                'FROM "{stream}" '
                'WHERE region_code IS NOT NULL '
                'GROUP BY region_code '
                'HAVING COUNT(*) > 1 '
                'ORDER BY failure_pct DESC NULLS LAST LIMIT 10'
            ),
            "category": "combined",
            "time_offset": toff(972),
        },
        {
            "id": "Q973",
            "sql": (
                'WITH zone_stats AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate, '
                'AVG(load_factor) AS avg_load, '
                'STDDEV(throughput_rate) AS std_rate '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'zone_stats2 AS ('
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate2, '
                'AVG(load_factor) AS avg_load2 '
                'FROM "{stream2}" GROUP BY facility_zone'
                ') '
                'SELECT z.facility_zone, '
                'z.avg_rate, z.avg_load, z.std_rate, '
                'z2.avg_rate2, z2.avg_load2, '
                'CASE '
                'WHEN z.avg_rate > z2.avg_rate2 THEN \'primary_faster\' '
                'ELSE \'secondary_faster\' END AS comparison '
                'FROM zone_stats z '
                'LEFT JOIN zone_stats2 z2 '
                'ON z.facility_zone = z2.facility_zone '
                'ORDER BY z.facility_zone'
            ),
            "category": "combined",
            "time_offset": toff(973),
        },
        {
            "id": "Q974",
            "sql": (
                'SELECT component_name, '
                'COUNT(*) AS total, '
                "COUNT(*) FILTER (WHERE match_all('error')) AS fts_errors, "
                "COUNT(*) FILTER (WHERE match_all('warehouse')) AS fts_hits, "
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'RANK() OVER (ORDER BY COUNT(*) DESC) AS freq_rank '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'ORDER BY freq_rank LIMIT 10'
            ),
            "category": "combined",
            "time_offset": toff(974),
        },
        {
            "id": "Q975",
            "sql": (
                'SELECT '
                'COALESCE(geo_country, \'unknown\') AS country, '
                'COALESCE(geo_user_type, \'unknown\') AS user_type, '
                'COUNT(*) AS cnt, '
                "SUM(CASE WHEN re_match(attack_name, "
                "'SQL|XSS|Injection') THEN 1 ELSE 0 END) AS critical_attacks, "
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" '
                'WHERE geo_country IS NOT NULL '
                'GROUP BY country, user_type '
                'ORDER BY cnt DESC LIMIT 12'
            ),
            "category": "combined",
            "time_offset": toff(975),
        },
        {
            "id": "Q976",
            "sql": (
                'WITH zone_perf AS ('
                'SELECT facility_zone, '
                'PERCENTILE_CONT(0.5) WITHIN GROUP '
                '(ORDER BY throughput_rate) AS median_rate, '
                'PERCENTILE_CONT(0.9) WITHIN GROUP '
                '(ORDER BY throughput_rate) AS p90_rate '
                'FROM "{stream}" GROUP BY facility_zone'
                '), '
                'zone_lat AS ('
                'SELECT facility_zone, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat '
                'FROM "{stream}" WHERE latency_ms IS NOT NULL '
                'GROUP BY facility_zone'
                ') '
                'SELECT zp.facility_zone, '
                'zp.median_rate, zp.p90_rate, zl.avg_lat '
                'FROM zone_perf zp '
                'LEFT JOIN zone_lat zl '
                'ON zp.facility_zone = zl.facility_zone '
                'ORDER BY zp.median_rate DESC'
            ),
            "category": "combined",
            "time_offset": toff(976),
        },
        {
            "id": "Q977",
            "sql": (
                'SELECT a.geo_org, '
                'COUNT(*) AS cnt, '
                'AVG(CAST(a.latency_ms AS FLOAT)) AS avg_lat_a, '
                'AVG(CAST(b.latency_ms AS FLOAT)) AS avg_lat_b, '
                'COUNT(DISTINCT a.visitor_session_id) AS distinct_sessions '
                'FROM "{stream}" a '
                'JOIN "{stream2}" b '
                'ON a.geo_org = b.geo_org '
                'WHERE a.geo_org IS NOT NULL '
                'GROUP BY a.geo_org '
                'ORDER BY cnt DESC LIMIT 10'
            ),
            "category": "combined",
            "time_offset": toff(977),
        },
        {
            "id": "Q978",
            "sql": (
                'WITH error_detail AS ('
                'SELECT _timestamp, component_name, '
                'exception_message, response_code, '
                "re_match(exception_message, 'NullPointer|Timeout|Security') "
                'AS is_critical '
                'FROM "{stream}" '
                'WHERE exception_message IS NOT NULL'
                ') '
                'SELECT component_name, '
                'COUNT(*) AS error_cnt, '
                'SUM(CASE WHEN is_critical THEN 1 ELSE 0 END) '
                'AS critical_cnt, '
                'AVG(CAST(response_code AS FLOAT)) AS avg_response_code '
                'FROM error_detail '
                'GROUP BY component_name '
                'ORDER BY error_cnt DESC LIMIT 10'
            ),
            "category": "combined",
            "time_offset": toff(978),
        },
        {
            "id": "Q979",
            "sql": (
                'SELECT facility_zone, '
                'COUNT(*) AS total_events, '
                'SUM(throughput_rate) AS total_rate, '
                'AVG(load_factor) AS avg_load, '
                'STDDEV(cell_temp) AS std_temp, '
                "SUM(CASE WHEN match_all('warehouse') THEN 1 ELSE 0 END) "
                'AS fts_hits '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY total_rate DESC'
            ),
            "category": "combined",
            "time_offset": toff(979),
        },
    ],

    # ── basic_select (15 queries: Q980-Q994) ────────────────────────
    "basic_select": [
        {
            "id": "Q980",
            "sql": (
                'SELECT _timestamp, facility_zone, load_factor, '
                'throughput_rate, '
                'CASE '
                'WHEN load_factor >= 80.0 AND cell_temp >= 30.0 '
                "THEN 'CRITICAL' "
                'WHEN load_factor >= 50.0 AND cell_temp >= 25.0 '
                "THEN 'WARNING' "
                'WHEN load_factor >= 20.0 THEN \'NORMAL\' '
                'WHEN charge_remaining < 20.0 THEN \'LOW_CHARGE\' '
                "ELSE 'UNKNOWN' END AS status, "
                'COALESCE(bot_flag, info_tag) AS security_flag '
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(980),
        },
        {
            "id": "Q981",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(exception_message, log_message, log) '
                'AS message, '
                'COALESCE(response_code, 0) AS status, '
                'latency_ms, '
                'COALESCE(scan_category, \'not_scanned\') AS scan_type '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY latency_ms DESC NULLS LAST LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(981),
        },
        {
            "id": "Q982",
            "sql": (
                'SELECT _timestamp, pallet_id, sorter_model, '
                'facility_zone, throughput_rate '
                'FROM "{stream}" '
                'WHERE facility_zone IN (\'ZONE-1\', \'ZONE-2\') '
                'AND throughput_rate > 200 '
                'AND (operation_mode = \'auto\' '
                'OR charge_remaining > 40.0) '
                'ORDER BY throughput_rate DESC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(982),
        },
        {
            "id": "Q983",
            "sql": (
                'SELECT _timestamp, component_name, region_code, '
                'latency_ms, response_code, '
                'CASE '
                'WHEN latency_ms < 100 THEN \'fast\' '
                'WHEN latency_ms < 500 THEN \'normal\' '
                'WHEN latency_ms < 2000 THEN \'slow\' '
                "ELSE 'very_slow' END AS latency_tier "
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'ORDER BY latency_ms ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(983),
        },
        {
            "id": "Q984",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(bot_flag, info_tag, passthrough_flag, '
                "'clean') AS security_tag, "
                'CAST(COALESCE(lcp_micros, inp_micros, latency_ms) '
                'AS FLOAT) AS perf_value, '
                'device_type, page_slug '
                'FROM "{stream}" '
                'WHERE device_type IS NOT NULL '
                'ORDER BY perf_value DESC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(984),
        },
        {
            "id": "Q985",
            "sql": (
                'SELECT DISTINCT facility_zone, control_center, '
                'operation_mode, sorter_model '
                'FROM "{stream}" '
                'WHERE facility_zone IN (\'ZONE-1\', \'ZONE-3\') '
                'ORDER BY facility_zone, control_center LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(985),
        },
        {
            "id": "Q986",
            "sql": (
                'SELECT _timestamp, pallet_id, '
                'throughput_rate, load_factor, cell_temp, '
                'throughput_rate / NULLIF(load_factor, 0) '
                'AS efficiency_ratio '
                'FROM "{stream}" '
                'WHERE load_factor > 0 '
                'ORDER BY efficiency_ratio DESC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(986),
        },
        {
            "id": "Q987",
            "sql": (
                'SELECT _timestamp, component_name, '
                'latency_ms, lcp_micros, inp_micros, '
                'COALESCE(latency_ms, lcp_micros, inp_micros) '
                'AS any_latency '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'OR lcp_micros IS NOT NULL '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(987),
        },
        {
            "id": "Q988",
            "sql": (
                'SELECT _timestamp, org_name, site_name, '
                'COALESCE(org_name, site_name, region_code) AS location, '
                'latency_ms '
                'FROM "{stream}" '
                'WHERE org_name IS NOT NULL OR site_name IS NOT NULL '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(988),
        },
        {
            "id": "Q989",
            "sql": (
                'SELECT _timestamp, facility_zone, '
                'throughput_rate, item_count, defect_limit, '
                'item_count * defect_limit AS quality_index '
                'FROM "{stream}" '
                'ORDER BY quality_index DESC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(989),
        },
        {
            "id": "Q990",
            "sql": (
                'SELECT _timestamp, conveyor_lane, '
                'conveyor_segment, facility_zone, '
                'throughput_rate '
                'FROM "{stream}" '
                'WHERE conveyor_lane IN (\'LANE-A\', \'LANE-B\') '
                'AND conveyor_segment <= 3 '
                'ORDER BY conveyor_lane, conveyor_segment, '
                '_timestamp ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(990),
        },
        {
            "id": "Q991",
            "sql": (
                'SELECT _timestamp, pallet_id, '
                'runtime_hours, scan_attempts, '
                'runtime_hours / NULLIF(scan_attempts, 0) '
                'AS hours_per_scan '
                'FROM "{stream}" '
                'WHERE scan_attempts > 0 '
                'ORDER BY hours_per_scan DESC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(991),
        },
        {
            "id": "Q992",
            "sql": (
                'SELECT _timestamp, node_ip, source_ip, '
                'app_label, datacenter, latency_ms '
                'FROM "{stream}" '
                'WHERE node_ip IS NOT NULL '
                'AND source_ip IS NOT NULL '
                'ORDER BY latency_ms ASC NULLS LAST LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(992),
        },
        {
            "id": "Q993",
            "sql": (
                'SELECT _timestamp, component_name, '
                'guard_mode, filter_result, auth_result, '
                'CASE '
                "WHEN guard_mode = 'active' "
                "AND filter_result = 'block' THEN 'blocked' "
                "WHEN guard_mode = 'active' "
                "AND filter_result = 'allow' THEN 'allowed' "
                "WHEN guard_mode = 'passive' THEN 'monitored' "
                "ELSE 'bypassed' END AS traffic_action "
                'FROM "{stream}" '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(993),
        },
        {
            "id": "Q994",
            "sql": (
                'SELECT _timestamp, '
                'COALESCE(build_signature, build_version) AS build, '
                'os_platform, device_type, render_scope, '
                'lcp_micros, cls_score '
                'FROM "{stream}" '
                'WHERE device_type IS NOT NULL '
                'ORDER BY _timestamp ASC LIMIT 10'
            ),
            "category": "basic_select",
            "time_offset": toff(994),
        },
    ],

    # ── math_functions (5 queries: Q995-Q999) ───────────────────────
    "math_functions": [
        {
            "id": "Q995",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'AVG(CAST(lcp_micros AS FLOAT)) AS avg_lcp '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL '
                'AND lcp_micros IS NOT NULL '
                'GROUP BY component_name '
                'HAVING COUNT(*) > 1 '
                'ORDER BY avg_lat DESC LIMIT 10'
            ),
            "category": "math_functions",
            "time_offset": toff(995),
        },
        {
            "id": "Q996",
            "sql": (
                'SELECT '
                'SQRT(AVG(CAST(latency_ms AS FLOAT) '
                '* CAST(latency_ms AS FLOAT)) '
                '- AVG(CAST(latency_ms AS FLOAT)) '
                '* AVG(CAST(latency_ms AS FLOAT))) AS std_lat, '
                'AVG(CAST(latency_ms AS FLOAT)) AS avg_lat, '
                'COUNT(*) AS cnt '
                'FROM "{stream}" '
                'WHERE latency_ms IS NOT NULL'
            ),
            "category": "math_functions",
            "time_offset": toff(996),
        },
        {
            "id": "Q997",
            "sql": (
                'SELECT component_name, '
                'AVG(CAST(throughput_rate AS FLOAT)) AS avg_rate, '
                'AVG(CAST(load_factor AS FLOAT)) AS avg_load, '
                'AVG(CAST(throughput_rate AS FLOAT) '
                '* CAST(load_factor AS FLOAT)) '
                '- AVG(CAST(throughput_rate AS FLOAT)) '
                '* AVG(CAST(load_factor AS FLOAT)) '
                'AS cov_approx '
                'FROM "{stream}" '
                'GROUP BY component_name '
                'HAVING COUNT(*) > 1 '
                'ORDER BY ABS(cov_approx) DESC LIMIT 10'
            ),
            "category": "math_functions",
            "time_offset": toff(997),
        },
        {
            "id": "Q998",
            "sql": (
                'SELECT facility_zone, '
                'AVG(throughput_rate) AS avg_rate, '
                'STDDEV(throughput_rate) AS std_rate, '
                'STDDEV(throughput_rate) / '
                'NULLIF(AVG(throughput_rate), 0) AS cv '
                'FROM "{stream}" '
                'GROUP BY facility_zone '
                'ORDER BY cv DESC'
            ),
            "category": "math_functions",
            "time_offset": toff(998),
        },
        {
            "id": "Q999",
            "sql": (
                'SELECT '
                'ROUND(POWER(SUM(CAST(throughput_rate AS FLOAT) '
                '- AVG(CAST(throughput_rate AS FLOAT)) '
                'OVER (), 2) / NULLIF(COUNT(*), 0)), 4) '
                'AS variance_pop, '
                'ROUND(AVG(CAST(throughput_rate AS FLOAT)), 2) '
                'AS avg_rate, '
                'COUNT(*) AS cnt '
                'FROM "{stream}"'
            ),
            "category": "math_functions",
            "time_offset": toff(999),
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

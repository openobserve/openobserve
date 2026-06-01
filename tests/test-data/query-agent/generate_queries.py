#!/usr/bin/env python3
"""Generate all 155 query category files with warehouse/supply-chain IoT field names.

Each query Q{N} targets its own isolated time window:
  base = BASE_TS + (N-1) * 60_000_000
  records at base + i*18_000_000 for i in 0..9

Queries use only the fields from conftest.py FIELD_POOL.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).parent / "queries"

BASE_TS = int(datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc).timestamp() * 1_000_000)


def tr(n: int):
    """Compute time_range for query Q{N}.

    Each query's data spans from base to base + 9*18M = base + 162M usec.
    Add 3M padding on each side.
    """
    base = BASE_TS + (n - 1) * 60_000_000
    return {
        "start": base - 3_000_000,
        "end": base + 9 * 18_000_000 + 3_000_000,
    }


def make_query(qid, qnum, sql, category, columns, note="", row_count=None):
    return {
        "id": qid,
        "sql": sql,
        "category": category,
        "time_range": tr(qnum),
        "expected": {
            "row_count": row_count,
            "columns": columns,
            "note": note,
        },
    }


# ═══════════════════════════════════════════════════════════════════════════
# Categories with query definitions
# Each tuple: (qid, category, [columns], note, sql)
# ═══════════════════════════════════════════════════════════════════════════

# ── AGGREGATION ──────────────────────────────────────────────────────────
AGGREGATION = [
    (1, "aggregation", ["facility_zone", "cnt"],
     "GROUP BY facility_zone with COUNT, ORDER BY cnt DESC",
     '''SELECT facility_zone, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY facility_zone ORDER BY cnt DESC'''),

    (2, "aggregation", ["operation_mode", "avg_load", "avg_tput"],
     "GROUP BY operation_mode with multiple AVG aggregates",
     '''SELECT operation_mode, ROUND(AVG(load_factor), 2) AS avg_load, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE load_factor IS NOT NULL GROUP BY operation_mode ORDER BY avg_tput DESC'''),

    (3, "aggregation", ["sorter_model", "cnt"],
     "GROUP BY sorter_model with WHERE match_all filter",
     '''SELECT sorter_model, COUNT(*) AS cnt FROM "query_agent_test" WHERE match_all('warehouse') GROUP BY sorter_model ORDER BY cnt DESC'''),

    (4, "aggregation", ["total_throughput"],
     "Single-row aggregate: SUM with WHERE filter",
     '''SELECT SUM(throughput_rate) AS total_throughput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL'''),

    (5, "aggregation", ["conveyor_lane", "cnt", "avg_load"],
     "GROUP BY with HAVING on AVG",
     '''SELECT conveyor_lane, COUNT(*) AS cnt, ROUND(AVG(load_factor), 2) AS avg_load FROM "query_agent_test" WHERE load_factor IS NOT NULL GROUP BY conveyor_lane HAVING AVG(load_factor) > 40.0 ORDER BY avg_load DESC'''),

    (6, "aggregation", ["facility_zone", "operation_mode", "cnt", "avg_tput"],
     "Multi-column GROUP BY with AVG and COUNT",
     '''SELECT facility_zone, operation_mode, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY facility_zone, operation_mode ORDER BY facility_zone ASC, cnt DESC'''),

    (7, "aggregation", ["control_center", "total_items", "avg_charge", "min_charge", "max_charge"],
     "Multiple aggregates: SUM, AVG, MIN, MAX on charge_remaining",
     '''SELECT control_center, SUM(item_count) AS total_items, ROUND(AVG(charge_remaining), 2) AS avg_charge, MIN(charge_remaining) AS min_charge, MAX(charge_remaining) AS max_charge FROM "query_agent_test" GROUP BY control_center ORDER BY total_items DESC'''),

    (8, "aggregation", ["facility_zone", "cnt", "distinct_sorters"],
     "COUNT and COUNT DISTINCT in same GROUP BY",
     '''SELECT facility_zone, COUNT(*) AS cnt, COUNT(DISTINCT sorter_model) AS distinct_sorters FROM "query_agent_test" GROUP BY facility_zone ORDER BY cnt DESC'''),

    (9, "aggregation", ["build_signature", "avg_runtime", "min_runtime", "max_runtime"],
     "AVG, MIN, MAX on runtime_hours grouped by build_signature",
     '''SELECT build_signature, ROUND(AVG(runtime_hours), 1) AS avg_runtime, MIN(runtime_hours) AS min_runtime, MAX(runtime_hours) AS max_runtime FROM "query_agent_test" WHERE runtime_hours IS NOT NULL GROUP BY build_signature ORDER BY avg_runtime DESC'''),

    (10, "aggregation", ["sorter_model", "avg_load", "avg_tput", "combined_score"],
     "Computed aggregate expression (avg_load + avg_tput) with HAVING",
     '''SELECT sorter_model, ROUND(AVG(load_factor), 2) AS avg_load, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(AVG(load_factor) + AVG(throughput_rate), 2) AS combined_score FROM "query_agent_test" WHERE load_factor IS NOT NULL AND throughput_rate IS NOT NULL GROUP BY sorter_model HAVING AVG(throughput_rate) > 300.0 ORDER BY combined_score DESC'''),

    (11, "aggregation", ["operation_mode", "cnt", "pct_of_total"],
     "Window-based percentage of total within GROUP BY result",
     '''SELECT operation_mode, COUNT(*) AS cnt, ROUND(CAST(COUNT(*) AS FLOAT) / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100.0, 2) AS pct_of_total FROM "query_agent_test" GROUP BY operation_mode ORDER BY cnt DESC'''),

    (12, "aggregation", ["facility_zone", "high_load_cnt", "low_load_cnt", "avg_cell_temp"],
     "Conditional COUNT with CASE filtered GROUP BY",
     '''SELECT facility_zone, COUNT(*) FILTER (WHERE load_factor > 60.0) AS high_load_cnt, COUNT(*) FILTER (WHERE load_factor <= 60.0) AS low_load_cnt, ROUND(AVG(cell_temp), 2) AS avg_cell_temp FROM "query_agent_test" GROUP BY facility_zone ORDER BY high_load_cnt DESC'''),

    (13, "aggregation", ["conveyor_lane", "auto_cnt", "manual_cnt", "hybrid_cnt"],
     "Multiple FILTER aggregates for pivot-style output",
     '''SELECT conveyor_lane, COUNT(*) FILTER (WHERE operation_mode='auto') AS auto_cnt, COUNT(*) FILTER (WHERE operation_mode='manual') AS manual_cnt, COUNT(*) FILTER (WHERE operation_mode='hybrid') AS hybrid_cnt FROM "query_agent_test" GROUP BY conveyor_lane ORDER BY conveyor_lane ASC'''),

    (14, "aggregation", ["control_center", "avg_defect", "avg_tput", "risk_flag"],
     "CASE in SELECT of GROUP BY for computed classification",
     '''SELECT control_center, ROUND(AVG(defect_limit), 3) AS avg_defect, ROUND(AVG(throughput_rate), 2) AS avg_tput, CASE WHEN AVG(defect_limit) > 2.0 THEN 'HIGH_DEFECT' WHEN AVG(throughput_rate) < 300.0 THEN 'LOW_THROUGHPUT' ELSE 'NOMINAL' END AS risk_flag FROM "query_agent_test" GROUP BY control_center ORDER BY avg_defect DESC'''),

    (15, "aggregation", ["sorter_model", "facility_zone", "cnt"],
     "GROUP BY ROLLUP-style two-column grouping (simulated with regular GROUP BY)",
     '''SELECT sorter_model, facility_zone, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY sorter_model, facility_zone ORDER BY sorter_model ASC, cnt DESC'''),

    (16, "aggregation", ["facility_zone", "mode_count", "dominant_mode"],
     "Subquery-based mode aggregation + dominant mode via CTE",
     '''WITH mode_counts AS (SELECT facility_zone, operation_mode, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY facility_zone, operation_mode), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY cnt DESC) AS rn FROM mode_counts) SELECT facility_zone, cnt AS mode_count, operation_mode AS dominant_mode FROM ranked WHERE rn = 1 ORDER BY facility_zone ASC'''),

    (17, "aggregation", ["operation_mode", "max_tput_item", "min_tput_item", "spread"],
     "MAX-MIN spread computation in GROUP BY",
     '''SELECT operation_mode, MAX(item_count) AS max_tput_item, MIN(item_count) AS min_tput_item, MAX(item_count) - MIN(item_count) AS spread FROM "query_agent_test" WHERE item_count > 0 GROUP BY operation_mode ORDER BY spread DESC'''),

    (18, "aggregation", ["conveyor_lane", "scan_total", "avg_scan", "retry_rate"],
     "SUM + AVG + computed rate per lane",
     '''SELECT conveyor_lane, SUM(scan_attempts) AS scan_total, ROUND(AVG(CAST(scan_attempts AS FLOAT)), 2) AS avg_scan, ROUND(CAST(COUNT(*) FILTER (WHERE scan_attempts >= 3) AS FLOAT) / NULLIF(COUNT(*), 0) * 100.0, 2) AS retry_rate FROM "query_agent_test" GROUP BY conveyor_lane ORDER BY retry_rate DESC'''),

    (19, "aggregation", ["build_signature", "std_tput", "avg_load", "cv_tput"],
     "STDDEV + AVG + coefficient of variation per build",
     '''SELECT build_signature, ROUND(STDDEV(throughput_rate), 2) AS std_tput, ROUND(AVG(load_factor), 2) AS avg_load, ROUND(STDDEV(throughput_rate) / NULLIF(AVG(throughput_rate), 0), 4) AS cv_tput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY build_signature HAVING COUNT(*) >= 2 ORDER BY cv_tput DESC'''),

    (20, "aggregation", ["facility_zone", "below_30_pct", "above_70_pct"],
     "Percentage-bucketized aggregation with FILTER",
     '''SELECT facility_zone, ROUND(CAST(COUNT(*) FILTER (WHERE charge_remaining < 30.0) AS FLOAT) / NULLIF(COUNT(*), 0) * 100.0, 2) AS below_30_pct, ROUND(CAST(COUNT(*) FILTER (WHERE charge_remaining > 70.0) AS FLOAT) / NULLIF(COUNT(*), 0) * 100.0, 2) AS above_70_pct FROM "query_agent_test" GROUP BY facility_zone ORDER BY below_30_pct DESC'''),
]

# ── BASIC_SELECT ─────────────────────────────────────────────────────────
BASIC_SELECT = [
    (21, "basic_select", ["_timestamp", "pallet_id", "sorter_model", "facility_zone", "throughput_rate"],
     "SELECT with IN filter and compound AND condition",
     '''SELECT _timestamp, pallet_id, sorter_model, facility_zone, throughput_rate FROM "query_agent_test" WHERE facility_zone IN ('ZONE-1', 'ZONE-2') AND throughput_rate > 300.0 ORDER BY throughput_rate DESC LIMIT 10'''),

    (22, "basic_select", ["_timestamp", "log", "stream", "pallet_id", "facility_zone", "operation_mode", "load_factor", "charge_remaining", "throughput_rate", "sorter_model", "conveyor_lane", "control_center", "item_count", "defect_limit", "runtime_hours", "package_size", "scan_attempts", "conveyor_segment", "cell_temp", "build_signature"],
     "SELECT * returning all generated columns",
     '''SELECT * FROM "query_agent_test" WHERE operation_mode='auto' AND load_factor > 30.0 LIMIT 10'''),

    (23, "basic_select", ["_timestamp", "pallet_id", "sorter_model", "facility_zone", "throughput_rate", "load_factor", "load_tier", "temp_category"],
     "Complex WHERE with AND/OR/IN/NOT, two CASE expressions, multi-column ORDER BY",
     '''SELECT _timestamp, pallet_id, sorter_model, facility_zone, throughput_rate, load_factor, CASE WHEN load_factor >= 80.0 THEN 'critical' WHEN load_factor >= 50.0 THEN 'elevated' WHEN load_factor >= 20.0 THEN 'normal' ELSE 'idle' END AS load_tier, CASE WHEN cell_temp >= 30.0 THEN 'hot' WHEN cell_temp >= 22.0 THEN 'warm' ELSE 'cool' END AS temp_category FROM "query_agent_test" WHERE (facility_zone IN ('ZONE-1', 'ZONE-2', 'ZONE-3') AND operation_mode != 'manual') OR (charge_remaining < 50.0 AND scan_attempts >= 2) ORDER BY _timestamp DESC, load_factor DESC LIMIT 15'''),

    (24, "basic_select", ["sorter_model", "operation_mode", "facility_zone", "build_signature"],
     "DISTINCT on 4 columns with BETWEEN, NOT IN, and range filter",
     '''SELECT DISTINCT sorter_model, operation_mode, facility_zone, build_signature FROM "query_agent_test" WHERE defect_limit BETWEEN 1.0 AND 3.0 AND runtime_hours NOT IN (24, 48, 72) AND package_size >= 300 ORDER BY sorter_model ASC, operation_mode ASC'''),

    (25, "basic_select", ["_timestamp", "pallet_id", "conveyor_lane", "load_factor", "charge_remaining", "utilization_index", "items_per_scan"],
     "Computed columns (utilization_index, items_per_scan) with NULLIF guards",
     '''SELECT _timestamp, pallet_id, conveyor_lane, load_factor, charge_remaining, ROUND((load_factor * charge_remaining) / 100.0, 2) AS utilization_index, ROUND(CAST(item_count AS FLOAT) / NULLIF(CAST(scan_attempts AS FLOAT), 0), 1) AS items_per_scan FROM "query_agent_test" WHERE load_factor IS NOT NULL AND charge_remaining IS NOT NULL AND item_count > 0 AND scan_attempts > 0 ORDER BY utilization_index DESC LIMIT 12'''),

    (26, "basic_select", ["_timestamp", "log", "control_center", "operation_mode", "cell_temp", "alert_status"],
     "4-branch nested CASE for alert classification, complex OR/NOT WHERE",
     '''SELECT _timestamp, log, control_center, operation_mode, cell_temp, CASE WHEN cell_temp >= 35.0 AND operation_mode = 'auto' THEN 'OVERTEMP-AUTO' WHEN cell_temp >= 35.0 THEN 'OVERTEMP' WHEN cell_temp >= 28.0 AND charge_remaining < 30.0 THEN 'WARNING-LOWCHARGE' WHEN cell_temp >= 28.0 THEN 'WARM' ELSE 'NORMAL' END AS alert_status FROM "query_agent_test" WHERE (cell_temp >= 28.0) OR (charge_remaining < 30.0 AND operation_mode != 'hybrid') ORDER BY cell_temp DESC, charge_remaining ASC LIMIT 20'''),

    (27, "basic_select", ["_timestamp", "sorter_model", "facility_zone", "throughput_rate", "load_factor", "charge_remaining", "effective_capacity"],
     "Triple-factor computed column (effective_capacity) with 3-column filtering",
     '''SELECT _timestamp, sorter_model, facility_zone, throughput_rate, load_factor, charge_remaining, ROUND(CAST(throughput_rate AS FLOAT) * (CAST(load_factor AS FLOAT) / 100.0) * (CAST(charge_remaining AS FLOAT) / 100.0), 2) AS effective_capacity FROM "query_agent_test" WHERE throughput_rate > 300.0 AND load_factor >= 30.0 AND facility_zone != 'ZONE-4' ORDER BY effective_capacity DESC, _timestamp ASC LIMIT 10'''),

    (28, "basic_select", ["pallet_id", "sorter_model", "conveyor_lane", "operation_mode", "runtime_hours", "runtime_days", "usage_class"],
     "LIKE patterns with OR chain, computed days column, CASE classification",
     '''SELECT pallet_id, sorter_model, conveyor_lane, operation_mode, runtime_hours, ROUND(runtime_hours / 24.0, 1) AS runtime_days, CASE WHEN runtime_hours >= 500 THEN 'heavy' WHEN runtime_hours >= 168 THEN 'moderate' ELSE 'light' END AS usage_class FROM "query_agent_test" WHERE runtime_hours IS NOT NULL AND (sorter_model LIKE 'SORT-X%' OR sorter_model LIKE 'SORT-Z%' OR (sorter_model = 'SORT-Q5' AND runtime_hours < 200)) ORDER BY runtime_days DESC'''),

    (29, "basic_select", ["_timestamp", "control_center", "facility_zone", "cell_temp", "segment_label", "defect_str"],
     "COALESCE with type casting + subquery in WHERE (IN with SELECT DISTINCT)",
     '''SELECT _timestamp, control_center, facility_zone, cell_temp, COALESCE(CAST(conveyor_segment AS VARCHAR), 'N/A') AS segment_label, COALESCE(CAST(defect_limit AS VARCHAR), '0.0') AS defect_str FROM "query_agent_test" WHERE facility_zone IN (SELECT DISTINCT facility_zone FROM "query_agent_test" WHERE cell_temp > 25.0) ORDER BY cell_temp DESC LIMIT 15'''),

    (30, "basic_select", ["_timestamp", "build_signature", "operation_mode", "item_count", "package_size", "total_weight_kg", "shipment_tier"],
     "Computed weight column + 4-tier CASE classification",
     '''SELECT _timestamp, build_signature, operation_mode, item_count, package_size, ROUND(CAST(item_count AS FLOAT) * CAST(package_size AS FLOAT) / 1000.0, 2) AS total_weight_kg, CASE WHEN item_count * package_size >= 300000 THEN 'XL' WHEN item_count * package_size >= 100000 THEN 'LG' WHEN item_count * package_size >= 30000 THEN 'MD' ELSE 'SM' END AS shipment_tier FROM "query_agent_test" WHERE item_count > 0 AND package_size > 0 ORDER BY total_weight_kg DESC LIMIT 15'''),

    (31, "basic_select", ["_timestamp", "pallet_id", "sorter_model", "scan_attempts", "retry_flag", "retry_flag_derived"],
     "Derived table subquery computing boolean flag, outer filter on derived column",
     '''SELECT _timestamp, pallet_id, sorter_model, scan_attempts, retry_flag, CASE WHEN scan_attempts >= 3 THEN TRUE ELSE FALSE END AS retry_flag_derived FROM (SELECT _timestamp, pallet_id, sorter_model, scan_attempts, scan_attempts >= 3 AS retry_flag FROM "query_agent_test") sub WHERE retry_flag = TRUE ORDER BY scan_attempts DESC'''),

    (32, "basic_select", ["_timestamp", "conveyor_lane", "facility_zone", "cell_temp", "ambient_deviation"],
     "Correlated scalar subquery for deviation, outer ABS filter",
     '''SELECT _timestamp, conveyor_lane, facility_zone, cell_temp, ambient_deviation FROM (SELECT _timestamp, conveyor_lane, facility_zone, cell_temp, ROUND(cell_temp - (SELECT AVG(cell_temp) FROM "query_agent_test" t2 WHERE t2.facility_zone = t1.facility_zone), 2) AS ambient_deviation FROM "query_agent_test" t1 WHERE cell_temp IS NOT NULL) derived WHERE ABS(ambient_deviation) > 3.0 ORDER BY ABS(ambient_deviation) DESC LIMIT 12'''),

    (33, "basic_select", ["_timestamp", "operation_mode", "conveyor_lane", "load_factor", "charge_remaining", "stress_index", "health_status"],
     "Computed stress_index + 4-branch health_status CASE, dual ORDER BY",
     '''SELECT _timestamp, operation_mode, conveyor_lane, load_factor, charge_remaining, ROUND((load_factor + (100.0 - charge_remaining)) / 2.0, 2) AS stress_index, CASE WHEN load_factor > 70.0 AND charge_remaining < 30.0 THEN 'OVERLOADED' WHEN load_factor > 70.0 THEN 'HIGH_LOAD' WHEN charge_remaining < 30.0 THEN 'LOW_CHARGE' ELSE 'STABLE' END AS health_status FROM "query_agent_test" ORDER BY stress_index DESC, _timestamp ASC LIMIT 15'''),

    (34, "basic_select", ["facility_zone", "_timestamp", "sorter_model", "throughput_rate", "load_factor"],
     "DISTINCT ON (facility_zone) for top-1 per zone by throughput",
     '''SELECT DISTINCT ON (facility_zone) facility_zone, _timestamp, sorter_model, throughput_rate, load_factor FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY facility_zone ASC, throughput_rate DESC'''),

    (35, "basic_select", ["_timestamp", "log", "facility_zone", "stream"],
     "Simple filter with stream=stdout and ORDER BY",
     '''SELECT _timestamp, log, facility_zone, stream FROM "query_agent_test" WHERE stream = 'stdout' ORDER BY _timestamp DESC LIMIT 15'''),
]

# ── COMBINED ─────────────────────────────────────────────────────────────
COMBINED = [
    (36, "combined", ["facility_zone", "events", "total_tput", "avg_load", "error_rate"],
     "Two CTEs + JOIN with derived rates",
     '''WITH throughput_cte AS (SELECT facility_zone, COUNT(*) AS events, SUM(throughput_rate) AS total_tput, ROUND(AVG(load_factor), 2) AS avg_load FROM "query_agent_test" GROUP BY facility_zone), charge_cte AS (SELECT facility_zone, COUNT(*) FILTER (WHERE charge_remaining < 25.0) AS low_charge_events FROM "query_agent_test" GROUP BY facility_zone) SELECT t.facility_zone, t.events, t.total_tput, t.avg_load, ROUND(CAST(c.low_charge_events AS FLOAT) / NULLIF(t.events, 0) * 100.0, 2) AS error_rate FROM throughput_cte t JOIN charge_cte c ON t.facility_zone = c.facility_zone ORDER BY error_rate DESC'''),

    (37, "combined", ["_timestamp", "log", "load_category", "rank_in_category"],
     "CASE in SELECT and PARTITION BY; window over computed category",
     '''SELECT _timestamp, log, CASE WHEN load_factor < 30.0 THEN 'light' WHEN load_factor < 60.0 THEN 'moderate' WHEN load_factor < 85.0 THEN 'heavy' ELSE 'critical' END AS load_category, ROW_NUMBER() OVER (PARTITION BY CASE WHEN load_factor < 30.0 THEN 'light' WHEN load_factor < 60.0 THEN 'moderate' WHEN load_factor < 85.0 THEN 'heavy' ELSE 'critical' END ORDER BY load_factor DESC) AS rank_in_category FROM "query_agent_test" WHERE load_factor IS NOT NULL ORDER BY load_category, rank_in_category'''),

    (38, "combined", ["facility_zone", "cnt", "avg_tput", "sorter_list"],
     "STRING_AGG for pipe-delimited sorter list per zone + GROUP BY aggregates",
     '''SELECT facility_zone, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput, STRING_AGG(DISTINCT sorter_model, ' | ' ORDER BY sorter_model ASC) AS sorter_list FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY facility_zone HAVING COUNT(*) >= 2 ORDER BY cnt DESC'''),

    (39, "combined", ["operation_mode", "facility_zone", "cnt", "sum_load", "avg_tput"],
     "Multi-column GROUP BY + 3 aggregates + ORDER BY sum DESC",
     '''SELECT operation_mode, facility_zone, COUNT(*) AS cnt, SUM(load_factor) AS sum_load, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE load_factor IS NOT NULL GROUP BY operation_mode, facility_zone ORDER BY sum_load DESC LIMIT 8'''),

    (40, "combined", ["_timestamp", "pallet_id", "facility_zone", "sorter_model", "throughput_rate", "running_avg", "deviation", "outlier_flag"],
     "Window running avg + deviation + outlier detection with CASE",
     '''SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate, ROUND(AVG(throughput_rate) OVER (PARTITION BY facility_zone ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS running_avg, ROUND((throughput_rate - AVG(throughput_rate) OVER (PARTITION BY facility_zone ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)), 2) AS deviation, CASE WHEN throughput_rate > 2 * AVG(throughput_rate) OVER (PARTITION BY facility_zone) THEN 'OUTLIER_HIGH' WHEN throughput_rate < 0.5 * AVG(throughput_rate) OVER (PARTITION BY facility_zone) THEN 'OUTLIER_LOW' ELSE 'NORMAL' END AS outlier_flag FROM "query_agent_test" WHERE throughput_rate IS NOT NULL AND facility_zone IS NOT NULL ORDER BY facility_zone ASC, _timestamp ASC'''),

    (41, "combined", ["_timestamp", "pallet_id", "facility_zone", "sorter_model", "throughput_rate", "load_factor", "charge_remaining", "composite_score", "overall_rank", "quintile"],
     "3 CTEs: weighted scoring + rank + NTILE, filter top 40%",
     '''WITH raw AS (SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate, load_factor, charge_remaining FROM "query_agent_test"), scored AS (SELECT *, ROUND((throughput_rate / NULLIF((SELECT AVG(throughput_rate) FROM raw), 0)) * 0.4 + (load_factor / NULLIF((SELECT AVG(load_factor) FROM raw), 0)) * 0.3 + (charge_remaining / NULLIF((SELECT AVG(charge_remaining) FROM raw), 0)) * 0.3, 4) AS composite_score FROM raw), ranked AS (SELECT *, RANK() OVER (ORDER BY composite_score DESC) AS overall_rank, NTILE(5) OVER (ORDER BY composite_score DESC) AS quintile FROM scored) SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate, load_factor, charge_remaining, composite_score, overall_rank, quintile FROM ranked WHERE quintile <= 2 ORDER BY composite_score DESC'''),

    (42, "combined", ["_timestamp", "pallet_id", "facility_zone", "sorter_model", "throughput_rate", "load_factor", "charge_remaining", "cell_temp", "tput_rn", "load_rn", "charge_rn", "combined_rank_sum", "multi_factor_rank"],
     "4 CTEs: 3 rankings + combined sum + RANK, top-3 per zone",
     '''WITH grid AS (SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate, load_factor, charge_remaining, cell_temp FROM "query_agent_test"), grid_ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS tput_rn, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY load_factor DESC) AS load_rn, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY charge_remaining ASC) AS charge_rn FROM grid), grid_scored AS (SELECT *, (tput_rn + load_rn + charge_rn) AS combined_rank_sum FROM grid_ranked), grid_final AS (SELECT *, RANK() OVER (PARTITION BY facility_zone ORDER BY combined_rank_sum ASC) AS multi_factor_rank FROM grid_scored) SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate, load_factor, charge_remaining, cell_temp, tput_rn, load_rn, charge_rn, combined_rank_sum, multi_factor_rank FROM grid_final WHERE multi_factor_rank <= 3 ORDER BY facility_zone ASC, multi_factor_rank ASC'''),

    (43, "combined", ["facility_zone", "sorter_model", "avg_tput", "avg_load", "tput_vs_zone"],
     "JOIN with derived zone stats + deviation from zone average",
     '''SELECT t.facility_zone, t.sorter_model, ROUND(AVG(t.throughput_rate), 2) AS avg_tput, ROUND(AVG(t.load_factor), 2) AS avg_load, ROUND(AVG(t.throughput_rate) - MAX(z.zone_avg_tput), 2) AS tput_vs_zone FROM "query_agent_test" t JOIN (SELECT facility_zone AS zfz, ROUND(AVG(throughput_rate), 2) AS zone_avg_tput FROM "query_agent_test" GROUP BY facility_zone) z ON t.facility_zone = z.zfz WHERE t.throughput_rate IS NOT NULL GROUP BY t.facility_zone, t.sorter_model ORDER BY tput_vs_zone DESC'''),

    (44, "combined", ["_timestamp", "pallet_id", "facility_zone", "sorter_model", "cell_temp", "mean_temp", "std_temp", "zscore", "anomaly_type"],
     "3 CTEs: stats -> thresholds -> anomaly detection with JOIN + CASE",
     '''WITH temp_summary AS (SELECT facility_zone, COUNT(*) AS readings, ROUND(AVG(cell_temp), 2) AS mean_temp, ROUND(STDDEV(cell_temp), 2) AS std_temp FROM "query_agent_test" WHERE cell_temp IS NOT NULL GROUP BY facility_zone), threshold AS (SELECT facility_zone, mean_temp, std_temp, mean_temp + 2 * std_temp AS upper_bound, mean_temp - 2 * std_temp AS lower_bound FROM temp_summary), anomalies AS (SELECT t._timestamp, t.pallet_id, t.facility_zone, t.sorter_model, t.cell_temp, th.mean_temp, th.std_temp, ROUND((t.cell_temp - th.mean_temp) / NULLIF(th.std_temp, 0), 3) AS zscore FROM "query_agent_test" t JOIN threshold th ON t.facility_zone = th.facility_zone WHERE t.cell_temp > th.upper_bound OR t.cell_temp < th.lower_bound) SELECT *, CASE WHEN zscore > 0 THEN 'SPIKE' ELSE 'DIP' END AS anomaly_type FROM anomalies ORDER BY ABS(zscore) DESC'''),

    (45, "combined", ["facility_zone", "best_mode", "avg_tput", "avg_load", "avg_charge", "low_charge_count", "action"],
     "3 CTEs + JOIN + multi-branch CASE: performance + charge -> action",
     '''WITH mode_perf AS (SELECT facility_zone, operation_mode, COUNT(*) AS ops, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(AVG(load_factor), 2) AS avg_load FROM "query_agent_test" GROUP BY facility_zone, operation_mode), ranked_perf AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY avg_tput DESC) AS perf_rank FROM mode_perf), top_perf AS (SELECT * FROM ranked_perf WHERE perf_rank = 1), charge_status AS (SELECT facility_zone, ROUND(AVG(charge_remaining), 2) AS avg_charge, COUNT(*) FILTER (WHERE charge_remaining < 30.0) AS low_charge_count FROM "query_agent_test" GROUP BY facility_zone) SELECT tp.facility_zone, tp.operation_mode AS best_mode, tp.avg_tput, tp.avg_load, cs.avg_charge, cs.low_charge_count, CASE WHEN cs.avg_charge < 40.0 AND tp.avg_tput > 400.0 THEN 'REBALANCE' WHEN cs.avg_charge < 40.0 THEN 'RECHARGE' WHEN tp.avg_tput < 200.0 THEN 'OPTIMIZE' ELSE 'STABLE' END AS action FROM top_perf tp JOIN charge_status cs ON tp.facility_zone = cs.facility_zone ORDER BY tp.avg_tput DESC'''),
]

# ── CTE_SUBQUERY ─────────────────────────────────────────────────────────
CTE_SUBQUERY = [
    (46, "cte_subquery", ["load_tier", "cnt", "p95_tput"],
     "Subquery with CASE classification + approx_percentile_cont",
     '''SELECT load_tier, COUNT(*) AS cnt, approx_percentile_cont(CAST(throughput_rate AS FLOAT), 0.95) AS p95_tput FROM (SELECT CASE WHEN load_factor < 30.0 THEN 'light' WHEN load_factor < 65.0 THEN 'moderate' ELSE 'heavy' END AS load_tier, throughput_rate FROM "query_agent_test" WHERE throughput_rate IS NOT NULL AND load_factor IS NOT NULL) sub GROUP BY load_tier ORDER BY load_tier ASC'''),

    (47, "cte_subquery", ["facility_zone", "total_events", "auto_events", "auto_pct"],
     "Two CTEs with LEFT JOIN for percentage computation",
     '''WITH total_counts AS (SELECT facility_zone, COUNT(*) AS total_events FROM "query_agent_test" GROUP BY facility_zone), auto_counts AS (SELECT facility_zone, COUNT(*) AS auto_events FROM "query_agent_test" WHERE operation_mode = 'auto' GROUP BY facility_zone) SELECT tc.facility_zone, tc.total_events, COALESCE(ac.auto_events, 0) AS auto_events, ROUND(CAST(COALESCE(ac.auto_events, 0) AS FLOAT) / CAST(tc.total_events AS FLOAT) * 100.0, 2) AS auto_pct FROM total_counts tc LEFT JOIN auto_counts ac ON tc.facility_zone = ac.facility_zone ORDER BY auto_pct DESC'''),

    (48, "cte_subquery", ["pallet_id", "throughput_rate", "load_factor"],
     "Subquery in WHERE with scalar aggregate; above-avg throughput rows",
     '''SELECT pallet_id, throughput_rate, load_factor FROM "query_agent_test" WHERE throughput_rate > (SELECT AVG(throughput_rate) FROM "query_agent_test" WHERE throughput_rate IS NOT NULL) ORDER BY throughput_rate DESC'''),

    (49, "cte_subquery", ["facility_zone", "avg_tput", "cnt"],
     "Derived table subquery in FROM with outer WHERE filter",
     '''SELECT derived.facility_zone, derived.avg_tput, derived.cnt FROM (SELECT facility_zone, ROUND(AVG(throughput_rate), 2) AS avg_tput, COUNT(*) AS cnt FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY facility_zone) AS derived WHERE derived.avg_tput > 300.0 ORDER BY derived.avg_tput DESC'''),

    (50, "cte_subquery", ["_timestamp", "facility_zone", "throughput_rate", "zone_avg"],
     "Correlated scalar subquery computing per-zone average",
     '''SELECT _timestamp, facility_zone, throughput_rate, (SELECT ROUND(AVG(throughput_rate), 2) FROM "query_agent_test" t2 WHERE t2.facility_zone = t1.facility_zone AND t2.throughput_rate IS NOT NULL) AS zone_avg FROM "query_agent_test" t1 WHERE throughput_rate IS NOT NULL ORDER BY _timestamp ASC LIMIT 12'''),

    (51, "cte_subquery", ["_timestamp", "sorter_model", "throughput_rate", "rn"],
     "CTE with ROW_NUMBER to get top 2 per sorter_model",
     '''WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY sorter_model ORDER BY throughput_rate DESC) AS rn FROM "query_agent_test" WHERE throughput_rate IS NOT NULL) SELECT _timestamp, sorter_model, throughput_rate, rn FROM ranked WHERE rn <= 2 ORDER BY sorter_model, rn'''),

    (52, "cte_subquery", ["facility_zone", "cnt", "avg_tput", "avg_temp", "top_mode", "mode_cnt"],
     "3 CTEs: stats + mode_stats + ranked with JOIN for top mode per zone",
     '''WITH zone_stats AS (SELECT facility_zone, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(AVG(cell_temp), 2) AS avg_temp FROM "query_agent_test" GROUP BY facility_zone), mode_stats AS (SELECT facility_zone, operation_mode, COUNT(*) AS mode_cnt FROM "query_agent_test" GROUP BY facility_zone, operation_mode), ranked_modes AS (SELECT facility_zone, operation_mode, mode_cnt, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY mode_cnt DESC) AS rn FROM mode_stats) SELECT zs.facility_zone, zs.cnt, zs.avg_tput, zs.avg_temp, rm.operation_mode AS top_mode, rm.mode_cnt FROM zone_stats zs JOIN ranked_modes rm ON zs.facility_zone = rm.facility_zone AND rm.rn = 1 ORDER BY zs.avg_tput DESC'''),

    (53, "cte_subquery", ["_timestamp", "facility_zone", "operation_mode", "throughput_rate", "mu", "var_tput", "sq_dev_ratio"],
     "2 CTEs with statistical computation (manual variance), JOIN on 2 columns",
     '''WITH base AS (SELECT * FROM "query_agent_test" WHERE throughput_rate IS NOT NULL AND load_factor IS NOT NULL), stats AS (SELECT facility_zone, operation_mode, COUNT(*) AS n, ROUND(AVG(throughput_rate), 2) AS mu, ROUND(AVG(throughput_rate * throughput_rate) - AVG(throughput_rate) * AVG(throughput_rate), 2) AS var_tput FROM base GROUP BY facility_zone, operation_mode) SELECT b._timestamp, b.facility_zone, b.operation_mode, b.throughput_rate, s.mu, s.var_tput, ROUND((b.throughput_rate - s.mu) * (b.throughput_rate - s.mu) / NULLIF(s.var_tput, 0), 3) AS sq_dev_ratio FROM base b JOIN stats s ON b.facility_zone = s.facility_zone AND b.operation_mode = s.operation_mode WHERE s.var_tput > 0 ORDER BY sq_dev_ratio DESC LIMIT 15'''),

    (54, "cte_subquery", ["segment", "facility_zone", "pallet_id", "throughput_rate", "rn"],
     "2 CTEs with UNION ALL combining top and bottom extremes",
     '''WITH ranked AS (SELECT _timestamp, pallet_id, facility_zone, throughput_rate, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rn FROM "query_agent_test" WHERE throughput_rate IS NOT NULL), top3 AS (SELECT * FROM ranked WHERE rn <= 3) SELECT 'top' AS segment, facility_zone, pallet_id, throughput_rate, rn FROM top3 UNION ALL SELECT 'bottom' AS segment, ranked.facility_zone, ranked.pallet_id, ranked.throughput_rate, ranked.rn FROM ranked WHERE ranked.rn > (SELECT MAX(rn) - 3 FROM ranked r2 WHERE r2.facility_zone = ranked.facility_zone) ORDER BY facility_zone ASC, segment ASC, rn ASC'''),

    (55, "cte_subquery", ["conveyor_lane", "facility_zone", "events", "avg_events", "diff_from_avg"],
     "CROSS JOIN between lane_activity CTE and global_avg CTE for above-average",
     '''WITH lane_activity AS (SELECT conveyor_lane, facility_zone, COUNT(*) AS events FROM "query_agent_test" GROUP BY conveyor_lane, facility_zone), global_avg AS (SELECT ROUND(AVG(CAST(events AS FLOAT)), 2) AS avg_events FROM lane_activity), above_avg AS (SELECT la.conveyor_lane, la.facility_zone, la.events, ga.avg_events, ROUND(CAST(la.events AS FLOAT) - ga.avg_events, 2) AS diff_from_avg FROM lane_activity la CROSS JOIN global_avg ga WHERE la.events > ga.avg_events) SELECT * FROM above_avg ORDER BY diff_from_avg DESC'''),

    (56, "cte_subquery", ["_timestamp", "pallet_id", "facility_zone", "throughput_rate", "rank_by_zone", "zone_avg_temp"],
     "Correlated subquery in SELECT: custom rank + zone average via CTE JOIN",
     '''WITH zone_stats AS (SELECT facility_zone, ROUND(AVG(cell_temp), 2) AS zone_avg_temp FROM "query_agent_test" GROUP BY facility_zone) SELECT t1._timestamp, t1.pallet_id, t1.facility_zone, t1.throughput_rate, ROW_NUMBER() OVER (PARTITION BY t1.facility_zone ORDER BY t1.throughput_rate DESC) AS rank_by_zone, zs.zone_avg_temp FROM "query_agent_test" t1 JOIN zone_stats zs ON t1.facility_zone = zs.facility_zone WHERE t1.throughput_rate IS NOT NULL ORDER BY t1.facility_zone ASC, rank_by_zone ASC'''),

    (57, "cte_subquery", ["facility_zone", "operation_mode", "avg_tput", "rnk"],
     "3-level nested: innermost aggregate -> middle RANK window -> outer WHERE filter",
     '''SELECT * FROM (SELECT facility_zone, operation_mode, avg_tput, RANK() OVER (PARTITION BY facility_zone ORDER BY avg_tput DESC) AS rnk FROM (SELECT facility_zone, operation_mode, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY facility_zone, operation_mode) inner_agg) ranked_agg WHERE rnk <= 2 ORDER BY facility_zone ASC, rnk ASC'''),

    (58, "cte_subquery", ["_timestamp", "pallet_a", "pallet_b", "facility_zone", "tput_diff"],
     "Self-join with inequality condition for pair-wise comparison",
     '''SELECT t1._timestamp, t1.pallet_id AS pallet_a, t2.pallet_id AS pallet_b, t1.facility_zone, ABS(t1.throughput_rate - t2.throughput_rate) AS tput_diff FROM "query_agent_test" t1 JOIN "query_agent_test" t2 ON t1.facility_zone = t2.facility_zone AND t1._timestamp < t2._timestamp AND t1.pallet_id != t2.pallet_id WHERE t1.throughput_rate IS NOT NULL AND t2.throughput_rate IS NOT NULL ORDER BY tput_diff ASC LIMIT 12'''),

    (59, "cte_subquery", ["facility_zone", "high_cnt", "med_cnt", "low_cnt", "high_pct"],
     "3 CTEs: CASE classification -> grouped summary -> pivot with pct computation",
     '''WITH temp_classified AS (SELECT _timestamp, pallet_id, facility_zone, cell_temp, CASE WHEN cell_temp >= 30.0 THEN 'HIGH' WHEN cell_temp >= 22.0 THEN 'MEDIUM' ELSE 'LOW' END AS temp_class FROM "query_agent_test" WHERE cell_temp IS NOT NULL), class_summary AS (SELECT facility_zone, temp_class, COUNT(*) AS cnt, ROUND(AVG(cell_temp), 2) AS avg_temp FROM temp_classified GROUP BY facility_zone, temp_class), pivot AS (SELECT facility_zone, SUM(CASE WHEN temp_class='HIGH' THEN cnt ELSE 0 END) AS high_cnt, SUM(CASE WHEN temp_class='MEDIUM' THEN cnt ELSE 0 END) AS med_cnt, SUM(CASE WHEN temp_class='LOW' THEN cnt ELSE 0 END) AS low_cnt FROM class_summary GROUP BY facility_zone) SELECT *, ROUND(CAST(high_cnt AS FLOAT) / NULLIF(high_cnt + med_cnt + low_cnt, 0) * 100.0, 2) AS high_pct FROM pivot ORDER BY high_pct DESC'''),

    (60, "cte_subquery", ["facility_zone", "sorter_model", "avg_tput", "avg_load"],
     "Derived table + scalar subquery + EXISTS with low-charge check",
     '''SELECT t1.facility_zone, t1.sorter_model, t1.avg_tput, t1.avg_load FROM (SELECT facility_zone, sorter_model, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(AVG(load_factor), 2) AS avg_load FROM "query_agent_test" GROUP BY facility_zone, sorter_model) t1 WHERE t1.avg_tput > (SELECT ROUND(AVG(throughput_rate) * 0.8, 2) FROM "query_agent_test") AND EXISTS (SELECT 1 FROM "query_agent_test" t2 WHERE t2.facility_zone = t1.facility_zone AND t2.charge_remaining < 20.0) ORDER BY t1.avg_tput DESC'''),

    (61, "cte_subquery", ["_timestamp", "pallet_id", "facility_zone", "throughput_rate", "operation_mode", "cell_temp", "peer_count", "zone_avg_load"],
     "Two CTEs with JOINs for peer count and zone average",
     '''WITH mode_counts AS (SELECT facility_zone, operation_mode, COUNT(*) AS peer_count FROM "query_agent_test" GROUP BY facility_zone, operation_mode), zone_load AS (SELECT facility_zone, ROUND(AVG(load_factor), 2) AS zone_avg_load FROM "query_agent_test" GROUP BY facility_zone) SELECT t1._timestamp, t1.pallet_id, t1.facility_zone, t1.throughput_rate, t1.operation_mode, t1.cell_temp, mc.peer_count, zl.zone_avg_load FROM "query_agent_test" t1 JOIN mode_counts mc ON t1.facility_zone = mc.facility_zone AND t1.operation_mode = mc.operation_mode JOIN zone_load zl ON t1.facility_zone = zl.facility_zone WHERE mc.peer_count >= 2 ORDER BY t1.facility_zone ASC, t1.throughput_rate DESC'''),

    (62, "cte_subquery", ["facility_zone", "chain_count", "avg_hours"],
     "Non-recursive CTE with window-based chaining by runtime_hours",
     '''WITH chain_builder AS (SELECT _timestamp, pallet_id, facility_zone, runtime_hours, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY runtime_hours ASC) AS seq, COUNT(*) OVER (PARTITION BY facility_zone) AS zone_cnt FROM "query_agent_test" WHERE runtime_hours IS NOT NULL), chains AS (SELECT facility_zone, pallet_id, runtime_hours, seq, zone_cnt, CASE WHEN seq < zone_cnt THEN 1 ELSE 0 END AS has_next FROM chain_builder) SELECT facility_zone, COUNT(*) AS chain_count, ROUND(AVG(runtime_hours), 1) AS avg_hours FROM chains GROUP BY facility_zone ORDER BY chain_count DESC'''),
]

# ── DATE_TIME ────────────────────────────────────────────────────────────
DATE_TIME = [
    (63, "date_time", ["_time", "cnt"],
     "Histogram with explicit 2-minute interval",
     '''SELECT histogram(_timestamp, '2 minutes') AS _time, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY _time ORDER BY _time ASC'''),

    (64, "date_time", ["ts_minute", "operation_mode", "cnt"],
     "1-minute histogram + GROUP BY operation_mode",
     '''SELECT histogram(_timestamp, '1 minute') AS ts_minute, operation_mode, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY ts_minute, operation_mode ORDER BY ts_minute ASC, operation_mode ASC'''),

    (65, "date_time", ["_timestamp", "pallet_id", "facility_zone", "log"],
     "ORDER BY DESC LIMIT 5 for most recent events",
     '''SELECT _timestamp, pallet_id, facility_zone, log FROM "query_agent_test" ORDER BY _timestamp DESC LIMIT 5'''),

    (66, "date_time", ["_time", "total_tput", "min_tput", "max_tput"],
     "Histogram with SUM/MIN/MAX aggregates",
     '''SELECT histogram(_timestamp, '5 minutes') AS _time, SUM(throughput_rate) AS total_tput, MIN(throughput_rate) AS min_tput, MAX(throughput_rate) AS max_tput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY _time ORDER BY _time ASC'''),

    (67, "date_time", ["minute_bucket", "auto_cnt", "manual_cnt", "hybrid_cnt"],
     "1-min histogram with 3 FILTER-counts as pivot per bucket",
     '''SELECT histogram(_timestamp, '1 minute') AS minute_bucket, COUNT(*) FILTER (WHERE operation_mode='auto') AS auto_cnt, COUNT(*) FILTER (WHERE operation_mode='manual') AS manual_cnt, COUNT(*) FILTER (WHERE operation_mode='hybrid') AS hybrid_cnt FROM "query_agent_test" GROUP BY minute_bucket ORDER BY minute_bucket ASC'''),

    (68, "date_time", ["half_min", "facility_zone", "cnt", "avg_load", "min_charge"],
     "30-sec histogram + zone breakdown + HAVING avg_load > 30",
     '''SELECT histogram(_timestamp, '30 seconds') AS half_min, facility_zone, COUNT(*) AS cnt, ROUND(AVG(load_factor), 2) AS avg_load, ROUND(MIN(charge_remaining), 2) AS min_charge FROM "query_agent_test" WHERE cell_temp >= 22.0 GROUP BY half_min, facility_zone HAVING ROUND(AVG(load_factor), 2) > 30.0 ORDER BY half_min ASC, facility_zone ASC'''),

    (69, "date_time", ["block", "cnt", "avg_tput", "smoothed_avg", "peak_rank"],
     "CTE with histogram + window over histogram buckets",
     '''WITH bucketed AS (SELECT histogram(_timestamp, '2 minutes') AS block, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY block) SELECT *, ROUND(AVG(avg_tput) OVER (ORDER BY block ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS smoothed_avg, ROW_NUMBER() OVER (ORDER BY cnt DESC) AS peak_rank FROM bucketed ORDER BY block ASC'''),

    (70, "date_time", ["window_5m", "sorter_model", "samples", "avg_tput", "avg_temp", "high_scan_pct"],
     "5-min histogram + sorter breakdown + computed high_scan_pct, HAVING >=2",
     '''SELECT histogram(_timestamp, '5 minutes') AS window_5m, sorter_model, COUNT(*) AS samples, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(AVG(cell_temp), 2) AS avg_temp, ROUND(CAST(SUM(CASE WHEN scan_attempts >= 3 THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100.0, 2) AS high_scan_pct FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY window_5m, sorter_model HAVING COUNT(*) >= 2 ORDER BY window_5m ASC, avg_tput DESC'''),

    (71, "date_time", ["default_bucket", "control_center", "operation_mode", "event_count", "total_items", "avg_charge"],
     "Default histogram + 3-field GROUP BY with item filter",
     '''SELECT histogram(_timestamp) AS default_bucket, control_center, operation_mode, COUNT(*) AS event_count, ROUND(SUM(item_count), 0) AS total_items, ROUND(AVG(charge_remaining), 2) AS avg_charge FROM "query_agent_test" WHERE item_count >= 100 GROUP BY default_bucket, control_center, operation_mode ORDER BY default_bucket ASC, event_count DESC'''),

    (72, "date_time", ["early_window", "early_cnt", "early_avg_tput", "late_window", "late_cnt", "late_avg_tput"],
     "FULL OUTER JOIN of two histograms splitting at mid-point timestamp",
     '''SELECT bucket_a._time AS early_window, bucket_a.cnt AS early_cnt, bucket_a.avg_tput AS early_avg_tput, bucket_b._time AS late_window, bucket_b.cnt AS late_cnt, bucket_b.avg_tput AS late_avg_tput FROM (SELECT histogram(_timestamp, '3 minutes') AS _time, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE _timestamp < (SELECT MIN(_timestamp) + (MAX(_timestamp) - MIN(_timestamp)) / 2 FROM "query_agent_test") GROUP BY _time) bucket_a FULL OUTER JOIN (SELECT histogram(_timestamp, '3 minutes') AS _time, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE _timestamp >= (SELECT MIN(_timestamp) + (MAX(_timestamp) - MIN(_timestamp)) / 2 FROM "query_agent_test") GROUP BY _time) bucket_b ON bucket_a._time = bucket_b._time ORDER BY early_window ASC NULLS LAST'''),

    (73, "date_time", ["minute_slot", "total_events", "avg_tput_hot", "avg_tput_cool"],
     "1-min histogram with conditional AVGs (hot vs cool temp split using CASE)",
     '''SELECT histogram(_timestamp, '1 minute') AS minute_slot, COUNT(*) AS total_events, ROUND(AVG(CASE WHEN cell_temp >= 28.0 THEN throughput_rate ELSE NULL END), 2) AS avg_tput_hot, ROUND(AVG(CASE WHEN cell_temp < 28.0 THEN throughput_rate ELSE NULL END), 2) AS avg_tput_cool FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY minute_slot ORDER BY minute_slot ASC'''),
]

# ── FULL_TEXT_SEARCH ─────────────────────────────────────────────────────
FULL_TEXT_SEARCH = [
    (74, "full_text_search", ["_timestamp", "log", "facility_zone"],
     "match_all full-text search for 'warehouse'",
     '''SELECT _timestamp, log, facility_zone FROM "query_agent_test" WHERE match_all('warehouse') ORDER BY _timestamp DESC LIMIT 10'''),

    (75, "full_text_search", ["_timestamp", "log", "pallet_id"],
     "match_all('event') full-text search (case-insensitive in practice)",
     '''SELECT _timestamp, log, pallet_id FROM "query_agent_test" WHERE match_all('event') ORDER BY _timestamp ASC'''),

    (76, "full_text_search", ["facility_zone", "cnt"],
     "match_all + field filter + GROUP BY",
     '''SELECT facility_zone, COUNT(*) AS cnt FROM "query_agent_test" WHERE match_all('record') AND throughput_rate > 200.0 GROUP BY facility_zone ORDER BY cnt DESC'''),

    (77, "full_text_search", ["_time", "match_count"],
     "match_all with histogram aggregation",
     '''SELECT histogram(_timestamp) AS _time, COUNT(*) AS match_count FROM "query_agent_test" WHERE match_all('warehouse') GROUP BY _time ORDER BY _time ASC'''),

    (78, "full_text_search", ["_timestamp", "pallet_id", "facility_zone", "sorter_model", "throughput_rate", "load_factor"],
     "match_all + numeric filter + IN clause",
     '''SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate, load_factor FROM "query_agent_test" WHERE match_all('warehouse') AND throughput_rate > 400.0 AND facility_zone IN ('ZONE-1', 'ZONE-2') ORDER BY throughput_rate DESC LIMIT 10'''),

    (79, "full_text_search", ["facility_zone", "match_cnt", "avg_tput", "avg_load"],
     "match_all + mode filter + GROUP BY with multiple aggregates and HAVING",
     '''SELECT facility_zone, COUNT(*) AS match_cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(AVG(load_factor), 2) AS avg_load FROM "query_agent_test" WHERE match_all('event') AND operation_mode != 'manual' GROUP BY facility_zone HAVING COUNT(*) >= 1 ORDER BY match_cnt DESC'''),

    (80, "full_text_search", ["time_block", "warehouse_hits", "total_events", "hit_rate_pct"],
     "match_all FILTER in histogram with hit-rate percentage",
     '''SELECT histogram(_timestamp, '1 minute') AS time_block, COUNT(*) FILTER (WHERE match_all('warehouse')) AS warehouse_hits, COUNT(*) AS total_events, ROUND(CAST(COUNT(*) FILTER (WHERE match_all('warehouse')) AS FLOAT) / NULLIF(COUNT(*), 0) * 100.0, 2) AS hit_rate_pct FROM "query_agent_test" GROUP BY time_block ORDER BY time_block ASC'''),

    (81, "full_text_search", ["_timestamp", "log", "pallet_id", "facility_zone", "sorter_model", "recency_rank"],
     "match_all with ROW_NUMBER window partitioned by zone for recency",
     '''SELECT _timestamp, log, pallet_id, facility_zone, sorter_model, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY _timestamp DESC) AS recency_rank FROM "query_agent_test" WHERE match_all('record') ORDER BY facility_zone ASC, recency_rank ASC'''),

    (82, "full_text_search", ["source", "_timestamp", "pallet_id", "facility_zone", "throughput_rate"],
     "UNION ALL of two match_all queries with different thresholds",
     '''SELECT 'primary_hits' AS source, _timestamp, pallet_id, facility_zone, throughput_rate FROM "query_agent_test" WHERE match_all('warehouse') AND throughput_rate >= 500.0 UNION ALL SELECT 'secondary_hits' AS source, _timestamp, pallet_id, facility_zone, throughput_rate FROM "query_agent_test" WHERE match_all('event') AND throughput_rate < 500.0 ORDER BY source ASC, throughput_rate DESC LIMIT 15'''),
]

# ── HISTOGRAM ────────────────────────────────────────────────────────────
HISTOGRAM = [
    (83, "histogram", ["_time", "cnt"],
     "Default histogram with COUNT",
     '''SELECT histogram(_timestamp) AS _time, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY _time ORDER BY _time'''),

    (84, "histogram", ["_time", "high_load_cnt", "low_load_cnt"],
     "Histogram with conditional COUNT using CASE",
     '''SELECT histogram(_timestamp) AS _time, COUNT(CASE WHEN load_factor > 50.0 THEN 1 END) AS high_load_cnt, COUNT(CASE WHEN load_factor <= 50.0 THEN 1 END) AS low_load_cnt FROM "query_agent_test" GROUP BY _time ORDER BY _time ASC'''),

    (85, "histogram", ["bucket_time", "facility_zone", "zone_events", "avg_tput"],
     "1-minute histogram + facility_zone breakdown (2-field GROUP BY)",
     '''SELECT histogram(_timestamp, '1 minute') AS bucket_time, facility_zone, COUNT(*) AS zone_events, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY bucket_time, facility_zone ORDER BY bucket_time ASC, facility_zone ASC'''),

    (86, "histogram", ["bucket", "cnt", "items", "avg_temp", "avg_charge"],
     "30-second histogram with 4 aggregates, filtered by operation_mode",
     '''SELECT histogram(_timestamp, '30 seconds') AS bucket, COUNT(*) AS cnt, SUM(item_count) AS items, ROUND(AVG(cell_temp), 2) AS avg_temp, ROUND(AVG(charge_remaining), 2) AS avg_charge FROM "query_agent_test" WHERE operation_mode != 'manual' GROUP BY bucket ORDER BY bucket ASC'''),

    (87, "histogram", ["time_window", "operation_mode", "high_load_count", "low_load_count", "total"],
     "2-minute histogram + mode breakdown with FILTER clauses",
     '''SELECT histogram(_timestamp, '2 minutes') AS time_window, operation_mode, COUNT(*) FILTER (WHERE load_factor > 50.0) AS high_load_count, COUNT(*) FILTER (WHERE load_factor <= 50.0) AS low_load_count, COUNT(*) AS total FROM "query_agent_test" GROUP BY time_window, operation_mode ORDER BY time_window ASC, operation_mode ASC'''),

    (88, "histogram", ["block", "sorter_model", "samples", "floor_tput", "ceiling_tput"],
     "5-minute histogram with MIN/MAX and HAVING filter",
     '''SELECT histogram(_timestamp, '5 minutes') AS block, sorter_model, COUNT(*) AS samples, ROUND(MIN(throughput_rate), 2) AS floor_tput, ROUND(MAX(throughput_rate), 2) AS ceiling_tput FROM "query_agent_test" GROUP BY block, sorter_model HAVING COUNT(*) >= 2 ORDER BY block ASC, ceiling_tput DESC'''),

    (89, "histogram", ["time_slot", "control_center", "events", "avg_pkg"],
     "Auto-interval histogram + control_center breakdown with package filter",
     '''SELECT histogram(_timestamp) AS time_slot, control_center, COUNT(*) AS events, ROUND(SUM(package_size) * 1.0 / NULLIF(COUNT(*), 0), 2) AS avg_pkg FROM "query_agent_test" WHERE package_size >= 250 GROUP BY time_slot, control_center ORDER BY time_slot ASC, events DESC'''),

    (90, "histogram", ["minute_slot", "total_events", "distinct_pallets", "distinct_lanes"],
     "1-minute histogram with COUNT DISTINCT on two columns",
     '''SELECT histogram(_timestamp, '1 minute') AS minute_slot, COUNT(*) AS total_events, COUNT(DISTINCT pallet_id) AS distinct_pallets, COUNT(DISTINCT conveyor_lane) AS distinct_lanes FROM "query_agent_test" GROUP BY minute_slot ORDER BY minute_slot ASC'''),

    (91, "histogram", ["interval_bucket", "conveyor_lane", "operation_mode", "cnt", "avg_scan"],
     "3-minute histogram with 3-field GROUP BY (bucket + lane + mode)",
     '''SELECT histogram(_timestamp, '3 minutes') AS interval_bucket, conveyor_lane, operation_mode, COUNT(*) AS cnt, ROUND(AVG(scan_attempts), 2) AS avg_scan FROM "query_agent_test" WHERE scan_attempts >= 1 GROUP BY interval_bucket, conveyor_lane, operation_mode ORDER BY interval_bucket ASC, cnt DESC'''),

    (92, "histogram", ["window_block", "charged_ops", "low_charge_ops", "low_charge_avg_temp"],
     "4-minute histogram with conditional FILTER aggregates and filtered AVG",
     '''SELECT histogram(_timestamp, '4 minutes') AS window_block, COUNT(*) FILTER (WHERE charge_remaining >= 60.0) AS charged_ops, COUNT(*) FILTER (WHERE charge_remaining < 30.0) AS low_charge_ops, ROUND(AVG(cell_temp) FILTER (WHERE charge_remaining < 30.0), 2) AS low_charge_avg_temp FROM "query_agent_test" GROUP BY window_block ORDER BY window_block ASC'''),

    (93, "histogram", ["fine_bucket", "total", "avg_defect", "tput_volatility"],
     "15-second fine histogram with STDDEV and HAVING",
     '''SELECT histogram(_timestamp, '15 seconds') AS fine_bucket, COUNT(*) AS total, ROUND(AVG(defect_limit), 3) AS avg_defect, ROUND(STDDEV(throughput_rate), 2) AS tput_volatility FROM "query_agent_test" WHERE defect_limit IS NOT NULL AND throughput_rate IS NOT NULL GROUP BY fine_bucket HAVING COUNT(*) > 1 ORDER BY fine_bucket ASC'''),
]

# ── MATH_FUNCTIONS ───────────────────────────────────────────────────────
MATH_FUNCTIONS = [
    (94, "math_functions", ["high_load_pct"],
     "Computed percentage of high-load events",
     '''SELECT ROUND(CAST(COUNT(CASE WHEN load_factor > 70.0 THEN 1 END) AS FLOAT) / NULLIF(COUNT(CASE WHEN load_factor <= 70.0 THEN 1 END), 0) * 100.0, 2) AS high_load_pct FROM "query_agent_test"'''),

    (95, "math_functions", ["_timestamp", "pallet_id", "throughput_rate", "load_factor", "geo_mean_index", "squared_normalized", "load_midpoint_dist"],
     "SQRT, POWER, ABS in one SELECT with geometric mean index",
     '''SELECT _timestamp, pallet_id, throughput_rate, load_factor, ROUND(SQRT(throughput_rate * load_factor), 2) AS geo_mean_index, ROUND(POWER(throughput_rate / 100.0, 2), 3) AS squared_normalized, ROUND(ABS(load_factor - 50.0), 2) AS load_midpoint_dist FROM "query_agent_test" WHERE throughput_rate > 0 AND load_factor > 0 ORDER BY geo_mean_index DESC LIMIT 12'''),

    (96, "math_functions", ["_timestamp", "item_count", "package_size", "item_pkg_ratio", "remainder", "max_dimension"],
     "Division with NULLIF + MOD + GREATEST with computed expression",
     '''SELECT _timestamp, item_count, package_size, ROUND(CAST(item_count AS FLOAT) / NULLIF(CAST(package_size AS FLOAT), 0), 4) AS item_pkg_ratio, ROUND(CAST(item_count AS FLOAT) - CAST(package_size AS FLOAT) * FLOOR(CAST(item_count AS FLOAT) / CAST(package_size AS FLOAT)), 0) AS remainder, ROUND(GREATEST(CAST(item_count AS FLOAT), CAST(package_size AS FLOAT), CAST(scan_attempts AS FLOAT) * 100.0), 1) AS max_dimension FROM "query_agent_test" WHERE item_count > 0 AND package_size > 0 ORDER BY item_pkg_ratio DESC'''),

    (97, "math_functions", ["_timestamp", "cell_temp", "rounded_temp", "temp_floor", "temp_ceil", "fractional_pct", "rounding_behavior"],
     "FLOOR, CEIL, fractional part computation, CASE on rounding direction",
     '''SELECT _timestamp, cell_temp, ROUND(cell_temp, 1) AS rounded_temp, FLOOR(cell_temp) AS temp_floor, CEIL(cell_temp) AS temp_ceil, ROUND((cell_temp - FLOOR(cell_temp)) * 100.0, 1) AS fractional_pct, CASE WHEN cell_temp - FLOOR(cell_temp) >= 0.5 THEN 'rounds_up' ELSE 'rounds_down' END AS rounding_behavior FROM "query_agent_test" WHERE cell_temp IS NOT NULL ORDER BY fractional_pct DESC'''),

    (98, "math_functions", ["facility_zone", "n", "avg_tput", "std_tput", "variance_manual", "cv"],
     "Manual variance (E[X^2]-E[X]^2) + coefficient of variation per zone",
     '''SELECT facility_zone, COUNT(*) AS n, ROUND(AVG(throughput_rate), 2) AS avg_tput, ROUND(STDDEV(throughput_rate), 2) AS std_tput, ROUND((AVG(throughput_rate * throughput_rate) - POWER(AVG(throughput_rate), 2)), 3) AS variance_manual, ROUND(STDDEV(throughput_rate) / NULLIF(AVG(throughput_rate), 0), 4) AS cv FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY facility_zone HAVING COUNT(*) >= 3 ORDER BY cv ASC'''),

    (99, "math_functions", ["_timestamp", "load_factor", "charge_remaining", "harmonic_component", "quadratic_mean", "euclidean_dist"],
     "Harmonic component, quadratic mean, Euclidean distance on (load, charge) pairs",
     '''SELECT _timestamp, load_factor, charge_remaining, ROUND((load_factor * charge_remaining) / NULLIF(load_factor + charge_remaining, 0), 2) AS harmonic_component, ROUND((POWER(load_factor, 2) + POWER(charge_remaining, 2)) / 2.0, 2) AS quadratic_mean, ROUND(SQRT(POWER(load_factor - charge_remaining, 2)), 2) AS euclidean_dist FROM "query_agent_test" WHERE load_factor > 0 AND charge_remaining > 0 ORDER BY harmonic_component DESC'''),

    (100, "math_functions", ["_timestamp", "throughput_rate", "load_factor", "charge_remaining", "avg_tput", "avg_load", "zscore_tput", "zscore_load"],
     "Z-score normalization using scalar subqueries for mean and stddev",
     '''WITH global_stats AS (SELECT AVG(throughput_rate) AS avg_tput, AVG(throughput_rate * throughput_rate) - AVG(throughput_rate) * AVG(throughput_rate) AS var_tput, AVG(load_factor) AS avg_load, AVG(load_factor * load_factor) - AVG(load_factor) * AVG(load_factor) AS var_load FROM "query_agent_test"), scored AS (SELECT t._timestamp, t.throughput_rate, t.load_factor, t.charge_remaining, gs.avg_tput, gs.avg_load, ROUND((t.throughput_rate - gs.avg_tput) / NULLIF(SQRT(gs.var_tput), 0), 4) AS zscore_tput, ROUND((t.load_factor - gs.avg_load) / NULLIF(SQRT(gs.var_load), 0), 4) AS zscore_load, ABS((t.throughput_rate - gs.avg_tput) / NULLIF(SQRT(gs.var_tput), 0)) AS abs_zscore_tput FROM "query_agent_test" t CROSS JOIN global_stats gs WHERE t.throughput_rate IS NOT NULL AND t.load_factor IS NOT NULL) SELECT _timestamp, throughput_rate, load_factor, charge_remaining, avg_tput, avg_load, zscore_tput, zscore_load FROM scored ORDER BY abs_zscore_tput DESC LIMIT 12'''),

    (101, "math_functions", ["_timestamp", "pallet_id", "cell_temp", "charge_remaining", "temp_percentile", "temp_mean_diff", "temp_zscore_window"],
     "PERCENT_RANK + window-based AVG/STDDEV for z-score",
     '''SELECT _timestamp, pallet_id, cell_temp, charge_remaining, ROUND(CAST(PERCENT_RANK() OVER (ORDER BY cell_temp) AS FLOAT), 4) AS temp_percentile, ROUND(cell_temp - AVG(cell_temp) OVER (), 2) AS temp_mean_diff, ROUND((cell_temp - AVG(cell_temp) OVER ()) / NULLIF(STDDEV(cell_temp) OVER (), 0), 4) AS temp_zscore_window FROM "query_agent_test" WHERE cell_temp IS NOT NULL ORDER BY temp_percentile DESC'''),

    (102, "math_functions", ["_timestamp", "defect", "load", "log_tput", "log10_items", "exp_defect"],
     "LN, LOG10, EXP with NULLIF guards",
     '''SELECT _timestamp, ROUND(defect_limit, 2) AS defect, ROUND(load_factor, 2) AS load, ROUND(CAST(LN(NULLIF(throughput_rate, 0)) AS FLOAT), 4) AS log_tput, ROUND(CAST(LOG10(NULLIF(item_count, 0)) AS FLOAT), 4) AS log10_items, ROUND(CAST(EXP(ROUND(defect_limit, 2)) AS FLOAT), 4) AS exp_defect FROM "query_agent_test" WHERE throughput_rate > 0 AND item_count > 0 AND defect_limit <= 2.0 ORDER BY log_tput DESC LIMIT 12'''),
]

# ── PAGINATION ───────────────────────────────────────────────────────────
PAGINATION = [
    (103, "pagination", ["_timestamp", "pallet_id", "facility_zone", "throughput_rate"],
     "LIMIT 8 OFFSET 4 — skips first 4 rows in DESC throughput order",
     '''SELECT _timestamp, pallet_id, facility_zone, throughput_rate FROM "query_agent_test" ORDER BY throughput_rate DESC LIMIT 8 OFFSET 4'''),

    (104, "pagination", ["sorter_model", "operation_mode", "cnt"],
     "GROUP BY with LIMIT/OFFSET pagination on aggregates",
     '''SELECT sorter_model, operation_mode, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY sorter_model, operation_mode ORDER BY cnt DESC LIMIT 6 OFFSET 2'''),

    (105, "pagination", ["_timestamp", "sorter_model", "throughput_rate", "row_num"],
     "CTE with ROW_NUMBER for pagination; rows 5-10",
     '''WITH numbered AS (SELECT _timestamp, sorter_model, throughput_rate, ROW_NUMBER() OVER (ORDER BY throughput_rate DESC) AS row_num FROM "query_agent_test" WHERE throughput_rate IS NOT NULL) SELECT _timestamp, sorter_model, throughput_rate, row_num FROM numbered WHERE row_num BETWEEN 5 AND 10 ORDER BY row_num'''),

    (106, "pagination", ["_timestamp", "pallet_id", "facility_zone", "sorter_model", "throughput_rate"],
     "Keyset pagination using subquery with OFFSET as reference",
     '''WITH reference AS (SELECT _timestamp FROM "query_agent_test" ORDER BY _timestamp ASC LIMIT 1 OFFSET 5) SELECT _timestamp, pallet_id, facility_zone, sorter_model, throughput_rate FROM "query_agent_test" WHERE _timestamp > (SELECT _timestamp FROM reference) ORDER BY _timestamp ASC LIMIT 8'''),

    (107, "pagination", ["_timestamp", "pallet_id", "control_center", "load_factor", "throughput_rate", "row_idx"],
     "CTE with ROW_NUMBER for page 2 (rows 7-14)",
     '''WITH page AS (SELECT _timestamp, pallet_id, control_center, load_factor, throughput_rate, ROW_NUMBER() OVER (ORDER BY throughput_rate DESC, _timestamp ASC) AS row_idx FROM "query_agent_test" WHERE throughput_rate IS NOT NULL) SELECT * FROM page WHERE row_idx > 6 AND row_idx <= 14 ORDER BY row_idx ASC'''),

    (108, "pagination", ["facility_zone", "operation_mode", "cnt", "avg_tput"],
     "GROUP BY with LIMIT/OFFSET pagination on aggregated results",
     '''SELECT facility_zone, operation_mode, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY facility_zone, operation_mode ORDER BY cnt DESC, avg_tput DESC LIMIT 6 OFFSET 3'''),

    (109, "pagination", ["_timestamp", "pallet_id", "facility_zone", "throughput_rate", "rn"],
     "Per-partition pagination: rows 2-4 within each facility_zone by throughput",
     '''WITH zoned AS (SELECT _timestamp, pallet_id, facility_zone, throughput_rate, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rn FROM "query_agent_test" WHERE throughput_rate IS NOT NULL) SELECT * FROM zoned WHERE rn BETWEEN 2 AND 4 ORDER BY facility_zone ASC, rn ASC'''),

    (110, "pagination", ["_timestamp", "pallet_id", "conveyor_lane", "load_factor", "charge_remaining"],
     "Second page (OFFSET 7, LIMIT 7) with dual ORDER BY",
     '''SELECT _timestamp, pallet_id, conveyor_lane, load_factor, charge_remaining FROM "query_agent_test" WHERE load_factor IS NOT NULL ORDER BY load_factor DESC, charge_remaining ASC LIMIT 7 OFFSET 7'''),

    (111, "pagination", ["_timestamp", "pallet_id", "facility_zone", "cell_temp", "temp_rank"],
     "Top-8 hottest + coldest via UNION of two RANK windows with LIMIT 16",
     '''WITH inner_page AS (SELECT _timestamp, pallet_id, facility_zone, cell_temp, RANK() OVER (ORDER BY cell_temp DESC) AS temp_rank FROM "query_agent_test" WHERE cell_temp IS NOT NULL) SELECT * FROM inner_page WHERE temp_rank <= 8 UNION ALL SELECT _timestamp, pallet_id, facility_zone, cell_temp, RANK() OVER (ORDER BY cell_temp ASC) AS temp_rank FROM "query_agent_test" WHERE cell_temp IS NOT NULL ORDER BY temp_rank ASC LIMIT 16'''),

    (112, "pagination", ["_timestamp", "throughput_rate", "dr"],
     "DENSE_RANK pagination: pages by distinct throughput tiers (dr 4-8)",
     '''WITH dense_ranked AS (SELECT *, DENSE_RANK() OVER (ORDER BY throughput_rate DESC) AS dr FROM "query_agent_test" WHERE throughput_rate IS NOT NULL), distinct_page AS (SELECT MIN(_timestamp) AS _timestamp, throughput_rate, dr FROM dense_ranked GROUP BY throughput_rate, dr) SELECT * FROM distinct_page WHERE dr > 3 AND dr <= 8 ORDER BY dr ASC'''),
]

# ── STRING_FUNCTIONS ─────────────────────────────────────────────────────
STRING_FUNCTIONS = [
    (113, "string_functions", ["_timestamp", "safe_zone", "sorter_op_label"],
     "COALESCE + CONCAT combining sorter and facility zone",
     '''SELECT _timestamp, COALESCE(facility_zone, 'UNKNOWN_ZONE') AS safe_zone, CONCAT(sorter_model, ' @ ', control_center) AS sorter_op_label FROM "query_agent_test" ORDER BY _timestamp ASC LIMIT 12'''),

    (114, "string_functions", ["_timestamp", "matched", "first_word"],
     "re_match + split_part on log field",
     '''SELECT _timestamp, re_match(log, 'warehouse|event') AS matched, split_part(log, ' ', 1) AS first_word FROM "query_agent_test" WHERE log IS NOT NULL ORDER BY _timestamp DESC LIMIT 12'''),

    (115, "string_functions", ["_timestamp", "pallet_upper", "lane_lower", "sorter_op", "clean_build", "label_len"],
     "5 string functions: UPPER, LOWER, CONCAT, TRIM+COALESCE, LENGTH+CONCAT",
     '''SELECT _timestamp, UPPER(pallet_id) AS pallet_upper, LOWER(conveyor_lane) AS lane_lower, CONCAT(sorter_model, '-', operation_mode) AS sorter_op, TRIM(COALESCE(build_signature, '')) AS clean_build, LENGTH(CONCAT(facility_zone, '-', control_center)) AS label_len FROM "query_agent_test" WHERE pallet_id IS NOT NULL ORDER BY _timestamp DESC LIMIT 12'''),

    (116, "string_functions", ["_timestamp", "pallet_id", "is_front_pallet", "prefix", "suffix_num"],
     "re_match with regex character class + split_part on dash delimiter",
     '''SELECT _timestamp, pallet_id, re_match(pallet_id, 'PL-00[1-4]') AS is_front_pallet, split_part(pallet_id, '-', 1) AS prefix, split_part(pallet_id, '-', 2) AS suffix_num FROM "query_agent_test" WHERE re_match(pallet_id, 'PL-00[1-8]') = TRUE ORDER BY suffix_num ASC'''),

    (117, "string_functions", ["control_center", "sorter_models", "op_modes", "event_cnt"],
     "STRING_AGG with DISTINCT + ORDER BY, second STRING_AGG for another column",
     '''SELECT control_center, STRING_AGG(DISTINCT sorter_model, ' | ' ORDER BY sorter_model ASC) AS sorter_models, STRING_AGG(DISTINCT operation_mode, ', ') AS op_modes, COUNT(*) AS event_cnt FROM "query_agent_test" WHERE control_center IS NOT NULL GROUP BY control_center HAVING COUNT(*) >= 2 ORDER BY event_cnt DESC'''),

    (118, "string_functions", ["_timestamp", "pallet_id", "build_signature", "build_prefix", "build_suffix", "replaced_sig"],
     "SUBSTR (two positions) + REPLACE + LIKE pattern filter",
     '''SELECT _timestamp, pallet_id, build_signature, SUBSTR(build_signature, 1, 8) AS build_prefix, SUBSTR(build_signature, 10, 2) AS build_suffix, REPLACE(build_signature, 'BS-', 'BUILD_') AS replaced_sig FROM "query_agent_test" WHERE build_signature LIKE 'BS-2026-%' ORDER BY build_signature ASC, _timestamp ASC'''),

    (119, "string_functions", ["_timestamp", "pallet_id", "conveyor_lane", "facility_zone", "short_code", "location_type"],
     "Nested: LOWER(CONCAT(SUBSTR, SUBSTR)) + CASE with re_match on CONCAT result",
     '''SELECT _timestamp, pallet_id, conveyor_lane, facility_zone, LOWER(CONCAT(SUBSTR(conveyor_lane, 1, 4), '-', SUBSTR(facility_zone, 5, 1))) AS short_code, CASE WHEN re_match(CONCAT(conveyor_lane, '-', facility_zone), 'LANE-[AB]-ZONE-[12]') THEN 'core' ELSE 'edge' END AS location_type FROM "query_agent_test" WHERE conveyor_lane IS NOT NULL AND facility_zone IS NOT NULL ORDER BY location_type ASC, short_code ASC'''),

    (120, "string_functions", ["_timestamp", "pallet_id", "sorter_model", "safe_sorter", "exclude_q5", "filtered_sorter"],
     "COALESCE + NULLIF + chained COALESCE(NULLIF(...))",
     '''SELECT _timestamp, pallet_id, sorter_model, COALESCE(sorter_model, 'UNKNOWN_SORTER') AS safe_sorter, NULLIF(sorter_model, 'SORT-Q5') AS exclude_q5, COALESCE(NULLIF(sorter_model, 'SORT-Q5'), 'FILTERED') AS filtered_sorter FROM "query_agent_test" ORDER BY _timestamp ASC LIMIT 12'''),

    (121, "string_functions", ["_timestamp", "log", "pallet_id", "has_keyword", "has_digit", "msg_length", "record_pos"],
     "re_match (two patterns) + LENGTH + POSITION on log field",
     '''SELECT _timestamp, log, pallet_id, re_match(log, 'warehouse|event') AS has_keyword, re_match(log, '[0-9]+') AS has_digit, LENGTH(log) AS msg_length, POSITION('record' IN log) AS record_pos FROM "query_agent_test" WHERE re_match(log, 'warehouse') = TRUE ORDER BY msg_length DESC LIMIT 12'''),

    (122, "string_functions", ["facility_zone", "mode_tput_list", "distinct_modes"],
     "STRING_AGG with CONCAT of mode + rounded throughput, ORDER BY inside STRING_AGG",
     '''SELECT facility_zone, STRING_AGG(DISTINCT CONCAT(operation_mode, ':', CAST(ROUND(throughput_rate, 0) AS VARCHAR)), '; ' ORDER BY throughput_rate DESC) AS mode_tput_list, COUNT(DISTINCT operation_mode) AS distinct_modes FROM "query_agent_test" WHERE throughput_rate IS NOT NULL GROUP BY facility_zone ORDER BY distinct_modes DESC'''),
]

# ── UNION ────────────────────────────────────────────────────────────────
UNION = [
    (123, "union", ["charge_tier", "cnt"],
     "UNION ALL combining two filtered GROUP BY results for charge tiers",
     '''SELECT 'critical' AS charge_tier, COUNT(*) AS cnt FROM "query_agent_test" WHERE charge_remaining < 30.0 GROUP BY 'critical' UNION ALL SELECT 'normal' AS charge_tier, COUNT(*) AS cnt FROM "query_agent_test" WHERE charge_remaining >= 30.0 GROUP BY 'normal' ORDER BY charge_tier ASC'''),

    (124, "union", ["sorter_model", "cnt"],
     "UNION (dedup) of two sorter partitions (high and low throughput)",
     '''SELECT sorter_model, COUNT(*) AS cnt FROM "query_agent_test" WHERE throughput_rate >= 500.0 GROUP BY sorter_model UNION SELECT sorter_model, COUNT(*) AS cnt FROM "query_agent_test" WHERE throughput_rate < 300.0 GROUP BY sorter_model ORDER BY sorter_model ASC'''),

    (125, "union", ["speed_tier", "cnt", "avg_tput"],
     "Triple UNION ALL with computed aggregates per speed tier",
     '''SELECT 'fast' AS speed_tier, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE throughput_rate >= 700.0 UNION ALL SELECT 'medium' AS speed_tier, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE throughput_rate >= 300.0 AND throughput_rate < 700.0 UNION ALL SELECT 'slow' AS speed_tier, COUNT(*) AS cnt, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" WHERE throughput_rate < 300.0 ORDER BY speed_tier ASC'''),

    (126, "union", ["sorter_model", "operation_mode", "cnt"],
     "UNION with NULL literal column",
     '''SELECT sorter_model, operation_mode, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY sorter_model, operation_mode HAVING COUNT(*) > 0 UNION ALL SELECT NULL AS sorter_model, operation_mode, COUNT(*) AS cnt FROM "query_agent_test" WHERE throughput_rate >= 800.0 GROUP BY operation_mode ORDER BY cnt DESC LIMIT 8'''),

    (127, "union", ["_timestamp", "log"],
     "UNION ALL across two temp zones; DESC LIMIT 10",
     '''SELECT _timestamp, log FROM "query_agent_test" WHERE cell_temp >= 30.0 UNION ALL SELECT _timestamp, log FROM "query_agent_test" WHERE cell_temp < 20.0 ORDER BY _timestamp DESC LIMIT 10'''),

    (128, "union", ["location", "granularity", "total", "avg_tput"],
     "Two CTEs with different GROUP BY levels, UNION ALL, ordered by granularity",
     '''WITH zone_agg AS (SELECT facility_zone AS location, 'zone' AS granularity, COUNT(*) AS total, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY facility_zone), center_agg AS (SELECT control_center AS location, 'center' AS granularity, COUNT(*) AS total, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY control_center), combined AS (SELECT * FROM zone_agg UNION ALL SELECT * FROM center_agg) SELECT * FROM combined ORDER BY granularity ASC, avg_tput DESC'''),

    (129, "union", ["facility_zone", "sorter_model", "cnt", "max_tput"],
     "UNION (dedup) of auto vs hybrid aggregations, same shape",
     '''SELECT facility_zone, sorter_model, COUNT(*) AS cnt, MAX(throughput_rate) AS max_tput FROM "query_agent_test" WHERE operation_mode = 'auto' GROUP BY facility_zone, sorter_model UNION SELECT facility_zone, sorter_model, COUNT(*) AS cnt, MAX(throughput_rate) AS max_tput FROM "query_agent_test" WHERE operation_mode = 'hybrid' GROUP BY facility_zone, sorter_model ORDER BY facility_zone ASC, max_tput DESC'''),

    (130, "union", ["facility_zone", "sorter_model", "throughput_rate", "rn", "mode"],
     "Two CTEs with ROW_NUMBER, then UNION ALL top-2 per zone per mode",
     '''WITH auto_top AS (SELECT facility_zone, sorter_model, throughput_rate, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rn FROM "query_agent_test" WHERE operation_mode='auto' AND throughput_rate IS NOT NULL), manual_top AS (SELECT facility_zone, sorter_model, throughput_rate, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rn FROM "query_agent_test" WHERE operation_mode='manual' AND throughput_rate IS NOT NULL) SELECT facility_zone, sorter_model, throughput_rate, rn, 'auto' AS mode FROM auto_top WHERE rn <= 2 UNION ALL SELECT facility_zone, sorter_model, throughput_rate, rn, 'manual' AS mode FROM manual_top WHERE rn <= 2 ORDER BY mode ASC, facility_zone ASC, rn ASC'''),

    (131, "union", ["_timestamp", "pallet_id", "facility_zone", "load_factor", "shift"],
     "UNION ALL splitting by computed shift (MOD of runtime_days)",
     '''SELECT _timestamp, pallet_id, facility_zone, load_factor, 'day_shift' AS shift FROM "query_agent_test" WHERE runtime_hours IS NOT NULL AND CAST(FLOOR(CAST(runtime_hours AS FLOAT) / 24.0) AS INTEGER) % 2 = 0 UNION ALL SELECT _timestamp, pallet_id, facility_zone, load_factor, 'night_shift' AS shift FROM "query_agent_test" WHERE runtime_hours IS NOT NULL AND CAST(FLOOR(CAST(runtime_hours AS FLOAT) / 24.0) AS INTEGER) % 2 = 1 ORDER BY shift ASC, load_factor DESC LIMIT 20'''),

    (132, "union", ["facility_zone", "pallet_id", "throughput_rate", "rn", "label"],
     "CTE with ROW_NUMBER, then three-way UNION ALL for LEADER/RUNNER_UP/TRAILING",
     '''WITH ranked_all AS (SELECT _timestamp, pallet_id, facility_zone, throughput_rate, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rn FROM "query_agent_test" WHERE throughput_rate IS NOT NULL) SELECT facility_zone, pallet_id, throughput_rate, rn, 'LEADER' AS label FROM ranked_all WHERE rn = 1 UNION ALL SELECT facility_zone, pallet_id, throughput_rate, rn, 'RUNNER_UP' AS label FROM ranked_all WHERE rn = 2 UNION ALL SELECT facility_zone, pallet_id, throughput_rate, rn, 'TRAILING' AS label FROM ranked_all WHERE rn >= 5 ORDER BY facility_zone ASC, rn ASC'''),

    (133, "union", ["facility_zone", "auto_cnt", "manual_cnt", "avg_tput_auto", "avg_tput_manual", "avg_temp_auto", "avg_temp_manual"],
     "FILTER-based per-mode aggregation (auto vs manual) without UNION",
     '''SELECT facility_zone, COUNT(*) FILTER (WHERE operation_mode='auto') AS auto_cnt, COUNT(*) FILTER (WHERE operation_mode='manual') AS manual_cnt, ROUND(AVG(throughput_rate) FILTER (WHERE operation_mode='auto'), 2) AS avg_tput_auto, ROUND(AVG(throughput_rate) FILTER (WHERE operation_mode='manual'), 2) AS avg_tput_manual, ROUND(AVG(cell_temp) FILTER (WHERE operation_mode='auto'), 2) AS avg_temp_auto, ROUND(AVG(cell_temp) FILTER (WHERE operation_mode='manual'), 2) AS avg_temp_manual FROM "query_agent_test" GROUP BY facility_zone ORDER BY facility_zone ASC'''),

    (134, "union", ["category", "cnt", "avg_temp", "avg_tput"],
     "CASE-based charge tier aggregation (single SELECT for charge tiers)",
     '''SELECT CASE WHEN charge_remaining < 35.0 THEN 'low_charge' WHEN charge_remaining BETWEEN 35.0 AND 70.0 THEN 'medium_charge' ELSE 'high_charge' END AS category, COUNT(*) AS cnt, ROUND(AVG(cell_temp), 2) AS avg_temp, ROUND(AVG(throughput_rate), 2) AS avg_tput FROM "query_agent_test" GROUP BY category ORDER BY category ASC'''),
]

# ── WINDOW ───────────────────────────────────────────────────────────────
WINDOW = [
    (135, "window", ["sorter_model", "throughput_rate", "rank", "drank"],
     "ROW_NUMBER + DENSE_RANK partitioned by sorter_model",
     '''SELECT sorter_model, throughput_rate, ROW_NUMBER() OVER (PARTITION BY sorter_model ORDER BY throughput_rate DESC) AS rank, DENSE_RANK() OVER (PARTITION BY sorter_model ORDER BY throughput_rate DESC) AS drank FROM "query_agent_test" WHERE throughput_rate IS NOT NULL'''),

    (136, "window", ["_timestamp", "throughput_rate", "prev_tput", "next_tput"],
     "LAG and LEAD with literal defaults",
     '''SELECT _timestamp, throughput_rate, LAG(throughput_rate, 1, 0) OVER (ORDER BY _timestamp) AS prev_tput, LEAD(throughput_rate, 1, 0) OVER (ORDER BY _timestamp) AS next_tput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY _timestamp ASC'''),

    (137, "window", ["facility_zone", "load_factor", "rank", "dense_rnk"],
     "RANK + DENSE_RANK partitioned by facility_zone",
     '''SELECT facility_zone, load_factor, RANK() OVER (PARTITION BY facility_zone ORDER BY load_factor DESC) AS rank, DENSE_RANK() OVER (PARTITION BY facility_zone ORDER BY load_factor DESC) AS dense_rnk FROM "query_agent_test" WHERE load_factor IS NOT NULL'''),

    (138, "window", ["_timestamp", "throughput_rate", "running_total", "moving_avg_3"],
     "Running total + 3-row moving average",
     '''SELECT _timestamp, throughput_rate, SUM(throughput_rate) OVER (ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total, AVG(throughput_rate) OVER (ORDER BY _timestamp ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS moving_avg_3 FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY _timestamp ASC'''),

    (139, "window", ["facility_zone", "sorter_model", "cnt", "rn"],
     "Window over GROUP BY result",
     '''SELECT facility_zone, sorter_model, COUNT(*) AS cnt, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY COUNT(*) DESC) AS rn FROM "query_agent_test" GROUP BY facility_zone, sorter_model ORDER BY facility_zone ASC, rn ASC'''),

    (140, "window", ["_timestamp", "operation_mode", "throughput_rate", "first_tput", "last_tput"],
     "FIRST_VALUE + LAST_VALUE with full partition frame",
     '''SELECT _timestamp, operation_mode, throughput_rate, FIRST_VALUE(throughput_rate) OVER (PARTITION BY operation_mode ORDER BY _timestamp) AS first_tput, LAST_VALUE(throughput_rate) OVER (PARTITION BY operation_mode ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_tput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY operation_mode, _timestamp'''),

    (141, "window", ["_timestamp", "load_factor", "pct_rank", "quartile"],
     "PERCENT_RANK and NTILE(4) across all rows",
     '''SELECT _timestamp, load_factor, PERCENT_RANK() OVER (ORDER BY load_factor) AS pct_rank, NTILE(4) OVER (ORDER BY load_factor) AS quartile FROM "query_agent_test" WHERE load_factor IS NOT NULL ORDER BY load_factor ASC'''),

    (142, "window", ["_timestamp", "pallet_id", "facility_zone", "throughput_rate", "rank_in_zone", "rank_dense", "dense_rnk", "prev_tput", "next_tput"],
     "5 window functions: ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD",
     '''SELECT _timestamp, pallet_id, facility_zone, throughput_rate, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rank_in_zone, RANK() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS rank_dense, DENSE_RANK() OVER (PARTITION BY facility_zone ORDER BY throughput_rate DESC) AS dense_rnk, LAG(throughput_rate, 1, 0) OVER (PARTITION BY facility_zone ORDER BY _timestamp) AS prev_tput, LEAD(throughput_rate, 1, 0) OVER (PARTITION BY facility_zone ORDER BY _timestamp) AS next_tput FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY facility_zone ASC, rank_in_zone ASC'''),

    (143, "window", ["_timestamp", "control_center", "item_count", "running_items", "ma_4_items", "center_avg"],
     "Running total + 4-row moving average + partition average",
     '''SELECT _timestamp, control_center, item_count, SUM(item_count) OVER (PARTITION BY control_center ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_items, AVG(item_count) OVER (PARTITION BY control_center ORDER BY _timestamp ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) AS ma_4_items, ROUND(AVG(CAST(item_count AS FLOAT)) OVER (PARTITION BY control_center), 1) AS center_avg FROM "query_agent_test" WHERE item_count > 0 ORDER BY control_center ASC, _timestamp ASC'''),

    (144, "window", ["_timestamp", "sorter_model", "load_factor", "charge_remaining", "first_load", "last_load", "second_load"],
     "FIRST_VALUE, LAST_VALUE, NTH_VALUE with full partition frame",
     '''SELECT _timestamp, sorter_model, load_factor, charge_remaining, FIRST_VALUE(load_factor) OVER (PARTITION BY sorter_model ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS first_load, LAST_VALUE(load_factor) OVER (PARTITION BY sorter_model ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_load, NTH_VALUE(load_factor, 2) OVER (PARTITION BY sorter_model ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS second_load FROM "query_agent_test" WHERE load_factor IS NOT NULL ORDER BY sorter_model ASC, _timestamp ASC'''),

    (145, "window", ["facility_zone", "operation_mode", "cnt", "zone_total", "zone_pct", "rn"],
     "Window over pre-aggregated subquery: zone_total, zone_pct, ROW_NUMBER",
     '''SELECT facility_zone, operation_mode, cnt, ROUND(SUM(cnt) OVER (PARTITION BY facility_zone), 0) AS zone_total, ROUND(CAST(cnt AS FLOAT) / NULLIF(SUM(cnt) OVER (PARTITION BY facility_zone), 0) * 100.0, 2) AS zone_pct, ROW_NUMBER() OVER (PARTITION BY facility_zone ORDER BY cnt DESC) AS rn FROM (SELECT facility_zone, operation_mode, COUNT(*) AS cnt FROM "query_agent_test" GROUP BY facility_zone, operation_mode) grouped ORDER BY facility_zone ASC, rn ASC'''),

    (146, "window", ["_timestamp", "conveyor_lane", "package_size", "cum_dist", "pct_rank", "quartile"],
     "CUME_DIST, PERCENT_RANK, NTILE(4) in one SELECT, partitioned by lane",
     '''SELECT _timestamp, conveyor_lane, package_size, ROUND(CUME_DIST() OVER (PARTITION BY conveyor_lane ORDER BY package_size), 4) AS cum_dist, ROUND(PERCENT_RANK() OVER (PARTITION BY conveyor_lane ORDER BY package_size), 4) AS pct_rank, NTILE(4) OVER (PARTITION BY conveyor_lane ORDER BY package_size) AS quartile FROM "query_agent_test" WHERE package_size > 0 ORDER BY conveyor_lane ASC, package_size ASC'''),

    (147, "window", ["_timestamp", "pallet_id", "build_signature", "runtime_hours", "hours_2_back", "hours_2_ahead", "delta_from_prev"],
     "LAG(offset=2) + LEAD(offset=2) + computed delta from LAG(offset=1)",
     '''SELECT _timestamp, pallet_id, build_signature, runtime_hours, LAG(runtime_hours, 2, 0) OVER (PARTITION BY build_signature ORDER BY runtime_hours) AS hours_2_back, LEAD(runtime_hours, 2, 9999) OVER (PARTITION BY build_signature ORDER BY runtime_hours) AS hours_2_ahead, ROUND(runtime_hours - LAG(runtime_hours, 1, 0) OVER (PARTITION BY build_signature ORDER BY runtime_hours), 1) AS delta_from_prev FROM "query_agent_test" WHERE runtime_hours IS NOT NULL ORDER BY build_signature ASC, runtime_hours ASC'''),

    (148, "window", ["_timestamp", "facility_zone", "throughput_rate", "zone_running_sum", "zone_running_min", "zone_running_max", "zone_moving_avg_5"],
     "Named WINDOW clauses (w1, w2) with different frame specs",
     '''SELECT _timestamp, facility_zone, throughput_rate, ROUND(SUM(throughput_rate) OVER w1, 2) AS zone_running_sum, ROUND(MIN(throughput_rate) OVER w1, 2) AS zone_running_min, ROUND(MAX(throughput_rate) OVER w1, 2) AS zone_running_max, ROUND(AVG(throughput_rate) OVER w2, 2) AS zone_moving_avg_5 FROM "query_agent_test" WHERE throughput_rate IS NOT NULL WINDOW w1 AS (PARTITION BY facility_zone ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), w2 AS (PARTITION BY facility_zone ORDER BY _timestamp ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) ORDER BY facility_zone ASC, _timestamp ASC'''),

    (149, "window", ["_timestamp", "control_center", "sorter_model", "throughput_rate", "rn_by_tput", "rn_by_load", "rn_by_charge"],
     "Three ROW_NUMBER windows with different ORDER BY, same PARTITION BY",
     '''SELECT _timestamp, control_center, sorter_model, throughput_rate, ROW_NUMBER() OVER (PARTITION BY control_center ORDER BY throughput_rate DESC) AS rn_by_tput, ROW_NUMBER() OVER (PARTITION BY control_center ORDER BY load_factor DESC) AS rn_by_load, ROW_NUMBER() OVER (PARTITION BY control_center ORDER BY charge_remaining ASC) AS rn_by_charge FROM "query_agent_test" WHERE throughput_rate IS NOT NULL AND load_factor IS NOT NULL AND charge_remaining IS NOT NULL ORDER BY control_center ASC, rn_by_tput ASC'''),

    (150, "window", ["_timestamp", "pallet_id", "facility_zone", "cell_temp", "rolling_avg_temp", "window_count"],
     "ROWS-based rolling window with 10 PRECEDING for temp rolling avg",
     '''SELECT _timestamp, pallet_id, facility_zone, cell_temp, ROUND(AVG(cell_temp) OVER (PARTITION BY facility_zone ORDER BY _timestamp ROWS BETWEEN 10 PRECEDING AND CURRENT ROW), 2) AS rolling_avg_temp, COUNT(*) OVER (PARTITION BY facility_zone ORDER BY _timestamp ROWS BETWEEN 10 PRECEDING AND CURRENT ROW) AS window_count FROM "query_agent_test" WHERE cell_temp IS NOT NULL ORDER BY facility_zone ASC, _timestamp ASC'''),

    (151, "window", ["_timestamp", "pallet_id", "operation_mode", "item_count", "forward_sum", "centered_avg_5"],
     "Forward-looking SUM + centered 5-row AVG",
     '''SELECT _timestamp, pallet_id, operation_mode, item_count, ROUND(SUM(item_count) OVER (PARTITION BY operation_mode ORDER BY _timestamp ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING), 1) AS forward_sum, ROUND(AVG(item_count) OVER (PARTITION BY operation_mode ORDER BY _timestamp ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING), 1) AS centered_avg_5 FROM "query_agent_test" WHERE item_count IS NOT NULL ORDER BY operation_mode ASC, _timestamp ASC'''),

    (152, "window", ["_timestamp", "facility_zone", "sorter_model", "throughput_rate", "load_factor", "relative_position", "load_deviation", "tput_normalized"],
     "Named window with 2-column PARTITION, relative_position + deviation + normalization",
     '''SELECT _timestamp, facility_zone, sorter_model, throughput_rate, load_factor, ROUND((ROW_NUMBER() OVER w)::FLOAT / NULLIF((COUNT(*) OVER w)::FLOAT, 0), 4) AS relative_position, ROUND(load_factor - AVG(load_factor) OVER w, 2) AS load_deviation, ROUND((throughput_rate - MIN(throughput_rate) OVER w) / NULLIF(MAX(throughput_rate) OVER w - MIN(throughput_rate) OVER w, 0), 4) AS tput_normalized FROM "query_agent_test" WHERE throughput_rate IS NOT NULL AND load_factor IS NOT NULL WINDOW w AS (PARTITION BY facility_zone, sorter_model) ORDER BY facility_zone ASC, sorter_model ASC, _timestamp ASC'''),

    (153, "window", ["_timestamp", "conveyor_lane", "cell_temp", "temp_diff", "lane_avg_temp"],
     "Window with LAG-based temperature change detection",
     '''SELECT _timestamp, conveyor_lane, cell_temp, ROUND(cell_temp - LAG(cell_temp, 1, 0) OVER (PARTITION BY conveyor_lane ORDER BY _timestamp), 2) AS temp_diff, ROUND(AVG(cell_temp) OVER (PARTITION BY conveyor_lane ORDER BY _timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS lane_avg_temp FROM "query_agent_test" WHERE cell_temp IS NOT NULL ORDER BY conveyor_lane ASC, _timestamp ASC'''),

    (154, "window", ["facility_zone", "sorter_model", "throughput_rate", "total_tput_zone", "total_tput_sort", "pct_of_zone", "pct_of_sorter"],
     "Double SUM-over-partition for hierarchical percentages",
     '''SELECT facility_zone, sorter_model, throughput_rate, SUM(throughput_rate) OVER (PARTITION BY facility_zone) AS total_tput_zone, SUM(throughput_rate) OVER (PARTITION BY sorter_model) AS total_tput_sort, ROUND(throughput_rate / NULLIF(SUM(throughput_rate) OVER (PARTITION BY facility_zone), 0) * 100.0, 2) AS pct_of_zone, ROUND(throughput_rate / NULLIF(SUM(throughput_rate) OVER (PARTITION BY sorter_model), 0) * 100.0, 2) AS pct_of_sorter FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY facility_zone ASC, throughput_rate DESC'''),

    (155, "window", ["_timestamp", "pallet_id", "operation_mode", "throughput_rate", "tput_avg_all", "tput_diff", "relative_rank"],
     "Unpartitioned window AVG + partitioned RANK comparison",
     '''SELECT _timestamp, pallet_id, operation_mode, throughput_rate, ROUND(AVG(throughput_rate) OVER (), 2) AS tput_avg_all, ROUND(throughput_rate - AVG(throughput_rate) OVER (), 2) AS tput_diff, RANK() OVER (PARTITION BY operation_mode ORDER BY throughput_rate DESC) AS relative_rank FROM "query_agent_test" WHERE throughput_rate IS NOT NULL ORDER BY operation_mode ASC, relative_rank ASC'''),
]


# ── Category → query list mapping ────────────────────────────────────────
CATEGORY_MAP = {
    "aggregation": AGGREGATION,
    "basic_select": BASIC_SELECT,
    "combined": COMBINED,
    "cte_subquery": CTE_SUBQUERY,
    "date_time": DATE_TIME,
    "full_text_search": FULL_TEXT_SEARCH,
    "histogram": HISTOGRAM,
    "math_functions": MATH_FUNCTIONS,
    "pagination": PAGINATION,
    "string_functions": STRING_FUNCTIONS,
    "union": UNION,
    "window": WINDOW,
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    for cat_name, queries in sorted(CATEGORY_MAP.items()):
        out_queries = []
        for qnum, category, columns, note, sql in queries:
            qid = f"Q{qnum:03d}"
            q = make_query(qid, qnum, sql.strip(), category, columns, note)
            out_queries.append(q)

        fp = OUT / f"{cat_name}.json"
        payload = {
            "queries": out_queries,
            "last_query_id": max(q[0] for q in queries),
        }
        with open(fp, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"Wrote {fp.name}: {len(out_queries)} queries (Q{queries[0][0]:03d}–Q{queries[-1][0]:03d})")

    total = sum(len(qs) for qs in CATEGORY_MAP.values())
    print(f"\nTotal: {total} queries across {len(CATEGORY_MAP)} categories")


if __name__ == "__main__":
    main()

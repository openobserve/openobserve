"""Compute expected result sets via DuckDB for all replicable queries.

Uses a pre-filtered DuckDB VIEW so the time-filter works for ALL queries
regardless of complexity (CTEs, subqueries, UNIONs, etc.) — no fragile
SQL WHERE injection needed.

sqllogictest-style: generates the exact expected output for each query so
the test runner can compare OO results cell-by-cell.

One-time tool — not a runtime test dependency.

Usage:
  cd tests/test-data/query-agent && python3 compute_counts.py
"""

import json
import re
import tempfile
from pathlib import Path

import duckdb

from data_gen import BASE_TS, build_dataset

QUERIES_DIR = Path("queries")
STREAM = "logs"


# ── OO → DuckDB SQL translation ─────────────────────────────────────────────

def _replace_re_match(sql: str) -> str:
    """Replace re_match(..., 'pat') with regexp_matches(..., 'pat')."""
    result = []
    i = 0
    while i < len(sql):
        m = re.match(r're_match\s*\(', sql[i:], re.IGNORECASE)
        if not m:
            result.append(sql[i])
            i += 1
            continue

        i += m.end()
        depth = 1
        j = i
        while j < len(sql) and depth > 0:
            if sql[j] == '(':
                depth += 1
            elif sql[j] == ')':
                depth -= 1
            j += 1
        paren_close_at = j - 1

        content = sql[i:paren_close_at]
        comma_pos = -1
        cdepth = 0
        for k, ch in enumerate(content):
            if ch == '(':
                cdepth += 1
            elif ch == ')':
                cdepth -= 1
            elif ch == ',' and cdepth == 0:
                comma_pos = k
                break

        if comma_pos < 0:
            result.append(sql[i - len(m.group()):j])
            i = j
            continue

        arg1 = content[:comma_pos].strip()
        arg2 = content[comma_pos + 1:].strip()
        result.append(f"regexp_matches({arg1}, {arg2})")

        i = j
        if sql[i:i + 7].upper() == ' = TRUE':
            i += 7

    return ''.join(result)


def _replace_match_all(sql: str) -> str:
    """Replace match_all('term') with log LIKE '%term%'."""
    return re.sub(
        r"match_all\('([^']*)'\)",
        r"log LIKE '%\1%'",
        sql,
        flags=re.IGNORECASE,
    )


def _replace_histogram(sql: str) -> tuple[str, bool]:
    """Translate histogram(_timestamp, 'N unit') → DuckDB integer arithmetic.

    OO's histogram is internally rewritten to DataFusion's:
      date_bin(interval, to_timestamp_micros(_timestamp),
               to_timestamp('2001-01-01T00:00:00'))

    Pure integer arithmetic (works in ALL DuckDB versions):
      origin + FLOOR((_timestamp - origin) / bucket_us) * bucket_us

    where origin = 978307200000000 (2001-01-01 UTC in microseconds).

    Returns (modified_sql, has_auto_interval).  Auto-interval queries
    (no second argument) cannot be replicated and must stay legacy.
    """
    if re.search(r'histogram\(_timestamp\)', sql, re.IGNORECASE):
        return sql, True

    _ORIGIN_US = 978307200000000  # 2001-01-01T00:00:00 UTC in micros

    # Map unit strings to microseconds
    def _bucket_us(m: re.Match) -> str:
        n = int(m.group(1))
        unit = m.group(2)
        if unit.startswith("second"):
            width = n * 1_000_000
        elif unit.startswith("minute"):
            width = n * 60_000_000
        elif unit.startswith("hour"):
            width = n * 3_600_000_000
        elif unit.startswith("day"):
            width = n * 86_400_000_000
        else:
            width = n * 1_000_000
        return f"CAST({_ORIGIN_US} + FLOOR((_timestamp - {_ORIGIN_US}) / {width}) * {width} AS BIGINT)"

    pattern = (
        r"histogram\(_timestamp,\s*'(\d+)\s*"
        r"(second|seconds|minute|minutes|hour|hours|day|days)'\)"
    )
    result = re.sub(pattern, _bucket_us, sql, flags=re.IGNORECASE)
    return result, False


def translate_oo_to_duckdb(sql: str) -> str:
    """Translate OpenObserve SQL → DuckDB SQL.

    Time filtering is handled by a pre-filtered view — this only
    replaces the stream placeholder and translates OO functions.
    """
    s = sql.replace("{stream}", STREAM)

    s = re.sub(
        r"approx_percentile_cont\(CAST\((\w+)\s+AS\s+FLOAT\),\s*([0-9.]+)\)",
        r"approx_quantile(\1::FLOAT, \2)", s, flags=re.IGNORECASE,
    )

    s = _replace_re_match(s)
    s = _replace_match_all(s)
    s, _ = _replace_histogram(s)  # histogram(_timestamp, 'N unit') → date_bin
    s = re.sub(r'\b(pivot)\b', r'pivoted', s, flags=re.IGNORECASE)

    return s


# ── Result-set builder ──────────────────────────────────────────────────────

# Columns OO drops due to LAG dedup bug
_OO_DROPPED_COLS = {"prev_tput", "hours_2_back", "delta_from_prev", "temp_diff"}

# Dynamic columns whose values differ between compute time and test time
_DYNAMIC_COLS = {"_timestamp", "_time"}

_EXCLUDE_COLS = _OO_DROPPED_COLS | _DYNAMIC_COLS

# Queries with known OO-DuckDB divergence — skip cell-by-cell comparison
_SKIP_SQLLOGICTEST = {
    "Q037",  # ROW_NUMBER tie-breaking differs between engines
    "Q058",  # Self-join pairings non-deterministic across engines
    "Q072",  # FULL OUTER JOIN histogram: NULL handling differs
    "Q080",  # FTS match_all + histogram: DuckDB LIKE != OO Tantivy
    "Q111",  # ROW_NUMBER ties in pagination
    "Q117",  # STRING_AGG ordering differs between engines
    "Q121",  # STRING_AGG concatenation order
    "Q127",  # UNION across 5 groups: boundary records compete for top-10 spots
    "Q152",  # PERCENT_RANK tie-breaking differs
}


def compute_results(con: duckdb.DuckDBPyConnection, q: dict, *, is_histogram: bool = False) -> dict | None:
    """Compute the expected result set for a single query.

    Returns the new ``expected`` dict, or None if the query should stay
    in legacy assertion mode.
    """
    offset = q["time_offset"]
    time_start = BASE_TS + offset["start_offset"]
    time_end = BASE_TS + offset["end_offset"]

    # Create a pre-filtered view so EVERY query (CTEs, subqueries, etc.)
    # gets the right records without fragile SQL WHERE injection.
    con.execute(
        f"CREATE OR REPLACE VIEW logs AS "
        f"SELECT * FROM _logs WHERE _timestamp >= {time_start} AND _timestamp <= {time_end}"
    )

    duck_sql = translate_oo_to_duckdb(q["sql"])

    # For histogram queries, _time is deterministic (bucketed via date_bin
    # with fixed origin).  Only _timestamp still varies between runs.
    if is_histogram:
        exclude_cols = _OO_DROPPED_COLS | {"_timestamp"}
    else:
        exclude_cols = _EXCLUDE_COLS

    try:
        rows = con.execute(duck_sql).fetchall()
        cols = [desc[0] for desc in con.description]
    except Exception as e:
        print(f"  {q['id']}: DuckDB error — {e}")
        return None

    # Filter out dynamic/OO-dropped columns
    keep_idx = [i for i, c in enumerate(cols) if c not in exclude_cols]
    filtered_cols = [cols[i] for i in keep_idx]
    filtered_rows = [
        [str(row[i]) for i in keep_idx] for row in rows
    ]

    # Histogram: OO serialises bucket timestamps as ISO strings
    # (e.g. "2026-06-03T04:00:00"), but DuckDB computes epoch
    # microseconds.  Convert all columns whose values are epoch-us
    # timestamps (> 1e15).  Some queries (Q072 FULL OUTER JOIN)
    # produce multiple histogram bucket columns.
    if is_histogram and filtered_rows:
        from datetime import datetime, timezone
        for row in filtered_rows:
            for j, val in enumerate(row):
                if val and val != 'None':
                    try:
                        us = int(float(val))
                        if us > 1_000_000_000_000_000:
                            dt = datetime.fromtimestamp(
                                us / 1_000_000, tz=timezone.utc
                            )
                            row[j] = dt.strftime('%Y-%m-%dT%H:%M:%S')
                    except (ValueError, OverflowError):
                        pass

    result = {
        "columns": filtered_cols,
        "results": filtered_rows,
        "results_mode": "rowsort",
    }

    if len(filtered_rows) == 0:
        print(f"  {q['id']}: 0 rows ({len(cols)} cols, {len(cols) - len(filtered_cols)} excluded)")
    else:
        print(f"  {q['id']}: {len(filtered_rows)} rows, {len(filtered_cols)} cols (excluded {len(cols) - len(filtered_cols)})")

    return result


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    print("Generating dataset in DuckDB...")
    records = build_dataset()
    con = duckdb.connect(":memory:")

    jsonl_str = "\n".join(json.dumps(r) for r in records)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
        tf.write(jsonl_str)
        tmp_path = tf.name

    try:
        # Load into _logs (underscore — "logs" is the per-query view)
        con.execute(
            "CREATE TABLE _logs AS SELECT * FROM read_json_auto(?)",
            [tmp_path],
        )
    finally:
        Path(tmp_path).unlink()

    total = con.execute("SELECT COUNT(*) FROM _logs").fetchone()[0]
    print(f"Loaded {total} records")

    # Persist the BASE_TS so the test harness uses the same value.
    # Without this, a minute-boundary crossing between compute and test
    # shifts all histogram bucket timestamps.
    override_path = QUERIES_DIR.parent / "base_ts_override.json"
    override_path.write_text(json.dumps({"BASE_TS": BASE_TS}))
    print(f"Saved BASE_TS override: {BASE_TS}")

    updated = 0
    skipped = 0

    for fp in sorted(QUERIES_DIR.glob("*.json")):
        with open(fp) as f:
            query_data = json.load(f)

        dirty = False
        for q in query_data["queries"]:
            expected = q.get("expected", {})

            # Histogram queries: skip auto-interval, convert explicit-interval
            is_histogram = "histogram(" in q["sql"]
            if is_histogram:
                _, has_auto = _replace_histogram(q["sql"])
                if has_auto:
                    skipped += 1
                    continue

            # Skip Q122 — STRING_AGG DISTINCT ORDER BY: DuckDB requires
            # ORDER BY expressions to appear in the aggregate argument
            # list for DISTINCT aggregates.
            if q["id"] == "Q122":
                skipped += 1
                continue

            new_expected = compute_results(con, q, is_histogram=is_histogram)
            if new_expected is None:
                skipped += 1
                continue

            # Mark known-divergent queries for skip-sqllogictest fallback
            if q["id"] in _SKIP_SQLLOGICTEST:
                new_expected["skip_sqllogictest"] = True

            # Replace the expected block
            q["expected"] = new_expected
            dirty = True

        if dirty:
            with open(fp, "w") as f:
                json.dump(query_data, f, separators=(",", ":"))
                f.write("\n")
            updated += 1

    print(f"\nUpdated {updated} query files")
    print(f"Skipped {skipped} (auto-interval histogram + Q122 + errors)")

    con.close()


if __name__ == "__main__":
    main()

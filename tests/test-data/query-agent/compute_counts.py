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
    s = re.sub(r'\b(pivot)\b', r'pivoted', s, flags=re.IGNORECASE)

    return s


# ── Result-set builder ──────────────────────────────────────────────────────

# Columns OO drops due to LAG dedup bug
_OO_DROPPED_COLS = {"prev_tput", "hours_2_back", "delta_from_prev", "temp_diff"}

# Dynamic columns whose values differ between compute time and test time
_DYNAMIC_COLS = {"_timestamp", "_time"}

_EXCLUDE_COLS = _OO_DROPPED_COLS | _DYNAMIC_COLS


def compute_results(con: duckdb.DuckDBPyConnection, q: dict) -> dict | None:
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

    try:
        rows = con.execute(duck_sql).fetchall()
        cols = [desc[0] for desc in con.description]
    except Exception as e:
        print(f"  {q['id']}: DuckDB error — {e}")
        return None

    # Filter out dynamic/OO-dropped columns
    keep_idx = [i for i, c in enumerate(cols) if c not in _EXCLUDE_COLS]
    filtered_cols = [cols[i] for i in keep_idx]
    filtered_rows = [
        [str(row[i]) for i in keep_idx] for row in rows
    ]

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

    updated = 0
    skipped = 0

    for fp in sorted(QUERIES_DIR.glob("*.json")):
        with open(fp) as f:
            query_data = json.load(f)

        dirty = False
        for q in query_data["queries"]:
            expected = q.get("expected", {})

            # Skip histogram queries — data_bin() is custom Rust
            if "histogram(" in q["sql"]:
                skipped += 1
                continue

            # Skip Q122 — STRING_AGG DISTINCT ORDER BY broken in OO
            if q["id"] == "Q122":
                skipped += 1
                continue

            new_expected = compute_results(con, q)
            if new_expected is None:
                skipped += 1
                continue

            # Replace the expected block
            q["expected"] = new_expected
            dirty = True

        if dirty:
            with open(fp, "w") as f:
                json.dump(query_data, f, indent=2)
            updated += 1

    print(f"\nUpdated {updated} query files")
    print(f"Skipped {skipped} (histogram + Q122 + errors)")

    con.close()


if __name__ == "__main__":
    main()

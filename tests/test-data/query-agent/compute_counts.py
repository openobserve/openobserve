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

QUERIES_DIR = Path(__file__).parent / "queries"
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
    """Replace match_all('term') with DuckDB LIKE conditions.

    Tantivy tokenizes the term and matches each token independently
    across all indexed text fields.  We emulate this with per-word LIKE
    conditions on the log field (the primary FTS field in test data).

    Single word:  match_all('warehouse') → log LIKE '%warehouse%'
    Multi-word:   match_all('ACK batch') → (log LIKE '%ACK%' AND log LIKE '%batch%')

    Note: This is an approximation — Tantivy's actual tokenization may
    differ from whitespace splitting (stemming, stop words, case folding).
    The per-token content assertion in the test runner provides a
    correctness backstop that is independent of this oracle.
    """
    def _escape_like(s: str) -> str:
        # Escape LIKE wildcards and single quotes to prevent unintended
        # matches and SQL syntax breaks.  Not a parameterized query, but
        # this is test infrastructure against a local in-memory DuckDB.
        return s.replace("'", "''").replace("%", "\\%").replace("_", "\\_")

    def _build_like(m: re.Match) -> str:
        term = m.group(1)
        words = [_escape_like(w) for w in term.split()]
        if len(words) == 1:
            return f"log LIKE '%{words[0]}%'"
        clauses = " AND ".join(f"log LIKE '%{w}%'" for w in words)
        return f"({clauses})"

    return re.sub(
        r"match_all\('([^']*)'\)",
        _build_like,
        sql,
        flags=re.IGNORECASE,
    )


def _replace_str_match_ignore_case(sql: str) -> str:
    """Replace str_match_ignore_case(field, 'pat') with lower(field) LIKE '%pat%'."""
    return re.sub(
        r"str_match_ignore_case\((\w+),\s*'([^']*)'\)",
        lambda m: f"lower({m.group(1)}) LIKE '%{m.group(2).lower()}%'",
        sql,
        flags=re.IGNORECASE,
    )


def _replace_regexp_like(sql: str) -> str:
    """Replace regexp_like(field, 'pat'[, 'flags']) with regexp_matches(field, 'pat'[, 'flags'])."""
    # Handle optional third argument (flags)
    return re.sub(
        r"regexp_like\s*\(\s*(\w+)\s*,\s*('(?:[^'\\]|\\.)*')\s*(?:,\s*('[^']*')\s*)?\)",
        lambda m: f"regexp_matches({m.group(1)}, {m.group(2)}"
                  + (f", {m.group(3)}" if m.group(3) else "") + ")",
        sql,
        flags=re.IGNORECASE,
    )


def _replace_approx_distinct(sql: str) -> str:
    """Replace approx_distinct(field) with approx_count_distinct(field)."""
    return re.sub(
        r"approx_distinct\s*\(\s*([^)]+)\s*\)",
        r"approx_count_distinct(\1)",
        sql,
        flags=re.IGNORECASE,
    )


def _replace_json_get_str_chained(sql: str) -> str:
    """Replace OO json_get_str/json_get_json with DuckDB json_extract_string.

    json_get_str(json_get_json(field, 'k1'), 'k2') → json_extract_string(field, '$.k1.k2')
    json_get_str(field, 'key') → json_extract_string(field, '$.key')
    json_get_json(field, 'key') → json_extract(field, '$.key')
    """
    # Chain: json_get_str(json_get_json(field, 'k1'), 'k2') -> json_extract_string(field, '$.k1.k2')
    pattern = r"json_get_str\(json_get_json\((\w+),\s*'([^']+)'\),\s*'([^']+)'\)"
    while re.search(pattern, sql, re.IGNORECASE):
        sql = re.sub(pattern, r"json_extract_string(\1, '$.\2.\3')", sql, flags=re.IGNORECASE)

    # Single json_get_str(field, 'key') -> json_extract_string(field, '$.key')
    sql = re.sub(
        r"json_get_str\((\w+),\s*'([^']+)'\)",
        r"json_extract_string(\1, '$.\2')",
        sql,
        flags=re.IGNORECASE,
    )

    # Single json_get_json(field, 'key') -> json_extract(field, '$.key')
    sql = re.sub(
        r"json_get_json\((\w+),\s*'([^']+)'\)",
        r"json_extract(\1, '$.\2')",
        sql,
        flags=re.IGNORECASE,
    )

    return sql


def _has_oo_specific_functions(sql: str) -> bool:
    """Check if SQL uses OO-specific array functions that DuckDB cannot replicate."""
    oo_patterns = [
        r'\bcast_to_arr\s*\(', r'\barray_has\s*\(',
        r'\bspath\s*\(', r'\bunnest\s*\(',
        r'\bflatten\s*\(', r'\barray_element\s*\(',
    ]
    return any(re.search(p, sql, re.IGNORECASE) for p in oo_patterns)


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


def translate_oo_to_duckdb(sql: str) -> tuple[str, bool]:
    """Translate OpenObserve SQL → DuckDB SQL.

    Time filtering is handled by a pre-filtered view — this only
    replaces the stream placeholder and translates OO functions.

    Returns (translated_sql, has_oo_specific_functions).
    """
    s = sql.replace("{stream}", STREAM).replace("{stream2}", "logs2")
    # NOTE: "{stream2}" → "logs2" (DuckDB view name), while conftest.py
    # replaces the same placeholder with STREAM2 (the actual OO stream
    # name).  Both are correct — each runs in its own execution context.

    # Check for OO-specific functions before translation
    has_oo = _has_oo_specific_functions(s)

    s = re.sub(
        r"approx_percentile_cont\(CAST\((\w+)\s+AS\s+FLOAT\),\s*([0-9.]+)\)",
        r"approx_quantile(\1::FLOAT, \2)", s, flags=re.IGNORECASE,
    )

    # regexp_match(field, 'pat') in OO returns array of capture groups.
    # array_extract(regexp_match(field, 'pat'), N) → regexp_extract(field, 'pat', N)
    s = re.sub(
        r"array_extract\(\s*regexp_match\(\s*(\w+)\s*,\s*('(?:[^'\\]|\\.)*')\s*\)\s*,\s*(\d+)\s*\)",
        r"regexp_extract(\1, \2, \3)",
        s,
        flags=re.IGNORECASE,
    )
    # Any remaining bare regexp_match → regexp_matches
    s = re.sub(r"\bregexp_match\s*\(", "regexp_matches(", s, flags=re.IGNORECASE)

    s = _replace_re_match(s)
    s = _replace_match_all(s)

    # re_not_match: replace with NOT regexp_matches before _replace_re_match runs
    s = re.sub(
        r"re_not_match\s*\(", "NOT regexp_matches(", s, flags=re.IGNORECASE
    )
    s, _ = _replace_histogram(s)  # histogram(_timestamp, 'N unit') → date_bin
    s = re.sub(r'\b(pivot)\b', r'pivoted', s, flags=re.IGNORECASE)
    s = _replace_str_match_ignore_case(s)
    s = _replace_regexp_like(s)
    s = _replace_approx_distinct(s)
    s = _replace_json_get_str_chained(s)

    return s, has_oo


# ── Result-set builder ──────────────────────────────────────────────────────

# Columns OO drops due to LAG dedup bug
_OO_DROPPED_COLS = {"prev_tput", "hours_2_back", "delta_from_prev", "temp_diff"}

# Dynamic columns whose values differ between compute time and test time
_DYNAMIC_COLS = {"_timestamp", "_time"}

_EXCLUDE_COLS = _OO_DROPPED_COLS | _DYNAMIC_COLS

# Queries with known OO-DuckDB divergence — skip cell-by-cell comparison
_SKIP_SQLLOGICTEST = {
    "Q016",  # ROW_NUMBER tie-breaking with 5 records/query
    "Q037",  # ROW_NUMBER tie-breaking differs between engines
    "Q052",  # ROW_NUMBER tie-breaking with 5 records/query
    "Q058",  # Self-join pairings non-deterministic across engines
    "Q072",  # FULL OUTER JOIN histogram: NULL handling differs
    "Q080",  # FTS match_all + histogram: DuckDB LIKE != OO Tantivy
    "Q104",  # ORDER BY + LIMIT + OFFSET tie with 5 records/query
    "Q111",  # ROW_NUMBER ties in pagination
    "Q117",  # STRING_AGG ordering differs between engines
    "Q121",  # STRING_AGG concatenation order
    "Q219",  # STRING_AGG DISTINCT without ORDER BY — ordering non-deterministic
    "Q127",  # UNION across 5 groups: boundary records compete for top-10 spots
    "Q141",  # NTILE quartile mismatch with 5 records/query
    "Q146",  # NTILE quartile mismatch with 5 records/query
    "Q152",  # PERCENT_RANK tie-breaking differs
    "Q156",  # Multi-CTE with LEFT JOIN self-reference — join pairings non-deterministic
    "Q158",  # UNION ALL with regexp_match — DuckDB RE2 doesn't handle OO regexp_match well
    "Q160",  # regexp_match with named capture groups — DuckDB RE2 doesn't support (?<name>...) syntax
    "Q161",  # spath/unnest/flatten/cast_to_arr — OO-specific array functions
    "Q162",  # rtrim/ltrim/spath/array_element/cast_to_arr — OO-specific array functions
    "Q192",  # approx_percentile_cont mismatch with 5 records/query
    "Q301",  # Hour bucket row count mismatch with 5 records/query
    "Q305",  # Hour bucket row count mismatch with 5 records/query
    "Q453",  # Hour bucket integer division mismatch (DataFusion vs DuckDB)
    "Q454",  # Minute bucket integer division mismatch (DataFusion vs DuckDB)
    "Q308",  # SELECT * — OO omits NULL-valued columns from JSON
    "Q320",  # SELECT * — OO omits NULL-valued columns from JSON
    "Q145",  # ROW_NUMBER tie-breaking with 5 records/query (window)
    "Q395",  # LAG window row count mismatch with 5 records/query
    "Q398",  # FIRST_VALUE/LAST_VALUE ROWS BETWEEN row count mismatch with 5 records
}

# Queries that use array_has/cast_to_arr — auto-marked as skip_sqllogictest
# since DuckDB cannot replicate OO's array semantics
_HAS_ARRAY_HAS = set()

# Queries where OO returns fewer columns than DuckDB (e.g. ENT FULL OUTER JOIN
# column aliasing). Skip the per-column existence check in legacy mode so the
# test only validates row-count and ORDER BY, not column presence.
_SKIP_COLUMN_CHECK = {"Q072", "Q308", "Q312", "Q313", "Q318", "Q320", "Q323", "Q395", "Q548"}


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
    # Views are recreated per query because each query has its own
    # time_offset — this is intentional, not overhead.
    con.execute(
        f"CREATE OR REPLACE VIEW logs AS "
        f"SELECT * FROM _logs WHERE _timestamp >= {time_start} AND _timestamp <= {time_end}"
    )
    # Cross-stream: second stream view uses the same time window because
    # both streams share identical timestamp ranges — only field values
    # differ (via stream_offset=7).  A single time_offset covers both.
    con.execute(
        f"CREATE OR REPLACE VIEW logs2 AS "
        f"SELECT * FROM _logs2 WHERE _timestamp >= {time_start} AND _timestamp <= {time_end}"
    )

    duck_sql, has_oo = translate_oo_to_duckdb(q["sql"])

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

    # Detect empty-aggregate results: DuckDB returns 1 row of NULLs for
    # aggregate queries with zero matching rows, but OO returns 0 rows.
    # OO also drops NULL-valued columns from JSON hits, so column presence
    # and row count are unreliable — skip both.
    if filtered_rows and all(
        all(v == 'None' for v in row) for row in filtered_rows
    ):
        result = {
            "skip_sqllogictest": True,
            "skip_row_count": True,
            "skip_column_check": True,
            "columns": filtered_cols,
        }
        print(f"  {q['id']}: empty-aggregate → skip_sqllogictest")
        return result

    if len(filtered_rows) == 0:
        print(f"  {q['id']}: 0 rows ({len(cols)} cols, {len(cols) - len(filtered_cols)} excluded)")
    else:
        print(f"  {q['id']}: {len(filtered_rows)} rows, {len(filtered_cols)} cols (excluded {len(cols) - len(filtered_cols)})")

    return result


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    print("Generating dataset in DuckDB...")
    records1 = build_dataset()
    records2 = build_dataset(stream_offset=7)
    con = duckdb.connect(":memory:")

    for label, records in [("_logs", records1), ("_logs2", records2)]:
        jsonl_str = "\n".join(json.dumps(r) for r in records)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
            tf.write(jsonl_str)
            tmp_path = tf.name

        try:
            con.execute(
                f"CREATE TABLE {label} AS SELECT * FROM read_json_auto(?)",
                [tmp_path],
            )
        finally:
            Path(tmp_path).unlink()

        count = con.execute(f"SELECT COUNT(*) FROM {label}").fetchone()[0]
        print(f"Loaded {label}: {count} records")

    total = con.execute("SELECT COUNT(*) FROM _logs").fetchone()[0]

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

        queries = query_data.get("queries")
        if queries is None:
            print(f"  (skipping {fp.name}: no 'queries' key)")
            continue
        dirty = False
        for q in queries:
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

            # Preserve manually-set metadata from the old expected block
            # (compute_results only returns columns+results+results_mode)
            old_expected = q.get("expected", {})

            new_expected = compute_results(con, q, is_histogram=is_histogram)
            if new_expected is None:
                skipped += 1
                continue

            # Merge preserved keys from old expected into new expected
            _PRESERVE_KEYS = ("skip_sqllogictest", "skip_row_count",
                              "skip_column_check",
                              "skip_without_single_node_opt",
                              "note", "assertions", "row_count")
            for key in _PRESERVE_KEYS:
                if key in old_expected:
                    new_expected[key] = old_expected[key]

            # Auto-mark OO-specific array function queries for skip_sqllogictest
            # (only if not already manually set)
            if "skip_sqllogictest" not in new_expected:
                _, has_oo = translate_oo_to_duckdb(q["sql"])
                if has_oo:
                    new_expected["skip_sqllogictest"] = True
                    if q["id"] not in _SKIP_SQLLOGICTEST:
                        _SKIP_SQLLOGICTEST.add(q["id"])

            # Mark known-divergent queries for skip-sqllogictest fallback
            if q["id"] in _SKIP_SQLLOGICTEST and "skip_sqllogictest" not in new_expected:
                new_expected["skip_sqllogictest"] = True

            # Skip per-column existence check for queries where OO returns
            # fewer columns than DuckDB (e.g. FULL OUTER JOIN aliasing in ENT)
            if q["id"] in _SKIP_COLUMN_CHECK:
                new_expected["skip_column_check"] = True

            # Replace the expected block
            q["expected"] = new_expected
            dirty = True

        if dirty:
            with open(fp, "w") as f:
                json.dump(query_data, f, indent=2)
                f.write("\n")
            updated += 1

    print(f"\nUpdated {updated} query files")
    print(f"Skipped {skipped} (auto-interval histogram + Q122 + errors)")

    con.close()


if __name__ == "__main__":
    main()

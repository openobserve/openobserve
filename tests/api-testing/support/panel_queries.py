"""Discovery and execution helpers for dashboard-panel query tests.

The query corpus lives in `tests/test-data/query-agent/queries/*.json` and is
owned by the query-agent suite, which verifies it through the Logs search path.
This module lets the dashboard tests reuse the exact same corpus — same SQL,
same time windows, same DuckDB-computed expectations — through the *dashboard*
panel path instead, so the two suites cannot drift apart.

Queries are discovered by shape rather than listed by ID. A hand-maintained list
of 70-odd IDs goes stale the moment someone adds a query; classifying the SQL
means new CTE combinations are picked up on their own.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path
from typing import Any

log = logging.getLogger("o2-api.panel-queries")

# support/ -> api-testing/ -> tests/
QUERY_AGENT_DIR = Path(__file__).resolve().parents[2] / "test-data" / "query-agent"
QUERIES_DIR = QUERY_AGENT_DIR / "queries"

# The corpus generator lives next to the queries it generates data for. Re-exported
# here so test modules have a single import site for both halves of the corpus.
sys.path.insert(0, str(QUERY_AGENT_DIR))
from data_gen import BASE_TS, build_dataset  # noqa: E402

__all__ = [
    "BASE_TS",
    "QUERIES_DIR",
    "QUERY_AGENT_DIR",
    "add_panel",
    "build_dataset",
    "classify",
    "discover_nested_match_all",
    "drop_panel",
    "expected_non_null_columns",
    "load_queries",
    "panel_axes",
    "panel_type_for",
    "query_window",
    "render_sql",
    "result_set_mismatch",
    "row_count_is_comparable",
    "values_equal",
    "write_with_fresh_hash",
]

# A CTE head is `WITH x AS (` or a continuation `, y AS (`; a derived table is a
# parenthesised SELECT in FROM position. Either one puts the match_all inside a
# nested query block, which is the case this module exists to cover.
_CTE_RE = re.compile(r"(?:WITH|,)\s+\w+\s+AS\s*\(", re.IGNORECASE)
_DERIVED_RE = re.compile(r"FROM\s*\(\s*SELECT", re.IGNORECASE)


def write_with_fresh_hash(client, dashboard_id: str, op, attempts: int = 3):
    """Run a panel write with a freshly read hash, retrying if it goes stale.

    Returns `(response, hash_used)`.

    Every panel write consumes the dashboard's hash and mints a new one. When a
    module drives many writes against one shared dashboard, the GET that reads
    the hash can occasionally return a version the store has already moved past,
    and the write comes back 409 through no fault of the test. Retrying with a
    re-read hash makes setup writes deterministic.

    This is only for writes that are *supposed* to succeed. Tests asserting
    conflict behaviour must call the endpoint directly, or the retry would paper
    over the very thing they check.
    """
    resp = None
    hash_used = ""
    for attempt in range(attempts):
        hash_used = client.dashboards.hash(dashboard_id)
        resp = op(hash_used)
        if resp.status_code != 409:
            return resp, hash_used
        log.warning(
            "panel write on %s hit a stale hash (attempt %d/%d)",
            dashboard_id,
            attempt + 1,
            attempts,
        )
    return resp, hash_used


def add_panel(client, dashboard_id: str, panel: dict) -> dict:
    """Add a panel and return the response body, retrying past stale hashes."""
    resp, _ = write_with_fresh_hash(
        client, dashboard_id, lambda h: client.dashboards.add_panel(dashboard_id, panel, hash=h)
    )
    assert resp.status_code == 200, f"AddPanel failed: {resp.status_code} {resp.text}"
    return resp.json()


def drop_panel(client, dashboard_id: str, panel_id: str) -> None:
    """Best-effort panel removal, for tests that add a panel mid-assertion."""
    try:
        write_with_fresh_hash(
            client,
            dashboard_id,
            lambda h: client.dashboards.delete_panel(dashboard_id, panel_id, hash=h),
        )
    except Exception as e:
        log.warning("panel cleanup failed for %s: %s", panel_id, e)


def load_queries(category: str) -> list[dict[str, Any]]:
    """Every query in one `queries/<category>.json` file, or [] if absent.

    Absent is normal, not an error: a branch that predates a query-set PR simply
    has fewer categories, and callers skip rather than fail.
    """
    path = QUERIES_DIR / f"{category}.json"
    if not path.exists():
        log.warning("query catalog %s not found", path)
        return []
    with open(path) as f:
        return json.load(f).get("queries", [])


def classify(sql: str) -> str | None:
    """Compact family label for a nested-query shape, or None if it isn't one.

    The label is what makes a parametrised failure legible — `Q1022-cte1_union_cdist_4ma`
    says which combination broke without opening the catalog.
    """
    nested = len(_CTE_RE.findall(sql))
    derived = bool(_DERIVED_RE.search(sql))
    if not nested and not derived:
        return None

    upper = sql.upper()
    tags = []
    if nested:
        tags.append(f"cte{nested}")
    if derived:
        tags.append("derived")
    if "UNION ALL" in upper:
        tags.append("union")
    if " JOIN " in upper:
        tags.append("join")
    if "{stream2}" in sql:
        tags.append("xstream")
    if "OVER (" in upper or "OVER(" in upper:
        tags.append("window")
    if "NOT MATCH_ALL" in upper:
        tags.append("not")
    if "HISTOGRAM(" in upper:
        tags.append("hist")
    if "COUNT(DISTINCT" in upper:
        tags.append("cdist")
    if "CASE WHEN" in upper:
        tags.append("case")
    if "HAVING" in upper:
        tags.append("having")
    tags.append(f"{len(re.findall('match_all', sql))}ma")
    return "_".join(tags)


def discover_nested_match_all(categories: tuple[str, ...]) -> list[tuple[str, str, dict]]:
    """(query_id, family, query) for every match_all query inside a CTE or subquery.

    Sorted by ID so parametrised runs are reproducible.
    """
    found: list[tuple[str, str, dict]] = []
    for category in categories:
        for query in load_queries(category):
            sql = query.get("sql", "")
            if "match_all" not in sql:
                continue
            family = classify(sql)
            if family is None:
                continue
            if "results" not in query.get("expected", {}):
                # No oracle result set — nothing meaningful to assert against.
                continue
            found.append((query["id"], family, query))
    return sorted(found, key=lambda t: t[0])


def panel_type_for(family: str, query: dict) -> str:
    """Pick a plausible chart type so the panel resembles something a user builds."""
    if "hist" in family:
        return "line"
    if len(query["expected"]["columns"]) == 1 or "window" in family or "join" in family:
        return "table"
    return "bar"


def render_sql(query: dict, stream: str, stream2: str) -> str:
    """Substitute the corpus stream placeholders with real stream names."""
    return query["sql"].replace("{stream}", stream).replace("{stream2}", stream2)


def query_window(query: dict, base_ts: int) -> tuple[int, int]:
    """Absolute search window, from the query's BASE_TS-relative offsets."""
    off = query["time_offset"]
    return base_ts + off["start_offset"], base_ts + off["end_offset"]


def panel_axes(query: dict) -> tuple[str, str]:
    """(x_alias, y_alias) taken from the oracle's own column list.

    Derived rather than hand-written so a panel can never disagree with the query
    it carries. Single-column queries reuse the one column for both axes.
    """
    cols = query["expected"]["columns"]
    return cols[0], cols[1] if len(cols) > 1 else cols[0]


def expected_non_null_columns(query: dict) -> list[str]:
    """Columns the oracle shows holding a real value in at least one row.

    OpenObserve omits NULL-valued keys from a hit rather than emitting them as
    null, so a column can legitimately be absent from some rows — or from every
    row, if the query's correct answer is NULL throughout. Asserting on the raw
    column list therefore produces false "dropped projection" failures; the
    query-agent comparator sidesteps this by reading cells with `.get(col, "")`.

    Restricting the projection assertion to columns the oracle proves are
    non-NULL somewhere keeps the check meaningful: a genuinely dropped
    projection makes the column vanish from every row, which this still catches.

    DuckDB renders NULL as "None" and OpenObserve as "", so both count as empty.
    """
    columns = query["expected"]["columns"]
    results = query["expected"]["results"]
    return [
        col
        for i, col in enumerate(columns)
        if any(str(row[i]) not in ("", "None") for row in results)
    ]


def values_equal(a: str, b: str, rel_tol: float = 0.05) -> bool:
    """Compare two result cells the way the query-agent comparator does.

    Cross-engine float aggregates (AVG, STDDEV) differ in their least-significant
    digits because summation order differs, so numerics compare within a relative
    tolerance while strings, integers and timestamps compare exactly.

    NULL renders as "" from OpenObserve and "None" from DuckDB; both mean empty.
    """
    if a == b:
        return True
    if (a == "" and b == "None") or (a == "None" and b == ""):
        return True
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return False
    return abs(fa - fb) / max(abs(fa), abs(fb), 1.0) < rel_tol


def result_set_mismatch(hits: list[dict], query: dict, rel_tol: float = 0.05) -> str | None:
    """First disagreement between live hits and the oracle, or None if they agree.

    Both sides are sorted before comparison, matching the query-agent comparator:
    the corpus pins the result *multiset*, not row order, so a query whose ORDER BY
    ties arbitrarily does not fail spuriously.

    Returns a message rather than raising, so the caller owns the assertion and can
    add its own context.
    """
    columns = query["expected"]["columns"]
    got = sorted([str(hit.get(col, "")) for col in columns] for hit in hits)
    want = sorted([str(cell) for cell in row] for row in query["expected"]["results"])

    if len(got) != len(want):
        return f"row count {len(got)} != oracle {len(want)}"

    for i, (got_row, want_row) in enumerate(zip(got, want, strict=True)):
        # Checked explicitly rather than left to zip: a short oracle row would
        # otherwise truncate the comparison and hide a real mismatch.
        if len(got_row) != len(want_row):
            return (
                f"row {i} has {len(got_row)} columns, oracle row has {len(want_row)}"
            )
        for j, (got_cell, want_cell) in enumerate(zip(got_row, want_row, strict=True)):
            if not values_equal(got_cell, want_cell, rel_tol):
                return (
                    f"row {i} column {j} ('{columns[j]}'): "
                    f"got {got_cell!r}, oracle {want_cell!r}"
                )
    return None


def row_count_is_comparable(query_id: str, query: dict) -> bool:
    """Whether the oracle's row count can be asserted against a live run.

    Histogram queries bucket against a BASE_TS that moves between the oracle run
    and this one, and anything carrying `skip_sqllogictest` has results the
    query-agent suite itself does not treat as authoritative.
    """
    expected = query["expected"]
    if expected.get("skip_sqllogictest"):
        return False
    return "histogram(" not in query["sql"].lower()

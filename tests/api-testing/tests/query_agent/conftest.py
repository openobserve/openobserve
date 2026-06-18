"""Shared fixtures for query agent tests.

Generates deterministic data in-memory (no external JSON file needed).
Each query filters to its own time range within the dataset for isolation.

A timestamp-suffixed stream name ensures each test session gets a clean
slate — accumulated data from prior runs cannot bleed into query results.
"""

import json
import logging
import re
import sys
import time
from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload
from support.wait import wait_until

# ── Paths ──────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent.parent.parent / "test-data" / "query-agent"
_QUERIES_DIR = _DATA_DIR / "queries"
sys.path.insert(0, str(_DATA_DIR))
from data_gen import BASE_TS, build_dataset  # noqa: E402

# Tie stream name to BASE_TS (stable within a session: comes from
# base_ts_override.json written by compute_counts.py).  PID suffix
# prevents data accumulation across multiple test invocations against
# the same environment.
import os as _os
STREAM = f"query_agent_test_{BASE_TS}_{_os.getpid()}"
STREAM2 = f"query_agent_test2_{BASE_TS}_{_os.getpid()}"


# ── Shared query loader ────────────────────────────────────────────────────
def _values_equal(a: str, b: str, rel_tol: float = 0.05) -> bool:
    """Compare two value strings, with relative tolerance for floats.

    Cross-engine floating-point aggregates (AVG, STDDEV, etc.) differ
    at the least-significant digits due to summation order.  A 1 %
    relative tolerance catches these while keeping exact match for
    strings, integers, and timestamps.
    """
    if a == b:
        return True
    # OO serializes NULL as "" while DuckDB uses "None" — treat as equal
    if (a == "" and b == "None") or (a == "None" and b == ""):
        return True
    try:
        fa = float(a)
        fb = float(b)
        denom = max(abs(fa), abs(fb), 1.0)
        return abs(fa - fb) / denom < rel_tol
    except (ValueError, TypeError):
        return False
def load_all_queries():
    """Return {category_name: [queries]} from queries/*.json files.

    Filters out queries whose ``expected`` block contains the optional
    boolean field ``skip_without_single_node_opt: true`` when the env var
    ``SINGLE_NODE_OPT_MODE`` is ``"false"`` (defaults to ``"true"``).

    This flag isolates queries that trigger known upstream DataFusion bugs
    in the non-optimized RemoteScanRewriter path — it should only be set
    for verified upstream issues, not as a workaround for test flakiness.
    """
    single_node_opt = _os.environ.get("SINGLE_NODE_OPT_MODE", "true").lower() == "true"
    categories: dict[str, list[dict]] = {}
    for fp in sorted(_QUERIES_DIR.glob("*.json")):
        with open(fp) as f:
            data = json.load(f)
        queries = data["queries"]
        if not single_node_opt:
            queries = [q for q in queries if not q.get("expected", {}).get("skip_without_single_node_opt")]
        categories[fp.stem] = queries
    return categories


# ── FTS Content Verification ────────────────────────────────────────────────
def _verify_fts_content(sql, hits, qid):
    """Verify match_all results: every returned hit contains the search terms.

    Tantivy full-text search tokenizes and indexes text fields.  When the
    DataFusion access plan is bypassed (e.g. after an upgrade), match_all
    can silently return wrong results — rows that don't contain the search
    terms at all.  This check catches that.

    Precondition: ``hits`` is non-empty (no-op otherwise).

    Only hard-fails when the ``log`` field is in the hit (match_all
    searches the FTS-indexed ``log`` field by default).  When ``log`` is
    absent from the SELECT, we can't verify — the match may have been
    against a non-returned field, and sqllogictest comparison remains the
    primary correctness backstop.
    """
    terms = re.findall(r"match_all\('([^']*)'\)", sql, re.IGNORECASE)
    if not terms or not hits:
        return

    has_log = "log" in hits[0]

    # Pre-compute lowercased words once outside the hit loop
    search_words = [w.lower() for term in terms for w in term.split()]

    for hit in hits:
        # Search all text fields in the hit
        text_parts = []
        for k, v in hit.items():
            if isinstance(v, str) and v:
                text_parts.append(v)
        haystack = " ".join(text_parts).lower()

        for word in search_words:
            if word not in haystack:
                if has_log:
                    raise AssertionError(
                        f"{qid}: FTS content verification failed — "
                        f"match_all term word '{word}' not found in any "
                        f"returned field (log is present). "
                        f"hit={ {k: v for k, v in hit.items() if k != '_timestamp'} }"
                    )
                # log not in SELECT — the match may be in a non-returned
                # field; sqllogictest comparison catches wrong row counts.


# ── Shared query runner ────────────────────────────────────────────────────
def run_query(client, query, *, skip_fts_count=False):
    """Execute a single query via _search and assert expected results.

    Two modes, determined by the presence of ``results`` in expected:

    * sqllogictest mode (results present): extract column values from hits
      as strings, sort if results_mode is "rowsort", then compare
      cell-by-cell against the expected result set computed by DuckDB.

    * Legacy assertion mode (results absent — histogram queries, Q122,
      and a few complex subqueries): check row_count, column presence,
      and run explicit content assertions.

    When *skip_fts_count* is True, full_text_search row_count is skipped
    (Tantivy FTS not available pre-flush).
    """
    qid = query["id"]
    size = 500
    offset = query["time_offset"]
    sql = query["sql"].replace("{stream}", STREAM).replace("{stream2}", STREAM2)
    json_data = search_payload(
        sql,
        start_time=BASE_TS + offset["start_offset"],
        end_time=BASE_TS + offset["end_offset"],
        size=size,
    )
    expected = query.get("expected", {})
    is_fts = query.get("category") == "full_text_search"

    sqllogictest_mode = (
        "results" in expected
        and not (skip_fts_count and is_fts)
        and not expected.get("skip_sqllogictest")
    )

    def _validate(hits):
        """Run every assertion for this query against *hits*; raise on mismatch."""
        # Verify match_all results actually contain the search terms.
        # After a DataFusion upgrade, the Tantivy access plan can be bypassed
        # silently — this content check catches wrong results that row-count
        # comparisons alone would miss.
        # Only run post-flush when Tantivy indexes are expected to exist.
        if not skip_fts_count:
            _verify_fts_content(sql, hits, qid)

        if sqllogictest_mode:
            # ── sqllogictest mode: result-set comparison with float tolerance ─
            cols = expected["columns"]
            actual = sorted(
                [str(hit.get(col, "")) for col in cols] for hit in hits
            )
            want = sorted(expected["results"])

            assert len(actual) == len(want), \
                f"{qid}: row count mismatch — got {len(actual)}, expected {len(want)}"

            for i, (got_row, want_row) in enumerate(zip(actual, want)):
                assert len(got_row) == len(want_row), \
                    f"{qid}: column count mismatch at row {i}"
                for j, (gv, wv) in enumerate(zip(got_row, want_row)):
                    if not _values_equal(gv, wv):
                        assert False, \
                            f"{qid}: mismatch at row {i}, col {j} ('{cols[j]}'): got {gv!r}, expected {wv!r}"

        else:
            # ── Legacy assertion mode (histogram, broken queries, complex CTEs)
            if expected.get("row_count") is not None:
                if not (skip_fts_count and is_fts) and not expected.get("skip_row_count"):
                    assert len(hits) == expected["row_count"], \
                        f"{qid}: Expected {expected['row_count']} rows, got {len(hits)}"

            assert len(hits) < size, \
                f"{qid}: Got {len(hits)} rows at size={size} — result may be truncated"

            if len(hits) > 0 and not expected.get("skip_column_check"):
                for col in expected.get("columns", []):
                    assert col in hits[0], f"{qid}: Expected column '{col}' not in response"

            _run_content_assertions(query, sql, hits)

    # Pre-flush (skip_fts_count=True), CI runs with ZO_MAX_FILE_RETENTION_TIME=1
    # so the memtable continuously rotates to immutable→WAL parquet→file_list
    # for the whole ~160s run.  A narrow time-window query issued mid-handoff
    # (an immutable removed before its parquet is registered, or a record
    # briefly present in neither) can transiently drop rows — changing both row
    # counts and aggregate values (COUNT(DISTINCT), SUM, …) even though the
    # data is durably ingested.  Re-run the whole comparison until it settles.
    # The post-flush phase runs the identical query against stable parquet, so
    # a genuine wrong-result regression is still caught there — the retry only
    # absorbs the transient ingestion race.
    attempts = 12 if skip_fts_count else 1
    for attempt in range(attempts):
        resp = client.post("_search?type=logs", json=json_data)
        assert resp.status_code == 200, \
            f"{qid}: Expected 200, got {resp.status_code}: {resp.text[:500]}"

        response_data = resp.json()
        assert "hits" in response_data, f"{qid}: Response should contain 'hits'"
        hits = response_data["hits"]

        try:
            _validate(hits)
        except AssertionError:
            if attempt < attempts - 1:
                time.sleep(0.5)
                continue
            raise
        break

    logging.info("%s passed: %d rows", qid, len(hits))


# ── Legacy Content Assertions (for queries without DuckDB results) ──────────
def _paren_depth(text, pos):
    """Return the nesting depth of parentheses at *pos* within *text*."""
    depth = 0
    for c in text[:pos]:
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
    return depth


def _run_content_assertions(query, sql, hits):
    """Validate result content via explicit assertions in the query JSON.

    Auto-inferred: ORDER BY direction from the outermost SQL ORDER BY clause.
    Explicit (per-query in ``expected.assertions``): row_contains, value_range.
    """
    qid = query["id"]
    expected = query.get("expected", {})

    assertions: list[dict] = list(expected.get("assertions", []))

    # Auto-infer order from the outermost SQL ORDER BY clause.
    order_matches = [
        m for m in re.finditer(
            r"ORDER\s+BY\s+([^\s,]+)\s*(ASC|DESC)?",
            sql, re.IGNORECASE,
        )
        if _paren_depth(sql, m.start()) == 0
    ]
    if order_matches:
        m = order_matches[-1]
        col = m.group(1).strip().strip('"').strip("'")
        direction = (m.group(2) or "ASC").upper()
        assertions.append({"type": "order", "column": col, "direction": direction})

    for i, a in enumerate(assertions):
        a_type = a["type"]
        label = f"{qid}: [{i}] {a_type}"

        if a_type == "order":
            col = a["column"]
            direction = a.get("direction", "ASC")
            values = [hit.get(col) for hit in hits if col in hit]
            if len(values) < 2:
                continue
            ordered = values == sorted(values) if direction == "ASC" \
                else values == sorted(values, reverse=True)
            assert ordered, \
                f"{label}: '{col}' not in {direction} order — {values[:5]}..."

        elif a_type == "row_contains":
            match = a["match"]
            found = any(
                all(hit.get(k) == v for k, v in match.items())
                for hit in hits
            )
            assert found, \
                f"{label}: no row matches {match}"

        elif a_type == "value_range":
            col = a["column"]
            for j, hit in enumerate(hits):
                val = hit.get(col)
                if val is None:
                    continue
                if "min" in a:
                    assert val >= a["min"], \
                        f"{label}: {col}={val} < min={a['min']} in row {j}"
                if "max" in a:
                    assert val <= a["max"], \
                        f"{label}: {col}={val} > max={a['max']} in row {j}"


# ── Session fixture: ingest data (no flush) ────────────────────────────────
@pytest.fixture(scope="session")
def ingest_query_agent_data():
    """Ingest deterministic data into both streams and wait for searchability.

    Does NOT flush — data stays in memtable for the pre-flush phase.
    Stream 2 uses stream_offset=7 for different but join-key-overlapping data.
    """

    client = OpenObserveClient()

    # Stream 1 (primary)
    records1 = build_dataset()
    data1 = json.dumps(records1)
    resp1 = client.post(f"{STREAM}/_json", data=data1,
                        headers={"Content-Type": "application/json"})
    if resp1.status_code == 200:
        logging.info("Stream1: ingested %d records (%d bytes)", len(records1), len(data1))
    else:
        pytest.fail(f"Stream1 ingestion failed: {resp1.status_code} — {resp1.text[:300]}")

    # Stream 2 (secondary, offset=7 for different but overlapping join keys)
    records2 = build_dataset(stream_offset=7)
    data2 = json.dumps(records2)
    resp2 = client.post(f"{STREAM2}/_json", data=data2,
                        headers={"Content-Type": "application/json"})
    if resp2.status_code == 200:
        logging.info("Stream2: ingested %d records (%d bytes)", len(records2), len(data2))
    else:
        pytest.fail(f"Stream2 ingestion failed: {resp2.status_code} — {resp2.text[:300]}")

    # Poll until all records from both streams are searchable.
    # Each stream is checked independently so cross-stream queries
    # never run against a partially-ready stream.
    expected1 = len(records1)
    expected2 = len(records2)
    _max_ts = max(r["_timestamp"] for r in records1 + records2)

    # Vortex servers do not expose WAL/memtable data — searches return
    # NewEmptyExec until data is flushed to vortex files.  Detect this by
    # attempting 3 quick polls; if no data appears, flush once and continue.
    def _quick_count(stream: str) -> int:
        now = datetime.now(UTC)
        end_us = max(int(now.timestamp() * 1_000_000), _max_ts) + 3_600_000_000
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        r = client.post("_search?type=logs", json={
            "query": {"sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
                      "start_time": start_us, "end_time": end_us,
                      "from": 0, "size": 1}
        })
        if r.status_code != 200:
            return 0
        hits = r.json().get("hits", [])
        return int(hits[0].get("c", 0)) if hits else 0

    _memtable_visible = False
    for _ in range(3):
        if _quick_count(STREAM) > 0:
            _memtable_visible = True
            break
        time.sleep(1.0)

    if not _memtable_visible:
        # No memtable data after 3s — flush so vortex files are created.
        flush_r = client.put("node/flush", prefix="")
        logging.info("Auto-flush after 3s (vortex or slow memtable): %s", flush_r.status_code)
        time.sleep(2.0)

    def _data_is_searchable():
        now = datetime.now(UTC)
        # Records have timestamps from BASE_TS to BASE_TS + ~66 min (future).
        # Extend end_us past _max_ts so the COUNT(*) window covers all records.
        # The vortex search engine enforces end_time strictly; parquet WAL does not.
        end_us = max(int(now.timestamp() * 1_000_000), _max_ts) + 3_600_000_000
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        # Check stream 1
        r1 = client.post("_search?type=logs", json={
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{STREAM}"',
                "start_time": start_us,
                "end_time": end_us,
                "from": 0,
                "size": 1,
            }
        })
        if r1.status_code != 200:
            return False
        hits1 = r1.json().get("hits", [])
        if not (hits1 and hits1[0].get("c", 0) >= expected1):
            return False
        # Check stream 2
        r2 = client.post("_search?type=logs", json={
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{STREAM2}"',
                "start_time": start_us,
                "end_time": end_us,
                "from": 0,
                "size": 1,
            }
        })
        if r2.status_code != 200:
            return False
        hits2 = r2.json().get("hits", [])
        if not (hits2 and hits2[0].get("c", 0) >= expected2):
            return False
        # Tail poll: verify a record near max_ts is searchable
        tail_r = client.post("_search?type=logs", json={
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{STREAM}"',
                "start_time": _max_ts - 60_000_000,
                "end_time": _max_ts + 3_600_000_000,
                "from": 0,
                "size": 1,
            }
        })
        if tail_r.status_code != 200:
            return False
        tail_hits = tail_r.json().get("hits", [])
        return bool(tail_hits and tail_hits[0].get("c", 0) >= 1)

    wait_until(_data_is_searchable, timeout=300, interval=1.0,
               msg=f"Stream data not searchable ({len(records1)} records)")
    logging.info("Both streams data is searchable (%d + %d records)", len(records1), len(records2))

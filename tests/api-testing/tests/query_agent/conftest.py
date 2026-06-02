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

# Unique stream per test session — prevents row-count drift from accumulated data.
STREAM = f"query_agent_test_{int(time.time())}"


# ── Shared query loader ────────────────────────────────────────────────────
def load_all_queries():
    """Return {category_name: [queries]} from queries/*.json files."""
    categories: dict[str, list[dict]] = {}
    for fp in sorted(_QUERIES_DIR.glob("*.json")):
        with open(fp) as f:
            data = json.load(f)
        categories[fp.stem] = data["queries"]
    return categories


# ── Shared query runner ────────────────────────────────────────────────────
def run_query(client, query, *, skip_fts_count=False):
    """Execute a single query via _search and assert expected results.

    When *skip_fts_count* is True, the row_count assertion is skipped for
    full_text_search queries (Tantivy FTS not available pre-flush).
    """
    size = 500
    offset = query["time_offset"]
    sql = query["sql"].replace("{stream}", STREAM)
    json_data = search_payload(
        sql,
        start_time=BASE_TS + offset["start_offset"],
        end_time=BASE_TS + offset["end_offset"],
        size=size,
    )
    resp = client.post("_search?type=logs", json=json_data)
    assert resp.status_code == 200, \
        f"{query['id']}: Expected 200, got {resp.status_code}: {resp.text[:500]}"

    response_data = resp.json()
    assert "hits" in response_data, f"{query['id']}: Response should contain 'hits'"
    hits = response_data["hits"]

    is_fts = query.get("category") == "full_text_search"
    expected = query.get("expected", {})

    if expected.get("row_count") is not None:
        if not (skip_fts_count and is_fts) and not expected.get("skip_row_count"):
            assert len(hits) == expected["row_count"], \
                f"{query['id']}: Expected {expected['row_count']} rows, got {len(hits)}"
        assert len(hits) < size, \
            f"{query['id']}: Got {len(hits)} rows at size={size} — result may be truncated"

    # Column assertions only run when hits are non-empty.
    # Queries with row_count=0 must NOT include "columns" in expected
    # (they can't be validated and would silently pass unchecked).
    if len(hits) > 0:
        for col in expected.get("columns", []):
            assert col in hits[0], f"{query['id']}: Expected column '{col}' not in response"

    _run_content_assertions(query, sql, hits)

    logging.info("%s passed: %d rows", query["id"], len(hits))


# ── Content + Order Assertions ──────────────────────────────────────────────
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
    """Validate result content: not-null columns, ORDER BY direction, and
    any explicit assertions defined in the query JSON.

    Auto-inferred from existing data:
      - *not_null*: every column in expected.columns must be non-null
      - *order*: parsed from the SQL ORDER BY clause

    Explicit (opt-in, per-query in JSON ``expected.assertions``):
      - *row_contains*: at least one row matches the given key/value pairs
      - *value_range*: numeric column values are within [min, max]
    """
    qid = query["id"]
    expected = query.get("expected", {})

    # Collect assertions: explicit JSON ones + auto-inferred
    assertions: list[dict] = list(expected.get("assertions", []))

    # Auto-infer order from the outermost SQL ORDER BY clause.
    # Window-function ORDER BYs (inside OVER parentheses) are excluded.
    order_matches = [
        m for m in re.finditer(
            r"ORDER\s+BY\s+([^\s,]+)\s*(ASC|DESC)?",
            sql, re.IGNORECASE,
        )
        if _paren_depth(sql, m.start()) == 0  # top-level only
    ]
    if order_matches:
        m = order_matches[-1]
        col = m.group(1).strip().strip('"').strip("'")
        direction = (m.group(2) or "ASC").upper()
        assertions.append({"type": "order", "column": col, "direction": direction})

    # Execute each assertion
    for i, a in enumerate(assertions):
        a_type = a["type"]
        label = f"{qid}: [{i}] {a_type}"

        if a_type == "not_null":
            col = a["column"]
            for j, hit in enumerate(hits):
                assert hit.get(col) is not None, \
                    f"{label}: '{col}' is null in row {j}"

        elif a_type == "order":
            col = a["column"]
            direction = a.get("direction", "ASC")
            values = [hit.get(col) for hit in hits if col in hit]
            if len(values) < 2:
                continue  # single row — trivially ordered
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
    """Ingest deterministic data and wait for it to be searchable.

    Does NOT flush — the data stays in memtable for the pre-flush phase.
    The post-flush phase triggers its own flush + re-poll.
    """

    client = OpenObserveClient()
    stream = STREAM

    # Generate data in-memory — no external JSON file dependency
    records = build_dataset()
    data = json.dumps(records)

    resp = client.post(f"{stream}/_json", data=data,
                       headers={"Content-Type": "application/json"})
    if resp.status_code == 200:
        logging.info("Ingested %d generated records (%d bytes)", len(records), len(data))
    else:
        pytest.fail(f"Ingestion failed: {resp.status_code} — {resp.text[:300]}")

    # Poll until all records are searchable (no flush — memtable only)
    expected = len(records)
    _max_ts = max(r["_timestamp"] for r in records)

    def _data_is_searchable():
        now = datetime.now(UTC)
        end_us = int(now.timestamp() * 1_000_000)
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
                "start_time": start_us,
                "end_time": end_us,
                "from": 0,
                "size": 1,
            }
        }
        r = client.post("_search?type=logs", json=payload)
        if r.status_code != 200:
            return False
        hits = r.json().get("hits", [])
        if not (hits and hits[0].get("c", 0) >= expected):
            return False
        tail_payload = {
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
                "start_time": _max_ts - 60_000_000,
                "end_time": _max_ts + 60_000_000,
                "from": 0,
                "size": 1,
            }
        }
        tr = client.post("_search?type=logs", json=tail_payload)
        if tr.status_code != 200:
            return False
        thits = tr.json().get("hits", [])
        return bool(thits and thits[0].get("c", 0) >= 1)

    wait_until(_data_is_searchable, timeout=120, interval=1.0,
               msg=f"{stream} data not searchable ({expected} records)")
    logging.info("%s data is searchable (%d records)", stream, expected)

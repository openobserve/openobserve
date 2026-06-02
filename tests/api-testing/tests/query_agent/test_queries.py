"""Query Agent — Unified Regression Suite.

All queries live in test-data/query-agent/queries/*.json (one file per category).
Adding a query = drop it into the right category file.  Adding a category = drop a
new .json file into the directory.  Zero test code changes.
"""

import json
import logging
from pathlib import Path

import pytest

from support.factories import search_payload

QUERIES_DIR = Path(__file__).parent.parent.parent.parent / "test-data" / "query-agent" / "queries"

# ── Discover category files ─────────────────────────────────────────────
_CATEGORIES: dict[str, list[dict]] = {}
for _fp in sorted(QUERIES_DIR.glob("*.json")):
    with open(_fp) as _f:
        _data = json.load(_f)
    _CATEGORIES[_fp.stem] = _data["queries"]


# ── Shared test body ────────────────────────────────────────────────────
def _run_query(client, query):
    size = 500
    json_data = search_payload(
        query["sql"],
        start_time=query["time_range"]["start"],
        end_time=query["time_range"]["end"],
        size=size,
    )
    resp = client.post("_search?type=logs", json=json_data)
    assert resp.status_code == 200, \
        f"{query['id']}: Expected 200, got {resp.status_code}: {resp.text[:500]}"

    response_data = resp.json()
    assert "hits" in response_data, f"{query['id']}: Response should contain 'hits'"
    hits = response_data["hits"]

    expected = query.get("expected", {})
    if expected.get("row_count") is not None:
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

    logging.info("%s passed: %d rows", query["id"], len(hits))


# ── Generate one parametrized test per category ─────────────────────────
def _make_test(cat, queries):
    @pytest.mark.parametrize("query", queries, ids=[q["id"] for q in queries])
    def _test(client, ingest_query_agent_data, query):
        _run_query(client, query)
    return _test


for _cat, _queries in sorted(_CATEGORIES.items()):
    _fn = _make_test(_cat, _queries)
    _fn.__name__ = f"test_{_cat}"
    _fn.__doc__ = f"Run {_cat} queries — parametrized from queries/{_cat}.json"
    globals()[_fn.__name__] = _fn

"""Phase 2 — Post-Flush Parquet + Tantivy: run all queries after flush.

A module-scoped fixture triggers the flush between the memtable phase
(test_1_memtable) and this phase. FTS queries (match_all) should now
return expected row counts because Tantivy indexes exist alongside
Parquet files.
"""

import logging

import pytest

from support.client import OpenObserveClient
from tests.query_agent.conftest import load_all_queries, run_query


@pytest.fixture(scope="module")
def post_flush(ingest_query_agent_data):
    """Trigger flush after memtable phase completes.

    Module-scoped + depends on the session-scoped ingestion fixture,
    so this runs AFTER all test_1_memtable tests finish but BEFORE
    any tests in this module start.
    """
    client = OpenObserveClient()
    stream = "query_agent_test_v2"

    # Use prefix="" because /node/flush sits outside the /api/{org} prefix
    resp = client.put("node/flush", prefix="")
    if resp.status_code == 200:
        logging.info("Flush succeeded — Parquet + Tantivy indexes generated")
    elif resp.status_code == 404:
        logging.info("Flush not applicable (local mode or non-ingester node)")
    else:
        logging.warning("Flush returned %s: %s", resp.status_code, resp.text[:200])

    # Brief wait for index generation
    import time
    time.sleep(2)

    logging.info("Post-flush phase ready")


# ── Query helpers ────────────────────────────────────────────────────────
def _make_test(cat, queries):
    @pytest.mark.parametrize("query", queries, ids=[q["id"] for q in queries])
    def _test(client, post_flush, query):
        # Post-flush: Tantivy available — assert full row counts including FTS
        run_query(client, query, skip_fts_count=False)
    return _test


# ── Generate one parametrized test per category ─────────────────────────
_CATEGORIES = load_all_queries()
for _cat, _queries in sorted(_CATEGORIES.items()):
    _fn = _make_test(_cat, _queries)
    _fn.__name__ = f"test_parquet_{_cat}"
    _fn.__doc__ = f"Post-flush: run {_cat} queries against Parquet + Tantivy"
    globals()[_fn.__name__] = _fn

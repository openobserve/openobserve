"""Phase 2 — Post-Flush Parquet + Tantivy: run all queries after flush.

A module-scoped fixture triggers the flush between the memtable phase
(test_1_memtable) and this phase. FTS queries (match_all) should now
return expected row counts because Tantivy indexes exist alongside
Parquet files.
"""

import logging
import time

import pytest

from support.client import OpenObserveClient
from tests.query_agent.conftest import load_all_queries, run_query, STREAM


@pytest.fixture(scope="module")
def post_flush(ingest_query_agent_data):
    """Trigger flush after memtable phase completes, then re-poll.

    Module-scoped + depends on the session-scoped ingestion fixture,
    so this runs AFTER all test_1_memtable tests finish but BEFORE
    any tests in this module start.
    """
    from datetime import datetime, timedelta, UTC
    from support.wait import wait_until

    client = OpenObserveClient()

    resp = client.put("node/flush", prefix="")
    if resp.status_code == 200:
        logging.info("Flush succeeded — Parquet + Tantivy indexes generated")
    elif resp.status_code == 404:
        logging.info("Flush not applicable (local mode or non-ingester node)")
    else:
        logging.warning("Flush returned %s: %s", resp.status_code, resp.text[:200])

    time.sleep(2)

    # Re-poll until all data is searchable via Parquet + Tantivy
    def _data_searchable():
        now = datetime.now(UTC)
        end_us = int(now.timestamp() * 1_000_000)
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{STREAM}"',
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
        return bool(hits and hits[0].get("c", 0) >= 1)

    wait_until(_data_searchable, timeout=60, interval=1.0,
               msg=f"{STREAM} data not searchable after flush")
    logging.info("Post-flush: data searchable")

    # Tantivy readiness: Parquet files may be searchable before Tantivy
    # indexes are built (ZO_MAX_FILE_RETENTION_TIME defaults to 600s).
    # Run a match_all query to confirm FTS is actually working.
    def _fts_ready():
        now = datetime.now(UTC)
        end_us = int(now.timestamp() * 1_000_000)
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        r = client.post("_search?type=logs", json={
            "query": {
                "sql": f'SELECT * FROM "{STREAM}" WHERE match_all(\'warehouse\') LIMIT 1',
                "start_time": start_us,
                "end_time": end_us,
                "from": 0,
                "size": 1,
            }
        })
        if r.status_code != 200:
            return False
        hits = r.json().get("hits", [])
        return bool(hits)

    wait_until(_fts_ready, timeout=120, interval=2.0,
               msg=f"Tantivy FTS not ready for {STREAM} after flush")
    logging.info("Post-flush: Tantivy FTS ready")


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

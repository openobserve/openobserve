"""Phase 1 — Memtable: run all queries BEFORE flush (no Tantivy FTS).

FTS queries (full_text_search) are expected to return 0 rows because
Tantivy indexes are only generated alongside Parquet files.
"""

import pytest

from tests.query_agent.conftest import load_all_queries, run_query

# ── Shared helpers ──────────────────────────────────────────────────────
def _make_test(cat, queries):
    @pytest.mark.parametrize("query", queries, ids=[q["id"] for q in queries])
    def _test(client, ingest_query_agent_data, query):
        # Pre-flush: Tantivy FTS not available — skip row_count for FTS queries
        run_query(client, query, skip_fts_count=True)
    return _test


# ── Generate one parametrized test per category ─────────────────────────
_CATEGORIES = load_all_queries()
for _cat, _queries in sorted(_CATEGORIES.items()):
    _fn = _make_test(_cat, _queries)
    _fn.__name__ = f"test_memtable_{_cat}"
    _fn.__doc__ = f"Memtable: run {_cat} queries pre-flush"
    globals()[_fn.__name__] = _fn

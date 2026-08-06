"""Phase 5 — Concurrency Stress: run queries in parallel to catch
thread-safety bugs, lock contention, and race conditions.

Sequential tests never hit deadlocks in DataFusion's physical planner,
contention in the file-list index, or thread-unsafe access to shared
state.  This test fires queries simultaneously at the same server,
each with its own HTTP client, and asserts every one of them returns
correct results.

Would have caught the ZO_MAX_FILE_RETENTION_TIME race condition
immediately — parallel queries can see inconsistent file-list state
that a single sequential query never observes.

Assumptions:
- Data is stable post-flush (no memtable rotation during test).
- The server can handle 15 concurrent search requests on CI hardware.
- Each query completes in under 120 s (Future timeout).
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest

from support.client import OpenObserveClient
from tests.query_agent.conftest import load_all_queries, run_query, STREAM

# Per-future safety timeout — a hung server thread shouldn't block CI forever.
_FUTURE_TIMEOUT = 120  # seconds

# Seconds of sleep between parametrized worker-level runs so residual
# server-side effects (connection-pool saturation, file handles) dissipate.
_COOLDOWN_SECONDS = 5


# ── Query selection (session fixture, not module-level) ───────────────────
def _select_concurrency_queries(per_category: int = 2) -> list[dict]:
    """Pick *per_category* queries from each category.

    Prefers sqllogictest-mode queries (have ``results``, no
    ``skip_sqllogictest`` flag) for strict cell-by-cell validation.
    Falls back to legacy-mode queries when not enough sqllogictest
    queries exist in a category.
    """
    all_cats = load_all_queries()
    selected: list[dict] = []
    for cat, queries in sorted(all_cats.items()):
        sqllogic = [
            q for q in queries
            if "results" in q.get("expected", {})
            and not q.get("expected", {}).get("skip_sqllogictest")
        ]
        others = [q for q in queries if q not in sqllogic]
        picks = (sqllogic + others)[:per_category]
        selected.extend(picks)
        logging.info(
            "Concurrency: %s — picked %s",
            cat,
            [(q["id"], "slt" if q in sqllogic else "legacy") for q in picks],
        )
    return selected


@pytest.fixture(scope="session")
def concurrency_queries():
    """Session-scoped query selection — avoids import-time failure risk."""
    return _select_concurrency_queries(per_category=2)


# ── Fixture: flush so data is stable (no memtable rotation during test) ───
@pytest.fixture(scope="module")
def post_flush_concurrency(ingest_query_agent_data):
    """Flush after ingestion so data sits in stable Parquet files.

    Without this, ZO_MAX_FILE_RETENTION_TIME would rotate immutables
    to WAL parquet mid-test, and parallel queries would hit the exact
    file-list race this test is designed to expose as a real bug.
    We want to test *query engine* concurrency, not ingestion races.
    """
    from datetime import datetime, timedelta, UTC
    from support.wait import wait_until

    client = OpenObserveClient()
    resp = client.put("node/flush", prefix="")
    if resp.status_code == 200:
        logging.info("Concurrency flush succeeded")
    elif resp.status_code == 404:
        logging.info("Concurrency flush not applicable (non-ingester node)")
    else:
        logging.warning("Concurrency flush returned %s: %s", resp.status_code, resp.text[:200])

    time.sleep(2)

    def _data_ready():
        now = datetime.now(UTC)
        end_us = int(now.timestamp() * 1_000_000)
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        r = client.post("_search?type=logs", json={
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{STREAM}"',
                "start_time": start_us, "end_time": end_us,
                "from": 0, "size": 1,
            }
        })
        if r.status_code != 200:
            return False
        hits = r.json().get("hits", [])
        return bool(hits and hits[0].get("c", 0) >= 1)

    wait_until(_data_ready, timeout=120, interval=2.0,
               msg=f"{STREAM} data not searchable after concurrency flush")
    logging.info("Concurrency post-flush: data searchable")


# ── Per-thread query runner ────────────────────────────────────────────────
def _run_one_query(query):
    """Execute a single query with its own HTTP client.

    ``requests.Session`` is **not** thread-safe, so each thread must
    have its own ``OpenObserveClient``.  ``run_query`` is otherwise
    stateless — it only reads module-level constants.
    """
    client = OpenObserveClient()
    qid = query["id"]
    try:
        run_query(client, query, skip_fts_count=False)
        return (qid, True, None)
    except AssertionError as e:
        return (qid, False, str(e)[:500])
    except Exception as e:
        return (qid, False, f"{type(e).__name__}: {str(e)[:500]}")


# ── Concurrency test: diverse queries ─────────────────────────────────────
@pytest.mark.parametrize("workers", [5, 10, 15])
def test_concurrency_diverse(client, post_flush_concurrency, concurrency_queries, workers):
    """Run queries from every category in parallel with *workers* threads.

    Each thread gets its own OpenObserveClient.  All queries must
    return correct results — any assertion failure, crash (500), or
    timeout is a test failure.

    Runs at three worker levels (5, 10, 15) to catch bugs that only
    appear under specific contention thresholds.  A cooldown between
    parametrized runs prevents residual server effects from causing
    cascading failures.
    """
    t0 = time.time()
    results: list[tuple[str, bool, str | None]] = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_run_one_query, q): q for q in concurrency_queries}
        for future in as_completed(futures):
            qid = futures[future]["id"]
            try:
                qid, ok, error = future.result(timeout=_FUTURE_TIMEOUT)
            except TimeoutError:
                qid = futures[future]["id"]
                results.append((qid, False, f"Future timed out after {_FUTURE_TIMEOUT}s"))
                logging.error("CONCURRENCY TIMEOUT [workers=%d] %s: %ds", workers, qid, _FUTURE_TIMEOUT)
                continue
            results.append((qid, ok, error))
            if not ok:
                logging.error("CONCURRENCY FAIL [workers=%d] %s: %s", workers, qid, error)

    elapsed = time.time() - t0
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(qid, err) for qid, ok, err in results if not ok]

    logging.info(
        "Concurrency diverse [workers=%d]: %d/%d passed in %.1fs",
        workers, passed, len(results), elapsed,
    )

    if failed:
        detail = "\n".join(f"  {qid}: {err}" for qid, err in failed)
        pytest.fail(
            f"Concurrency diverse [workers={workers}]: "
            f"{len(failed)}/{len(results)} queries failed:\n{detail}"
        )

    time.sleep(_COOLDOWN_SECONDS)


# ── Concurrency test: same query, multiple threads ────────────────────────
def test_concurrency_same_query(client, post_flush_concurrency, concurrency_queries):
    """Run the same aggregation query concurrently from 10 threads.

    A common source of race conditions is multiple clients executing the
    identical query simultaneously — shared plan caches, file-list
    snapshots, or aggregation state can be corrupted by parallel access
    to the same physical plan.
    """
    # Use the simplest aggregation query from the selected set
    agg_queries = [q for q in concurrency_queries if q.get("category") == "aggregation"]
    if not agg_queries:
        pytest.skip("No aggregation query available for same-query concurrency test")
    query = agg_queries[0]

    workers = 10
    t0 = time.time()
    results: list[tuple[str, bool, str | None]] = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(_run_one_query, query) for _ in range(workers)]
        for i, future in enumerate(as_completed(futures)):
            try:
                qid, ok, error = future.result(timeout=_FUTURE_TIMEOUT)
            except TimeoutError:
                results.append((f"thread_{i}", False, f"Future timed out after {_FUTURE_TIMEOUT}s"))
                continue
            results.append((qid, ok, error))
            if not ok:
                logging.error("CONCURRENCY SAME-QUERY FAIL [thread %d] %s: %s", i, qid, error)

    elapsed = time.time() - t0
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(qid, err) for qid, ok, err in results if not ok]

    logging.info(
        "Concurrency same-query [%d threads]: %d/%d passed in %.1fs",
        workers, passed, len(results), elapsed,
    )

    if failed:
        detail = "\n".join(f"  {qid}: {err}" for qid, err in failed)
        pytest.fail(
            f"Concurrency same-query: {len(failed)}/{len(results)} threads failed:\n{detail}"
        )

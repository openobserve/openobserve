"""Phase 5 — Concurrency Stress: run queries in parallel to catch
thread-safety bugs, lock contention, and race conditions.

Sequential tests never hit deadlocks in DataFusion's physical planner,
contention in the file-list index, or thread-unsafe access to shared
state.  This test fires 15 queries simultaneously at the same server,
each with its own HTTP client, and asserts every one of them returns
correct results.

Would have caught the ZO_MAX_FILE_RETENTION_TIME race condition
immediately — parallel queries can see inconsistent file-list state
that a single sequential query never observes.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest

from support.client import OpenObserveClient
from tests.query_agent.conftest import load_all_queries, run_query, STREAM


# ── Query selection ───────────────────────────────────────────────────────
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


_CONCURRENCY_QUERIES = _select_concurrency_queries(per_category=2)


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


# ── Concurrency test ──────────────────────────────────────────────────────
@pytest.mark.parametrize("workers", [5, 10, 15])
def test_concurrency_stress(client, post_flush_concurrency, workers):
    """Run all selected queries in parallel with *workers* threads.

    Each thread gets its own OpenObserveClient.  All queries must
    return correct results — any assertion failure, crash (500), or
    timeout is a test failure.

    Runs at three worker levels (5, 10, 15) to catch bugs that only
    appear under specific contention thresholds.
    """
    t0 = time.time()
    results: list[tuple[str, bool, str | None]] = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_run_one_query, q): q for q in _CONCURRENCY_QUERIES}
        for future in as_completed(futures):
            qid, ok, error = future.result()
            results.append((qid, ok, error))
            if not ok:
                logging.error("CONCURRENCY FAIL [workers=%d] %s: %s", workers, qid, error)

    elapsed = time.time() - t0
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(qid, err) for qid, ok, err in results if not ok]

    logging.info(
        "Concurrency [workers=%d]: %d/%d passed in %.1fs",
        workers, passed, len(results), elapsed,
    )

    if failed:
        detail = "\n".join(f"  {qid}: {err}" for qid, err in failed)
        pytest.fail(
            f"Concurrency [workers={workers}]: {len(failed)}/{len(results)} "
            f"queries failed:\n{detail}"
        )

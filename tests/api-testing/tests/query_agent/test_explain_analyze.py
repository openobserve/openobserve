"""EXPLAIN ANALYZE — run EXPLAIN ANALYZE on every query in the suite.

Prefixes each of the ~672 queries with ``EXPLAIN ANALYZE `` and
asserts the server returns a valid physical plan (200) without
populating ``partial_error``.  Plan output is non-deterministic
(optimizer version, node count, per-node timing), so we only assert
on structure: status 200, ``partial_error`` absent/falsy, and plan
content present in the first hit.

Also validates that EXPLAIN ANALYZE on the cross-schema dot-notation
query returns 4xx (not 5xx) — the same graceful rejection as without
EXPLAIN.
"""

import logging
import time

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload
from tests.query_agent.conftest import load_all_queries, STREAM, BASE_TS


# ── Fixture: flush so data is stable ─────────────────────────────────────
@pytest.fixture(scope="module")
def explain_post_flush(ingest_query_agent_data):
    """Flush after ingestion so EXPLAIN ANALYZE runs against stable Parquet."""
    from datetime import datetime, timedelta, UTC
    from support.wait import wait_until

    client = OpenObserveClient()
    resp = client.put("node/flush", prefix="")
    if resp.status_code == 200:
        logging.info("Explain: flush succeeded")
    elif resp.status_code == 404:
        logging.info("Explain: flush not applicable (non-ingester node)")
    else:
        logging.warning("Explain: flush returned %s: %s", resp.status_code, resp.text[:200])

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
               msg=f"{STREAM} data not searchable")
    logging.info("Explain post-flush: data searchable")


# ── Helpers ───────────────────────────────────────────────────────────────
def _assert_explain_ok(resp, qid):
    """Assert EXPLAIN ANALYZE returned 200 with a plan and no partial_error."""
    assert resp.status_code == 200, (
        f"{qid}: EXPLAIN ANALYZE expected 200, got {resp.status_code}: {resp.text[:500]}"
    )
    body = resp.json()

    # partial_error must be absent or falsy
    pe = body.get("partial_error")
    assert not pe, f"{qid}: partial_error is set: {pe!r}"

    # Hits must contain plan output
    hits = body.get("hits", [])
    assert len(hits) > 0, f"{qid}: no hits — expected plan output"

    # Plan content should be in the first hit
    hit = hits[0]
    has_plan = "plan" in hit or "Plan" in str(hit)
    assert has_plan, f"{qid}: no plan content in hit keys: {list(hit.keys())}"


def _run_explain(client, query):
    """Run EXPLAIN ANALYZE on a single query. Returns (qid, ok, error_msg)."""
    qid = query["id"]
    offset = query["time_offset"]
    sql = "EXPLAIN ANALYZE " + query["sql"].replace("{stream}", STREAM).replace("{stream2}", STREAM)

    # Use the same time window as the original query so the plan covers
    # the same data.
    payload = search_payload(
        sql,
        start_time=BASE_TS + offset["start_offset"],
        end_time=BASE_TS + offset["end_offset"],
        size=500,
    )

    try:
        resp = client.post("_search?type=logs", json=payload)
        _assert_explain_ok(resp, qid)
        return (qid, True, None)
    except AssertionError as e:
        return (qid, False, str(e)[:500])
    except Exception as e:
        return (qid, False, f"{type(e).__name__}: {str(e)[:500]}")


# ── Generate one parametrized test per category ───────────────────────────
def _make_test(cat, queries):
    @pytest.mark.parametrize("query", queries, ids=[q["id"] for q in queries])
    def _test(client, explain_post_flush, query):
        qid, ok, error = _run_explain(client, query)
        if not ok:
            pytest.fail(f"{qid}: {error}")

    return _test


_CATEGORIES = load_all_queries()
for _cat, _queries in sorted(_CATEGORIES.items()):
    _fn = _make_test(_cat, _queries)
    _fn.__name__ = f"test_explain_{_cat}"
    _fn.__doc__ = f"EXPLAIN ANALYZE: run all {_cat} queries with EXPLAIN ANALYZE prefix"
    globals()[_fn.__name__] = _fn


# ── Cross-schema rejection ────────────────────────────────────────────────
@pytest.mark.parametrize("sql,label", [
    pytest.param(
        "EXPLAIN ANALYZE SELECT b.id, b.name FROM default AS a INNER JOIN enrich.rich AS b ON a.id = b.id LIMIT 1",
        "select_columns",
        id="select_columns",
    ),
    pytest.param(
        "EXPLAIN ANALYZE SELECT count(*) FROM default AS a INNER JOIN enrich.rich AS b ON a.id = b.id LIMIT 1",
        "select_count",
        id="select_count",
    ),
])
def test_explain_analyze_cross_schema_rejected(client, explain_post_flush, sql, label):
    """EXPLAIN ANALYZE on cross-schema dot-notation returns 4xx, not 5xx.

    Both projection (b.id, b.name) and aggregation (count(*)) variants
    are checked — EXPLAIN ANALYZE actually executes the query, so the
    aggregation path may hit different planner/execution code.
    """
    t0 = BASE_TS
    t1 = t0 + 60_000_000 * 120
    payload = search_payload(sql, start_time=t0, end_time=t1)
    resp = client.post("_search?type=logs", json=payload)

    assert 400 <= resp.status_code <= 499, (
        f"EXPLAIN ANALYZE cross-schema [{label}]: expected 4xx, got {resp.status_code}: {resp.text[:500]}"
    )

    body = resp.json()
    msg = body.get("message", "")
    assert "rich" in msg or "enrich" in msg or "stream" in msg.lower(), (
        f"EXPLAIN ANALYZE cross-schema [{label}]: error message should mention the "
        f"unresolved stream, got: {msg!r}"
    )

    logging.info("EXPLAIN ANALYZE cross-schema [%s]: correctly rejected with %s — %s", label, resp.status_code, msg)

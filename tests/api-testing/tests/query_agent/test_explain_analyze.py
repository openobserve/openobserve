"""EXPLAIN / EXPLAIN ANALYZE tests.

Verifies the query engine returns a valid plan (200) without crashing
or populating ``partial_error``.  Plan output is non-deterministic
(optimizer version, node count, timing) so we only assert on structure:
status 200, ``partial_error`` absent, and plan content present in hits.

Also validates that EXPLAIN ANALYZE on invalid cross-schema dot-notation
queries returns 4xx (not 5xx) — the same graceful rejection as without
EXPLAIN.
"""

import logging

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload
from tests.query_agent.conftest import STREAM, BASE_TS, run_query


# ── Fixtures ──────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def explain_post_flush(ingest_query_agent_data):
    """Flush so we have stable parquet to run EXPLAIN ANALYZE against."""
    import time
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
def _explain(client, sql, start_time, end_time):
    """Run EXPLAIN / EXPLAIN ANALYZE and return the response."""
    payload = search_payload(sql, start_time=start_time, end_time=end_time)
    return client.post("_search?type=logs", json=payload)


def _assert_explain_ok(resp, label):
    """Assert EXPLAIN returned 200 with a plan and no partial_error."""
    assert resp.status_code == 200, (
        f"{label}: expected 200, got {resp.status_code}: {resp.text[:500]}"
    )
    body = resp.json()

    # partial_error must be absent or falsy
    pe = body.get("partial_error")
    assert not pe, f"{label}: partial_error is set: {pe!r}"

    # Hits must contain plan output
    hits = body.get("hits", [])
    assert len(hits) > 0, f"{label}: no hits — expected plan output"

    # Plan content should be in the first hit
    hit = hits[0]
    has_plan = "plan" in hit or "Plan" in str(hit)
    assert has_plan, f"{label}: no plan content in hit: {list(hit.keys())}"

    logging.info("%s: OK — %d plan hits, took=%s", label, len(hits), body.get("took"))


# ── Tests ─────────────────────────────────────────────────────────────────
def test_explain_analyze_basic(client, explain_post_flush):
    """EXPLAIN ANALYZE on a simple aggregation returns a physical plan."""
    sql = f'EXPLAIN ANALYZE SELECT COUNT(*) FROM "{STREAM}"'
    t0 = BASE_TS
    t1 = t0 + 60_000_000 * 120  # 120 minutes after base
    resp = _explain(client, sql, t0, t1)
    _assert_explain_ok(resp, "EXPLAIN ANALYZE COUNT(*)")


def test_explain_logical(client, explain_post_flush):
    """EXPLAIN (without ANALYZE) returns a logical plan."""
    sql = f'EXPLAIN SELECT * FROM "{STREAM}" LIMIT 5'
    t0 = BASE_TS
    t1 = t0 + 60_000_000 * 120
    resp = _explain(client, sql, t0, t1)
    _assert_explain_ok(resp, "EXPLAIN SELECT")


def test_explain_analyze_group_by(client, explain_post_flush):
    """EXPLAIN ANALYZE on GROUP BY + aggregation."""
    sql = f'EXPLAIN ANALYZE SELECT facility_zone, COUNT(*) AS cnt FROM "{STREAM}" GROUP BY facility_zone ORDER BY cnt DESC'
    t0 = BASE_TS
    t1 = t0 + 60_000_000 * 120
    resp = _explain(client, sql, t0, t1)
    _assert_explain_ok(resp, "EXPLAIN ANALYZE GROUP BY")


def test_explain_analyze_cross_schema_rejected(client, explain_post_flush):
    """EXPLAIN ANALYZE on cross-schema dot-notation returns 4xx, not 5xx.

    This is the reported bug case — EXPLAIN ANALYZE should not crash
    when the query references schemas via dot notation.  It should
    return the same 4xx rejection as without EXPLAIN.
    """
    sql = "EXPLAIN ANALYZE SELECT b.id, b.name FROM default AS a INNER JOIN enrich.rich AS b ON a.id = b.id LIMIT 1"
    t0 = BASE_TS
    t1 = t0 + 60_000_000 * 120
    resp = _explain(client, sql, t0, t1)

    assert 400 <= resp.status_code <= 499, (
        f"EXPLAIN ANALYZE cross-schema: expected 4xx, got {resp.status_code}: {resp.text[:500]}"
    )

    # Verify the rejection is for stream resolution (cross-schema/dot-notation),
    # not a generic syntax error.  The server should reference the unresolved
    # stream name in its error.
    body = resp.json()
    msg = body.get("message", "")
    assert "rich" in msg or "enrich" in msg or "stream" in msg.lower(), (
        f"EXPLAIN ANALYZE cross-schema: error message should mention the "
        f"unresolved stream, got: {msg!r}"
    )

    logging.info("EXPLAIN ANALYZE cross-schema: correctly rejected with %s — %s", resp.status_code, msg)

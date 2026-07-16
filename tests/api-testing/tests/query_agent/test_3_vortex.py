"""Phase 3 — Post-Flush Vortex: run all queries after flush against vortex files.

Identical query set as Phase 2 (test_2_parquet.py) — 155 queries across 12
categories. The server must be started with ZO_FILE_FORMAT=vortex. Any
divergence in results vs parquet is a vortex bug.

Enterprise CI only — do not add this file to the OSS api-testing.yml.

Test plan: scenarios 26–46 (Section 3 — Query Correctness, vortex phase).
"""
import json
import logging
import os as _os
import time

import pytest

from support.client import OpenObserveClient
from tests.query_agent.conftest import load_all_queries, run_query, STREAM


@pytest.fixture(scope="module")
def post_flush_vortex(ingest_query_agent_data):  # noqa: ARG001
    """Flush the server and wait for vortex files to be searchable."""
    from datetime import datetime, timedelta, UTC
    from support.wait import wait_until

    client = OpenObserveClient()

    resp = client.put("node/flush", prefix="")
    if resp.status_code == 200:
        logging.info("Flush succeeded — vortex files generated")
    elif resp.status_code == 404:
        logging.info("Flush not applicable (non-ingester node)")
    else:
        logging.warning("Flush returned %s: %s", resp.status_code, resp.text[:200])

    time.sleep(2)

    def _data_searchable():
        now = datetime.now(UTC)
        # Extend end_us 12 hours ahead to cover future-dated records
        # (BASE_TS = now - 2h; records span up to now + ~7h).
        end_us = int((now + timedelta(hours=12)).timestamp() * 1_000_000)
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
    logging.info("Post-flush vortex: data searchable")

    # Tantivy readiness: vortex files may be searchable before Tantivy
    # indexes are built.  Run a match_all query to confirm FTS is ready.
    _poll_end_us = int(datetime.now(UTC).timestamp() * 1_000_000)
    _poll_start_us = int((datetime.now(UTC) - timedelta(weeks=4)).timestamp() * 1_000_000)

    def _fts_ready():
        r = client.post("_search?type=logs", json={
            "query": {
                "sql": f'SELECT * FROM "{STREAM}" WHERE match_all(\'warehouse\') LIMIT 1',
                "start_time": _poll_start_us,
                "end_time": _poll_end_us,
                "from": 0,
                "size": 1,
            }
        })
        if r.status_code != 200:
            return False
        hits = r.json().get("hits", [])
        if not hits:
            return False
        log_val = str(hits[0].get("log", "")).lower()
        return "warehouse" in log_val

    wait_until(_fts_ready, timeout=120, interval=2.0,
               msg=f"Tantivy FTS not ready for {STREAM} after flush")
    logging.info("Post-flush vortex: Tantivy FTS ready")


class TestVortexJoin:
    """Scenario 39: self-join on a vortex stream returns correct results.

    The query-agent categories don't include JOIN queries, so this class
    covers scenario 39 explicitly with a standalone correctness check.
    Runs post-flush, same server as the parametrized tests above.
    """

    def test_39_self_join_on_vortex_stream(self, client, post_flush_vortex):  # noqa: ARG002
        from datetime import datetime, timedelta, UTC
        from support.factories import search_payload
        from tests.query_agent.conftest import STREAM

        now = datetime.now(UTC)
        payload = search_payload(
            f'SELECT a.pallet_id, b.pallet_id AS b_pallet FROM "{STREAM}" a '
            f'JOIN "{STREAM}" b ON a.conveyor_lane = b.conveyor_lane '
            f'WHERE a.pallet_id != b.pallet_id LIMIT 10',
            start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=10,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200, \
            f"self-join failed: {resp.status_code} {resp.text[:300]}"
        hits = resp.json()["hits"]
        assert len(hits) > 0, "self-join returned no rows — join broken on vortex"
        for h in hits:
            assert "pallet_id" in h, "join result missing pallet_id column"
            assert "b_pallet" in h, "join result missing b_pallet column"
            assert h["pallet_id"] != h["b_pallet"], "ON condition not enforced"


class TestVortexUtf8Int64CastPushdown:
    """Regression: vortex cast pushdown must not blow up on utf8 > int.

    Repros the bug fixed by o2-enterprise#2179: when a field is ingested
    first as i64 and later as utf8, the effective schema becomes utf8.
    DataFusion then coerces ``WHERE field > 0`` to
    ``CAST(field AS Int64) > 0``.  Before the fix, vortex accepted this
    cast for pushdown but had no utf8 -> i64 cast kernel, so execution
    failed with e.g. ``No CastReduce to cast constant array from utf8? to i64?``.

    This test forces that exact shape:
      1. ingest a batch with ``value`` as int (42, 100, ...)
      2. ingest a batch with ``value`` as string ("abc", "hello", "17") -> schema widens to utf8
      3. flush so a vortex file is generated
      4. run ``SELECT * FROM stream WHERE value > 0``
      5. assert 200 + empty partial_error (the query must not 5xx or partially fail)
    """

    @pytest.fixture(scope="class")
    def utf8_int64_stream(self):
        """Ingest i64-then-utf8 data into a fresh stream and flush to vortex."""
        from datetime import datetime, timedelta, UTC
        from support.wait import wait_until

        client = OpenObserveClient()
        stream = f"vortex_utf8_i64_cast_{int(time.time() * 1000)}_{_os.getpid()}"

        now = datetime.now(UTC)
        base_us = int(now.timestamp() * 1_000_000)

        # Batch 1: numeric values -> schema starts as i64.
        int_records = [
            {"_timestamp": base_us + i * 1_000_000, "value": v, "tag": f"i_{i}"}
            for i, v in enumerate([42, 100, 7, 250, 1])
        ]
        r1 = client.post(f"{stream}/_json", data=json.dumps(int_records),
                         headers={"Content-Type": "application/json"})
        assert r1.status_code == 200, f"int ingest failed: {r1.status_code} {r1.text[:300]}"

        # Batch 2: string values on the SAME field -> schema widens to utf8.
        # Includes numeric-looking strings ("17") to exercise the coercion path.
        str_records = [
            {"_timestamp": base_us + (10 + i) * 1_000_000, "value": v, "tag": f"s_{i}"}
            for i, v in enumerate(["abc", "hello", "17", "world", "3"])
        ]
        r2 = client.post(f"{stream}/_json", data=json.dumps(str_records),
                         headers={"Content-Type": "application/json"})
        assert r2.status_code == 200, f"utf8 ingest failed: {r2.status_code} {r2.text[:300]}"

        # Flush so a vortex file is generated with the widened utf8 schema.
        flush_r = client.put("node/flush", prefix="")
        logging.info("utf8/i64 cast fixture: flush -> %s", flush_r.status_code)
        time.sleep(2)

        # Wait for the flushed data to be searchable (vortex file registered).
        end_us = base_us + 3_600_000_000
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)

        def _searchable():
            r = client.post("_search?type=logs", json={
                "query": {
                    "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
                    "start_time": start_us, "end_time": end_us,
                    "from": 0, "size": 1,
                }
            })
            if r.status_code != 200:
                return False
            hits = r.json().get("hits", [])
            return bool(hits and hits[0].get("c", 0) >= len(int_records) + len(str_records))

        wait_until(_searchable, timeout=120, interval=2.0,
                   msg=f"{stream}: utf8+i64 data not searchable after flush")

        return {"stream": stream, "start_us": start_us, "end_us": end_us}

    def test_utf8_column_gt_int_does_not_crash_vortex(self, client, utf8_int64_stream):
        """SELECT * WHERE value > 0 must return 200 (no cast-pushdown 5xx)."""
        from support.factories import search_payload

        stream = utf8_int64_stream["stream"]
        payload = search_payload(
            f'SELECT * FROM "{stream}" WHERE value > 0',
            start_time=utf8_int64_stream["start_us"],
            end_time=utf8_int64_stream["end_us"],
            size=100,
        )
        resp = client.post("_search?type=logs", json=payload)

        # The bug manifested as an error surfaced via partial_error / 5xx —
        # message contained "No CastReduce" or "No CastKernel ... utf8 ... i64".
        assert resp.status_code == 200, (
            f"utf8>int on vortex failed with {resp.status_code}: {resp.text[:600]}"
        )
        body = resp.json()
        pe = body.get("partial_error")
        assert not pe, (
            f"partial_error set — cast-pushdown regression: {pe!r}"
        )


def _make_test(cat, queries):
    @pytest.mark.parametrize("query", queries, ids=[q["id"] for q in queries])
    def _test(client, post_flush_vortex, query):  # noqa: ARG001
        run_query(client, query)
    return _test


_CATEGORIES = load_all_queries()
for _cat, _queries in sorted(_CATEGORIES.items()):
    _fn = _make_test(_cat, _queries)
    _fn.__name__ = f"test_vortex_{_cat}"
    _fn.__doc__ = f"Post-flush vortex: run {_cat} queries against vortex files"
    globals()[_fn.__name__] = _fn

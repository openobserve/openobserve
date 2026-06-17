"""Phase 3 — Post-Flush Vortex: run all queries after flush against vortex files.

Identical query set as Phase 2 (test_2_parquet.py) — 155 queries across 12
categories. The server must be started with ZO_FILE_FORMAT=vortex. Any
divergence in results vs parquet is a vortex bug.

Enterprise CI only — do not add this file to the OSS api-testing.yml.

Test plan: scenarios 26–46 (Section 3 — Query Correctness, vortex phase).
"""
import logging
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

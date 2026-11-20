"""A full-text query keeps its hits after the rows move from the WAL to object storage (ENT#536).

The first `match_all` is answered from the ingester WAL and cached; once the files were uploaded
with their tantivy index, the same query returned 0. `_search_partition` counts only rows in the
file list, so the test waits until it reports every row before querying again, cached and uncached.
The `tantivy_after_wal_flush` shard keeps WAL files 10s and pushes every 2s; against a server on the
600s default, set FTS_FLUSH_WAIT_SECS=900.
"""

from __future__ import annotations

import os
import time

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

ROWS = 50
TOKEN = "ovnbtok536"
FLUSH_WAIT_SECS = int(os.environ.get("FTS_FLUSH_WAIT_SECS", "180"))


def _uploaded_records(client: OpenObserveClient, stream: str, start: int, end: int) -> int:
    body = {"sql": f'SELECT count(*) FROM "{stream}"', "start_time": start, "end_time": end, "streaming_output": True}
    resp = client.post("_search_partition", params={"type": "logs"}, json=body)
    assert resp.status_code == 200, f"_search_partition: {resp.status_code} {resp.text[:300]}"
    return resp.json().get("records", 0)


def _match_all_count(client: OpenObserveClient, stream: str, start: int, end: int, use_cache: bool = True) -> int:
    body = {
        "query": {
            "sql": f"SELECT count(*) AS cnt FROM \"{stream}\" WHERE match_all('{TOKEN}')",
            "start_time": start,
            "end_time": end,
            "size": -1,
        }
    }
    resp = client.post("_search", params={"type": "logs", "use_cache": str(use_cache).lower()}, json=body)
    assert resp.status_code == 200, f"search: {resp.status_code} {resp.text[:300]}"
    hits = resp.json()["hits"]
    return hits[0]["cnt"] if hits else 0


def test_match_all_returns_the_same_hits_before_and_after_the_wal_flush(client: OpenObserveClient):
    stream = unique_name("pytest_fts_flush")
    now = int(time.time() * 1_000_000)
    rows = [
        {"_timestamp": now - i * 1_000_000, "message": f"request {i} {TOKEN} done", "seq": i}
        for i in range(ROWS)
    ]
    resp = client.post(f"{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest: {resp.status_code} {resp.text[:300]}"
    start, end = now - 3_600_000_000, now + 600_000_000

    try:
        wait_until(
            lambda: _match_all_count(client, stream, start, end) == ROWS,
            timeout=120,
            interval=2,
            msg=f"match_all over WAL never returned {ROWS}",
        )
        wait_until(
            lambda: _uploaded_records(client, stream, start, end) >= ROWS,
            timeout=FLUSH_WAIT_SECS,
            interval=5,
            msg=f"{stream} never left the WAL; set FTS_FLUSH_WAIT_SECS past the server's ZO_MAX_FILE_RETENTION_TIME",
        )
        assert _match_all_count(client, stream, start, end) == ROWS, (
            "ENT#536: match_all lost its hits once the files moved to object storage"
        )
        assert _match_all_count(client, stream, start, end, use_cache=False) == ROWS, (
            "ENT#536: uncached match_all over the uploaded files lost its hits"
        )
    finally:
        client.delete(f"streams/{stream}", params={"type": "logs"})

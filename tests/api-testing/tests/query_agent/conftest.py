"""Shared fixtures for query agent tests.

Generates deterministic data in-memory (no external JSON file needed).
Each query filters to its own time range within the dataset for isolation.
"""

import json
import logging
import sys
from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

# Shared deterministic data generator — single source of truth for both
# the test fixture and the capture_row_counts.py utility.
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "test-data" / "query-agent"))
from data_gen import build_dataset  # noqa: E402


@pytest.fixture(scope="session")
def ingest_query_agent_data():
    """Generate and ingest deterministic data into query_agent_test_v2 stream."""

    client = OpenObserveClient()
    stream = "query_agent_test_v2"

    # Generate data in-memory — no external JSON file dependency
    records = build_dataset()
    data = json.dumps(records)

    resp = client.post(f"{stream}/_json", data=data, headers={"Content-Type": "application/json"})
    if resp.status_code == 200:
        logging.info("Ingested %d generated records (%d bytes)", len(records), len(data))
    else:
        pytest.fail(f"Ingestion failed: {resp.status_code} — {resp.text[:300]}")

    # Flush so data is committed to storage
    flush_resp = client.put("node/flush")
    if flush_resp.status_code == 200:
        logging.info("Flush successful")
    elif flush_resp.status_code == 404:
        logging.info("Flush not needed (local mode)")
    else:
        logging.warning("Flush returned %s: %s", flush_resp.status_code, flush_resp.text[:200])

    # Poll until all records are searchable.
    expected = len(records)
    # Timestamp of the very last record — used to verify the tail of the
    # dataset is queryable, not just the total count (which can be satisfied
    # by old data from previous runs at different timestamps).
    _max_ts = max(r["_timestamp"] for r in records)

    def _data_is_searchable():
        now = datetime.now(UTC)
        end_us = int(now.timestamp() * 1_000_000)
        start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
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
        if not (hits and hits[0].get("c", 0) >= expected):
            return False
        # Verify the highest-timestamp record is searchable.
        # A COUNT(*) can be satisfied by old data from prior runs whose
        # timestamps differ from the current ingestion batch. Without this
        # secondary check, tests for later-numbered queries (which have
        # higher offsets from BASE_TS) can fail with 0 results.
        tail_payload = {
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{stream}"',
                "start_time": _max_ts - 60_000_000,
                "end_time": _max_ts + 60_000_000,
                "from": 0,
                "size": 1,
            }
        }
        tr = client.post("_search?type=logs", json=tail_payload)
        if tr.status_code != 200:
            return False
        thits = tr.json().get("hits", [])
        return bool(thits and thits[0].get("c", 0) >= 1)

    wait_until(_data_is_searchable, timeout=120, interval=1.0,
               msg=f"query_agent_test_v2 data not searchable ({expected} records)")
    logging.info("query_agent_test_v2 data is searchable (%d records)", expected)

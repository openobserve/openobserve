"""Shared fixtures for query agent tests.

Ingests dataset.json once into the query_agent_test stream.
Each query filters to its own time range within the dataset for isolation.
"""

import logging
from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

ROOT_DIR = Path(__file__).parent.parent.parent.parent
DATASET_FILE = ROOT_DIR / "test-data" / "query-agent" / "dataset.json"


@pytest.fixture(scope="session")
def ingest_query_agent_data():
    """Ingest dataset.json into the query_agent_test stream. Runs once per session."""

    if not DATASET_FILE.exists():
        logging.warning("dataset.json not found — skipping ingestion")
        return

    with open(DATASET_FILE) as f:
        data = f.read()

    client = OpenObserveClient()
    stream = "query_agent_test"

    resp = client.post(f"{stream}/_json", data=data, headers={"Content-Type": "application/json"})
    if resp.status_code == 200:
        logging.info("Ingested dataset.json (%d bytes)", len(data))
    else:
        logging.error("Ingestion failed: %s — %s", resp.status_code, resp.text[:300])
        return

    # Flush so data is committed to storage
    flush_resp = client.put("node/flush", prefix="")
    if flush_resp.status_code == 200:
        logging.info("Flush successful")
    elif flush_resp.status_code == 404:
        logging.info("Flush not needed (local mode)")
    else:
        logging.warning("Flush returned %s: %s", flush_resp.status_code, flush_resp.text[:200])

    # Poll until data is searchable — uses a wide time window matching root conftest pattern
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
        return bool(hits and hits[0].get("c", 0) > 0)

    wait_until(_data_is_searchable, timeout=60, interval=1.0, msg="query_agent_test data not searchable")
    logging.info("query_agent_test data is searchable")

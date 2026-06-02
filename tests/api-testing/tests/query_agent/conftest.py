"""Shared fixtures for query agent tests.

Generates deterministic data in-memory (no external JSON file needed).
Each query filters to its own time range within the dataset for isolation.
"""

import json
import logging
import random
from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

random.seed(42)

BASE_TS = int(datetime(2026, 6, 1, 10, 0, 0, tzinfo=UTC).timestamp() * 1_000_000)

# ── Completely original field schema — warehouse/supply-chain IoT ───────
FIELD_POOL = {
    "pallet_id":     ["PL-001", "PL-002", "PL-003", "PL-004", "PL-005", "PL-006", "PL-007", "PL-008"],
    "load_factor":   [12.5, 33.0, 55.2, 72.8, 88.1, 94.6, 45.3, 67.9, 21.4, 99.0],
    "charge_remaining": [10.0, 25.0, 42.5, 58.0, 75.3, 88.7, 95.0, 5.0, 33.3, 66.6],
    "throughput_rate": [150.0, 320.0, 480.0, 610.0, 725.0, 840.0, 290.0, 555.0, 190.0, 900.0],
    "sorter_model":  ["SORT-X1", "SORT-A7", "SORT-M3", "SORT-Z9", "SORT-X1", "SORT-A7", "SORT-M3", "SORT-Q5"],
    "conveyor_lane": ["LANE-A", "LANE-B", "LANE-C", "LANE-D", "LANE-A", "LANE-B", "LANE-C", "LANE-D"],
    "facility_zone": ["ZONE-1", "ZONE-2", "ZONE-3", "ZONE-4", "ZONE-1", "ZONE-2", "ZONE-3", "ZONE-4"],
    "control_center":["CC-ALPHA", "CC-BETA", "CC-GAMMA", "CC-DELTA", "CC-ALPHA", "CC-BETA", "CC-GAMMA", "CC-DELTA"],
    "item_count":    [50, 120, 200, 340, 88, 155, 410, 275, 60, 500],
    "defect_limit":  [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 0.8, 1.2, 2.8, 3.5],
    "runtime_hours": [24, 72, 168, 360, 720, 48, 120, 500, 90, 1000],
    "operation_mode":["auto", "manual", "hybrid", "auto", "manual", "hybrid", "auto", "manual"],
    "package_size":  [100, 250, 500, 750, 1000, 200, 350, 600, 850, 1200],
    "scan_attempts": [1, 2, 3, 1, 2, 4, 1, 3, 2, 5],
    "conveyor_segment": [1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
    "cell_temp":     [18.5, 22.0, 26.3, 30.1, 35.7, 19.2, 24.8, 28.9, 32.5, 40.0],
    "build_signature":["BS-2026-A1", "BS-2026-B2", "BS-2026-C3", "BS-2025-D4", "BS-2026-A1",
                       "BS-2026-B2", "BS-2026-C3", "BS-2025-D4"],
}

STREAM_VALUES = ["stdout", "stdout", "stdout", "stderr"]


def _make_record(ts, idx, qid):
    """Build a single deterministic data record."""
    r = {
        "_timestamp": ts,
        "log": f"{qid} warehouse event record {idx}",
        "stream": STREAM_VALUES[idx % len(STREAM_VALUES)],
    }
    for field, pool in FIELD_POOL.items():
        r[field] = pool[idx % len(pool)]
    return r


def _build_dataset(num_queries=155):
    """Generate deterministic records for queries Q001-Q{num_queries}."""
    records = []
    for qi in range(1, num_queries + 1):
        qid = f"Q{qi:03d}"
        base = BASE_TS + (qi - 1) * 60_000_000
        for i in range(10):
            ts = base + i * 18_000_000
            records.append(_make_record(ts, i, qid))
    return records


@pytest.fixture(scope="session")
def ingest_query_agent_data():
    """Generate and ingest deterministic data into query_agent_test stream."""

    client = OpenObserveClient()
    stream = "query_agent_test"

    # Generate data in-memory — no external JSON file dependency
    records = _build_dataset()
    data = json.dumps(records)

    resp = client.post(f"{stream}/_json", data=data, headers={"Content-Type": "application/json"})
    if resp.status_code == 200:
        logging.info("Ingested %d generated records (%d bytes)", len(records), len(data))
    else:
        logging.error("Ingestion failed: %s — %s", resp.status_code, resp.text[:300])
        return

    # Flush so data is committed to storage
    flush_resp = client.put("node/flush")
    if flush_resp.status_code == 200:
        logging.info("Flush successful")
    elif flush_resp.status_code == 404:
        logging.info("Flush not needed (local mode)")
    else:
        logging.warning("Flush returned %s: %s", flush_resp.status_code, flush_resp.text[:200])

    # Poll until data is searchable
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

    wait_until(_data_is_searchable, timeout=60, interval=1.0,
               msg="query_agent_test data not searchable")
    logging.info("query_agent_test data is searchable")

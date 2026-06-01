#!/usr/bin/env python3
"""Ingest deterministic data into the dev instance, then capture row counts for all queries."""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import base64

BASE = os.environ["ZO_BASE_URL"].rstrip("/") + "/"
EMAIL = os.environ["ZO_ROOT_USER_EMAIL"]
PASSWORD = os.environ["ZO_ROOT_USER_PASSWORD"]
AUTH = base64.b64encode(f"{EMAIL}:{PASSWORD}".encode()).decode()

QUERIES_DIR = Path(__file__).parent / "queries"
STREAM = "query_agent_test"

BASE_TS = int(datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc).timestamp() * 1_000_000)

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
    r = {
        "_timestamp": ts,
        "log": f"{qid} warehouse event record {idx}",
        "stream": STREAM_VALUES[idx % len(STREAM_VALUES)],
    }
    for field, pool in FIELD_POOL.items():
        r[field] = pool[idx % len(pool)]
    return r


def _build_dataset(num_queries=155):
    records = []
    for qi in range(1, num_queries + 1):
        qid = f"Q{qi:03d}"
        base = BASE_TS + (qi - 1) * 60_000_000
        for i in range(10):
            ts = base + i * 18_000_000
            records.append(_make_record(ts, i, qid))
    return records


session = requests.Session()
session.headers["Authorization"] = f"Basic {AUTH}"

# ── Ingest data ──────────────────────────────────────────────────────────
print("Generating dataset...")
records = _build_dataset()
data = json.dumps(records)
print(f"Generated {len(records)} records ({len(data)} bytes)")

resp = session.post(f"{BASE}api/default/{STREAM}/_json", data=data,
                    headers={"Content-Type": "application/json"})
if resp.status_code == 200:
    print(f"Ingested {len(records)} records")
else:
    print(f"Ingestion FAILED: {resp.status_code} — {resp.text[:300]}", file=sys.stderr)
    sys.exit(1)

# ── Flush ────────────────────────────────────────────────────────────────
flush_resp = session.put(f"{BASE}api/default/node/flush", params={"prefix": ""})
print(f"Flush: {flush_resp.status_code}")

# ── Wait for all 1550 records to be searchable ───────────────────────────
print("Waiting for all 1550 records to be searchable...")
now = datetime.now(timezone.utc)
end_us = int(now.timestamp() * 1_000_000)
start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
searchable = 0
for attempt in range(120):
    payload = {
        "query": {
            "sql": f'SELECT COUNT(*) AS c FROM "{STREAM}"',
            "start_time": start_us,
            "end_time": end_us,
            "from": 0,
            "size": 1,
        }
    }
    r = session.post(f"{BASE}api/default/_search?type=logs", json=payload)
    if r.status_code == 200:
        hits = r.json().get("hits", [])
        searchable = hits[0].get("c", 0) if hits else 0
        if searchable >= 1550:
            print(f"All data searchable: {searchable} records (attempt {attempt+1})")
            break
        if attempt % 10 == 0:
            print(f"  attempt {attempt+1}: {searchable}/1550 records indexed...")
    time.sleep(2)
else:
    print(f"WARNING: Only {searchable}/1550 records indexed after 4 min, proceeding anyway")

# ── Capture row counts ───────────────────────────────────────────────────
print("\nCapturing row counts...")
updated = 0
for fp in sorted(QUERIES_DIR.glob("*.json")):
    with open(fp) as f:
        query_data = json.load(f)
    dirty = False
    for q in query_data["queries"]:
        payload = {
            "query": {
                "sql": q["sql"],
                "start_time": q["time_range"]["start"],
                "end_time": q["time_range"]["end"],
                "from": 0,
                "size": 150,
            }
        }
        url = f"{BASE}api/default/_search?type=logs"
        resp = session.post(url, json=payload)
        if resp.status_code == 200:
            hits = resp.json().get("hits", [])
            actual_count = len(hits)
            q["expected"]["row_count"] = actual_count
            dirty = True
            print(f"  {q['id']}: {actual_count} rows")
        else:
            print(f"  {q['id']}: ERROR {resp.status_code} — {resp.text[:200]}", file=sys.stderr)
        time.sleep(0.3)

    if dirty:
        with open(fp, "w") as f:
            json.dump(query_data, f, indent=2)
        updated += 1
        print(f"Wrote {fp.name}")

print(f"\nUpdated {updated} category files")

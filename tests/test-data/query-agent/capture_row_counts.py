#!/usr/bin/env python3
"""Ingest deterministic data and capture row counts for all queries against a live instance."""
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
ORG = os.environ.get("ZO_ORG_ID", "default")
AUTH = base64.b64encode(f"{EMAIL}:{PASSWORD}".encode()).decode()

QUERIES_DIR = Path(__file__).parent / "queries"
STREAM = "query_agent_test_v2"

# Shared deterministic data generator
from data_gen import build_dataset  # noqa: E402

session = requests.Session()
session.headers["Authorization"] = f"Basic {AUTH}"

# ── Ingest data ──────────────────────────────────────────────────────────
print("Generating dataset...")
records = build_dataset()
data = json.dumps(records)
print(f"Generated {len(records)} records ({len(data)} bytes)")

resp = session.post(f"{BASE}api/{ORG}/{STREAM}/_json", data=data,
                    headers={"Content-Type": "application/json"})
if resp.status_code == 200:
    print(f"Ingested {len(records)} records")
else:
    print(f"Ingestion FAILED: {resp.status_code} — {resp.text[:300]}", file=sys.stderr)
    sys.exit(1)

# ── Flush ────────────────────────────────────────────────────────────────
flush_resp = session.put(f"{BASE}api/{ORG}/node/flush")
print(f"Flush: {flush_resp.status_code}")

# ── Wait for all records to be searchable ────────────────────────────────
expected = len(records)
print(f"Waiting for all {expected} records to be searchable...")
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
    r = session.post(f"{BASE}api/{ORG}/_search?type=logs", json=payload)
    if r.status_code == 200:
        hits = r.json().get("hits", [])
        searchable = hits[0].get("c", 0) if hits else 0
        if searchable >= expected:
            print(f"All data searchable: {searchable} records (attempt {attempt+1})")
            break
        if attempt % 10 == 0:
            print(f"  attempt {attempt+1}: {searchable}/{expected} records indexed...")
    time.sleep(2)
else:
    print(f"WARNING: Only {searchable}/{expected} records indexed after 4 min, proceeding anyway")

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
                "size": 500,
            }
        }
        url = f"{BASE}api/{ORG}/_search?type=logs"
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

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
STREAM = f"query_agent_capture_{int(time.time())}"

# Shared deterministic data generator
from data_gen import BASE_TS, build_dataset  # noqa: E402

session = requests.Session()
session.headers["Authorization"] = f"Basic {AUTH}"


def search(sql, start_us, end_us, size=500):
    """Run a search and return (status_code, hit_count, error_text)."""
    payload = {
        "query": {
            "sql": sql,
            "start_time": start_us,
            "end_time": end_us,
            "from": 0,
            "size": size,
        }
    }
    r = session.post(f"{BASE}api/{ORG}/_search?type=logs", json=payload)
    if r.status_code == 200:
        return 200, len(r.json().get("hits", [])), None
    return r.status_code, -1, r.text[:300]


# ── Ingest data ──────────────────────────────────────────────────────────
print("Generating dataset...")
records = build_dataset()
data = json.dumps(records)
print(f"Generated {len(records)} records ({len(data)} bytes)")

resp = session.post(f"{BASE}api/{ORG}/{STREAM}/_json", data=data,
                    headers={"Content-Type": "application/json"})
if resp.status_code == 200:
    print(f"Ingested {len(records)} records into {STREAM}")
else:
    print(f"Ingestion FAILED: {resp.status_code} — {resp.text[:300]}", file=sys.stderr)
    sys.exit(1)

# ── Try explicit flush (may 404 on non-ingester nodes) ───────────────────
flush_resp = session.put(f"{BASE}node/flush")
print(f"Flush: {flush_resp.status_code}")

# ── Wait for all records to be searchable ────────────────────────────────
expected = len(records)
_max_ts = max(r["_timestamp"] for r in records)
print(f"Waiting for all {expected} records to be searchable...")
now = datetime.now(timezone.utc)
end_us = int(now.timestamp() * 1_000_000)
start_us = int((now - timedelta(weeks=4)).timestamp() * 1_000_000)
searchable = 0
for attempt in range(120):
    status, count, _ = search(f'SELECT COUNT(*) AS c FROM "{STREAM}"', start_us, end_us, size=1)
    if status == 200 and count >= expected:
        # Secondary check: ensure the newest records are searchable
        s2, c2, _ = search(
            f'SELECT COUNT(*) AS c FROM "{STREAM}"',
            _max_ts - 60_000_000,
            _max_ts + 60_000_000,
            size=1,
        )
        if s2 == 200 and c2 >= 1:
            print(f"Data searchable: {count} total, {c2} in tail window (attempt {attempt+1})")
            break
    if attempt % 10 == 0:
        print(f"  attempt {attempt+1}: {count}/{expected} records indexed...")
    time.sleep(2)
else:
    print(f"WARNING: Only {searchable}/{expected} records indexed after 4 min")

# ── Capture row counts ───────────────────────────────────────────────────
print("\nCapturing row counts...")
updated = 0
for fp in sorted(QUERIES_DIR.glob("*.json")):
    with open(fp) as f:
        query_data = json.load(f)
    dirty = False
    for q in query_data["queries"]:
        offset = q["time_offset"]
        sql = q["sql"].replace("{stream}", STREAM)
        start = BASE_TS + offset["start_offset"]
        end = BASE_TS + offset["end_offset"]
        status, count, error = search(sql, start, end)
        if status == 200:
            q["expected"]["row_count"] = count
            dirty = True
            print(f"  {q['id']}: {count} rows")
        else:
            print(f"  {q['id']}: ERROR {status} — {error}", file=sys.stderr)
        time.sleep(0.3)

    if dirty:
        with open(fp, "w") as f:
            json.dump(query_data, f, indent=2)
        updated += 1
        print(f"Wrote {fp.name}")

print(f"\nUpdated {updated} category files")
print(f"Stream: {STREAM}")

"""Shared deterministic data generator for query agent tests.

Used by both conftest.py (test fixture) and capture_row_counts.py (utility).
"""

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

random.seed(42)

# Check for a BASE_TS override saved by compute_counts.py so that the
# compute oracle and the test harness share the same BASE_TS. Without
# this, a minute boundary crossing between compute and test shifts
# all histogram bucket timestamps.
_OVERRIDE_FILE = Path(__file__).parent / "base_ts_override.json"
if _OVERRIDE_FILE.exists():
    BASE_TS = json.loads(_OVERRIDE_FILE.read_text())["BASE_TS"]
else:
    _now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    BASE_TS = int((_now - timedelta(hours=4)).timestamp() * 1_000_000)

FIELD_POOL = {
    "pallet_id":       ["PL-001", "PL-002", "PL-003", "PL-004", "PL-005", "PL-006", "PL-007", "PL-008"],
    "load_factor":     [12.5, 33.0, 55.2, 72.8, 88.1, 94.6, 45.3, 67.9, 21.4, 99.0],
    "charge_remaining":[10.0, 25.0, 42.5, 58.0, 75.3, 88.7, 95.0, 5.0, 33.3, 66.6],
    "throughput_rate": [150.0, 320.0, 480.0, 610.0, 725.0, 840.0, 290.0, 555.0, 190.0, 900.0],
    "sorter_model":    ["SORT-X1", "SORT-A7", "SORT-M3", "SORT-Z9", "SORT-X1", "SORT-A7", "SORT-M3", "SORT-Q5"],
    "conveyor_lane":   ["LANE-A", "LANE-B", "LANE-C", "LANE-D", "LANE-A", "LANE-B", "LANE-C", "LANE-D"],
    "facility_zone":   ["ZONE-1", "ZONE-2", "ZONE-3", "ZONE-4", "ZONE-1", "ZONE-2", "ZONE-3", "ZONE-4"],
    "control_center":  ["CC-ALPHA", "CC-BETA", "CC-GAMMA", "CC-DELTA", "CC-ALPHA", "CC-BETA", "CC-GAMMA", "CC-DELTA"],
    "item_count":      [50, 120, 200, 340, 88, 155, 410, 275, 60, 500],
    "defect_limit":    [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 0.8, 1.2, 2.8, 3.5],
    "runtime_hours":   [24, 72, 168, 360, 720, 48, 120, 500, 90, 1000],
    "operation_mode":  ["auto", "manual", "hybrid", "auto", "manual", "hybrid", "auto", "manual"],
    "package_size":    [100, 250, 500, 750, 1000, 200, 350, 600, 850, 1200],
    "scan_attempts":   [1, 2, 3, 1, 2, 4, 1, 3, 2, 5],
    "conveyor_segment":[1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
    "cell_temp":       [18.5, 22.0, 26.3, 30.1, 35.7, 19.2, 24.8, 28.9, 32.5, 40.0],
    "build_signature": ["BS-2026-A1", "BS-2026-B2", "BS-2026-C3", "BS-2025-D4", "BS-2026-A1",
                        "BS-2026-B2", "BS-2026-C3", "BS-2025-D4"],
}

STREAM_VALUES = ["stdout", "stdout", "stdout", "stderr"]


def make_record(ts, idx, qid):
    """Build a single deterministic data record."""
    r = {
        "_timestamp": ts,
        "log": f"{qid} warehouse event record {idx}",
        "stream": STREAM_VALUES[idx % len(STREAM_VALUES)],
    }
    for field, pool in FIELD_POOL.items():
        r[field] = pool[idx % len(pool)]
    return r


def build_dataset(num_queries=155):
    """Generate deterministic records for queries Q001-Q{num_queries}."""
    records = []
    for qi in range(1, num_queries + 1):
        qid = f"Q{qi:03d}"
        base = BASE_TS + (qi - 1) * 60_000_000
        for i in range(10):
            ts = base + i * 18_000_000
            records.append(make_record(ts, i, qid))
    return records

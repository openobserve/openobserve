#!/usr/bin/env python3
"""
Performance Benchmark: Single GROUP BY vs Two-field GROUP BY via Tantivy
========================================================================
Tests the optimization from issue #12039.

Usage:
    python3 scripts/bench_group_by.py [--base-url URL] [--records N] [--rounds N]

Phases:
    1. Create stream with index_fields configured
    2. Ingest test data (high cardinality fields)
    3. Wait for data flush & index build
    4. Run benchmark queries: single vs two-field GROUP BY
    5. Output comparison report
"""

import argparse
import json
import random
import string
import sys
import time
from datetime import datetime, timedelta, timezone
from statistics import mean, median, stdev
from urllib.request import Request, urlopen
from urllib.error import URLError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEFAULT_BASE_URL = "http://localhost:5080"
DEFAULT_USER = "admin@test.com"
DEFAULT_PASS = "Admin123!"
ORG = "default"
STREAM = "bench_group_by"

# Data generation params
USERIDS = [f"user_{i:04d}" for i in range(500)]          # 500 unique users
SEARCH_PHRASES = [f"phrase_{i:03d}" for i in range(200)] # 200 unique phrases
STATUSES = ["200", "301", "400", "403", "404", "500"]
METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"]
SERVICES = [f"svc_{i:02d}" for i in range(50)]           # 50 services


def make_auth_header(user, password):
    import base64
    cred = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {cred}", "Content-Type": "application/json"}


def api_request(base_url, path, method="GET", data=None, headers=None):
    url = f"{base_url}{path}"
    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except URLError as e:
        body_text = ""
        if hasattr(e, "read"):
            try:
                body_text = e.read().decode()[:200]
            except Exception:
                pass
        return 0, {"error": str(e), "body": body_text}


# ---------------------------------------------------------------------------
# Phase 1: Setup stream with index fields
# ---------------------------------------------------------------------------
def setup_stream(base_url, headers):
    print("\n=== Phase 1: Setup stream & index fields ===")

    # Update stream settings to enable index on key fields
    index_fields = ["userid", "searchphrase", "service", "method", "status"]
    settings = {
        "index_fields": {"add": index_fields, "remove": []},
        "full_text_search_keys": {"add": ["message"], "remove": []},
    }
    status, resp = api_request(
        base_url,
        f"/api/{ORG}/streams/{STREAM}/settings",
        method="PUT",
        data=settings,
        headers=headers,
    )
    if status == 200:
        print(f"  Stream settings updated: index_fields = {index_fields}")
        return True
    else:
        print(f"  Settings response: {status} {resp}")
        return False


# ---------------------------------------------------------------------------
# Phase 2: Generate & ingest data
# ---------------------------------------------------------------------------
def generate_batch(batch_size, base_ts):
    records = []
    for i in range(batch_size):
        # Keep within last 4 hours to avoid ZO_INGEST_ALLOWED_UPTO rejection
        ts = base_ts + timedelta(seconds=random.randint(0, 4 * 3600))
        records.append({
            "_timestamp": int(ts.timestamp() * 1_000_000),
            "userid": random.choice(USERIDS),
            "searchphrase": random.choice(SEARCH_PHRASES),
            "status": random.choice(STATUSES),
            "method": random.choice(METHODS),
            "service": random.choice(SERVICES),
            "response_time": random.randint(1, 5000),
            "message": f"request from {random.choice(USERIDS)} searching {random.choice(SEARCH_PHRASES)}",
        })
    return records


def ingest_data(base_url, headers, total_records, batch_size=5000):
    print(f"\n=== Phase 2: Ingesting {total_records:,} records ===")
    base_ts = datetime.now(timezone.utc) - timedelta(hours=4)
    ingested = 0
    start = time.time()

    # First batch: create the stream
    first_batch = min(batch_size, total_records)
    records = generate_batch(first_batch, base_ts)
    status, resp = api_request(
        base_url,
        f"/api/{ORG}/{STREAM}/_json",
        method="POST",
        data=records,
        headers=headers,
    )
    if status == 200:
        successful = resp.get("status", [{}])[0].get("successful", 0)
        failed = resp.get("status", [{}])[0].get("failed", 0)
        if failed > 0:
            error = resp.get("status", [{}])[0].get("error", "")
            print(f"  WARNING: first batch {successful} ok, {failed} failed: {error}")
    ingested += first_batch

    # Now configure index fields (stream must exist) - retry up to 5 times
    for attempt in range(5):
        time.sleep(1)  # Wait a moment for stream to be fully created
        if setup_stream(base_url, headers):
            break
        print(f"    Retrying settings ({attempt+2}/5)...")

    # Continue ingesting remaining data
    while ingested < total_records:
        this_batch = min(batch_size, total_records - ingested)
        records = generate_batch(this_batch, base_ts)
        status, resp = api_request(
            base_url,
            f"/api/{ORG}/{STREAM}/_json",
            method="POST",
            data=records,
            headers=headers,
        )
        ingested += this_batch
        elapsed = time.time() - start
        rate = ingested / elapsed if elapsed > 0 else 0
        print(f"\r  Ingested: {ingested:>10,} / {total_records:,}  ({rate:,.0f} rec/s)", end="", flush=True)

    elapsed = time.time() - start
    print(f"\n  Done in {elapsed:.1f}s ({ingested/elapsed:,.0f} rec/s)")
    return ingested


def flush_data(base_url, headers):
    print("\n=== Phase 3: Flushing data & waiting for index build ===")
    api_request(base_url, "/node/flush", method="PUT", headers=headers)
    print("  Flush requested, waiting 30s for compaction + index build...")
    for i in range(30, 0, -1):
        print(f"\r  Waiting... {i:2d}s", end="", flush=True)
        time.sleep(1)
    print("\r  Ready.                ")


# ---------------------------------------------------------------------------
# Phase 4: Benchmark queries
# ---------------------------------------------------------------------------
def run_query(base_url, headers, sql, start_time, end_time):
    """Run a search query and return (elapsed_ms, num_hits, scan_size)."""
    payload = {
        "query": {
            "sql": sql,
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 1000,
        }
    }
    t0 = time.time()
    status, resp = api_request(
        base_url,
        f"/api/{ORG}/_search?type=logs",
        method="POST",
        data=payload,
        headers=headers,
    )
    elapsed_ms = (time.time() - t0) * 1000

    hits = 0
    scan_size = 0
    if status == 200:
        hits = resp.get("total", 0)
        scan_size = resp.get("scan_size", 0)
    else:
        print(f"\n  Query error: {status} {resp}")

    return elapsed_ms, hits, scan_size


def benchmark(base_url, headers, rounds):
    print(f"\n=== Phase 4: Running benchmark ({rounds} rounds per query) ===\n")

    now = datetime.now(timezone.utc)
    start_us = int((now - timedelta(hours=5)).timestamp() * 1_000_000)
    end_us = int(now.timestamp() * 1_000_000)

    queries = {
        # --- Single GROUP BY ---
        "1-field GROUP BY (userid, LIMIT 10)": (
            f'SELECT userid, COUNT(*) as cnt FROM "{STREAM}" '
            f"GROUP BY userid ORDER BY cnt DESC LIMIT 10"
        ),
        "1-field GROUP BY (searchphrase, LIMIT 10)": (
            f'SELECT searchphrase, COUNT(*) as cnt FROM "{STREAM}" '
            f"GROUP BY searchphrase ORDER BY cnt DESC LIMIT 10"
        ),
        "1-field GROUP BY (service, LIMIT 20)": (
            f'SELECT service, COUNT(*) as cnt FROM "{STREAM}" '
            f"GROUP BY service ORDER BY cnt DESC LIMIT 20"
        ),
        # --- Two-field GROUP BY ---
        "2-field GROUP BY (userid+searchphrase, LIMIT 10)": (
            f'SELECT userid, searchphrase, COUNT(*) as cnt FROM "{STREAM}" '
            f"GROUP BY userid, searchphrase ORDER BY cnt DESC LIMIT 10"
        ),
        "2-field GROUP BY (userid+service, LIMIT 10)": (
            f'SELECT userid, service, COUNT(*) as cnt FROM "{STREAM}" '
            f"GROUP BY userid, service ORDER BY cnt DESC LIMIT 10"
        ),
        "2-field GROUP BY (service+method, LIMIT 20)": (
            f'SELECT service, method, COUNT(*) as cnt FROM "{STREAM}" '
            f"GROUP BY service, method ORDER BY cnt DESC LIMIT 20"
        ),
        # --- Baseline: full scan aggregation (non-indexed field) ---
        "Baseline: GROUP BY non-indexed (response_time buckets)": (
            f'SELECT CASE WHEN response_time < 100 THEN \'fast\' '
            f"WHEN response_time < 1000 THEN 'medium' ELSE 'slow' END as speed, "
            f'COUNT(*) as cnt FROM "{STREAM}" GROUP BY speed ORDER BY cnt DESC LIMIT 10'
        ),
    }

    results = {}
    for label, sql in queries.items():
        print(f"  {label}")
        print(f"    SQL: {sql[:100]}...")
        latencies = []
        for r in range(rounds):
            ms, hits, scan_size = run_query(base_url, headers, sql, start_us, end_us)
            latencies.append(ms)
            print(f"    Round {r+1}: {ms:>8.1f} ms  (hits={hits})", flush=True)

        results[label] = {
            "latencies": latencies,
            "min": min(latencies),
            "max": max(latencies),
            "mean": mean(latencies),
            "median": median(latencies),
            "stdev": stdev(latencies) if len(latencies) > 1 else 0,
        }
        print()

    return results


# ---------------------------------------------------------------------------
# Phase 5: Report
# ---------------------------------------------------------------------------
def print_report(results, total_records):
    print("\n" + "=" * 90)
    print(f"  BENCHMARK REPORT  ({total_records:,} records)")
    print("=" * 90)
    print(f"{'Query':<55} {'Min':>8} {'Mean':>8} {'Median':>8} {'Max':>8} {'StdDev':>8}")
    print("-" * 90)

    for label, r in results.items():
        print(
            f"{label:<55} "
            f"{r['min']:>7.1f}ms "
            f"{r['mean']:>7.1f}ms "
            f"{r['median']:>7.1f}ms "
            f"{r['max']:>7.1f}ms "
            f"{r['stdev']:>7.1f}ms"
        )

    # Comparison section
    print("\n" + "-" * 90)
    print("  COMPARISON: 1-field vs 2-field GROUP BY")
    print("-" * 90)

    single_keys = [k for k in results if k.startswith("1-field")]
    double_keys = [k for k in results if k.startswith("2-field")]

    if single_keys and double_keys:
        avg_single = mean([results[k]["median"] for k in single_keys])
        avg_double = mean([results[k]["median"] for k in double_keys])
        ratio = avg_double / avg_single if avg_single > 0 else float("inf")
        print(f"  Avg median latency (1-field): {avg_single:>8.1f} ms")
        print(f"  Avg median latency (2-field): {avg_double:>8.1f} ms")
        print(f"  Ratio (2-field / 1-field):     {ratio:>8.2f}x")

    baseline_keys = [k for k in results if k.startswith("Baseline")]
    if baseline_keys and double_keys:
        avg_baseline = mean([results[k]["median"] for k in baseline_keys])
        avg_double = mean([results[k]["median"] for k in double_keys])
        speedup = avg_baseline / avg_double if avg_double > 0 else float("inf")
        print(f"\n  Avg median latency (baseline full-scan): {avg_baseline:>8.1f} ms")
        print(f"  Avg median latency (2-field tantivy):    {avg_double:>8.1f} ms")
        print(f"  Speedup (tantivy vs full-scan):           {speedup:>8.2f}x")

    print("=" * 90)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Benchmark: GROUP BY via Tantivy")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--password", default=DEFAULT_PASS)
    parser.add_argument("--records", type=int, default=500_000, help="Total records to ingest")
    parser.add_argument("--batch-size", type=int, default=5000, help="Batch size per request")
    parser.add_argument("--rounds", type=int, default=5, help="Rounds per query")
    parser.add_argument("--skip-ingest", action="store_true", help="Skip data ingestion")
    args = parser.parse_args()

    headers = make_auth_header(args.user, args.password)

    # Health check
    status, _ = api_request(args.base_url, "/healthz", headers=headers)
    if status != 200:
        print(f"ERROR: OpenObserve not reachable at {args.base_url}")
        sys.exit(1)
    print(f"OpenObserve is running at {args.base_url}")

    if not args.skip_ingest:
        ingest_data(args.base_url, headers, args.records, args.batch_size)
        flush_data(args.base_url, headers)
    else:
        print("\n  Skipping ingestion (--skip-ingest)")

    results = benchmark(args.base_url, headers, args.rounds)
    print_report(results, args.records)

    # Save raw results
    out_file = "scripts/bench_group_by_results.json"
    with open(out_file, "w") as f:
        json.dump(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "total_records": args.records,
                "rounds": args.rounds,
                "results": {k: {kk: vv for kk, vv in v.items()} for k, v in results.items()},
            },
            f,
            indent=2,
        )
    print(f"\nRaw results saved to {out_file}")


if __name__ == "__main__":
    main()

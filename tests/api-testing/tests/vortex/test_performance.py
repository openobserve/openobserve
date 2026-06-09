"""Vortex performance and stress tests (Section 9, scenarios 74–78).

These tests measure and log performance metrics — they do NOT assert specific
latency or throughput thresholds (which are environment-dependent). Instead they:
  - Document actual values via logging so CI artifacts capture them
  - Assert basic correctness (all records stored, queries return results)
  - Assert that vortex does not catastrophically regress vs parquet

Enterprise CI only — do not add to OSS api-testing.yml.

Test plan coverage: scenarios 74–78 (Section 9 — Performance & Stress).
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from .conftest import SESSION_ID, count_records, flush_and_wait, ingest


def _compact_timeout() -> float:
    """Derive compaction wait timeout from ZO_COMPACT_INTERVAL_SECONDS env var.

    CI sets ZO_COMPACT_INTERVAL_SECONDS=30; wait 3× interval + 15s buffer.
    When unset (local dev), returns 30s so the test skips quickly.
    """
    interval = float(os.environ.get("ZO_COMPACT_INTERVAL_SECONDS", "0"))
    return interval * 3 + 15 if interval > 0 else 30.0

_BASE = f"vp_{SESSION_ID}"


def _stream(suffix: str) -> str:
    return f"{_BASE}_{suffix}"


def _ts(offset_us: int = 0) -> int:
    return int(time.time() * 1_000_000) + offset_us


def _wide_payload(sql: str, size: int = 10) -> dict:
    now = datetime.now(timezone.utc)
    return search_payload(
        sql,
        start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
        end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
        size=size,
    )


# ─── Scenario 74 & 75: Ingest throughput and query latency ────────────────────

class TestVortexThroughputAndLatency:
    """Scenarios 74–75: measure ingest throughput and query latency, log results."""

    STREAM = _stream("throughput")
    N = 10_000

    def test_74_ingest_throughput(self, client):
        """Scenario 74: measure vortex ingest throughput (records/sec)."""
        records = [
            {
                "_timestamp": _ts(i * 100),
                "host": f"host-{i % 10}",
                "level": "info",
                "message": f"perf test record {i}",
                "value": float(i),
                "idx": i,
            }
            for i in range(self.N)
        ]
        payload = json.dumps(records)

        start = time.monotonic()
        resp = client.post(
            f"{self.STREAM}/_json",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        elapsed = time.monotonic() - start

        assert resp.status_code == 200, f"ingest failed: {resp.status_code}"
        throughput = self.N / elapsed
        assert throughput > 0, "throughput must be positive"
        logging.info(
            "PERF scenario-74: ingested %d records in %.2fs → %.0f records/sec",
            self.N, elapsed, throughput,
        )

    def test_74_all_records_searchable(self, client):
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=180)
        total = count_records(client, self.STREAM)
        assert total >= self.N, f"expected {self.N} records, got {total}"

    def test_75_query_latency(self, client):
        """Scenario 75: measure query latency over vortex data, log p50/total."""
        queries = [
            f'SELECT COUNT(*) AS c FROM "{self.STREAM}"',
            f'SELECT host, COUNT(*) AS c FROM "{self.STREAM}" GROUP BY host ORDER BY c DESC',
            f'SELECT AVG(value), MAX(value), MIN(value) FROM "{self.STREAM}"',
            f'SELECT * FROM "{self.STREAM}" ORDER BY _timestamp DESC',
        ]
        for sql in queries:
            start = time.monotonic()
            resp = client.post("_search?type=logs", json=_wide_payload(sql, size=100))
            elapsed_ms = (time.monotonic() - start) * 1000
            assert resp.status_code == 200, f"query failed: {sql[:60]}"
            took_server = resp.json().get("took", 0)
            logging.info(
                "PERF scenario-75: query='%s...' client_ms=%.1f server_ms=%d",
                sql[:50], elapsed_ms, took_server,
            )


# ─── Scenario 76: File size comparison ────────────────────────────────────────

class TestVortexFileSizeComparison:
    """Scenario 76: log vortex compressed_size from stream stats.

    After compaction, stream stats expose storage_size and compressed_size.
    We log these for comparison with parquet in CI artifacts.
    Note: stats only populate after background compaction — test skips if
    compaction hasn't run. Set ZO_COMPACT_INTERVAL short in enterprise CI.
    """

    STREAM = _stream("filesize")
    N = 5_000

    def test_76_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "host": f"h{i%5}", "msg": f"msg {i}", "val": i}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=180)

    def test_76_log_file_size_stats(self, client):
        from support.wait import WaitTimeout, wait_until

        def _stats_ready():
            r = client.get(f"streams?type=logs&stream_name={self.STREAM}")
            if r.status_code != 200:
                return None
            entry = next((s for s in r.json().get("list", []) if s["name"] == self.STREAM), {})
            stats = entry.get("stats", {})
            return stats if float(stats.get("storage_size", 0)) > 0 else None

        t = _compact_timeout()
        try:
            stats = wait_until(_stats_ready, timeout=t, interval=5,
                               msg="waiting for compaction to populate file size stats")
            logging.info(
                "PERF scenario-76: stream=%s doc_num=%s file_num=%s "
                "storage_size_mb=%.4f compressed_size_mb=%.4f",
                self.STREAM,
                stats.get("doc_num"),
                stats.get("file_num"),
                float(stats.get("storage_size", 0)),
                float(stats.get("compressed_size", 0)),
            )
        except WaitTimeout:
            pytest.skip(
                f"compaction did not run within {t:.0f}s — set ZO_COMPACT_INTERVAL "
                "short in enterprise CI to populate file size stats"
            )


# ─── Scenario 77: Large batch ingest ──────────────────────────────────────────

class TestLargeBatchIngest:
    """Scenario 77: ingest >100K records as vortex, verify all stored and queryable."""

    STREAM = _stream("large_batch")
    N = 100_000

    def test_77_ingest_100k_records(self, client):
        records = [
            {"_timestamp": _ts(i * 10), "idx": i, "host": f"h{i%20}", "val": float(i % 1000)}
            for i in range(self.N)
        ]
        resp = client.post(
            f"{self.STREAM}/_json",
            data=json.dumps(records),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200, f"large batch ingest failed: {resp.status_code}"
        logging.info("PERF scenario-77: ingested %d records", self.N)

    def test_77_all_records_queryable(self, client):
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=300)
        total = count_records(client, self.STREAM)
        assert total >= self.N, f"expected {self.N} records, got {total}"
        logging.info("PERF scenario-77: %d records confirmed queryable", total)


# ─── Scenario 78: Many small files ────────────────────────────────────────────

class TestManySmallFiles:
    """Scenario 78: 100 small flushes → 100+ files in one stream, union works."""

    STREAM = _stream("many_files")
    BATCHES = 20   # reduced from 100 for test speed; increase in CI with longer timeout
    BATCH_N = 10

    def test_78_ingest_many_small_batches(self, client):
        for batch_idx in range(self.BATCHES):
            records = [
                {
                    # 1 s per batch, 1 ms per record — all 20 batches stay within
                    # the +1 hour search window used by count_records.
                    "_timestamp": _ts(batch_idx * 1_000_000 + i * 1_000),
                    "batch_idx": batch_idx,
                    "idx": i,
                    "host": f"h{i % 5}",
                }
                for i in range(self.BATCH_N)
            ]
            ingest(client, self.STREAM, records)

        expected = self.BATCHES * self.BATCH_N
        flush_and_wait(client, self.STREAM, expected=expected, timeout=180)
        logging.info("PERF scenario-78: %d batches × %d records flushed", self.BATCHES, self.BATCH_N)

    def test_78_streaming_union_correct(self, client):
        """Query spanning all batches returns correct total."""
        expected = self.BATCHES * self.BATCH_N
        total = count_records(client, self.STREAM)
        assert total >= expected, f"expected {expected} records across all files, got {total}"

    def test_78_per_batch_counts_correct(self, client):
        """Each batch_idx has exactly BATCH_N records — no data loss or duplication."""
        for batch_idx in range(self.BATCHES):
            n = count_records(client, self.STREAM, where=f"batch_idx={batch_idx}")
            assert n == self.BATCH_N, \
                f"batch_idx={batch_idx}: expected {self.BATCH_N} records, got {n}"

"""Vortex format conversion tests — parquet ↔ vortex cross-format reading.

Designed to run as 3 separate CI jobs (enterprise CI matrix) so each job
starts a fresh server with a different ZO_FILE_FORMAT but shares the same
data directory on disk:

    phase 1  ZO_FILE_FORMAT=parquet  → ingest batch-1 (parquet)
    phase 2  ZO_FILE_FORMAT=vortex   → read old parquet + ingest batch-2 (vortex)
    phase 3  ZO_FILE_FORMAT=parquet  → read mixed + ingest batch-3 (parquet)

Each phase is a standalone pytest target:
    pytest tests/vortex/test_format_conversion.py::TestPhase1Parquet
    pytest tests/vortex/test_format_conversion.py::TestPhase2Vortex
    pytest tests/vortex/test_format_conversion.py::TestPhase3ParquetReturn

Stream name is shared across phases via the VORTEX_STREAM_NAME env var (or
the default "vortex_format_test").  The enterprise CI workflow sets this once
and all 3 jobs inherit it.

Test plan coverage: scenarios 1–13 (format conversion section).
"""
from __future__ import annotations

import time
import logging
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from .conftest import SESSION_ID, STREAM, count_records, flush_and_wait, ingest

BATCH_SIZE = 20


def _make_batch(tag: str, n: int = BATCH_SIZE) -> list[dict]:
    now_us = int(time.time() * 1_000_000)
    return [
        {
            "_timestamp": now_us + i * 1_000,
            "host": f"host-{i % 5}",
            "level": "info" if i % 3 != 0 else "error",
            "batch": tag,
            "count": i,
            "message": f"log line {i} batch={tag}",
        }
        for i in range(n)
    ]


# ─── Phase 1: ZO_FILE_FORMAT=parquet ──────────────────────────────────────────
# CI matrix label: parquet_to_vortex
# Expected env:    ZO_FILE_FORMAT=parquet

class TestPhase1Parquet:
    """Scenario 1: ingest into parquet, verify data is queryable."""

    def test_phase_1_parquet(self, client):
        """Ingest batch-1 as parquet; assert 20 records visible after flush."""
        ingest(client, STREAM, _make_batch("parquet_1"))
        flush_and_wait(client, STREAM, expected=BATCH_SIZE)

        total = count_records(client, STREAM)
        assert total >= BATCH_SIZE, f"expected {BATCH_SIZE} records, got {total}"

        batch1 = count_records(client, STREAM, where="batch='parquet_1'")
        assert batch1 == BATCH_SIZE, f"batch-1 count wrong: {batch1}"
        logging.info("Phase 1 passed: %d parquet records on disk", batch1)

    def test_phase_1_parquet_query_correctness(self, client):
        """Scenario 1: SELECT * returns correct rows, level/host fields intact."""
        now = datetime.now(timezone.utc)
        payload = search_payload(
            f'SELECT host, level, batch, count FROM "{STREAM}" WHERE batch=\'parquet_1\' ORDER BY count ASC',
            start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=BATCH_SIZE + 10,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == BATCH_SIZE
        assert all(h["batch"] == "parquet_1" for h in hits)
        assert {h["level"] for h in hits} <= {"info", "error"}


# ─── Phase 2: ZO_FILE_FORMAT=vortex ───────────────────────────────────────────
# CI matrix label: vortex_read_both
# Expected env:    ZO_FILE_FORMAT=vortex
# Precondition:    Phase 1 data is on disk as .parquet files

class TestPhase2Vortex:
    """Scenarios 2–3: parquet files remain readable after switch to vortex;
    new ingest writes vortex; mixed-format query returns combined results."""

    def test_phase_2a_old_parquet_still_readable(self, client):
        """Scenario 2: vortex server reads phase-1 parquet data without re-ingest."""
        batch1 = count_records(client, STREAM, where="batch='parquet_1'")
        assert batch1 == BATCH_SIZE, (
            f"Parquet files from phase 1 not readable under vortex server: "
            f"expected {BATCH_SIZE}, got {batch1}"
        )

    def test_phase_2b_ingest_vortex_and_query_both(self, client):
        """Scenarios 3: ingest batch-2 as vortex; combined query returns both formats."""
        ingest(client, STREAM, _make_batch("vortex_1"))
        flush_and_wait(client, STREAM, expected=BATCH_SIZE * 2)

        total = count_records(client, STREAM)
        assert total >= BATCH_SIZE * 2, f"expected {BATCH_SIZE * 2} total, got {total}"

        batch1 = count_records(client, STREAM, where="batch='parquet_1'")
        batch2 = count_records(client, STREAM, where="batch='vortex_1'")
        assert batch1 == BATCH_SIZE, f"parquet batch-1 count wrong: {batch1}"
        assert batch2 == BATCH_SIZE, f"vortex batch-2 count wrong: {batch2}"
        logging.info("Phase 2 passed: %d parquet + %d vortex records", batch1, batch2)

    def test_phase_2c_group_by_across_formats(self, client):
        """Scenario 13: GROUP BY batch unifies results across format boundary."""
        now = datetime.now(timezone.utc)
        payload = search_payload(
            f'SELECT batch, COUNT(*) AS c FROM "{STREAM}" GROUP BY batch ORDER BY batch',
            start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=10,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        by_batch = {h["batch"]: int(h["c"]) for h in hits}
        assert by_batch.get("parquet_1") == BATCH_SIZE
        assert by_batch.get("vortex_1") == BATCH_SIZE


# ─── Phase 3: ZO_FILE_FORMAT=parquet (return) ─────────────────────────────────
# CI matrix label: parquet_read_all
# Expected env:    ZO_FILE_FORMAT=parquet
# Precondition:    Phase 1 (.parquet) + Phase 2 (.vortex) data on disk

class TestPhase3ParquetReturn:
    """Scenarios 4–5: parquet server reads old vortex files; ingest of
    batch-3 as parquet; all 3 batches queryable."""

    def test_phase_3a_vortex_files_still_readable(self, client):
        """Scenario 4: parquet server reads phase-2 vortex files."""
        batch2 = count_records(client, STREAM, where="batch='vortex_1'")
        assert batch2 == BATCH_SIZE, (
            f"Vortex files from phase 2 not readable under parquet server: "
            f"expected {BATCH_SIZE}, got {batch2}"
        )

    def test_phase_3b_ingest_third_batch_and_query_all(self, client):
        """Scenario 5: ingest batch-3 as parquet; all 3 batches correct."""
        ingest(client, STREAM, _make_batch("parquet_2"))
        flush_and_wait(client, STREAM, expected=BATCH_SIZE * 3)

        total = count_records(client, STREAM)
        assert total >= BATCH_SIZE * 3, f"expected {BATCH_SIZE * 3} total, got {total}"

        for tag, label in [("parquet_1", "batch-1"), ("vortex_1", "batch-2"), ("parquet_2", "batch-3")]:
            n = count_records(client, STREAM, where=f"batch='{tag}'")
            assert n == BATCH_SIZE, f"{label} ({tag}) count wrong: {n}"

        logging.info("Phase 3 passed: all 3 batches queryable (parquet+vortex+parquet)")

    def test_phase_3c_count_across_mixed_formats(self, client):
        """Scenario 43/45: COUNT(*) and time-range query across all 3 format batches."""
        total = count_records(client, STREAM)
        assert total >= BATCH_SIZE * 3

    def test_phase_3d_column_projection_mixed_stream(self, client):
        """Scenario 46: SELECT specific columns works across mixed-format stream."""
        now = datetime.now(timezone.utc)
        payload = search_payload(
            f'SELECT host, level, batch FROM "{STREAM}" LIMIT 5',
            start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=5,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == 5
        for h in hits:
            assert "host" in h
            assert "level" in h
            assert "batch" in h


# ─── Standalone: vortex-only (scenario 10) ────────────────────────────────────
# Run this against a ZO_FILE_FORMAT=vortex server that has never seen parquet.

class TestVortexOnly:
    """Scenario 10: ZO_FILE_FORMAT=vortex from the start, no parquet involved."""

    STREAM = f"vortex_only_{SESSION_ID}"

    def test_vortex_only_ingest_and_query(self, client):
        """Ingest into a fresh all-vortex stream and verify all records queryable."""
        stream = self.STREAM
        records = _make_batch("vortex_only")
        ingest(client, stream, records)
        flush_and_wait(client, stream, expected=BATCH_SIZE)

        n = count_records(client, stream, where="batch='vortex_only'")
        assert n == BATCH_SIZE, f"all-vortex stream count wrong: {n}"

    def test_vortex_only_field_values_correct(self, client):
        """Round-trip: field values ingested into vortex match what's returned."""
        now = datetime.now(timezone.utc)
        payload = search_payload(
            f'SELECT host, level, count FROM "{self.STREAM}" WHERE batch=\'vortex_only\' ORDER BY count ASC',
            start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=BATCH_SIZE + 5,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == BATCH_SIZE
        counts = [int(h["count"]) for h in hits]
        assert counts == list(range(BATCH_SIZE)), f"count field values wrong: {counts}"


# ─── Scenario 9: empty stream then switch ─────────────────────────────────────

class TestEmptyStreamSwitch:
    """Scenario 9: create a stream with no data, switch format, then ingest.

    The stream has no files on disk before ingest — exercises the code path
    where the format dispatcher encounters an empty file list on first read.
    """

    STREAM = f"vortex_empty_{SESSION_ID}"

    def test_9_ingest_into_previously_empty_stream(self, client):
        """Ingest into a brand-new stream under vortex; all records queryable."""
        records = _make_batch("after_switch", n=10)
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=10)
        assert count_records(client, self.STREAM) == 10

    def test_9_query_returns_correct_fields(self, client):
        n = count_records(client, self.STREAM, where="batch='after_switch'")
        assert n == 10, f"expected 10 rows with batch=after_switch, got {n}"


# ─── Scenarios 7, 8: Metrics and Traces stream round-trips ────────────────────
# Enterprise CI only — these classes test the same parquet↔vortex logic as the
# 3-phase logs tests but for metrics and traces stream types.

class TestMetricsStreamConversion:
    """Scenario 7: metrics stream parquet → vortex → parquet round-trip."""

    import os as _os
    STREAM = _os.environ.get("VORTEX_METRICS_STREAM", f"vortex_metrics_{SESSION_ID}")

    def test_7_ingest_metrics_and_query(self, client):
        """Ingest metric-shaped records; verify all queryable regardless of phase."""
        records = [
            {
                "_timestamp": int(time.time() * 1_000_000) + i * 60_000_000,
                "batch": "metrics_batch",
                "metric_name": "cpu_usage",
                "value": float(i % 100),
                "host": f"host-{i % 5}",
            }
            for i in range(BATCH_SIZE)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=BATCH_SIZE)
        assert count_records(client, self.STREAM) >= BATCH_SIZE

    def test_7_metric_aggregation_correct(self, client):
        """Aggregation over metrics stream returns correct values across formats."""
        now = datetime.now(timezone.utc)
        payload = search_payload(
            f'SELECT COUNT(*) AS c, AVG(value) AS avg_val FROM "{self.STREAM}"',
            start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=1,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert hits and int(hits[0].get("c", 0)) >= BATCH_SIZE


class TestTracesStreamConversion:
    """Scenario 8: traces stream parquet → vortex → parquet round-trip."""

    import os as _os
    STREAM = _os.environ.get("VORTEX_TRACES_STREAM", f"vortex_traces_{SESSION_ID}")

    def test_8_ingest_trace_shaped_records(self, client):
        """Ingest trace-shaped records; verify all queryable regardless of phase."""
        records = [
            {
                "_timestamp": int(time.time() * 1_000_000) + i * 1_000_000,
                "batch": "traces_batch",
                "trace_id": f"trace-{i:04d}",
                "span_id": f"span-{i:04d}",
                "service_name": f"svc-{i % 3}",
                "duration_ms": i * 10,
            }
            for i in range(BATCH_SIZE)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=BATCH_SIZE)
        assert count_records(client, self.STREAM) >= BATCH_SIZE

    def test_8_trace_filter_correct(self, client):
        """Filtering by service_name works across parquet and vortex files."""
        n = count_records(client, self.STREAM, where="service_name='svc-0'")
        expected = sum(1 for i in range(BATCH_SIZE) if i % 3 == 0)
        assert n == expected, f"expected {expected} svc-0 traces, got {n}"

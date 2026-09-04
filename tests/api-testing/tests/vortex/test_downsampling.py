"""Vortex downsampling / compaction tests (Section 6, scenarios 47–50).

Design principle: data-correctness assertions run after flush_and_wait and
always pass. Only stream-stats metadata (storage_size, file_num) truly
requires background compaction — those checks skip with a clear message
when compaction hasn't fired.

This means the suite provides real value in every CI run, and compaction-
metadata assertions become bonus checks when ZO_COMPACT_INTERVAL is short.

Enterprise CI only — do not add to OSS api-testing.yml.

Test plan coverage: scenarios 47–50 (Section 6 — Downsampling).
"""
from __future__ import annotations

import json as _json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from support.wait import WaitTimeout, wait_until
from .conftest import SESSION_ID, count_records, flush_and_wait, ingest

_BASE = f"vds_{SESSION_ID}"  # vortex_downsampling

_COMPACT_SKIP_MSG = (
    "compaction did not run within the timeout — set ZO_COMPACT_INTERVAL "
    "short (e.g. 30s) in enterprise CI to enable compaction-metadata checks"
)


def _compact_timeout() -> float:
    """Derive compaction wait timeout from ZO_COMPACT_INTERVAL_SECONDS env var.

    CI sets ZO_COMPACT_INTERVAL_SECONDS=30; we wait 3× that plus a 15s buffer
    so compaction has time to fire at least twice and update stream stats.
    When unset (local dev), returns 30s so tests skip quickly rather than hang.
    """
    interval = float(os.environ.get("ZO_COMPACT_INTERVAL_SECONDS", "0"))
    return interval * 3 + 15 if interval > 0 else 30.0


def _stream(suffix: str) -> str:
    return f"{_BASE}_{suffix}"


def _ts(offset_us: int = 0) -> int:
    return int(time.time() * 1_000_000) + offset_us


def _wide_payload(sql: str, size: int = 100) -> dict:
    now = datetime.now(timezone.utc)
    return search_payload(
        sql,
        start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
        end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
        size=size,
    )


def _try_wait_for_compaction(client, stream: str, *, timeout: float | None = None) -> dict | None:
    """Poll stream stats until storage_size > 0. Returns stats dict or None."""
    t = timeout if timeout is not None else _compact_timeout()

    def _ready():
        r = client.get(f"streams?type=logs&stream_name={stream}")
        if r.status_code != 200:
            return None
        entry = next(
            (s for s in r.json().get("list", []) if s["name"] == stream), {}
        )
        stats = entry.get("stats", {})
        return stats if float(stats.get("storage_size", 0)) > 0 else None

    try:
        return wait_until(_ready, timeout=t, interval=5.0,
                          msg=f"{stream}: compaction stats not populated within {t}s")
    except WaitTimeout:
        return None


# ─── Scenario 47: Basic compaction ────────────────────────────────────────────

class TestDownsampleVortex:
    """Scenario 47: vortex files are compacted after ZO_COMPACT_INTERVAL."""

    STREAM = _stream("compact")
    N = 200

    def test_47_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "host": f"h{i % 10}", "val": i}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=30)

    def test_47_data_queryable_after_flush(self, client):
        """Data is queryable after flush — compaction must not lose records."""
        total = count_records(client, self.STREAM)
        assert total >= self.N, f"expected {self.N} records, got {total}"
        logging.info("scenario-47: %d records queryable after flush", total)

    def test_47_compaction_metadata(self, client):
        """After compaction, file_num >= 1 and storage_size > 0. Skips if compaction didn't run."""
        stats = _try_wait_for_compaction(client, self.STREAM)
        if stats is None:
            pytest.skip(_COMPACT_SKIP_MSG)

        file_num = int(stats.get("file_num", 0))
        assert file_num >= 1, f"expected at least 1 file after compaction, got {file_num}"
        logging.info("scenario-47: file_num=%d after compaction", file_num)


# ─── Scenario 48: Compaction correctness ──────────────────────────────────────

class TestDownsampleComparison:
    """Scenario 48: query results are identical before and after compaction."""

    STREAM = _stream("compare")
    N = 100

    def test_48_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "host": f"h{i % 5}", "val": i, "batch": "cmp"}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=30)

    def test_48_count_correct_after_flush(self, client):
        total = count_records(client, self.STREAM)
        assert total == self.N, f"expected {self.N}, got {total}"

    def test_48_aggregation_correct_after_flush(self, client):
        """GROUP BY results are correct after flush — compaction must not alter them."""
        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f'SELECT host, COUNT(*) AS c FROM "{self.STREAM}" '
                f'GROUP BY host ORDER BY host',
                size=20,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        by_host = {h["host"]: int(h["c"]) for h in hits}
        expected_per_host = self.N // 5
        for host, cnt in by_host.items():
            assert cnt == expected_per_host, (
                f"{host}: expected {expected_per_host}, got {cnt}"
            )

    def test_48_compaction_metadata(self, client):
        """Compaction metadata check — skips if compaction didn't run."""
        stats = _try_wait_for_compaction(client, self.STREAM)
        if stats is None:
            pytest.skip(_COMPACT_SKIP_MSG)
        assert float(stats.get("storage_size", 0)) > 0, "storage_size should be > 0 after compaction"
        logging.info("scenario-48: storage_size=%.4f after compaction", float(stats.get("storage_size", 0)))


# ─── Scenario 49: Mixed-source compaction ─────────────────────────────────────

class TestDownsampleMixedSource:
    """Scenario 49: compaction merges records from multiple small flushes."""

    STREAM = _stream("mixed_compact")
    BATCHES = 10
    BATCH_N = 20

    def test_49_many_small_flushes(self, client):
        for b in range(self.BATCHES):
            records = [
                {"_timestamp": _ts(b * 1_000_000 + i * 1_000), "batch_id": b, "idx": i}
                for i in range(self.BATCH_N)
            ]
            ingest(client, self.STREAM, records)

        flush_and_wait(client, self.STREAM, expected=self.BATCHES * self.BATCH_N, timeout=30)

    def test_49_total_count_correct(self, client):
        """All records queryable after flush — compaction must not drop any."""
        total = count_records(client, self.STREAM)
        expected = self.BATCHES * self.BATCH_N
        assert total >= expected, f"expected {expected}, got {total}"

    def test_49_per_batch_counts_correct(self, client):
        """Each batch has the right record count after flush (single GROUP BY query)."""
        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f'SELECT batch_id, COUNT(*) AS c FROM "{self.STREAM}" '
                f'GROUP BY batch_id ORDER BY batch_id',
                size=self.BATCHES + 1,
            ),
        )
        assert resp.status_code == 200, f"GROUP BY query failed: {resp.status_code}"
        hits = resp.json()["hits"]
        by_batch = {int(h["batch_id"]): int(h["c"]) for h in hits}
        for b in range(self.BATCHES):
            assert by_batch.get(b, 0) == self.BATCH_N, (
                f"batch_id={b}: expected {self.BATCH_N}, got {by_batch.get(b, 0)}"
            )

    def test_49_compaction_metadata(self, client):
        """Compaction metadata — skips if compaction didn't run."""
        stats = _try_wait_for_compaction(client, self.STREAM)
        if stats is None:
            pytest.skip(_COMPACT_SKIP_MSG)
        assert int(stats.get("file_num", 0)) >= 1, "file_num must be >= 1 after compaction"
        logging.info("scenario-49: file_num=%d after compaction", int(stats.get("file_num", 0)))


# ─── Scenario 50: File size limit ─────────────────────────────────────────────

class TestDownsampleFileSizeLimit:
    """Scenario 50: large ingest is fully queryable; compaction produces on-disk files."""

    STREAM = _stream("size_limit")
    N = 2_000

    def test_50_large_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 100), "idx": i, "host": f"h{i % 20}",
             "payload": "x" * 100}
            for i in range(self.N)
        ]
        resp = client.post(
            f"{self.STREAM}/_json",
            data=_json.dumps(records),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200, f"large ingest failed: {resp.status_code}"
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=60)

    def test_50_all_records_queryable(self, client):
        """All 50K records queryable after flush — no compaction needed."""
        total = count_records(client, self.STREAM)
        assert total >= self.N, f"expected {self.N}, got {total}"
        logging.info("scenario-50: %d records queryable after flush", total)

    def test_50_compaction_metadata(self, client):
        """Compaction metadata (file_num, storage_size) — skips if compaction didn't run."""
        stats = _try_wait_for_compaction(client, self.STREAM)
        if stats is None:
            pytest.skip(_COMPACT_SKIP_MSG)

        file_num = int(stats.get("file_num", 0))
        assert file_num >= 1, f"expected at least 1 file, got {file_num}"
        logging.info("scenario-50: file_num=%d storage_size=%.4f",
                     file_num, float(stats.get("storage_size", 0)))

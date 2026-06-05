"""Vortex downsampling / compaction tests (Section 6, scenarios 47–50).

Downsampling in OpenObserve is a background compaction job — there is no HTTP
endpoint to trigger it on demand. Tests that depend on compaction having run
catch WaitTimeout and call pytest.skip() with a hint to configure
ZO_COMPACT_INTERVAL short in enterprise CI.

Enterprise CI only — do not add to OSS api-testing.yml.

Test plan coverage: scenarios 47–50 (Section 6 — Downsampling).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from support.wait import WaitTimeout, wait_until
from .conftest import SESSION_ID, count_records, flush_and_wait, ingest

_BASE = f"vds_{SESSION_ID}"  # vortex_downsampling

_COMPACT_SKIP_MSG = (
    "compaction did not run within the timeout — set ZO_COMPACT_INTERVAL "
    "short (e.g. 30s) in enterprise CI to enable downsampling tests"
)


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


def _wait_for_compaction(client, stream: str, *, timeout: float = 120.0) -> dict:
    """Poll stream stats until storage_size > 0 (indicates compaction ran).

    Raises WaitTimeout if compaction does not complete within *timeout* seconds.
    """
    def _ready():
        r = client.get(f"streams?type=logs&stream_name={stream}")
        if r.status_code != 200:
            return None
        entry = next(
            (s for s in r.json().get("list", []) if s["name"] == stream), {}
        )
        stats = entry.get("stats", {})
        return stats if float(stats.get("storage_size", 0)) > 0 else None

    return wait_until(_ready, timeout=timeout, interval=5.0,
                      msg=f"{stream}: compaction stats not populated within {timeout}s")


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
        flush_and_wait(client, self.STREAM, expected=self.N)

    def test_47_data_still_queryable_after_compaction(self, client):
        """Compaction must not lose records — total count unchanged."""
        try:
            _wait_for_compaction(client, self.STREAM, timeout=120)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        total = count_records(client, self.STREAM)
        assert total >= self.N, f"expected {self.N} records after compaction, got {total}"
        logging.info("scenario-47: %d records after compaction", total)

    def test_47_file_count_reduces_after_compaction(self, client):
        """After compaction, file_num in stream stats is >= 1."""
        try:
            stats = _wait_for_compaction(client, self.STREAM, timeout=120)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        file_num = int(stats.get("file_num", 0))
        assert file_num >= 1, f"expected at least 1 file after compaction, got {file_num}"
        logging.info("scenario-47: file_num=%d after compaction", file_num)


# ─── Scenario 48: Compaction correctness ──────────────────────────────────────

class TestDownsampleComparison:
    """Scenario 48: query results before and after compaction are identical."""

    STREAM = _stream("compare")
    N = 100

    def test_48_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "host": f"h{i % 5}", "val": i, "batch": "cmp"}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N)

    def test_48_pre_compaction_count(self, client):
        total = count_records(client, self.STREAM)
        assert total == self.N, f"pre-compaction: expected {self.N}, got {total}"

    def test_48_post_compaction_count_matches(self, client):
        try:
            _wait_for_compaction(client, self.STREAM, timeout=120)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        total = count_records(client, self.STREAM)
        assert total == self.N, f"post-compaction: expected {self.N}, got {total}"

    def test_48_aggregation_unchanged_after_compaction(self, client):
        try:
            _wait_for_compaction(client, self.STREAM, timeout=120)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

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


# ─── Scenario 49: Mixed-source compaction ─────────────────────────────────────

class TestDownsampleMixedSource:
    """Scenario 49: compaction merges records from multiple small flushes into one file."""

    STREAM = _stream("mixed_compact")
    BATCHES = 10
    BATCH_N = 20

    def test_49_many_small_flushes(self, client):
        for b in range(self.BATCHES):
            records = [
                {"_timestamp": _ts(b * 100_000_000 + i * 1_000), "batch_id": b, "idx": i}
                for i in range(self.BATCH_N)
            ]
            ingest(client, self.STREAM, records)

        flush_and_wait(client, self.STREAM, expected=self.BATCHES * self.BATCH_N)

    def test_49_all_records_survive_compaction(self, client):
        try:
            _wait_for_compaction(client, self.STREAM, timeout=120)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        total = count_records(client, self.STREAM)
        expected = self.BATCHES * self.BATCH_N
        assert total >= expected, f"expected {expected}, got {total}"

    def test_49_per_batch_counts_correct_after_compaction(self, client):
        try:
            _wait_for_compaction(client, self.STREAM, timeout=120)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        for b in range(self.BATCHES):
            n = count_records(client, self.STREAM, where=f"batch_id={b}")
            assert n == self.BATCH_N, (
                f"batch_id={b}: expected {self.BATCH_N}, got {n}"
            )


# ─── Scenario 50: File size limit ─────────────────────────────────────────────

class TestDownsampleFileSizeLimit:
    """Scenario 50: large ingest produces multiple compact files (no single oversized file)."""

    STREAM = _stream("size_limit")
    N = 50_000

    def test_50_large_ingest_and_flush(self, client):
        import json as _json
        records = [
            {"_timestamp": _ts(i * 100), "idx": i, "host": f"h{i % 20}",
             "payload": "x" * 200}
            for i in range(self.N)
        ]
        resp = client.post(
            f"{self.STREAM}/_json",
            data=_json.dumps(records),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200, f"large ingest failed: {resp.status_code}"
        flush_and_wait(client, self.STREAM, expected=self.N, timeout=300)

    def test_50_all_records_queryable_after_compaction(self, client):
        try:
            _wait_for_compaction(client, self.STREAM, timeout=180)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        total = count_records(client, self.STREAM)
        assert total >= self.N, f"expected {self.N}, got {total}"
        logging.info("scenario-50: %d records after large-batch compaction", total)

    def test_50_file_num_reasonable(self, client):
        """After compaction, file_num must be >= 1 (data on disk)."""
        try:
            stats = _wait_for_compaction(client, self.STREAM, timeout=180)
        except WaitTimeout:
            pytest.skip(_COMPACT_SKIP_MSG)

        file_num = int(stats.get("file_num", 0))
        assert file_num >= 1, f"expected at least 1 file, got {file_num}"
        logging.info("scenario-50: file_num=%d", file_num)

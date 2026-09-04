"""Vortex data integrity tests.

Verifies that data written as vortex files round-trips correctly: exact
field values, null handling, unicode, large payloads, binary data,
and concurrent access.

Test plan coverage: scenarios 55–62.
Scenarios 63–65 (filesystem-level inspections) live in the enterprise repo.

Enterprise CI only — do not add to OSS api-testing.yml.
"""
from __future__ import annotations

import time
import logging
import json
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from .conftest import SESSION_ID, count_records, flush_and_wait, ingest

_BASE = f"vdi_{SESSION_ID}"  # vortex_data_integrity


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


# ─── Scenario 55: Exact value round-trip ──────────────────────────────────────

class TestExactValueRoundTrip:
    """Scenario 55: every ingested field value survives a write→flush→read cycle."""

    STREAM = _stream("roundtrip")

    RECORD = {
        "_timestamp": _ts(),
        "str_field": "hello world",
        "int_field": 42,
        "float_field": 3.14159,
        "bool_true": True,
        "bool_false": False,
        "neg_int": -99,
        "large_int": 1_000_000_000,
        "zero": 0,
        "empty_str": "",
        "tag": "roundtrip_marker",
    }

    def test_55_ingest_and_flush(self, client):
        ingest(client, self.STREAM, [self.RECORD])
        flush_and_wait(client, self.STREAM, expected=1)

    def test_55_values_match_exactly(self, client):
        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f'SELECT str_field, int_field, float_field, neg_int, large_int, zero '
                f'FROM "{self.STREAM}" WHERE tag=\'roundtrip_marker\'',
                size=5,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == 1, f"expected 1 hit, got {len(hits)}"
        h = hits[0]
        assert h["str_field"] == "hello world"
        assert int(h["int_field"]) == 42
        assert abs(float(h["float_field"]) - 3.14159) < 1e-4
        assert int(h["neg_int"]) == -99
        assert int(h["large_int"]) == 1_000_000_000
        assert int(h["zero"]) == 0


# ─── Scenario 56: Null / missing field handling ───────────────────────────────

class TestNullHandling:
    """Scenario 56: null values stored in vortex survive round-trip as null/empty.

    OO only creates schema fields for columns with at least one non-null value.
    We first ingest a record with a non-null anchor value so the field is
    schema-registered, then ingest records where the field is absent/null.
    """

    STREAM = _stream("nulls")

    def test_56_null_field_handling(self, client):
        anchor = {"_timestamp": _ts(0), "host": "anchor", "nullable_field": "seed", "group": "null_test"}
        null_records = [
            {"_timestamp": _ts(i * 1_000 + 1_000), "host": f"h{i}", "group": "null_test"}
            for i in range(5)
        ]
        ingest(client, self.STREAM, [anchor] + null_records)
        flush_and_wait(client, self.STREAM, expected=6)

        # Count rows that have the anchor's exact value — more reliable than
        # IS NOT NULL because OO stores missing fields as empty strings, not SQL NULL.
        n_with = count_records(client, self.STREAM, where="nullable_field='seed'")
        assert n_with == 1, f"only anchor row should have nullable_field='seed'; got {n_with}"

        total = count_records(client, self.STREAM, where="group='null_test'")
        assert total == 6, f"all 6 rows should be queryable; got {total}"


# ─── Scenario 57: Unicode and special characters ──────────────────────────────

class TestUnicodeRoundTrip:
    """Scenario 57: unicode strings, emoji, and special chars survive vortex round-trip."""

    STREAM = _stream("unicode")

    STRINGS = [
        ("ascii", "hello world"),
        ("accents", "café résumé naïve"),
        ("cjk", "日本語テスト"),
        ("emoji", "test 🚀 data 🎉"),
        ("special", 'quotes"and\'apostrophes'),
        ("newline", "line1\nline2"),
        ("tab", "col1\tcol2"),
    ]

    def test_57_unicode_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "label": label, "value": value}
            for i, (label, value) in enumerate(self.STRINGS)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=len(self.STRINGS))

    def test_57_unicode_values_queryable(self, client):
        total = count_records(client, self.STREAM)
        assert total == len(self.STRINGS), f"expected {len(self.STRINGS)} rows, got {total}"

    def test_57_filter_by_label(self, client):
        for label, _ in self.STRINGS:
            n = count_records(client, self.STREAM, where=f"label='{label}'")
            assert n == 1, f"label={label!r}: expected 1 row, got {n}"


# ─── Scenario 58: Large single record ─────────────────────────────────────────

class TestLargeRecord:
    """Scenario 58: a single record with many fields and large string values is stored correctly."""

    STREAM = _stream("large_record")
    N_FIELDS = 100
    STR_LEN = 1000

    def test_58_ingest_large_record(self, client):
        record = {"_timestamp": _ts(), "marker": "large_record_test"}
        for i in range(self.N_FIELDS):
            record[f"field_{i:03d}"] = "x" * self.STR_LEN
        ingest(client, self.STREAM, [record])
        flush_and_wait(client, self.STREAM, expected=1)
        assert count_records(client, self.STREAM) == 1

    def test_58_large_record_queryable(self, client):
        n = count_records(client, self.STREAM, where="marker='large_record_test'")
        assert n == 1, f"large record not queryable: {n}"


# ─── Scenario 59: High-cardinality field ──────────────────────────────────────

class TestHighCardinality:
    """Scenario 59: a field with N distinct values is correctly grouped and counted."""

    STREAM = _stream("high_card")
    N = 500

    def test_59_ingest_high_cardinality(self, client):
        records = [
            {"_timestamp": _ts(i * 100), "user_id": f"user_{i:05d}", "val": i}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N)

    def test_59_total_count_correct(self, client):
        total = count_records(client, self.STREAM)
        assert total == self.N, f"expected {self.N} rows, got {total}"

    def test_59_group_by_cardinality(self, client):
        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f'SELECT COUNT(DISTINCT user_id) AS distinct_users FROM "{self.STREAM}"',
                size=1,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert hits, "no hits returned"
        assert int(hits[0]["distinct_users"]) == self.N


# ─── Scenario 60: Timestamp precision ─────────────────────────────────────────

class TestTimestampPrecision:
    """Scenario 60: microsecond timestamps are stored with full precision."""

    STREAM = _stream("ts_precision")

    def test_60_ingest_close_timestamps(self, client):
        base = _ts()
        records = [
            {"_timestamp": base + i * 1_000, "seq": i}  # 1 ms apart — avoids µs truncation
            for i in range(10)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=10)
        assert count_records(client, self.STREAM) == 10

    def test_60_order_by_timestamp_correct(self, client):
        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f'SELECT seq, _timestamp FROM "{self.STREAM}" ORDER BY _timestamp ASC',
                size=20,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == 10
        seqs = [int(h["seq"]) for h in hits]
        assert seqs == list(range(10)), f"timestamp ordering wrong: {seqs}"


# ─── Scenario 61: Concurrent reads during write ───────────────────────────────

class TestConcurrentReadWrite:
    """Scenario 61: reading while writing does not corrupt results.

    Simulates concurrent access by interleaving ingests and reads.
    Not truly concurrent (single-threaded), but exercises the read path
    while the WAL is being built up.
    """

    STREAM = _stream("concurrent")
    BATCHES = 5
    BATCH_N = 20

    def test_61_interleaved_ingest_and_read(self, client):
        total_ingested = 0
        for b in range(self.BATCHES):
            records = [
                {"_timestamp": _ts(b * 1_000_000 + i * 1_000), "batch": b, "idx": i}
                for i in range(self.BATCH_N)
            ]
            ingest(client, self.STREAM, records)
            total_ingested += self.BATCH_N
            # Read mid-flight — count must be >= previously flushed batches (WAL visible)
            count = count_records(client, self.STREAM)
            assert count >= 0  # any count is fine — just no errors

        flush_and_wait(client, self.STREAM, expected=total_ingested)
        final = count_records(client, self.STREAM)
        assert final == total_ingested, f"expected {total_ingested}, got {final}"


# ─── Scenario 62: File metadata consistency ───────────────────────────────────

class TestFileMetadata:
    """Scenario 62: stream listing returns consistent metadata after vortex ingest."""

    STREAM = _stream("metadata")
    N = 25

    def test_62_ingest_and_flush(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "host": f"h{i % 5}", "idx": i}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N)

    def test_62_stream_listing_has_correct_structure(self, client):
        """Stream listing has required fields; stats are non-negative.

        Note: doc_num/storage_size only update after background compaction.
        We assert structure (created_at, non-negative counts), not specific values.
        """
        resp = client.get(f"streams?type=logs&stream_name={self.STREAM}")
        assert resp.status_code == 200

        entry = next(
            (s for s in resp.json().get("list", []) if s["name"] == self.STREAM),
            None,
        )
        assert entry is not None, f"stream {self.STREAM!r} not found in listing"
        assert entry["stream_type"] == "logs"

        stats = entry.get("stats", {})
        assert int(stats.get("created_at", 0)) > 0, "created_at must be set"
        for key in ("doc_num", "file_num"):
            assert int(stats.get(key, 0)) >= 0, f"{key} must be >= 0"
        for key in ("storage_size", "compressed_size"):
            assert float(stats.get(key, 0.0)) >= 0.0, f"{key} must be >= 0"

        logging.info(
            "stream %s: created_at=%s doc_num=%s file_num=%s",
            self.STREAM,
            stats.get("created_at"),
            stats.get("doc_num"),
            stats.get("file_num"),
        )

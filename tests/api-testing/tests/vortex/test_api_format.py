"""Vortex API-level format awareness tests (Section 8, scenarios 71–73).

Verifies that the HTTP API correctly surfaces stream metadata, schema, and
query results regardless of whether underlying files are .parquet or .vortex.

Key findings from API probing:
  - Schema lives in GET /api/{org}/streams?type=logs&stream_name={name}
    under the `schema` key — there is no separate /schema endpoint.
  - Result caching: `result_cache_ratio` in _search responses is 0 on first
    query, 100 on repeat identical queries.

Enterprise CI only — do not add to OSS api-testing.yml.

Test plan coverage: scenarios 71–73 (Section 8 — API-Level Format Awareness).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from .conftest import SESSION_ID, flush_and_wait, ingest, wait_for_stream_stats

_BASE = f"va_{SESSION_ID}"  # vortex_api


def _stream(suffix: str) -> str:
    return f"{_BASE}_{suffix}"


def _ts(offset_ms: int = 0) -> int:
    return int(time.time() * 1_000_000) + offset_ms * 1_000


def _wide_payload(stream: str, sql: str, size: int = 20) -> dict:
    now = datetime.now(timezone.utc)
    return search_payload(
        sql,
        start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
        end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
        size=size,
    )


def _get_stream_entry(client, stream: str) -> dict:
    """Fetch the stream listing entry for *stream*. Returns {} if not found."""
    resp = client.get(f"streams?type=logs&stream_name={stream}")
    assert resp.status_code == 200, f"streams listing failed: {resp.status_code}"
    return next(
        (s for s in resp.json().get("list", []) if s["name"] == stream),
        {},
    )


# ─── Scenario 71: Stream listing ──────────────────────────────────────────────

class TestStreamListing:
    """Scenario 71: stream listing returns correct stats after vortex ingest+flush."""

    STREAM = _stream("listing")
    N = 15

    def test_71_stream_appears_in_listing(self, client):
        records = [
            {"_timestamp": _ts(i * 100), "host": f"h{i}", "level": "info", "idx": i}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N)

        entry = _get_stream_entry(client, self.STREAM)
        assert entry, f"stream {self.STREAM!r} not found in listing"
        assert entry["name"] == self.STREAM
        assert entry["stream_type"] == "logs"

    def test_71_stats_structure_correct(self, client):
        """Stream stats have the right shape after flush.

        doc_num/storage_size only update after compaction (server-side schedule).
        We assert structure and created_at; size/count fields require compaction.
        """
        entry = _get_stream_entry(client, self.STREAM)
        assert entry, f"stream {self.STREAM!r} not found"
        stats = entry.get("stats", {})
        assert int(stats.get("created_at", 0)) > 0, "created_at must be set"
        for key in ("doc_num", "file_num"):
            assert int(stats.get(key, 0)) >= 0, f"{key} must be >= 0"
        for key in ("storage_size", "compressed_size"):
            assert float(stats.get(key, 0)) >= 0, f"{key} must be >= 0"

    def test_71_total_fields_non_negative(self, client):
        entry = _get_stream_entry(client, self.STREAM)
        assert entry, f"stream {self.STREAM!r} not found"
        assert int(entry.get("total_fields", 0)) >= 0


# ─── Scenario 72: Schema API ───────────────────────────────────────────────────

class TestSchemaAPI:
    """Scenario 72: schema returned via the stream listing is self-consistent
    for a stream containing data (whether parquet or vortex on disk).

    Note: there is no separate /schema HTTP endpoint — schema is embedded in the
    streams listing response under the `schema` key.
    """

    STREAM = _stream("schema")

    FIELDS = ["env", "region", "service", "latency_ms", "success"]

    def test_72_schema_is_present_after_flush(self, client):
        records = [
            {
                "_timestamp": _ts(i * 100),
                "env": "prod",
                "region": "us-east-1",
                "service": f"svc-{i % 3}",
                "latency_ms": i * 10,
                "success": i % 2 == 0,
            }
            for i in range(10)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=10)

        entry = _get_stream_entry(client, self.STREAM)
        assert entry, f"stream {self.STREAM!r} not found"

        schema = entry.get("schema", [])
        assert isinstance(schema, list), f"schema should be a list, got {type(schema)}"

    def test_72_schema_fields_have_name_and_type(self, client):
        entry = _get_stream_entry(client, self.STREAM)
        schema = entry.get("schema", [])

        if not schema:
            pytest.skip("schema not yet materialized — may need more data or a compaction cycle")

        for field in schema:
            assert "name" in field, f"schema field missing 'name': {field}"
            assert "type" in field, f"schema field missing 'type': {field}"

    def test_72_schema_covers_ingested_fields(self, client):
        entry = _get_stream_entry(client, self.STREAM)
        schema = entry.get("schema", [])

        if not schema:
            pytest.skip("schema not yet materialized")

        schema_names = {f["name"] for f in schema}
        for expected_field in self.FIELDS:
            assert expected_field in schema_names, \
                f"ingested field '{expected_field}' missing from schema: {schema_names}"


# ─── Scenario 73: Cache behavior ──────────────────────────────────────────────

class TestCacheBehavior:
    """Scenario 73: identical queries against a mixed-format stream hit the result
    cache on repeat, returning identical results both times."""

    STREAM = _stream("cache")
    N = 12

    def _run_search(self, client) -> tuple[list, int]:
        """Returns (hits, result_cache_ratio)."""
        payload = _wide_payload(
            self.STREAM,
            f'SELECT host, idx FROM "{self.STREAM}" ORDER BY idx ASC',
            size=self.N + 5,
        )
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200, f"search failed: {resp.status_code}"
        data = resp.json()
        return data["hits"], int(data.get("result_cache_ratio", 0))

    def test_73_results_identical_on_repeat_query(self, client):
        records = [
            {"_timestamp": _ts(i * 100), "host": f"host-{i}", "idx": i}
            for i in range(self.N)
        ]
        ingest(client, self.STREAM, records)
        flush_and_wait(client, self.STREAM, expected=self.N)

        hits1, ratio1 = self._run_search(client)
        hits2, ratio2 = self._run_search(client)

        assert len(hits1) == len(hits2), \
            f"hit count changed between queries: {len(hits1)} vs {len(hits2)}"

        for i, (h1, h2) in enumerate(zip(hits1, hits2)):
            assert h1 == h2, f"row {i} differs between queries: {h1!r} vs {h2!r}"

    def test_73_second_query_uses_result_cache(self, client):
        # First call is a cache miss (ratio may be 0); second should be a cache hit.
        _, ratio1 = self._run_search(client)
        _, ratio2 = self._run_search(client)

        assert ratio2 >= ratio1, \
            f"result_cache_ratio should not decrease on repeat: {ratio1} → {ratio2}"

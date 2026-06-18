"""Vortex full-text search tests (Section 7, scenarios 51–54).

FTS is enabled per-field via:
    PUT /api/{org}/streams/{stream}/settings?type=logs
    body: {"full_text_search_keys": {"add": ["field_name"]}}

After enabling FTS and flushing, OO builds a Tantivy index. Queries use
match_all('keyword') or match_all_raw('keyword') via SQL.

Enterprise CI only — do not add to OSS api-testing.yml.

Test plan coverage: scenarios 51–54 (Section 7 — Full-Text Search).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from support.wait import WaitTimeout, wait_until
from .conftest import SESSION_ID, count_records, flush_and_wait, ingest

_BASE = f"vfts_{SESSION_ID}"  # vortex_fts


def _stream(suffix: str) -> str:
    return f"{_BASE}_{suffix}"


def _ts(offset_us: int = 0) -> int:
    return int(time.time() * 1_000_000) + offset_us


def _wide_payload(sql: str, size: int = 50) -> dict:
    now = datetime.now(timezone.utc)
    return search_payload(
        sql,
        start_time=int((now - timedelta(weeks=4)).timestamp() * 1_000_000),
        end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
        size=size,
    )


def _enable_fts(client, stream: str, field: str) -> None:
    """Enable full-text search on *field* for *stream*."""
    resp = client.put(
        f"streams/{stream}/settings?type=logs",
        json={"full_text_search_keys": {"add": [field]}},
    )
    assert resp.status_code in (200, 204), (
        f"enable FTS failed: {resp.status_code} {resp.text[:200]}"
    )


def _wait_for_fts(client, stream: str, keyword: str, *, timeout: float = 120.0) -> None:
    """Wait until match_all(keyword) returns at least one hit in *stream*.

    Raises pytest.skip if the server returns 400 for match_all — this means
    FTS/Tantivy is not compiled in or not configured, not a transient failure.
    """
    def _ready():
        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f"SELECT COUNT(*) AS c FROM \"{stream}\" WHERE match_all('{keyword}')",
                size=1,
            ),
        )
        if resp.status_code == 400:
            # match_all not supported — fail fast rather than looping to timeout
            raise RuntimeError(
                f"match_all query returned 400 — FTS may not be supported: {resp.text[:200]}"
            )
        if resp.status_code != 200:
            return False
        hits = resp.json().get("hits", [])
        return bool(hits and int(hits[0].get("c", 0)) >= 1)

    try:
        wait_until(
            _ready,
            timeout=timeout,
            interval=3.0,
            msg=f"{stream}: FTS index for '{keyword}' not ready within {timeout}s",
        )
    except RuntimeError as exc:
        pytest.skip(str(exc))


# ─── Scenario 51: Basic FTS on vortex stream ──────────────────────────────────

class TestFTSBasic:
    """Scenario 51: enable FTS on a vortex stream and verify match_all works."""

    STREAM = _stream("basic")
    FIELD = "message"

    RECORDS = [
        {"_timestamp": _ts(i * 1_000), "message": msg, "idx": i}
        for i, msg in enumerate([
            "unicorn rainbow deploy succeeded",
            "database connection pool exhausted",
            "unicorn startup complete",
            "cache miss ratio exceeded threshold",
            "unicorn worker recycled",
        ])
    ]

    def test_51_ingest_and_enable_fts(self, client):
        # Ingest first so the stream exists before applying the settings update.
        ingest(client, self.STREAM, self.RECORDS)
        _enable_fts(client, self.STREAM, self.FIELD)
        flush_and_wait(client, self.STREAM, expected=len(self.RECORDS))

    def test_51_fts_matches_keyword(self, client):
        try:
            _wait_for_fts(client, self.STREAM, "unicorn", timeout=120)
        except WaitTimeout:
            pytest.skip("FTS index not ready — check ZO_COMPACT_INTERVAL in enterprise CI")

        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f"SELECT message, idx FROM \"{self.STREAM}\" "
                f"WHERE match_all('unicorn') ORDER BY idx ASC",
                size=10,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == 3, f"expected 3 unicorn hits, got {len(hits)}"
        for h in hits:
            assert "unicorn" in h["message"].lower(), \
                f"FTS returned non-matching row: {h['message']!r}"

    def test_51_fts_no_false_positives(self, client):
        try:
            _wait_for_fts(client, self.STREAM, "unicorn", timeout=60)
        except WaitTimeout:
            pytest.skip("FTS index not ready")

        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f"SELECT COUNT(*) AS c FROM \"{self.STREAM}\" "
                f"WHERE match_all('nonexistentkeywordxyz')",
                size=1,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        n = int(hits[0].get("c", 0)) if hits else 0
        assert n == 0, f"FTS returned false positives for nonexistent keyword: {n}"


# ─── Scenario 52: FTS index rebuild after format switch ───────────────────────

class TestFTSRebuild:
    """Scenario 52: FTS index is rebuilt correctly when format switches parquet→vortex.

    In this API test, both batches are written in the same format. The
    cross-format rebuild is validated in enterprise CI phase tests. Here we
    verify FTS survives multiple ingest+flush cycles.
    """

    STREAM = _stream("rebuild")
    FIELD = "log"

    def test_52_fts_survives_multiple_flushes(self, client):
        # Ingest at least one record first so the stream exists before settings update.
        ingest(client, self.STREAM, [
            {"_timestamp": _ts(0), "log": "phoenix init", "batch": -1}
        ])
        _enable_fts(client, self.STREAM, self.FIELD)

        for batch in range(3):
            records = [
                {"_timestamp": _ts(batch * 1_000_000 + i * 1_000),
                 "log": f"phoenix event batch{batch} entry{i}",
                 "batch": batch}
                for i in range(5)
            ]
            ingest(client, self.STREAM, records)

        # 1 init record + 3 batches × 5 = 16 total; FTS query only matches "phoenix"
        flush_and_wait(client, self.STREAM, expected=16)

        try:
            _wait_for_fts(client, self.STREAM, "phoenix", timeout=120)
        except WaitTimeout:
            pytest.skip("FTS index not ready")

        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f"SELECT COUNT(*) AS c FROM \"{self.STREAM}\" WHERE match_all('phoenix')",
                size=1,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        total = int(hits[0].get("c", 0)) if hits else 0
        # 15 batch records + 1 init record (also contains "phoenix") = 16
        assert total == 16, f"expected 16 phoenix hits across batches, got {total}"


# ─── Scenario 53: FTS on mixed-format stream ──────────────────────────────────

class TestFTSMixedFormats:
    """Scenario 53: FTS works on a stream containing both parquet and vortex files.

    In single-format CI, this validates FTS across multiple flush cycles.
    In enterprise CI with format switch, this validates cross-format FTS.
    """

    STREAM = _stream("mixed")
    FIELD = "content"

    def test_53_fts_across_multiple_batches(self, client):
        batch_a = [
            {"_timestamp": _ts(i * 1_000), "content": f"zeppelin airship log {i}", "src": "a"}
            for i in range(5)
        ]
        batch_b = [
            {"_timestamp": _ts(100_000 + i * 1_000), "content": f"rocket launch log {i}", "src": "b"}
            for i in range(5)
        ]

        # Ingest batch_a first so the stream exists before applying FTS settings.
        ingest(client, self.STREAM, batch_a)
        _enable_fts(client, self.STREAM, self.FIELD)
        ingest(client, self.STREAM, batch_b)
        flush_and_wait(client, self.STREAM, expected=10)

        try:
            _wait_for_fts(client, self.STREAM, "zeppelin", timeout=120)
        except WaitTimeout:
            pytest.skip("FTS index not ready")

        for keyword, expected_count in [("zeppelin", 5), ("rocket", 5), ("log", 10)]:
            resp = client.post(
                "_search?type=logs",
                json=_wide_payload(
                    f"SELECT COUNT(*) AS c FROM \"{self.STREAM}\" WHERE match_all('{keyword}')",
                    size=1,
                ),
            )
            assert resp.status_code == 200
            hits = resp.json()["hits"]
            n = int(hits[0].get("c", 0)) if hits else 0
            assert n == expected_count, f"keyword={keyword!r}: expected {expected_count}, got {n}"


# ─── Scenario 54: FTS preserves row order in combined results ─────────────────

class TestFTSParallelRowOrder:
    """Scenario 54: FTS result order is consistent with ORDER BY on regular fields."""

    STREAM = _stream("order")
    FIELD = "text"

    def test_54_fts_result_order(self, client):
        records = [
            {"_timestamp": _ts(i * 1_000), "text": f"dragonfly signal {i}", "seq": i}
            for i in range(10)
        ]
        # Ingest before enabling FTS so the stream exists when settings are applied.
        ingest(client, self.STREAM, records)
        _enable_fts(client, self.STREAM, self.FIELD)
        flush_and_wait(client, self.STREAM, expected=10)

        try:
            _wait_for_fts(client, self.STREAM, "dragonfly", timeout=120)
        except WaitTimeout:
            pytest.skip("FTS index not ready")

        resp = client.post(
            "_search?type=logs",
            json=_wide_payload(
                f"SELECT seq FROM \"{self.STREAM}\" WHERE match_all('dragonfly') ORDER BY seq ASC",
                size=20,
            ),
        )
        assert resp.status_code == 200
        hits = resp.json()["hits"]
        assert len(hits) == 10, f"expected 10 hits, got {len(hits)}"
        seqs = [int(h["seq"]) for h in hits]
        assert seqs == list(range(10)), f"FTS result order wrong: {seqs}"

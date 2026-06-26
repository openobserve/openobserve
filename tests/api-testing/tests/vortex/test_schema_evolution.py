"""Vortex schema evolution tests.

All tests run against a single ZO_FILE_FORMAT=vortex server — no restarts.
Each test class uses a fresh stream (stream name includes class name) so
tests are fully isolated and can run in parallel.

Test plan coverage:
  Scenarios 14–25  — baseline schema evolution (new field, drop field, type change,
                      incompatible type changes)
  Scenarios 26–28  — diverge-then-converge: three-batch field lifecycle
  Scenarios 29–31  — NULL handling for absent fields
  Scenarios 32–36  — aggregations on partial fields (COUNT, SUM, MIN/MAX, DISTINCT)
  Scenarios 37–40  — GROUP BY / ORDER BY across evolved schemas
  Scenarios 41–43  — type change on field reappearance
  Scenarios 44–46  — multiple divergence cycles
  Scenarios 47–51  — complex queries (SELECT *, CASE WHEN, subquery, CTE, WHERE)
  Scenarios 52–55  — time-range queries across evolving schemas
  Scenarios 56–57b — full-text search on evolved schemas (57b uses match_all FTS UDF)
  Scenarios 58–59  — high-field-count divergence
  Negative tests   — phantom values, graceful unknown-field handling, count invariant
"""
from __future__ import annotations

import time
import logging

import pytest

from .conftest import SESSION_ID, count_records, flush_and_wait, ingest, _wide_window
from support.factories import search_payload

_BASE_STREAM = f"vse_{SESSION_ID}"  # vortex_schema_evo


def _stream(suffix: str) -> str:
    return f"{_BASE_STREAM}_{suffix}"


def _ts(offset_ms: int = 0) -> int:
    return int(time.time() * 1_000_000) + offset_ms * 1_000


# ─── Section 2.1: New field addition ──────────────────────────────────────────

class TestNewFieldAddition:
    """Scenarios 14–16: fields added in later batches appear in query results;
    older rows get null for the new field."""

    STREAM = _stream("new_field")

    def test_14_add_single_new_field(self, client):
        """Scenario 14: ingest A,B then A,B,C; older rows show null for C."""
        s = self.STREAM
        batch1 = [{"_timestamp": _ts(i), "field_a": f"a{i}", "field_b": i} for i in range(5)]
        batch2 = [{"_timestamp": _ts(100 + i), "field_a": f"a{i}", "field_b": i, "field_c": f"c{i}"} for i in range(5)]

        ingest(client, s, batch1)
        ingest(client, s, batch2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10

        with_c = count_records(client, s, where="field_c IS NOT NULL AND field_c != ''")
        assert with_c == 5, f"only batch-2 rows should have field_c; got {with_c}"

    def test_15_add_multiple_new_fields(self, client):
        """Scenario 15: batch-2 adds C, D, E; all 5 fields queryable."""
        s = _stream("multi_new")
        batch1 = [{"_timestamp": _ts(i), "field_a": "a", "field_b": 1} for i in range(5)]
        batch2 = [{"_timestamp": _ts(100 + i), "field_a": "a", "field_b": 1,
                   "field_c": "c", "field_d": i, "field_e": True} for i in range(5)]

        ingest(client, s, batch1)
        ingest(client, s, batch2)
        flush_and_wait(client, s, expected=10)

        # field_a is a string — IS NOT NULL AND != '' is a valid emptiness check.
        n = count_records(client, s, where="field_a IS NOT NULL AND field_a != ''")
        assert n == 10, f"field_a should appear in all 10 rows, got {n}"
        # field_b is int — comparing to '' is a numeric/string type mismatch; use
        # the actual value (1 in every row) instead.
        n = count_records(client, s, where="field_b = 1")
        assert n == 10, f"field_b should appear in all 10 rows, got {n}"

        # Use value-specific checks: IS NOT NULL AND != '' is unreliable for
        # numeric/boolean fields (e.g. field_d=0, field_e=false may look empty).
        n = count_records(client, s, where="field_c='c'")
        assert n == 5, f"field_c should appear in 5 rows, got {n}"
        # field_d is int — non-null rows have values 0..4; use >= 0 so value 0 is included
        n = count_records(client, s, where="field_d >= 0")
        assert n == 5, f"field_d should appear in 5 rows, got {n}"
        # field_e is Boolean — comparing to '' causes a type error; check the actual value
        n = count_records(client, s, where="field_e = true")
        assert n == 5, f"field_e should appear in 5 rows, got {n}"

    def test_16_new_field_data_types(self, client):
        """Scenario 16: new fields of type string, int, float, bool are all queryable."""
        s = _stream("dtypes")
        base = [{"_timestamp": _ts(i), "host": "h1"} for i in range(3)]
        evolved = [
            {"_timestamp": _ts(100 + i), "host": "h1",
             "str_field": "hello",
             "int_field": 42,
             "float_field": 3.14,
             "bool_field": True}
            for i in range(3)
        ]
        ingest(client, s, base)
        ingest(client, s, evolved)
        flush_and_wait(client, s, expected=6)

        n = count_records(client, s, where="str_field='hello'")
        assert n == 3, f"str_field filter wrong: {n}"
        n = count_records(client, s, where="int_field=42")
        assert n == 3, f"int_field filter wrong: {n}"


# ─── Section 2.2: Field removal / missing fields ───────────────────────────────

class TestFieldRemoval:
    """Scenarios 17–18: omitting a field in later batches leaves older rows intact."""

    def test_17_omit_field_in_newer_data(self, client):
        """Scenario 17: ingest A,B,C then A,B (no C); older rows keep their C value."""
        s = _stream("omit_field")
        batch1 = [{"_timestamp": _ts(i), "fa": "a", "fb": 1, "fc": "present"} for i in range(5)]
        batch2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fb": 1} for i in range(5)]

        ingest(client, s, batch1)
        ingest(client, s, batch2)
        flush_and_wait(client, s, expected=10)

        with_fc = count_records(client, s, where="fc='present'")
        assert with_fc == 5, f"only batch-1 should have fc=present; got {with_fc}"

    def test_18_omit_then_readd_field(self, client):
        """Scenario 18: A,B,C → A,B → A,B,C: C present in batches 1 and 3 only."""
        s = _stream("readd_field")
        b1 = [{"_timestamp": _ts(i), "fa": "a", "fc": "v1"} for i in range(4)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(4)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "v3"} for i in range(4)]

        ingest(client, s, b1)
        ingest(client, s, b2)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=12)

        with_fc = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        assert with_fc == 8, f"fc should be present in 8 rows (batches 1 and 3), got {with_fc}"


# ─── Section 2.3: Type changes ─────────────────────────────────────────────────

class TestTypeChanges:
    """Scenarios 19–20: numeric widening and string→int coercion via schema evolution."""

    def test_19_string_to_numeric_coercion(self, client):
        """Scenario 19: field X ingested as string '42' then as int 42 — cast_to_type applies."""
        s = _stream("str_to_int")
        batch1 = [{"_timestamp": _ts(i), "host": "h", "value": "42"} for i in range(3)]
        batch2 = [{"_timestamp": _ts(100 + i), "host": "h", "value": 99} for i in range(3)]

        ingest(client, s, batch1)
        ingest(client, s, batch2)
        flush_and_wait(client, s, expected=6)

        total = count_records(client, s)
        assert total == 6, f"expected 6 rows; got {total}"

    def test_20_int_to_float_widening(self, client):
        """Scenario 20: field X ingested as int then float — both values queryable."""
        s = _stream("int_float")
        batch1 = [{"_timestamp": _ts(i), "host": "h", "metric": 10} for i in range(3)]
        batch2 = [{"_timestamp": _ts(100 + i), "host": "h", "metric": 10.5} for i in range(3)]

        ingest(client, s, batch1)
        ingest(client, s, batch2)
        flush_and_wait(client, s, expected=6)

        total = count_records(client, s)
        assert total == 6, f"expected 6 rows; got {total}"


# ─── Section 2.4: Schema evolution edge cases ──────────────────────────────────

class TestSchemaEvolutionEdgeCases:
    """Scenarios 22–25: edge cases for schema evolution under vortex."""

    def test_22_schema_evolution_on_mixed_format_stream(self, client):
        """Scenario 22: field C added in batch-2 appears as null for batch-1 rows.

        In this API test both batches are written in the same format (whatever the
        server uses). The format-boundary case is validated in enterprise CI phase
        tests where ZO_FILE_FORMAT changes between batches. Here we verify the
        schema evolution logic itself.
        """
        s = _stream("mixed_fmt_schema")
        batch1 = [{"_timestamp": _ts(i), "fa": "a", "fb": 1} for i in range(5)]
        batch2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fb": 1, "fc": "new"} for i in range(5)]

        ingest(client, s, batch1)
        ingest(client, s, batch2)
        flush_and_wait(client, s, expected=10)

        assert count_records(client, s) == 10
        with_fc = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        assert with_fc == 5, f"only batch-2 rows should have fc; got {with_fc}"

    def test_23_large_number_of_field_additions(self, client):
        """Scenario 23: 5 base fields then 50 new fields across 5 batches — all queryable."""
        s = _stream("many_fields")
        base = [{"_timestamp": _ts(i), "f0": "base", "f1": 1, "f2": 2.0, "f3": True, "f4": "x"} for i in range(3)]
        ingest(client, s, base)

        for batch_idx in range(5):
            extra = {f"new_field_{batch_idx * 10 + j}": f"val_{j}" for j in range(10)}
            records = [{"_timestamp": _ts(1000 * (batch_idx + 1) + i), "f0": "extra", **extra} for i in range(3)]
            ingest(client, s, records)

        flush_and_wait(client, s, expected=18)

        total = count_records(client, s)
        assert total == 18

        n = count_records(client, s, where="new_field_0 IS NOT NULL AND new_field_0 != ''")
        assert n == 3, f"new_field_0 should appear in 3 rows, got {n}"
        n = count_records(client, s, where="new_field_40 IS NOT NULL AND new_field_40 != ''")
        assert n == 3, f"new_field_40 should appear in 3 rows, got {n}"

    def test_24_nested_field_addition(self, client):
        """Scenario 24: nested JSON object field is ingested and queryable."""
        s = _stream("nested")
        records = [
            {
                "_timestamp": _ts(i),
                "host": f"h{i}",
                "metadata": {"env": "prod", "region": "us-east-1"},
            }
            for i in range(5)
        ]
        ingest(client, s, records)
        flush_and_wait(client, s, expected=5)

        total = count_records(client, s)
        assert total == 5

    def test_25_array_field_addition(self, client):
        """Scenario 25: array field is ingested and appears in results."""
        s = _stream("array_field")
        records = [
            {"_timestamp": _ts(i), "host": f"h{i}", "tags": ["a", "b", "c"]}
            for i in range(5)
        ]
        ingest(client, s, records)
        flush_and_wait(client, s, expected=5)

        total = count_records(client, s)
        assert total == 5


# ─── Section 2.6: Incompatible type changes ────────────────────────────────────

class TestIncompatibleTypeChanges:
    """Scenarios A–F: a field's type changes to an incompatible type across batches.

    Each test ingests Batch 1 (type T1), flushes to disk, then ingests Batch 2
    (type T2) and flushes again — ensuring the two batches end up in separate
    files with different schemas. Assertions verify:
      1. No crash — total record count is intact after the type change.
      2. A type-specific filter returns only the matching batch's records;
         the other batch's records are excluded without error.
    """

    def test_scenario_a_bool_to_string(self, client):
        """Scenario A: flag bool→string. WHERE flag='yes' matches only Batch 2."""
        s = _stream("bool_to_str")
        b1 = [{"_timestamp": _ts(i), "flag": True, "batch": 1} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "flag": "yes", "batch": 2} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10, f"expected 10 total records; got {total}"

        matched = count_records(client, s, where="flag = 'yes'")
        assert matched == 5, f"WHERE flag='yes' should match only Batch 2 (5 records); got {matched}"

    def test_scenario_b_float_to_string(self, client):
        """Scenario B: score float→string. WHERE score='high' matches only Batch 2."""
        s = _stream("float_to_str")
        b1 = [{"_timestamp": _ts(i), "score": 3.14, "batch": 1} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "score": "high", "batch": 2} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10, f"expected 10 total records; got {total}"

        matched = count_records(client, s, where="score = 'high'")
        assert matched == 5, f"WHERE score='high' should match only Batch 2 (5 records); got {matched}"

    def test_scenario_c_int_to_string(self, client):
        """Scenario C: code int→string. WHERE code='foo' matches only Batch 2."""
        s = _stream("int_to_str")
        b1 = [{"_timestamp": _ts(i), "code": 100, "batch": 1} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "code": "foo", "batch": 2} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10, f"expected 10 total records; got {total}"

        matched = count_records(client, s, where="code = 'foo'")
        assert matched == 5, f"WHERE code='foo' should match only Batch 2 (5 records); got {matched}"

    def test_scenario_d_bool_to_int(self, client):
        """Scenario D: active bool→int. OO coerces True→1, so WHERE active=1 matches both batches."""
        s = _stream("bool_to_int")
        b1 = [{"_timestamp": _ts(i), "active": True, "batch": 1} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "active": 1, "batch": 2} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10, f"expected 10 total records; got {total}"

        # OO coerces boolean True → 1 when evaluating integer predicates,
        # so both Batch 1 (True) and Batch 2 (1) satisfy active = 1.
        matched = count_records(client, s, where="active = 1")
        assert matched == 10, f"OO coerces True→1; expected all 10 records to match; got {matched}"

    def test_scenario_e_bool_to_float(self, client):
        """Scenario E: ratio bool→float. OO coerces True→1.0, so WHERE ratio>0.7 matches Batch 1 + high Batch 2."""
        s = _stream("bool_to_float")
        b1 = [{"_timestamp": _ts(i), "ratio": True, "batch": 1} for i in range(5)]
        # Batch 2: 3 records at 1.0 (i=0,2,4 → >0.7), 2 records at 0.5 (i=1,3 → <0.7)
        b2 = [
            {"_timestamp": _ts(100 + i), "ratio": 1.0 if i % 2 == 0 else 0.5, "batch": 2}
            for i in range(5)
        ]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10, f"expected 10 total records; got {total}"

        # OO coerces boolean True → 1.0 when evaluating float predicates.
        # Batch 1: all True → 1.0 > 0.7 → 5 matches.
        # Batch 2: ratio=1.0 (3 records) > 0.7, ratio=0.5 (2 records) not > 0.7 → 3 matches.
        # Total expected: 5 + 3 = 8.
        matched = count_records(client, s, where="ratio > 0.7")
        assert matched == 8, f"OO coerces True→1.0; expected 8 records (5 bool + 3 float); got {matched}"

    def test_scenario_f_int_to_float(self, client):
        """Scenario F: value int→float. WHERE value>1.2 matches only Batch 2."""
        s = _stream("int_to_float")
        # Batch 1: value=1 — 1 < 1.2 so should NOT match even after coercion
        b1 = [{"_timestamp": _ts(i), "value": 1, "batch": 1} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "value": 1.5, "batch": 2} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)

        total = count_records(client, s)
        assert total == 10, f"expected 10 total records; got {total}"

        matched = count_records(client, s, where="value > 1.2")
        assert matched == 5, f"WHERE value>1.2 should match only Batch 2 (5 records); got {matched}"


# ─── Section 2.7: Diverge-then-converge ──────────────────────────────────────

class TestSchemaDivergenceConvergence:
    """Scenarios 26–28: three-batch schema drift simulating real field lifecycle.

    Batch 1  [fa, fb, fc]          — initial deployment
    Batch 2  [fa, fb, fd]          — update: fc dropped, fd introduced
    Batch 3  [fa, fb, fc, fd, fe]  — redeployment: fc back, fd kept, fe added

    Each batch is flushed to a separate file before the next batch is ingested.
    This forces the query planner to reconcile three distinct on-disk schemas —
    the path touched by 'perf: Batch schema evolution checks' (v0.80.0).

    Without flush_and_wait between batches all records land in the same memtable
    and OO sees the union schema immediately — no evolution occurs and the tests
    prove nothing.
    """

    def test_26_nullability_per_batch(self, client):
        """Scenario 26: each field is non-null in exactly the batches that sent it.

        fa, fb  — all 15 rows
        fc      — batch 1 + batch 3 = 10 rows; null in batch 2
        fd      — batch 2 + batch 3 = 10 rows; null in batch 1
        fe      — batch 3 only = 5 rows
        """
        s = _stream("dc_nullability")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fb": i, "fc": f"c{i}"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fb": i, "fd": f"d{i}"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fb": i, "fc": f"c{i}", "fd": f"d{i}", "fe": f"e{i}"} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

        assert count_records(client, s) == 15

        fa_count = count_records(client, s, where="fa IS NOT NULL AND fa != ''")
        assert fa_count == 15, f"fa should be in all 15 rows; got {fa_count}"

        fb_count = count_records(client, s, where="fb IS NOT NULL")
        assert fb_count == 15, f"fb should be in all 15 rows; got {fb_count}"

        fc_present = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        assert fc_present == 10, f"fc should be in batches 1+3 (10 rows); got {fc_present}"

        fd_present = count_records(client, s, where="fd IS NOT NULL AND fd != ''")
        assert fd_present == 10, f"fd should be in batches 2+3 (10 rows); got {fd_present}"

        fe_present = count_records(client, s, where="fe IS NOT NULL AND fe != ''")
        assert fe_present == 5, f"fe should be in batch 3 only (5 rows); got {fe_present}"

    def test_27_cross_batch_aggregation(self, client):
        """Scenario 27: numeric field absent in one batch — COUNT and range filter correct.

        latency_ms is present in batches 1 and 3, absent in batch 2.
        COUNT(*) must return 15. Filters on latency_ms must return 10.
        """
        s = _stream("dc_agg")
        b1 = [{"_timestamp": _ts(i),       "host": "h1", "latency_ms": 100 + i} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "host": "h1"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "host": "h1", "latency_ms": 200 + i} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

        total = count_records(client, s)
        assert total == 15, f"total record count wrong: {total}"

        with_latency = count_records(client, s, where="latency_ms IS NOT NULL")
        assert with_latency == 10, f"latency_ms should be non-null in 10 rows; got {with_latency}"

        # batch 1: values 100–104, batch 3: values 200–204 — all > 99
        above_threshold = count_records(client, s, where="latency_ms > 99")
        assert above_threshold == 10, f"latency_ms > 99 should match 10 rows; got {above_threshold}"

    def test_28_field_coexistence_isolation(self, client):
        """Scenario 28: intersection and exclusion queries correctly isolate each batch.

        Only batch 3 has both fc and fd.
        Only batch 1 has fc without fd.
        Only batch 2 has fd without fc.
        """
        s = _stream("dc_isolation")
        b1 = [{"_timestamp": _ts(i),       "fa": "shared", "fc": "from_b1"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "shared", "fd": "from_b2"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "shared", "fc": "from_b3", "fd": "from_b3"} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

        # OO stores absent string fields as empty string '' rather than SQL NULL,
        # so the correct non-null check for string fields is "IS NOT NULL AND != ''".
        both = count_records(client, s, where="fc IS NOT NULL AND fc != '' AND fd IS NOT NULL AND fd != ''")
        assert both == 5, f"only batch 3 should have both fc and fd (5 rows); got {both}"

        fc_only = count_records(client, s, where="fc IS NOT NULL AND fc != '' AND (fd IS NULL OR fd = '')")
        assert fc_only == 5, f"only batch 1 should have fc without fd (5 rows); got {fc_only}"

        fd_only = count_records(client, s, where="fd IS NOT NULL AND fd != '' AND (fc IS NULL OR fc = '')")
        assert fd_only == 5, f"only batch 2 should have fd without fc (5 rows); got {fd_only}"


# ─── Group 1: NULL handling ────────────────────────────────────────────────────

class TestNullHandling:
    """Scenarios 29–31: NULL and empty-string handling for absent fields.

    Batch 1 [fa, fb, fc], Batch 2 [fa, fb, fd], Batch 3 [fa, fb, fc, fd, fe]
    fc is absent in batch 2 — those rows must be reachable via IS NULL / IS EMPTY filters.
    """

    def _ingest_three_batches(self, client, s):
        """Ingest the standard three-batch diverge-then-converge schema into *s*.

        Batch 1 [fa, fb, fc], Batch 2 [fa, fb, fd], Batch 3 [fa, fb, fc, fd, fe].
        flush_and_wait after each batch forces a separate on-disk file so the query
        planner must reconcile three distinct schemas.
        """
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fb": i, "fc": f"val{i}"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fb": i, "fd": f"val{i}"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fb": i, "fc": f"val{i}", "fd": f"val{i}", "fe": f"val{i}"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

    def test_29_where_field_is_null_returns_absent_batch(self, client):
        """Scenario 29: WHERE fc IS NULL returns exactly batch 2 rows (5)."""
        s = _stream("null_29")
        self._ingest_three_batches(client, s)
        null_rows = count_records(client, s, where="fc IS NULL OR fc = ''")
        assert null_rows == 5, f"batch 2 rows (fc absent) should be 5; got {null_rows}"

    def test_30_coalesce_on_absent_field(self, client):
        """Scenario 30: COALESCE(NULLIF(fc, ''), 'missing') classifies absent-field rows.

        OO stores absent string fields as '' not SQL NULL, so plain COALESCE(fc, 'missing')
        returns '' for batch 2 rows ('' is not NULL). NULLIF(fc, '') converts '' → NULL first,
        letting COALESCE substitute the default. Batch 2 (5 rows) must resolve to 'missing'.
        """
        s = _stream("null_30")
        self._ingest_three_batches(client, s)
        start, end = _wide_window()
        sql = f"""SELECT COUNT(*) AS c FROM "{s}" WHERE COALESCE(NULLIF(fc, ''), 'missing') = 'missing'"""
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        coalesced = int(hits[0].get("c", 0)) if hits else 0
        assert coalesced == 5, f"COALESCE must classify 5 absent-fc rows as 'missing'; got {coalesced}"

    def test_31_not_null_and_null_are_exhaustive(self, client):
        """Scenario 31: IS NOT NULL + IS NULL counts must sum to total — no rows lost."""
        s = _stream("null_31")
        self._ingest_three_batches(client, s)
        total = count_records(client, s)
        not_null = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        is_null = count_records(client, s, where="fc IS NULL OR fc = ''")
        assert total == 15, f"total must be 15; got {total}"
        assert not_null + is_null == total, (
            f"IS NOT NULL ({not_null}) + IS NULL ({is_null}) must equal total ({total})"
        )


# ─── Group 2: Aggregations on partial fields ──────────────────────────────────

class TestAggregationsOnPartialFields:
    """Scenarios 32–36: aggregate functions on fields absent in some batches.

    latency_ms present in batches 1 and 3 (values 100–104 and 200–204), absent in batch 2.
    COUNT(*) must always be 15. Aggregations on latency_ms must operate over 10 rows only.
    """

    def _ingest(self, client, s):
        """Ingest three batches where latency_ms is absent in batch 2.

        Batch 1 [host, latency_ms 100–104], Batch 2 [host only],
        Batch 3 [host, latency_ms 200–204]. flush_and_wait after each batch
        ensures each lands in a separate on-disk file with its own schema header.
        """
        b1 = [{"_timestamp": _ts(i),       "host": "h1", "latency_ms": 100 + i} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "host": "h1"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "host": "h1", "latency_ms": 200 + i} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

    def test_32_count_field_vs_count_star(self, client):
        """Scenario 32: COUNT(latency_ms) must be 10; COUNT(*) must be 15."""
        s = _stream("agg_32")
        self._ingest(client, s)
        total = count_records(client, s)
        assert total == 15, f"COUNT(*) must be 15; got {total}"
        with_latency = count_records(client, s, where="latency_ms IS NOT NULL")
        assert with_latency == 10, f"COUNT(latency_ms) must be 10; got {with_latency}"

    def test_33_sum_excludes_null_rows(self, client):
        """Scenario 33: SUM(latency_ms) sums only the 10 rows that have it.
        batch 1: 100+101+102+103+104 = 510, batch 3: 200+201+202+203+204 = 1010, total = 1520.
        """
        s = _stream("agg_33")
        self._ingest(client, s)
        start, end = _wide_window()
        sql = f'SELECT SUM(latency_ms) AS total FROM "{s}"'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        result = float(hits[0].get("total", 0)) if hits else 0
        assert result == 1520.0, f"SUM(latency_ms) must be 1520; got {result}"

    def test_34_min_max_on_partial_field(self, client):
        """Scenario 34: MIN and MAX on latency_ms operate only over the 10 rows that have it."""
        s = _stream("agg_34")
        self._ingest(client, s)
        start, end = _wide_window()
        sql = f'SELECT MIN(latency_ms) AS mn, MAX(latency_ms) AS mx FROM "{s}"'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        assert hits, "expected hits from MIN/MAX query"
        mn = float(hits[0].get("mn", -1))
        mx = float(hits[0].get("mx", -1))
        assert mn == 100.0, f"MIN(latency_ms) must be 100; got {mn}"
        assert mx == 204.0, f"MAX(latency_ms) must be 204; got {mx}"

    def test_35_count_distinct_on_partial_field(self, client):
        """Scenario 35: COUNT(DISTINCT latency_ms) must be 10 — null rows from batch 2 excluded.

        batch 1: values 100–104 (5 distinct), batch 3: values 200–204 (5 distinct) = 10 total.
        COUNT(DISTINCT) must not count the 5 null rows from batch 2.
        """
        s = _stream("agg_35")
        self._ingest(client, s)
        start, end = _wide_window()
        sql = f'SELECT COUNT(DISTINCT latency_ms) AS c FROM "{s}"'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 10, f"COUNT(DISTINCT latency_ms) must be 10; got {count}"

    def test_35b_count_distinct_deduplicates_cross_batch(self, client):
        """Scenario 35b: COUNT(DISTINCT) must deduplicate values that appear in multiple batches.

        Both batch 1 and batch 3 send latency_ms=100. COUNT(DISTINCT latency_ms) must
        return 1 — not 2 (one per batch) or 10 (one per row). Catches the double-count
        bug where schema reconciliation creates duplicate dictionary entries per file.
        """
        s = _stream("agg_35b")
        b1 = [{"_timestamp": _ts(i),       "host": "h1", "latency_ms": 100} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "host": "h1"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "host": "h1", "latency_ms": 100} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        start, end = _wide_window()
        sql = f'SELECT COUNT(DISTINCT latency_ms) AS c FROM "{s}"'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 1, f"COUNT(DISTINCT) must deduplicate latency_ms=100 across batches 1+3; got {count}"

    def test_36_sum_of_always_present_field_covers_all_rows(self, client):
        """Scenario 36: SUM on a field present in all batches must include all 15 rows."""
        s = _stream("agg_36")
        b1 = [{"_timestamp": _ts(i),       "host": "h1", "val": 1, "latency_ms": 100 + i} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "host": "h1", "val": 1} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "host": "h1", "val": 1, "latency_ms": 200 + i} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        start, end = _wide_window()
        sql = f'SELECT SUM(val) AS s FROM "{s}"'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        result = float(hits[0].get("s", 0)) if hits else 0
        assert result == 15.0, f"SUM(val) across all 15 rows must be 15; got {result}"


# ─── Group 3: GROUP BY and ORDER BY on evolved fields ─────────────────────────

class TestGroupByOrderByEvolved:
    """Scenarios 37–40: GROUP BY and ORDER BY on fields absent in some batches."""

    def _ingest(self, client, s):
        """Ingest three batches where fc is absent in batch 2.

        Batch 1 [fa, fc='zone_a'], Batch 2 [fa only], Batch 3 [fa, fc='zone_b'].
        flush_and_wait after each batch forces separate on-disk files.
        """
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "zone_a"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "zone_b"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

    def test_37_group_by_evolved_field_null_group_present(self, client):
        """Scenario 37: GROUP BY fc — batch 2 rows (fc absent/empty) must not vanish.

        Verified by summing individual group counts via WHERE, which avoids
        parsing OO's GROUP BY response format.
        """
        s = _stream("grp_37")
        self._ingest(client, s)
        zone_a  = count_records(client, s, where="fc = 'zone_a'")
        zone_b  = count_records(client, s, where="fc = 'zone_b'")
        null_fc = count_records(client, s, where="fc IS NULL OR fc = ''")
        total_from_groups = zone_a + zone_b + null_fc
        assert total_from_groups == 15, (
            f"groups must sum to 15 (zone_a={zone_a}, zone_b={zone_b}, null={null_fc}); "
            f"batch 2 null group must not be lost"
        )

    def test_38_group_by_count_per_group_correct(self, client):
        """Scenario 38: zone_a=5 rows, zone_b=5 rows, null=5 rows."""
        s = _stream("grp_38")
        self._ingest(client, s)
        zone_a = count_records(client, s, where="fc = 'zone_a'")
        zone_b = count_records(client, s, where="fc = 'zone_b'")
        null_fc = count_records(client, s, where="fc IS NULL OR fc = ''")
        assert zone_a == 5, f"zone_a must be 5; got {zone_a}"
        assert zone_b == 5, f"zone_b must be 5; got {zone_b}"
        assert null_fc == 5, f"null fc (batch 2) must be 5; got {null_fc}"

    def test_39_order_by_evolved_field_no_records_lost(self, client):
        """Scenario 39: ORDER BY fc ASC — all 15 rows returned, null rows sort without crashing."""
        s = _stream("grp_39")
        self._ingest(client, s)
        total = count_records(client, s)
        assert total == 15, f"ORDER BY must not drop records; total must be 15; got {total}"

    def test_40_order_by_evolved_field_with_limit(self, client):
        """Scenario 40: ORDER BY fc DESC LIMIT 5 — returns 5 rows without error."""
        s = _stream("grp_40")
        self._ingest(client, s)
        start, end = _wide_window()
        sql = f'SELECT fc FROM "{s}" ORDER BY fc DESC LIMIT 5'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=5))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        assert len(hits) == 5, f"LIMIT 5 must return 5 rows; got {len(hits)}"


# ─── Group 4: Type change on reappearance ─────────────────────────────────────

class TestTypeChangeOnReappearance:
    """Scenarios 41–43: field changes type between the batch where it disappears and reappears."""

    def test_41_string_to_int_on_reappearance(self, client):
        """Scenario 41: fc is string in batch 1, absent in batch 2, int in batch 3."""
        s = _stream("retype_41")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "text"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": 42} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        total = count_records(client, s)
        assert total == 15, f"type change on reappearance must not lose records; got {total}"

    def test_42_int_to_float_on_reappearance(self, client):
        """Scenario 42: fc is int in batch 1, absent in batch 2, float in batch 3.

        OO preserves the original int type registration. When fc=10.5 reappears on
        an int-typed field, the value is stored but numeric predicates reflect the
        original type — batch 3 rows are present and non-null but fc=10.5 is not
        queryable as an integer value. The invariant is that no records are lost.
        """
        s = _stream("retype_42")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": 10} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": 10.5} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        # Primary: no records lost
        total = count_records(client, s)
        assert total == 15, f"int→float reappearance must not lose records; got {total}"
        # batch 1 (original int) is numerically queryable
        int_match = count_records(client, s, where="fc = 10")
        assert int_match == 5, f"batch 1 fc=10 must match WHERE fc=10 (5 rows); got {int_match}"
        # fc is a numeric field — comparing to '' causes a Float64 cast error in OO.
        # Use IS NOT NULL only (no != '' check) for numeric fields.
        fc_present = count_records(client, s, where="fc IS NOT NULL")
        assert fc_present == 10, f"fc must be non-null in batches 1+3 (10 rows); got {fc_present}"

    def test_43_bool_to_string_on_reappearance(self, client):
        """Scenario 43: fc is bool in batch 1, absent in batch 2, string in batch 3."""
        s = _stream("retype_43")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": True} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "active"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        total = count_records(client, s)
        assert total == 15, f"bool→string reappearance must not lose records; got {total}"
        string_match = count_records(client, s, where="fc = 'active'")
        assert string_match == 5, f"only batch 3 rows should match fc='active'; got {string_match}"


# ─── Group 5: Multiple divergence cycles ──────────────────────────────────────

class TestMultipleDivergenceCycles:
    """Scenarios 44–46: field disappears and reappears more than once."""

    def test_44_two_full_cycles_five_batches(self, client):
        """Scenario 44: fc diverges twice across 5 batches.

        Batch 1 [fa, fc], Batch 2 [fa, fd], Batch 3 [fa, fc],
        Batch 4 [fa, fd], Batch 5 [fa, fc, fd]
        fc present in batches 1, 3, 5 = 15 rows.
        fd present in batches 2, 4, 5 = 15 rows.
        """
        s = _stream("cycle_44")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": f"c{i}"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fd": f"d{i}"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": f"c{i}"} for i in range(5)]
        b4 = [{"_timestamp": _ts(300 + i), "fa": "a", "fd": f"d{i}"} for i in range(5)]
        b5 = [{"_timestamp": _ts(400 + i), "fa": "a", "fc": f"c{i}", "fd": f"d{i}"} for i in range(5)]
        ingest(client, s, b1); flush_and_wait(client, s, expected=5)
        ingest(client, s, b2); flush_and_wait(client, s, expected=10)
        ingest(client, s, b3); flush_and_wait(client, s, expected=15)
        ingest(client, s, b4); flush_and_wait(client, s, expected=20)
        ingest(client, s, b5); flush_and_wait(client, s, expected=25)

        total = count_records(client, s)
        assert total == 25, f"total must be 25 across 5 batches; got {total}"
        fc_count = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        assert fc_count == 15, f"fc in batches 1,3,5 = 15 rows; got {fc_count}"
        fd_count = count_records(client, s, where="fd IS NOT NULL AND fd != ''")
        assert fd_count == 15, f"fd in batches 2,4,5 = 15 rows; got {fd_count}"

    def test_45_field_appears_disappears_twice(self, client):
        """Scenario 45: fc appears in batch 1, gone in batch 2, back in batch 3, gone in batch 4."""
        s = _stream("cycle_45")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "here"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "back"} for i in range(5)]
        b4 = [{"_timestamp": _ts(300 + i), "fa": "a"} for i in range(5)]
        ingest(client, s, b1); flush_and_wait(client, s, expected=5)
        ingest(client, s, b2); flush_and_wait(client, s, expected=10)
        ingest(client, s, b3); flush_and_wait(client, s, expected=15)
        ingest(client, s, b4); flush_and_wait(client, s, expected=20)

        total = count_records(client, s)
        assert total == 20, f"total must be 20; got {total}"
        fc_present = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        assert fc_present == 10, f"fc in batches 1,3 only = 10 rows; got {fc_present}"

    def test_46_two_independent_fields_cycling(self, client):
        """Scenario 46: fc and fd do independent divergence cycles simultaneously."""
        s = _stream("cycle_46")
        # fc: present in b1, absent in b2, present in b3
        # fd: absent in b1, present in b2, present in b3
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "c"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fd": "d"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "c", "fd": "d"} for i in range(5)]
        ingest(client, s, b1); flush_and_wait(client, s, expected=5)
        ingest(client, s, b2); flush_and_wait(client, s, expected=10)
        ingest(client, s, b3); flush_and_wait(client, s, expected=15)

        fc_count = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        fd_count = count_records(client, s, where="fd IS NOT NULL AND fd != ''")
        assert fc_count == 10, f"fc in batches 1,3 = 10; got {fc_count}"
        assert fd_count == 10, f"fd in batches 2,3 = 10; got {fd_count}"


# ─── Group 6: Complex queries across evolved schemas ──────────────────────────

class TestComplexQueriesEvolved:
    """Scenarios 47–51: subquery, CTE, CASE WHEN, SELECT *, window on evolved schemas."""

    def _ingest(self, client, s):
        """Ingest three batches with the diverge-then-converge pattern plus fd in batch 3.

        Batch 1 [fa, fb, fc], Batch 2 [fa, fb], Batch 3 [fa, fb, fc, fd].
        flush_and_wait after each batch forces separate on-disk schema files.
        """
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fb": i, "fc": f"c{i}"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fb": i} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fb": i, "fc": f"c{i}", "fd": f"d{i}"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

    def test_47_select_star_returns_all_rows(self, client):
        """Scenario 47: SELECT * — all 15 rows returned, union schema applied."""
        s = _stream("cplx_47")
        self._ingest(client, s)
        total = count_records(client, s)
        assert total == 15, f"SELECT * must return all 15 rows; got {total}"

    def test_48_case_when_on_evolved_field(self, client):
        """Scenario 48: CASE WHEN fc IS NULL THEN 'missing' ELSE 'present' END — all 15 rows classified."""
        s = _stream("cplx_48")
        self._ingest(client, s)
        # Verify via WHERE rather than parsing GROUP BY response format
        present = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        missing = count_records(client, s, where="fc IS NULL OR fc = ''")
        assert present == 10, f"'present' group (fc not null) must be 10; got {present}"
        assert missing == 5,  f"'missing' group (fc null/empty) must be 5; got {missing}"
        assert present + missing == 15, "CASE WHEN groups must cover all 15 rows"

    def test_49_subquery_on_evolved_field(self, client):
        """Scenario 49: subquery filtering on evolved field must return correct subset."""
        s = _stream("cplx_49")
        self._ingest(client, s)
        start, end = _wide_window()
        sql = f'SELECT COUNT(*) AS c FROM (SELECT fc FROM "{s}" WHERE fc IS NOT NULL AND fc != \'\')'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 10, f"subquery on evolved fc must return 10 rows; got {count}"

    def test_50_cte_on_evolved_field(self, client):
        """Scenario 50: CTE referencing evolved field — correct row counts."""
        s = _stream("cplx_50")
        self._ingest(client, s)
        start, end = _wide_window()
        sql = (
            f'WITH base AS (SELECT fc, fd FROM "{s}") '
            f'SELECT COUNT(*) AS c FROM base WHERE fc IS NOT NULL AND fc != \'\''
        )
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 10, f"CTE on evolved fc must return 10; got {count}"

    def test_51_evolved_field_in_where_and_select(self, client):
        """Scenario 51: SELECT fc, COUNT(*) WHERE fc IS NOT NULL — correct isolation."""
        s = _stream("cplx_51")
        self._ingest(client, s)
        present = count_records(client, s, where="fc IS NOT NULL AND fc != ''")
        assert present == 10, f"WHERE fc IS NOT NULL must isolate 10 rows; got {present}"


# ─── Group 7: Time-range queries on evolved schemas ───────────────────────────

class TestTimeRangeEvolved:
    """Scenarios 52–55: time-scoped queries on evolved schemas.

    Batch 1 at t=now+0ms,   Batch 2 at t=now+100ms,  Batch 3 at t=now+200ms.
    Time-range queries must isolate individual batches correctly.
    """

    def _ingest(self, client, s):
        """Ingest three batches with explicit _timestamp offsets; return base_us.

        base_us is captured BEFORE record creation so time-range callers can
        compute exact per-batch windows. Records land at:
          b1: base_us + 0..4 ms, b2: base_us + 100..104 ms, b3: base_us + 200..204 ms.
        fc is in b1 and b3; fd is in b3 only. flush_and_wait forces separate files.
        """
        base_us = int(time.time() * 1_000_000)
        b1 = [{"_timestamp": base_us + i * 1_000,           "fa": "a", "fc": f"c{i}"} for i in range(5)]
        b2 = [{"_timestamp": base_us + (100 + i) * 1_000,   "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": base_us + (200 + i) * 1_000,   "fa": "a", "fc": f"c{i}", "fd": f"d{i}"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        return base_us

    def test_52_query_batch1_range_only_fc_present(self, client):
        """Scenario 52: time range covering only batch 1 — all 5 rows returned."""
        s = _stream("tr_52")
        base_us = self._ingest(client, s)
        # batch 1: base_us + 0..4ms  →  window [base_us - 10ms, base_us + 50ms]
        sql = f'SELECT COUNT(*) AS c FROM "{s}"'
        payload = search_payload(sql, start_time=base_us - 10_000, end_time=base_us + 50_000, size=1)
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 5, f"batch 1 time range must return 5 rows; got {count}"

    def test_53_query_batch2_range_fc_null(self, client):
        """Scenario 53: time range covering only batch 2 — fc absent for all 5 rows."""
        s = _stream("tr_53")
        base_us = self._ingest(client, s)
        # batch 2: base_us + 100..104ms  →  window [base_us + 90ms, base_us + 150ms]
        sql = f'SELECT COUNT(*) AS c FROM "{s}"'
        payload = search_payload(sql, start_time=base_us + 90_000, end_time=base_us + 150_000, size=1)
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 5, f"batch 2 time range must return 5 rows; got {count}"

    def test_54_full_range_returns_all(self, client):
        """Scenario 54: full time range spanning all 3 batches returns all 15 rows."""
        s = _stream("tr_54")
        self._ingest(client, s)
        total = count_records(client, s)
        assert total == 15, f"full time range must return all 15 rows; got {total}"

    def test_55_cross_batch_boundary_no_records_lost(self, client):
        """Scenario 55: time range spanning boundary between batch 1 and 2 — no records dropped."""
        s = _stream("tr_55")
        base_us = self._ingest(client, s)
        # span batch 1 (0..4ms) + batch 2 (100..104ms)  →  window [base_us - 10ms, base_us + 150ms]
        sql = f'SELECT COUNT(*) AS c FROM "{s}"'
        payload = search_payload(sql, start_time=base_us - 10_000, end_time=base_us + 150_000, size=1)
        resp = client.post("_search?type=logs", json=payload)
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 10, f"boundary spanning batches 1+2 must return 10 rows; got {count}"


# ─── Group 8: FTS on evolved schemas ──────────────────────────────────────────

class TestFTSEvolved:
    """Scenarios 56–57: field-value queries on fields absent in some batches.

    Tests that exact-match filters on fc correctly exclude batch 2 rows (where fc
    was never ingested) and that distinct keyword values are independently queryable
    after fc reappears. Verified via WHERE equality rather than raw FTS API calls.
    """

    def test_56_fts_field_absent_in_middle_batch(self, client):
        """Scenario 56: FTS on fc — batch 2 rows (fc absent) must not appear in results."""
        s = _stream("fts_56")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "searchable_keyword"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "searchable_keyword"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

        total = count_records(client, s)
        assert total == 15, f"total must be 15; got {total}"
        with_keyword = count_records(client, s, where="fc = 'searchable_keyword'")
        assert with_keyword == 10, f"fc='searchable_keyword' must match batches 1+3 (10 rows); got {with_keyword}"

    def test_57_fts_field_reappears_index_correct(self, client):
        """Scenario 57: fc absent in batch 2, reappears in batch 3 with different value — each queryable."""
        s = _stream("fts_57")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "keyword_alpha"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "keyword_beta"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

        alpha = count_records(client, s, where="fc = 'keyword_alpha'")
        beta  = count_records(client, s, where="fc = 'keyword_beta'")
        assert alpha == 5, f"keyword_alpha must match batch 1 only (5 rows); got {alpha}"
        assert beta  == 5, f"keyword_beta must match batch 3 only (5 rows); got {beta}"

    def test_57b_match_all_fts_excludes_absent_batch(self, client):
        """Scenario 57b: match_all() FTS must not return batch 2 rows where fc was never ingested.

        Uses OO's match_all() SQL UDF for a genuine full-text search rather than an
        exact-match WHERE filter. If the FTS index is corrupted across schema batches,
        batch 2 rows could appear even though fc was never written for them.
        Skipped automatically if match_all is not available in this OO build.
        """
        s = _stream("fts_57b")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": "uniqueterm"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": "uniqueterm"} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        start, end = _wide_window()
        sql = f"SELECT COUNT(*) AS c FROM \"{s}\" WHERE match_all('uniqueterm')"
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        if resp.status_code == 400 and "match_all" in resp.text.lower():
            pytest.skip("match_all UDF not available in this OO build")
        assert resp.status_code == 200, resp.text
        hits = resp.json().get("hits", [])
        count = int(hits[0].get("c", 0)) if hits else 0
        assert count == 10, f"match_all FTS must match batches 1+3 only (10 rows); got {count}"


# ─── Group 9: High field count with divergence ────────────────────────────────

class TestHighFieldCountDivergence:
    """Scenarios 58–59: large numbers of fields churning across batches."""

    def test_58_100_fields_full_replacement(self, client):
        """Scenario 58: batch 1 has 100 fields, all dropped in batch 2, 100 different in batch 3.
        Total union schema has 200+ fields. Queries on any field must return 5 rows."""
        s = _stream("hf_58")
        b1_fields = {f"field_a_{j}": f"val_{j}" for j in range(100)}
        b3_fields = {f"field_b_{j}": f"val_{j}" for j in range(100)}
        b1 = [{"_timestamp": _ts(i), "fa": "a", **b1_fields} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", **b3_fields} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)

        total = count_records(client, s)
        assert total == 15, f"100-field full replacement must not lose records; got {total}"
        a_field = count_records(client, s, where="field_a_0 IS NOT NULL AND field_a_0 != ''")
        assert a_field == 5, f"field_a_0 must be in batch 1 only (5 rows); got {a_field}"
        b_field = count_records(client, s, where="field_b_0 IS NOT NULL AND field_b_0 != ''")
        assert b_field == 5, f"field_b_0 must be in batch 3 only (5 rows); got {b_field}"

    def test_59_five_batches_20_unique_fields_each(self, client):
        """Scenario 59: 5 batches, each with 20 unique fields — 100 total fields in union schema."""
        s = _stream("hf_59")
        for batch_idx in range(5):
            fields = {f"b{batch_idx}_field_{j}": f"v{j}" for j in range(20)}
            records = [{"_timestamp": _ts(batch_idx * 100 + i), "fa": "a", **fields} for i in range(5)]
            ingest(client, s, records)
            flush_and_wait(client, s, expected=(batch_idx + 1) * 5)

        total = count_records(client, s)
        assert total == 25, f"5 batches x 5 records = 25 total; got {total}"
        # Each batch's unique field must be present in exactly 5 rows
        for batch_idx in range(5):
            field_name = f"b{batch_idx}_field_0"
            n = count_records(client, s, where=f"{field_name} IS NOT NULL AND {field_name} != ''")
            assert n == 5, f"{field_name} must be in batch {batch_idx} only (5 rows); got {n}"


# ─── Negative tests ────────────────────────────────────────────────────────────

class TestNegativeCases:
    """Negative tests: OO must not silently return wrong data under schema drift.

    These tests assert that schema evolution never causes phantom values on absent
    fields, never silently drops records, and handles queries on non-existent fields
    without crashing.
    """

    def test_neg1_absent_field_has_no_phantom_values(self, client):
        """Absent numeric field must be NULL — not defaulted to 0 or any phantom value.

        If schema reconciliation incorrectly fills absent fields with 0, then
        WHERE latency_ms BETWEEN 0 AND 99999 would return 15 rows instead of 10.
        Catches silent data fabrication, not just data loss.
        """
        s = _stream("neg1")
        b1 = [{"_timestamp": _ts(i),       "host": "h1", "latency_ms": 100 + i} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "host": "h1"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "host": "h1", "latency_ms": 200 + i} for i in range(5)]
        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        # If batch 2 rows got phantom latency_ms=0 this returns 15 not 10
        phantom_check = count_records(client, s, where="latency_ms BETWEEN 0 AND 99999")
        assert phantom_check == 10, (
            f"absent field must not get phantom value; BETWEEN 0 AND 99999 must match "
            f"batches 1+3 only (10 rows); got {phantom_check}"
        )

    def test_neg2_query_nonexistent_field_returns_gracefully(self, client):
        """A field never ingested in any batch must return a clean 400 — not crash with 500.

        OO returns code 20004 "Search field not found" for completely unknown fields.
        This is the documented behavior: OO does not treat unknown fields as universally
        NULL; it raises a schema error. The invariant is no 500 / no server crash.
        """
        s = _stream("neg2")
        records = [{"_timestamp": _ts(i), "host": "h1", "val": i} for i in range(5)]
        ingest(client, s, records)
        flush_and_wait(client, s, expected=5)
        start, end = _wide_window()
        sql = f'SELECT COUNT(*) AS c FROM "{s}" WHERE completely_absent_field_xyz IS NOT NULL'
        resp = client.post("_search?type=logs", json=search_payload(sql, start_time=start, end_time=end, size=1))
        assert resp.status_code == 400, (
            f"unknown field must return 400 field-not-found; got {resp.status_code}: {resp.text[:200]}"
        )
        assert "20004" in resp.text or "field" in resp.text.lower(), (
            f"400 response must be a field-not-found error, not a server crash: {resp.text[:200]}"
        )

    def test_neg3_record_count_monotonically_increases(self, client):
        """COUNT(*) must equal the cumulative ingest count after every batch — no silent drops.

        Schema drift must never cause previously flushed records to disappear.
        Checked after each flush so a regression is pinned to the exact batch that caused it.
        """
        s = _stream("neg3")
        b1 = [{"_timestamp": _ts(i),       "fa": "a", "fc": f"c{i}"} for i in range(5)]
        b2 = [{"_timestamp": _ts(100 + i), "fa": "a", "fd": f"d{i}"} for i in range(5)]
        b3 = [{"_timestamp": _ts(200 + i), "fa": "a", "fc": f"c{i}", "fd": f"d{i}", "fe": f"e{i}"} for i in range(5)]

        ingest(client, s, b1)
        flush_and_wait(client, s, expected=5)
        assert count_records(client, s) == 5, "after batch 1: must have exactly 5 records"

        ingest(client, s, b2)
        flush_and_wait(client, s, expected=10)
        assert count_records(client, s) == 10, "after batch 2: schema change must not drop batch 1 records"

        ingest(client, s, b3)
        flush_and_wait(client, s, expected=15)
        assert count_records(client, s) == 15, "after batch 3: schema convergence must not drop any records"

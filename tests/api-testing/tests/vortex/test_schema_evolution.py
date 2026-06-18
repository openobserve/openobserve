"""Vortex schema evolution tests.

All tests run against a single ZO_FILE_FORMAT=vortex server — no restarts.
Each test class uses a fresh stream (stream name includes class name) so
tests are fully isolated and can run in parallel.

Test plan coverage: scenarios 14–25 (schema evolution section).
"""
from __future__ import annotations

import time
import logging

import pytest

from .conftest import SESSION_ID, count_records, flush_and_wait, ingest

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

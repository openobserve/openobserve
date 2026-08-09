"""Unit tests for the DBM fixture replay tool (no network).

Run:  python3 -m pytest tests/dbm-capture/replay/test_replay.py -q

Covers the pure transformation core of replay.py:
  * offset re-anchoring (fixture times are t0-relative integer ns offsets)
  * ID token minting (trace-NNN / span-NNN -> fresh 32/16-hex, links preserved)
  * OTLP-JSON request construction
  * --json-path flattening (stored-span-shaped records for ingest_json)
  * spoof injection (used by the integration suite's D1 test)
  * minimal protobuf encoding for the internal gRPC Ingest call
"""
from __future__ import annotations

import copy
import json
import random
import re

import pytest

import replay


NOW_NS = 1_800_000_000_000_000_000  # arbitrary "now" for determinism


@pytest.fixture()
def fixture():
    """A miniature scrubbed fixture in the exact on-disk shape."""
    return {
        "t0": 1_786_121_289_534_844_042,
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "dbm-java-multi"}},
                        {
                            "key": "deployment.environment.name",
                            "value": {"stringValue": "capture-env-a"},
                        },
                    ]
                },
                "scopeSpans": [
                    {
                        "scope": {"name": "io.opentelemetry.jdbc", "version": "2.30.0"},
                        "spans": [
                            {
                                "traceId": "trace-001",
                                "spanId": "span-001",
                                "parentSpanId": "span-002",
                                "name": "SELECT dbm.dbm_items",
                                "kind": 3,
                                "flags": 259,
                                "startTimeUnixNano": 460_900,
                                "endTimeUnixNano": 48_309_208,
                                "attributes": [
                                    {"key": "db.system", "value": {"stringValue": "postgresql"}},
                                    {
                                        "key": "db.statement",
                                        "value": {
                                            "stringValue": "SELECT id FROM dbm_items WHERE id = ?"
                                        },
                                    },
                                    {"key": "server.port", "value": {"intValue": "5432"}},
                                ],
                                "status": {"code": 2, "message": "40P01"},
                                "events": [
                                    {
                                        "name": "exception",
                                        "timeUnixNano": 40_000_000,
                                        "attributes": [
                                            {
                                                "key": "exception.type",
                                                "value": {"stringValue": "PSQLException"},
                                            }
                                        ],
                                    }
                                ],
                                "links": [
                                    {"traceId": "trace-002", "spanId": "span-003", "flags": 259}
                                ],
                            },
                            {
                                "traceId": "trace-001",
                                "spanId": "span-002",
                                "name": "parent-wrapper",
                                "kind": 1,
                                "startTimeUnixNano": 0,
                                "endTimeUnixNano": 50_000_000,
                                "attributes": [],
                            },
                        ],
                    }
                ],
            },
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "other-svc"}}
                    ]
                },
                "scopeSpans": [
                    {
                        "scope": {"name": "x"},
                        "spans": [
                            {
                                "traceId": "trace-002",
                                "spanId": "span-003",
                                "name": "leaf",
                                "kind": 3,
                                "startTimeUnixNano": 1_000,
                                "endTimeUnixNano": 2_000,
                                "attributes": [
                                    {"key": "db.system", "value": {"stringValue": "redis"}},
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
    }


def _all_spans(fx):
    for rs in fx["resourceSpans"]:
        for ss in rs["scopeSpans"]:
            yield from ss["spans"]


# ---------------------------------------------------------------- rebase


class TestRebase:
    def test_all_times_absolute_and_recent(self, fixture):
        out = replay.rebase(fixture, now_ns=NOW_NS, anchor_seconds_ago=30)
        for sp in _all_spans(out):
            for k in ("startTimeUnixNano", "endTimeUnixNano"):
                t = int(sp[k])
                # every span must land within the last 5 minutes of "now"
                assert NOW_NS - 300 * 10**9 < t <= NOW_NS, f"{k}={t} not recent"

    def test_latest_span_lands_anchor_seconds_ago(self, fixture):
        out = replay.rebase(fixture, now_ns=NOW_NS, anchor_seconds_ago=30)
        max_end = max(int(sp["endTimeUnixNano"]) for sp in _all_spans(out))
        assert max_end == NOW_NS - 30 * 10**9

    def test_relative_deltas_preserved(self, fixture):
        out = replay.rebase(fixture, now_ns=NOW_NS, anchor_seconds_ago=30)
        spans_in = list(_all_spans(fixture))
        spans_out = list(_all_spans(out))
        for a, b in zip(spans_in, spans_out):
            assert int(b["endTimeUnixNano"]) - int(b["startTimeUnixNano"]) == int(
                a["endTimeUnixNano"]
            ) - int(a["startTimeUnixNano"])
        # cross-span ordering preserved
        d_in = int(spans_in[1]["startTimeUnixNano"]) - int(spans_in[0]["startTimeUnixNano"])
        d_out = int(spans_out[1]["startTimeUnixNano"]) - int(spans_out[0]["startTimeUnixNano"])
        assert d_in == d_out

    def test_event_times_rebased(self, fixture):
        out = replay.rebase(fixture, now_ns=NOW_NS, anchor_seconds_ago=30)
        sp = next(_all_spans(out))
        ev_t = int(sp["events"][0]["timeUnixNano"])
        assert int(sp["startTimeUnixNano"]) < ev_t < int(sp["endTimeUnixNano"])

    def test_input_not_mutated(self, fixture):
        snapshot = copy.deepcopy(fixture)
        replay.rebase(fixture, now_ns=NOW_NS, anchor_seconds_ago=30)
        assert fixture == snapshot


# ---------------------------------------------------------------- id minting


HEX32 = re.compile(r"^[0-9a-f]{32}$")
HEX16 = re.compile(r"^[0-9a-f]{16}$")


class TestMintIds:
    def test_tokens_become_hex(self, fixture):
        out = replay.mint_ids(fixture, rng=random.Random(7))
        for sp in _all_spans(out):
            assert HEX32.match(sp["traceId"]), sp["traceId"]
            assert HEX16.match(sp["spanId"]), sp["spanId"]
            if "parentSpanId" in sp:
                assert HEX16.match(sp["parentSpanId"])

    def test_parent_links_preserved(self, fixture):
        out = replay.mint_ids(fixture, rng=random.Random(7))
        spans = list(_all_spans(out))
        child, parent = spans[0], spans[1]
        assert child["parentSpanId"] == parent["spanId"]
        assert child["traceId"] == parent["traceId"]

    def test_span_links_remapped_consistently(self, fixture):
        out = replay.mint_ids(fixture, rng=random.Random(7))
        spans = list(_all_spans(out))
        link = spans[0]["links"][0]
        leaf = spans[2]
        assert link["spanId"] == leaf["spanId"]
        assert link["traceId"] == leaf["traceId"]

    def test_distinct_tokens_distinct_ids(self, fixture):
        out = replay.mint_ids(fixture, rng=random.Random(7))
        spans = list(_all_spans(out))
        assert spans[0]["traceId"] != spans[2]["traceId"]
        ids = {sp["spanId"] for sp in spans}
        assert len(ids) == 3

    def test_two_invocations_mint_fresh_ids(self, fixture):
        a = replay.mint_ids(fixture, rng=random.Random(1))
        b = replay.mint_ids(fixture, rng=random.Random(2))
        assert next(_all_spans(a))["traceId"] != next(_all_spans(b))["traceId"]


# ---------------------------------------------------------------- otlp request


class TestOtlpRequest:
    def test_shape(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        req = replay.build_otlp_request(prepared)
        assert set(req.keys()) == {"resourceSpans"}
        assert "t0" not in req
        sp = req["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        # nano fields serialized as strings (OTLP/JSON convention; O2 accepts both)
        assert isinstance(sp["startTimeUnixNano"], str)
        assert HEX32.match(sp["traceId"])

    def test_spoof_injection_adds_span_attributes(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        req = replay.build_otlp_request(
            prepared, spoof={"o2_db_fingerprint": "HACK", "infer_service_name": "HACK"}
        )
        for rs in req["resourceSpans"]:
            for ss in rs["scopeSpans"]:
                for sp in ss["spans"]:
                    keys = {a["key"] for a in sp["attributes"]}
                    assert {"o2_db_fingerprint", "infer_service_name"} <= keys


# ---------------------------------------------------------------- json flatten


class TestFlattenRecords:
    def test_record_core_fields(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        recs = replay.flatten_records(prepared)
        assert len(recs) == 3
        r = recs[0]
        assert HEX32.match(r["trace_id"]) and HEX16.match(r["span_id"])
        assert r["span_kind"] == "3"
        assert r["span_status"] == "ERROR"
        assert r["operation_name"] == "SELECT dbm.dbm_items"
        assert r["service_name"] == "dbm-java-multi"
        # start_time in ns; _timestamp in microseconds derived from it
        assert r["_timestamp"] == r["start_time"] // 1000
        assert r["duration"] == (r["end_time"] - r["start_time"]) // 1000

    def test_span_attributes_at_top_level(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        r = replay.flatten_records(prepared)[0]
        assert r["db.system"] == "postgresql"
        assert r["db.statement"] == "SELECT id FROM dbm_items WHERE id = ?"
        assert r["server.port"] == 5432  # intValue decoded to int

    def test_resource_attributes_service_prefixed(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        r = replay.flatten_records(prepared)[0]
        assert r["service.deployment.environment.name"] == "capture-env-a"

    def test_parent_reference_fields(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        r = replay.flatten_records(prepared)[0]
        assert r["reference.parent_span_id"] == replay.flatten_records(prepared)[1]["span_id"]
        assert r["reference.parent_trace_id"] == r["trace_id"]
        # root span carries no reference keys
        r_root = replay.flatten_records(prepared)[1]
        assert "reference.parent_span_id" not in r_root

    def test_unset_status(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        assert replay.flatten_records(prepared)[1]["span_status"] == "UNSET"

    def test_spoof_injection_adds_record_keys(self, fixture):
        prepared = replay.prepare(fixture, now_ns=NOW_NS, rng=random.Random(7))
        recs = replay.flatten_records(
            prepared, spoof={"o2_db_fingerprint": "HACK", "infer_service_name": "HACK"}
        )
        for r in recs:
            assert r["o2_db_fingerprint"] == "HACK"
            assert r["infer_service_name"] == "HACK"


# ---------------------------------------------------------------- protobuf


class TestProtobuf:
    def test_varint_roundtrip_known_values(self):
        assert replay.encode_varint(0) == b"\x00"
        assert replay.encode_varint(1) == b"\x01"
        assert replay.encode_varint(300) == b"\xac\x02"

    def test_ingestion_request_encoding(self):
        payload = b'[{"a":1}]'
        msg = replay.encode_ingestion_request(
            org_id="default", stream_type="traces", stream_name="default", data=payload
        )
        # field 1 (org_id): tag 0x0a, len 7, "default"
        assert msg.startswith(b"\x0a\x07default")
        # field 2 (stream_type): tag 0x12
        assert b"\x12\x06traces" in msg
        # field 3 (stream_name): tag 0x1a
        assert b"\x1a\x07default" in msg
        # field 4 (IngestionData{1: bytes}): tag 0x22, nested tag 0x0a
        inner = b"\x0a" + replay.encode_varint(len(payload)) + payload
        assert b"\x22" + replay.encode_varint(len(inner)) + inner in msg
        # field 5 (ingestion_type JSON=0): explicit presence, tag 0x28 value 0
        assert msg.endswith(b"\x28\x00")

    def test_ingestion_response_decoding(self):
        # status_code=200, message="ok"
        raw = b"\x08" + replay.encode_varint(200) + b"\x12\x02ok"
        code, message = replay.decode_ingestion_response(raw)
        assert code == 200
        assert message == "ok"

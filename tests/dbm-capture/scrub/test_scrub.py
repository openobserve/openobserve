"""Tests for scrub.py — fixture scrubber for the DBM capture rig.

Contract (docs/superpowers/plans/2026-08-07-dbm-capture-rig.md, Task 4):
  python3 scrub.py IN.jsonl OUT.json
  IN.jsonl  = line-delimited OTLP JSON, one ExportTraceServiceRequest per line
  OUT.json  = {"t0": <original min epoch nanos as int>, "resourceSpans": [...]}
    - every *TimeUnixNano value -> int offset in nanos from t0 (t0 = global min)
    - traceId -> "trace-NNN" first-seen order
    - spanId AND parentSpanId share ONE "span-NNN" namespace (links preserved)
    - keys sorted, 2-space indent, trailing newline, byte-deterministic
    - everything else passes through untouched
"""

import json
import subprocess
import sys
from pathlib import Path

SCRUB = Path(__file__).parent / "scrub.py"

T0 = 1_700_000_000_000_000_000  # epoch nanos


def make_input() -> str:
    """Two JSONL lines of OTLP trace JSON (uint64s as strings, per OTLP JSON)."""
    line1 = {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "dbm-python-pg"}}
                    ]
                },
                "scopeSpans": [
                    {
                        "scope": {"name": "test-scope"},
                        "spans": [
                            {
                                "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                                "spanId": "1111111111111111",
                                "parentSpanId": "",
                                "name": "parent",
                                "kind": 3,
                                "flags": 256,
                                "startTimeUnixNano": str(T0),
                                "endTimeUnixNano": str(T0 + 5_000_000),
                                "attributes": [
                                    {"key": "test.step_id", "value": {"stringValue": "S01"}},
                                    {"key": "net.peer.port", "value": {"intValue": "5432"}},
                                ],
                                "droppedAttributesCount": 3,
                                "status": {},
                            },
                            {
                                "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                                "spanId": "2222222222222222",
                                "parentSpanId": "1111111111111111",
                                "name": "child",
                                "kind": 3,
                                "startTimeUnixNano": str(T0 + 1_000_000),
                                "endTimeUnixNano": str(T0 + 3_000_000),
                                "events": [
                                    {
                                        "timeUnixNano": str(T0 + 2_000_000),
                                        "name": "exception",
                                    }
                                ],
                                "status": {"code": 2},
                            },
                        ],
                    }
                ],
            }
        ]
    }
    line2 = {
        "resourceSpans": [
            {
                "resource": {"attributes": []},
                "scopeSpans": [
                    {
                        "scope": {"name": "test-scope"},
                        "spans": [
                            {
                                "traceId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                                "spanId": "3333333333333333",
                                "name": "other-trace",
                                "kind": 2,
                                "startTimeUnixNano": str(T0 + 10_000_000),
                                "endTimeUnixNano": str(T0 + 12_000_000),
                            }
                        ],
                    }
                ],
            }
        ]
    }
    return json.dumps(line1) + "\n" + json.dumps(line2) + "\n"


def run_scrub(tmp_path: Path, content: str, out_name: str = "out.json") -> Path:
    infile = tmp_path / "in.jsonl"
    infile.write_text(content)
    outfile = tmp_path / out_name
    subprocess.run(
        [sys.executable, str(SCRUB), str(infile), str(outfile)],
        check=True,
        capture_output=True,
    )
    return outfile


def load(outfile: Path) -> dict:
    return json.loads(outfile.read_text())


def all_spans(doc: dict):
    for rs in doc["resourceSpans"]:
        for ss in rs["scopeSpans"]:
            for span in ss["spans"]:
                yield span


def walk(obj, key=None):
    """Yield (key, value) for every dict entry, recursively."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v
            yield from walk(v, k)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk(item, key)


# --- token consistency + parent-link preservation -------------------------


def test_token_consistency_and_parent_link(tmp_path):
    doc = load(run_scrub(tmp_path, make_input()))
    spans = {s["name"]: s for s in all_spans(doc)}

    parent, child, other = spans["parent"], spans["child"], spans["other-trace"]

    # same raw trace id -> same token, first-seen order
    assert parent["traceId"] == "trace-001"
    assert child["traceId"] == "trace-001"
    assert other["traceId"] == "trace-002"

    # spanId and parentSpanId share one namespace: link survives
    assert parent["spanId"] == "span-001"
    assert child["spanId"] == "span-002"
    assert child["parentSpanId"] == parent["spanId"]
    assert other["spanId"] == "span-003"

    # no raw hex ids anywhere in the output
    text = json.dumps(doc)
    assert "aaaaaaaa" not in text
    assert "1111111111111111" not in text
    assert "2222222222222222" not in text
    assert "3333333333333333" not in text


def test_empty_parent_span_id_not_tokenized(tmp_path):
    doc = load(run_scrub(tmp_path, make_input()))
    spans = {s["name"]: s for s in all_spans(doc)}
    # root span had parentSpanId "" — must not become a span token
    assert spans["parent"]["parentSpanId"] == ""


# --- delta preservation ----------------------------------------------------


def test_t0_and_delta_preservation(tmp_path):
    doc = load(run_scrub(tmp_path, make_input()))
    assert doc["t0"] == T0
    assert isinstance(doc["t0"], int)

    spans = {s["name"]: s for s in all_spans(doc)}
    assert spans["parent"]["startTimeUnixNano"] == 0  # min timestamp -> offset 0
    assert spans["parent"]["endTimeUnixNano"] == 5_000_000
    assert spans["child"]["startTimeUnixNano"] == 1_000_000
    assert spans["child"]["endTimeUnixNano"] == 3_000_000
    assert spans["child"]["events"][0]["timeUnixNano"] == 2_000_000
    assert spans["other-trace"]["startTimeUnixNano"] == 10_000_000
    assert spans["other-trace"]["endTimeUnixNano"] == 12_000_000


def test_no_absolute_unixnano_survives(tmp_path):
    doc = load(run_scrub(tmp_path, make_input()))
    found = 0
    for k, v in walk(doc):
        if isinstance(k, str) and k.lower().endswith("timeunixnano"):
            found += 1
            assert isinstance(v, int), f"{k} must be int, got {type(v)}"
            assert v < 10**15, f"{k}={v} looks like an absolute epoch timestamp"
    assert found == 7  # 3 spans x start+end, 1 event


# --- determinism & formatting ---------------------------------------------


def test_determinism_byte_identical(tmp_path):
    content = make_input()
    out1 = run_scrub(tmp_path, content, "out1.json")
    out2 = run_scrub(tmp_path, content, "out2.json")
    assert out1.read_bytes() == out2.read_bytes()


def test_canonical_formatting(tmp_path):
    outfile = run_scrub(tmp_path, make_input())
    text = outfile.read_text()
    assert text.endswith("\n")
    assert not text.endswith("\n\n")
    # key-sorted, 2-space indent canonical form
    assert text == json.dumps(json.loads(text), sort_keys=True, indent=2) + "\n"


# --- multi-line merge ------------------------------------------------------


def test_multiline_merge(tmp_path):
    doc = load(run_scrub(tmp_path, make_input()))
    assert set(doc.keys()) == {"resourceSpans", "t0"}
    # two lines, one resourceSpans entry each -> merged list of 2
    assert len(doc["resourceSpans"]) == 2


def test_blank_lines_ignored(tmp_path):
    content = make_input().replace("\n", "\n\n", 1)  # inject a blank line
    doc = load(run_scrub(tmp_path, content + "\n"))
    assert len(doc["resourceSpans"]) == 2


# --- pass-through ----------------------------------------------------------


def test_non_timestamp_fields_untouched(tmp_path):
    doc = load(run_scrub(tmp_path, make_input()))
    spans = {s["name"]: s for s in all_spans(doc)}
    parent = spans["parent"]

    # non-timestamp ints unchanged
    assert parent["kind"] == 3
    assert parent["flags"] == 256
    assert parent["droppedAttributesCount"] == 3
    assert spans["child"]["status"] == {"code": 2}

    # OTLP attribute intValue stays a string, value unchanged
    attrs = {a["key"]: a["value"] for a in parent["attributes"]}
    assert attrs["net.peer.port"] == {"intValue": "5432"}
    assert attrs["test.step_id"] == {"stringValue": "S01"}

    # resource attributes untouched
    res_attrs = doc["resourceSpans"][0]["resource"]["attributes"]
    assert res_attrs == [
        {"key": "service.name", "value": {"stringValue": "dbm-python-pg"}}
    ]


def test_integer_timestamps_in_input_accepted(tmp_path):
    """Some producers emit uint64 as JSON numbers rather than strings."""
    line = {
        "resourceSpans": [
            {
                "scopeSpans": [
                    {
                        "spans": [
                            {
                                "traceId": "cccccccccccccccccccccccccccccccc",
                                "spanId": "4444444444444444",
                                "name": "int-ts",
                                "startTimeUnixNano": T0,
                                "endTimeUnixNano": T0 + 7_000_000,
                            }
                        ]
                    }
                ]
            }
        ]
    }
    doc = load(run_scrub(tmp_path, json.dumps(line) + "\n"))
    assert doc["t0"] == T0
    span = next(all_spans(doc))
    assert span["startTimeUnixNano"] == 0
    assert span["endTimeUnixNano"] == 7_000_000

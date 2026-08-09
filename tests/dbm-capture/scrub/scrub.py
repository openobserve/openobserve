#!/usr/bin/env python3
"""Scrub raw OTLP JSONL trace captures into canonical checked-in fixtures.

Usage:
    python3 scrub.py IN.jsonl OUT.json

IN.jsonl:  line-delimited OTLP JSON — each non-blank line one
           ExportTraceServiceRequest: {"resourceSpans": [...]}.
OUT.json:  single JSON object {"t0": <int>, "resourceSpans": [...]} where
  - resourceSpans merges all lines' resourceSpans, in input order
  - t0 = the minimum *TimeUnixNano value across the whole input (epoch nanos)
  - every *TimeUnixNano value is replaced by an int offset in nanos from t0
  - traceId values become "trace-NNN" tokens in first-seen (document) order
  - spanId and parentSpanId share ONE "span-NNN" token namespace, so
    parent<->child links (and span links) survive tokenization
  - keys sorted alphabetically, 2-space indent, trailing newline —
    byte-identical output for identical input
  - all other fields pass through untouched

Stdlib only. Deterministic: token assignment and t0 depend only on input
bytes (json.loads preserves each object's key order, and traversal follows
document order).
"""

import json
import sys

TRACE_ID_KEY = "traceId"
SPAN_ID_KEYS = ("spanId", "parentSpanId")


def is_time_key(key):
    """True for startTimeUnixNano, endTimeUnixNano, timeUnixNano, etc."""
    return isinstance(key, str) and key.lower().endswith("timeunixnano")


def collect_min_timestamp(obj, current=None):
    """First pass: global minimum across every *TimeUnixNano value."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if is_time_key(k) and isinstance(v, (str, int)) and str(v).strip():
                ts = int(v)
                if current is None or ts < current:
                    current = ts
            else:
                current = collect_min_timestamp(v, current)
    elif isinstance(obj, list):
        for item in obj:
            current = collect_min_timestamp(item, current)
    return current


def scrub_node(obj, t0, trace_tokens, span_tokens):
    """Second pass: rewrite timestamps and ids in document order, in place."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if is_time_key(k) and isinstance(v, (str, int)) and str(v).strip():
                obj[k] = int(v) - t0
            elif k == TRACE_ID_KEY and isinstance(v, str) and v:
                if v not in trace_tokens:
                    trace_tokens[v] = "trace-%03d" % (len(trace_tokens) + 1)
                obj[k] = trace_tokens[v]
            elif k in SPAN_ID_KEYS and isinstance(v, str) and v:
                if v not in span_tokens:
                    span_tokens[v] = "span-%03d" % (len(span_tokens) + 1)
                obj[k] = span_tokens[v]
            else:
                scrub_node(v, t0, trace_tokens, span_tokens)
    elif isinstance(obj, list):
        for item in obj:
            scrub_node(item, t0, trace_tokens, span_tokens)


def scrub(lines):
    """Merge JSONL lines and scrub. Returns the canonical output object."""
    resource_spans = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        resource_spans.extend(request.get("resourceSpans", []))

    doc = {"resourceSpans": resource_spans}
    t0 = collect_min_timestamp(doc)
    if t0 is None:
        t0 = 0
    scrub_node(doc, t0, {}, {})
    return {"t0": t0, "resourceSpans": resource_spans}


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: python3 scrub.py IN.jsonl OUT.json\n")
        return 2
    in_path, out_path = argv[1], argv[2]
    with open(in_path, "r", encoding="utf-8") as f:
        result = scrub(f)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, sort_keys=True, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

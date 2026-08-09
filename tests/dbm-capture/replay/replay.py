#!/usr/bin/env python3
"""Replay scrubbed DBM capture fixtures into a running OpenObserve.

Fixture format (see tests/dbm-capture/MANIFEST.md):
    {"t0": <epoch-ns of capture>, "resourceSpans": [...]}
with tokenized ids (trace-NNN / span-NNN) and t0-relative integer
*TimeUnixNano offsets.

Default mode POSTs the fixture as one OTLP-JSON ExportTraceServiceRequest to
    http://localhost:$PORT/api/{org}/v1/traces
after (1) re-anchoring all offsets to "now" — O2 silently drops spans older
than ZO_INGEST_ALLOWED_UPTO (default 5h), so replayed spans must land within
the last few minutes — and (2) minting fresh 32/16-hex trace/span ids per
token, preserving parent/link relationships.

--json-path mode instead flattens each span to a stored-span-shaped JSON
record and sends the batch through the *internal gRPC Ingest service*
(cluster.Ingest/Ingest, IngestionType JSON, stream_type "traces") on the gRPC
port. That is the only externally reachable entry into
`openobserve_core::traces::ingest_json` — there is NO HTTP route for it; the
HTTP routes /api/{org}/v1/traces (+ /traces, /otel/v1/traces) all go through
otlp_proto/otlp_json (src/api/http/src/handler/http/router/mod.rs:782-784,
src/api/grpc/src/handler/grpc/request/ingest.rs:113). The protobuf framing is
hand-rolled below (the message is 5 simple fields) so the tool needs only
grpcio, not protoc-generated stubs.

--spoof KEY=VALUE injects extra span attributes (OTLP mode) or record keys
(--json-path mode) — used by the integration suite to prove derived-identity
spoofing is stripped/renamed.

Usage:
    python3 replay.py fixtures/java-dup.json --port 5090
    python3 replay.py fixtures/python-pg-new.json --json-path --grpc-port 5091 \
        --spoof o2_db_fingerprint=HACK --spoof infer_service_name=HACK
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import random
import sys

# ---------------------------------------------------------------------------
# pure transformations
# ---------------------------------------------------------------------------

_TIME_KEYS = ("startTimeUnixNano", "endTimeUnixNano", "timeUnixNano")


def load_fixture(path: str) -> dict:
    with open(path) as f:
        fx = json.load(f)
    if "t0" not in fx or "resourceSpans" not in fx:
        raise ValueError(f"{path}: not a scrubbed fixture (want t0 + resourceSpans)")
    return fx


def _iter_spans(fixture: dict):
    for rs in fixture["resourceSpans"]:
        for ss in rs.get("scopeSpans", []):
            yield from ss.get("spans", [])


def _max_offset(fixture: dict) -> int:
    m = 0
    for sp in _iter_spans(fixture):
        for k in ("startTimeUnixNano", "endTimeUnixNano"):
            if k in sp:
                m = max(m, int(sp[k]))
        for ev in sp.get("events", []):
            if "timeUnixNano" in ev:
                m = max(m, int(ev["timeUnixNano"]))
    return m


def rebase(fixture: dict, *, now_ns: int | None = None, anchor_seconds_ago: int = 30) -> dict:
    """Return a copy with t0-relative offsets rewritten to absolute epoch-ns.

    The LATEST timestamp in the fixture lands exactly `anchor_seconds_ago`
    before `now_ns`; every other time keeps its relative distance. Fixture
    capture windows are seconds long, so everything lands "just now" — far
    inside the ZO_INGEST_ALLOWED_UPTO=5h drop horizon.
    """
    if now_ns is None:
        import time

        now_ns = time.time_ns()
    out = copy.deepcopy(fixture)
    base = now_ns - anchor_seconds_ago * 10**9 - _max_offset(out)
    for sp in _iter_spans(out):
        for k in ("startTimeUnixNano", "endTimeUnixNano"):
            if k in sp:
                sp[k] = base + int(sp[k])
        for ev in sp.get("events", []):
            if "timeUnixNano" in ev:
                ev["timeUnixNano"] = base + int(ev["timeUnixNano"])
    return out


def _mint_hex(rng: random.Random, nbytes: int) -> str:
    return "".join(rng.choice("0123456789abcdef") for _ in range(nbytes * 2))


def mint_ids(fixture: dict, *, rng: random.Random | None = None) -> dict:
    """Return a copy with id tokens replaced by fresh hex ids.

    Every distinct traceId value maps to one fresh 32-hex id, every distinct
    spanId/parentSpanId/link id value to one fresh 16-hex id — so parent and
    link relationships survive the rewrite. Fresh per invocation: repeated
    replays create new traces instead of colliding with stored ones.
    """
    rng = rng or random.Random()
    out = copy.deepcopy(fixture)
    trace_map: dict[str, str] = {}
    span_map: dict[str, str] = {}

    def t(tok: str) -> str:
        if tok not in trace_map:
            trace_map[tok] = _mint_hex(rng, 16)
        return trace_map[tok]

    def s(tok: str) -> str:
        if tok not in span_map:
            span_map[tok] = _mint_hex(rng, 8)
        return span_map[tok]

    for sp in _iter_spans(out):
        sp["traceId"] = t(sp["traceId"])
        sp["spanId"] = s(sp["spanId"])
        if sp.get("parentSpanId"):
            sp["parentSpanId"] = s(sp["parentSpanId"])
        for link in sp.get("links", []):
            if link.get("traceId"):
                link["traceId"] = t(link["traceId"])
            if link.get("spanId"):
                link["spanId"] = s(link["spanId"])
    return out


def prepare(
    fixture: dict,
    *,
    now_ns: int | None = None,
    anchor_seconds_ago: int = 30,
    rng: random.Random | None = None,
) -> dict:
    """rebase + mint_ids in one step."""
    return mint_ids(
        rebase(fixture, now_ns=now_ns, anchor_seconds_ago=anchor_seconds_ago), rng=rng
    )


# ---------------------------------------------------------------------------
# OTLP-JSON request
# ---------------------------------------------------------------------------


def build_otlp_request(prepared: dict, *, spoof: dict[str, str] | None = None) -> dict:
    """Build the ExportTraceServiceRequest JSON body (nano fields as strings)."""
    req = {"resourceSpans": copy.deepcopy(prepared["resourceSpans"])}
    for rs in req["resourceSpans"]:
        for ss in rs.get("scopeSpans", []):
            for sp in ss.get("spans", []):
                for k in ("startTimeUnixNano", "endTimeUnixNano"):
                    if k in sp:
                        sp[k] = str(sp[k])
                for ev in sp.get("events", []):
                    if "timeUnixNano" in ev:
                        ev["timeUnixNano"] = str(ev["timeUnixNano"])
                if spoof:
                    sp.setdefault("attributes", [])
                    for key, val in spoof.items():
                        sp["attributes"].append(
                            {"key": key, "value": {"stringValue": val}}
                        )
    return req


# ---------------------------------------------------------------------------
# --json-path flattening (stored-span shape, feeds core traces::ingest_json)
# ---------------------------------------------------------------------------

_STATUS = {0: "UNSET", 1: "OK", 2: "ERROR"}


def _any_value(v: dict):
    if "stringValue" in v:
        return v["stringValue"]
    if "intValue" in v:
        return int(v["intValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "boolValue" in v:
        return bool(v["boolValue"])
    # arrays/kvlists: keep raw JSON string (fine for replay purposes)
    return json.dumps(v)


def flatten_records(prepared: dict, *, spoof: dict[str, str] | None = None) -> list[dict]:
    """Flatten every span into the stored-span record shape ingest_json expects.

    Mirrors how the OTLP path serializes `common::meta::traces::Span`:
    span attributes at top level (raw dotted keys — server-side flattening
    converts to underscores), resource attributes prefixed `service.`,
    parent link as `reference.parent_*`, times in ns with `_timestamp` µs.
    """
    records = []
    for rs in prepared["resourceSpans"]:
        service_name = "unknown_service"
        resource_attrs = {}
        for attr in (rs.get("resource") or {}).get("attributes", []):
            if attr["key"] == "service.name":
                service_name = _any_value(attr["value"])
            else:
                resource_attrs[f"service.{attr['key']}"] = _any_value(attr["value"])
        for ss in rs.get("scopeSpans", []):
            for sp in ss.get("spans", []):
                start = int(sp["startTimeUnixNano"])
                end = int(sp["endTimeUnixNano"])
                rec = {
                    "trace_id": sp["traceId"],
                    "span_id": sp["spanId"],
                    "flags": sp.get("flags", 1),
                    "span_status": _STATUS.get((sp.get("status") or {}).get("code", 0), "UNSET"),
                    "span_kind": str(sp.get("kind", 0)),
                    "operation_name": sp.get("name", ""),
                    "start_time": start,
                    "end_time": end,
                    "duration": (end - start) // 1000,
                    "service_name": service_name,
                    "events": "[]",
                    "links": "[]",
                    "_timestamp": start // 1000,
                }
                if sp.get("parentSpanId"):
                    rec["reference.parent_trace_id"] = sp["traceId"]
                    rec["reference.parent_span_id"] = sp["parentSpanId"]
                    rec["reference.ref_type"] = "ChildOf"
                rec.update(resource_attrs)
                for attr in sp.get("attributes", []):
                    rec[attr["key"]] = _any_value(attr["value"])
                if spoof:
                    rec.update(spoof)
                records.append(rec)
    return records


# ---------------------------------------------------------------------------
# minimal protobuf for cluster.Ingest/Ingest (src/proto/proto/cluster/ingest.proto)
# ---------------------------------------------------------------------------


def encode_varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _len_delim(field: int, payload: bytes) -> bytes:
    return encode_varint((field << 3) | 2) + encode_varint(len(payload)) + payload


def encode_ingestion_request(
    *, org_id: str, stream_type: str, stream_name: str, data: bytes
) -> bytes:
    """cluster.IngestionRequest{org_id, stream_type, stream_name, data{data}, ingestion_type=JSON}."""
    msg = b""
    msg += _len_delim(1, org_id.encode())
    msg += _len_delim(2, stream_type.encode())
    msg += _len_delim(3, stream_name.encode())
    msg += _len_delim(4, _len_delim(1, data))
    # optional IngestionType ingestion_type = 5; JSON = 0 — encode explicitly
    msg += encode_varint((5 << 3) | 0) + encode_varint(0)
    return msg


def decode_ingestion_response(raw: bytes) -> tuple[int, str]:
    """cluster.IngestionResponse{int32 status_code = 1; string message = 2}."""
    code, message = 0, ""
    i = 0
    while i < len(raw):
        tag = 0
        shift = 0
        while True:
            b = raw[i]
            i += 1
            tag |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80:
                break
        field, wire = tag >> 3, tag & 7
        if wire == 0:  # varint
            val = 0
            shift = 0
            while True:
                b = raw[i]
                i += 1
                val |= (b & 0x7F) << shift
                shift += 7
                if not b & 0x80:
                    break
            if field == 1:
                code = val
        elif wire == 2:  # len-delimited
            ln = 0
            shift = 0
            while True:
                b = raw[i]
                i += 1
                ln |= (b & 0x7F) << shift
                shift += 7
                if not b & 0x80:
                    break
            payload = raw[i : i + ln]
            i += ln
            if field == 2:
                message = payload.decode(errors="replace")
        else:
            raise ValueError(f"unsupported wire type {wire}")
    return code, message


# ---------------------------------------------------------------------------
# senders
# ---------------------------------------------------------------------------


def send_otlp(req: dict, *, url: str, org: str, user: str, password: str, stream: str | None):
    import requests

    headers = {"Content-Type": "application/json"}
    if stream:
        headers["stream-name"] = stream
    resp = requests.post(
        f"{url.rstrip('/')}/api/{org}/v1/traces",
        data=json.dumps(req),
        headers=headers,
        auth=(user, password),
        timeout=60,
    )
    return resp


def send_json_grpc(
    records: list[dict],
    *,
    host: str,
    port: int,
    org: str,
    stream: str,
    user: str,
    password: str,
):
    """Call cluster.Ingest/Ingest with IngestionType JSON over the gRPC port.

    Auth: basic credentials + `organization` metadata — accepted by
    src/api/grpc/src/handler/grpc/auth/mod.rs check_auth for root/org users.
    """
    import grpc

    body = encode_ingestion_request(
        org_id=org,
        stream_type="traces",
        stream_name=stream,
        data=json.dumps(records).encode(),
    )
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    channel = grpc.insecure_channel(f"{host}:{port}")
    try:
        call = channel.unary_unary(
            "/cluster.Ingest/Ingest",
            request_serializer=lambda b: b,
            response_deserializer=lambda b: b,
        )
        raw = call(
            body,
            metadata=(
                ("authorization", f"Basic {token}"),
                ("organization", org),
            ),
            timeout=60,
        )
        return decode_ingestion_response(raw)
    finally:
        channel.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("fixtures", nargs="+", help="scrubbed fixture json path(s)")
    p.add_argument("--url", default=None, help="base URL (default http://localhost:$PORT)")
    p.add_argument("--port", type=int, default=int(os.environ.get("ZO_HTTP_PORT", 5080)))
    p.add_argument("--grpc-host", default="localhost")
    p.add_argument("--grpc-port", type=int, default=int(os.environ.get("ZO_GRPC_PORT", 5081)))
    p.add_argument("--org", default="default")
    p.add_argument("--stream", default=None, help="target stream (header / gRPC stream_name)")
    p.add_argument("--user", default=os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com"))
    p.add_argument(
        "--password", default=os.environ.get("ZO_ROOT_USER_PASSWORD", "Complexpass#123")
    )
    p.add_argument("--json-path", action="store_true", help="send via internal gRPC JSON path")
    p.add_argument("--anchor-seconds-ago", type=int, default=30)
    p.add_argument(
        "--spoof",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="inject extra span attribute (OTLP) / record key (--json-path); repeatable",
    )
    p.add_argument("--dry-run", action="store_true", help="print summary, send nothing")
    args = p.parse_args(argv)

    spoof = {}
    for item in args.spoof:
        k, _, v = item.partition("=")
        if not _:
            p.error(f"--spoof wants KEY=VALUE, got {item!r}")
        spoof[k] = v

    url = args.url or f"http://localhost:{args.port}"
    ok = True
    for path in args.fixtures:
        fx = load_fixture(path)
        prepared = prepare(fx, anchor_seconds_ago=args.anchor_seconds_ago)
        n_spans = sum(1 for _ in _iter_spans(prepared))
        if args.json_path:
            records = flatten_records(prepared, spoof=spoof or None)
            if args.dry_run:
                print(f"{path}: DRY-RUN json-path {len(records)} records")
                continue
            code, message = send_json_grpc(
                records,
                host=args.grpc_host,
                port=args.grpc_port,
                org=args.org,
                stream=args.stream or "default",
                user=args.user,
                password=args.password,
            )
            good = code == 200
            print(f"{path}: json-path {len(records)} records -> status_code={code} {message}")
        else:
            req = build_otlp_request(prepared, spoof=spoof or None)
            if args.dry_run:
                print(f"{path}: DRY-RUN otlp {n_spans} spans")
                continue
            resp = send_otlp(
                req,
                url=url,
                org=args.org,
                user=args.user,
                password=args.password,
                stream=args.stream,
            )
            good = resp.status_code == 200
            print(f"{path}: otlp {n_spans} spans -> HTTP {resp.status_code} {resp.text[:200]}")
        ok = ok and good
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

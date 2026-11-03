"""OTLP profiles builder (JSON + hand-encoded protobuf, as the Python proto package lacks v1development), query wrappers, reference dataset."""

from __future__ import annotations

import copy
import json
import sys
import time
from dataclasses import dataclass
from typing import Any

import requests

from support.client import OpenObserveClient
from support.wait import WaitTimeout, wait_until

NS = 1_000_000_000
US = 1_000_000
MIN_US = 60 * US
PARTIAL_MSG = "Some profiles were rejected due to out-of-window timestamps, malformed samples, or empty samples"
BAD_CT_BODY = {"code": 3, "message": "Bad Request: Content-Type must be application/json or application/x-protobuf"}
GRPC_EXPORT = "/opentelemetry.proto.collector.profiles.v1development.ProfilesService/Export"
# Older than any ZO_INGEST_ALLOWED_UPTO in use (CI 48 h, local up to 4000 h).
STALE_NS = 400 * 24 * 3600 * NS

# A 1000-frame stack nests ~2000 JSON levels in merge/diff trees, past the default decoder limit.
sys.setrecursionlimit(max(sys.getrecursionlimit(), 20_000))


def now_ns() -> int:
    return time.time_ns()


def now_us() -> int:
    return time.time_ns() // 1000


class ProfilesBuilder:
    """Collects one shared dictionary plus resources; `model()` returns a snake_case request dict."""

    def __init__(self) -> None:
        self.strings: list[str] = [""]
        self._str: dict[str, int] = {"": 0}
        self.functions: list[dict] = [{}]
        self._fn: dict[tuple, int] = {}
        self.locations: list[dict] = [{}]
        self._loc: dict[str, int] = {}
        self.stacks: list[dict] = [{"location_indices": []}]
        self._stack: dict[tuple, int] = {}
        self.links: list[dict] = [{}]
        self.attributes: list[dict] = [{}]
        self.mappings: list[dict] = [{}]
        self.resources: list[dict] = []

    def s(self, text: str) -> int:
        if text not in self._str:
            self._str[text] = len(self.strings)
            self.strings.append(text)
        return self._str[text]

    def func(self, name: str | None, system_name: str | None = None) -> int:
        key = (name, system_name)
        if key not in self._fn:
            entry: dict[str, int] = {}
            if name:
                entry["name_strindex"] = self.s(name)
            if system_name:
                entry["system_name_strindex"] = self.s(system_name)
            self._fn[key] = len(self.functions)
            self.functions.append(entry)
        return self._fn[key]

    def loc_fn(self, *names: str) -> int:
        """Symbolized location; several names = inlined lines, in line order."""
        key = "fn:" + "\x00".join(names)
        if key not in self._loc:
            self._loc[key] = len(self.locations)
            self.locations.append({"lines": [{"function_index": self.func(n)} for n in names]})
        return self._loc[key]

    def loc_raw(self, **fields: Any) -> int:
        self.locations.append(dict(fields))
        return len(self.locations) - 1

    def mapping(self, filename: str, memory_start: int, file_offset: int = 0, attrs: list[int] | None = None) -> int:
        entry = {
            "memory_start": memory_start,
            "memory_limit": memory_start + 0x100000,
            "file_offset": file_offset,
            "filename_strindex": self.s(filename),
        }
        if attrs:
            entry["attribute_indices"] = attrs
        self.mappings.append(entry)
        return len(self.mappings) - 1

    def attr(self, key: str, value: Any) -> int:
        self.attributes.append({"key_strindex": self.s(key), "value": any_value(value)})
        return len(self.attributes) - 1

    def stack(self, frames: list[str]) -> int:
        """Stack of symbolized frames, leaf first."""
        return self.stack_locs([self.loc_fn(f) for f in frames])

    def stack_locs(self, locs: list[int]) -> int:
        key = tuple(locs)
        if key not in self._stack:
            self._stack[key] = len(self.stacks)
            self.stacks.append({"location_indices": list(locs)})
        return self._stack[key]

    def link(self, trace_hex: str, span_hex: str) -> int:
        self.links.append({"trace_id": bytes.fromhex(trace_hex), "span_id": bytes.fromhex(span_hex)})
        return len(self.links) - 1

    def sample(
        self,
        frames: list[str] | None = None,
        *,
        stack: int | None = None,
        values=(),
        timestamps=(),
        attrs: dict[str, Any] | None = None,
        link: int = 0,
    ) -> dict:
        idx = stack if stack is not None else (self.stack(frames) if frames else 0)
        out: dict[str, Any] = {"stack_index": idx, "values": list(values), "timestamps_unix_nano": list(timestamps)}
        if attrs:
            out["attribute_indices"] = [self.attr(k, v) for k, v in attrs.items()]
        if link:
            out["link_index"] = link
        return out

    def stacks_samples(self, stacks: list[tuple[list[str], int]]) -> list[dict]:
        return [self.sample(frames, values=[value]) for frames, value in stacks]

    def profile(
        self,
        samples: list[dict],
        *,
        type_: str = "cpu",
        unit: str = "nanoseconds",
        time_ns: int = 0,
        duration_ns: int = 10 * NS,
        period_type: tuple[str, str] | None = None,
        period: int = 0,
        profile_id: bytes | None = None,
    ) -> dict:
        out: dict[str, Any] = {
            "sample_type": {"type_strindex": self.s(type_), "unit_strindex": self.s(unit)},
            "samples": samples,
            "time_unix_nano": time_ns,
            "duration_nano": duration_ns,
        }
        if period_type:
            out["period_type"] = {"type_strindex": self.s(period_type[0]), "unit_strindex": self.s(period_type[1])}
        if period:
            out["period"] = period
        if profile_id is not None:
            out["profile_id"] = profile_id
        return out

    def resource(
        self,
        profiles: list[dict],
        attrs: dict[str, Any] | None = None,
        *,
        scope_name: str = "",
        scope_version: str = "",
    ) -> dict:
        res = {
            "resource": {"attributes": [{"key": k, "value": any_value(v)} for k, v in (attrs or {}).items()]},
            "scope_profiles": [{"scope": {"name": scope_name, "version": scope_version}, "profiles": profiles}],
        }
        self.resources.append(res)
        return res

    def model(self) -> dict:
        return copy.deepcopy(
            {
                "resource_profiles": self.resources,
                "dictionary": {
                    "mapping_table": self.mappings,
                    "location_table": self.locations,
                    "function_table": self.functions,
                    "link_table": self.links,
                    "string_table": self.strings,
                    "attribute_table": self.attributes,
                    "stack_table": self.stacks,
                },
            }
        )


def any_value(value: Any) -> dict:
    if isinstance(value, bool):
        return {"bool_value": value}
    if isinstance(value, int):
        return {"int_value": value}
    if isinstance(value, list):
        return {"array_value": {"values": [any_value(v) for v in value]}}
    if isinstance(value, dict):
        return value
    return {"string_value": value}


def simple_request(
    stacks: list[tuple[list[str], int]],
    *,
    service: str = "svc-a",
    type_: str = "cpu",
    unit: str = "nanoseconds",
    time_ns: int | None = None,
    attrs: dict[str, Any] | None = None,
) -> dict:
    b = ProfilesBuilder()
    t = time_ns if time_ns is not None else now_ns() - 60 * NS
    b.resource(
        [b.profile(b.stacks_samples(stacks), type_=type_, unit=unit, time_ns=t)],
        {"service.name": service, **(attrs or {})},
    )
    return b.model()


def _camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(p.capitalize() for p in rest)


def to_json(model: Any, key: str = "") -> Any:
    """snake_case model -> OTLP/JSON (camelCase, hex trace/span/profile ids, int64 as strings)."""
    if isinstance(model, dict):
        return {_camel(k): to_json(v, k) for k, v in model.items()}
    if isinstance(model, list):
        return [to_json(v, key) for v in model]
    if isinstance(model, bytes):
        return model.hex()
    if key in ("values", "timestamps_unix_nano", "time_unix_nano", "duration_nano", "int_value") and isinstance(
        model, int
    ):
        return str(model)
    return model


def _varint(n: int) -> bytes:
    n &= (1 << 64) - 1
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _tag(field: int, wire: int) -> bytes:
    return _varint((field << 3) | wire)


def _int(field: int, v: int) -> bytes:
    return _tag(field, 0) + _varint(v) if v else b""


def _len(field: int, data: bytes) -> bytes:
    return _tag(field, 2) + _varint(len(data)) + data


def _str(field: int, s: str) -> bytes:
    return _len(field, s.encode()) if s else b""


def _bytes(field: int, b: bytes) -> bytes:
    return _len(field, b) if b else b""


def _fixed64(field: int, v: int) -> bytes:
    return _tag(field, 1) + (v & ((1 << 64) - 1)).to_bytes(8, "little") if v else b""


def _packed(field: int, vals: list[int]) -> bytes:
    return _len(field, b"".join(_varint(v) for v in vals)) if vals else b""


def _packed_fixed64(field: int, vals: list[int]) -> bytes:
    return _len(field, b"".join(v.to_bytes(8, "little") for v in vals)) if vals else b""


def _pb_any(v: dict | None) -> bytes:
    if not v:
        return b""
    if "string_value" in v:
        return _len(1, v["string_value"].encode())
    if "bool_value" in v:
        return _tag(2, 0) + _varint(int(v["bool_value"]))
    if "int_value" in v:
        return _tag(3, 0) + _varint(v["int_value"])
    if "array_value" in v:
        return _len(5, b"".join(_len(1, _pb_any(x)) for x in v["array_value"]["values"]))
    if "string_value_strindex" in v:
        return _tag(8, 0) + _varint(v["string_value_strindex"])
    raise ValueError(f"unsupported AnyValue {v}")


def _pb_kv(kv: dict) -> bytes:
    return (
        _str(1, kv.get("key", ""))
        + (_len(2, _pb_any(kv["value"])) if kv.get("value") else b"")
        + _int(3, kv.get("key_strindex", 0))
    )


def _pb_value_type(vt: dict | None) -> bytes:
    return _int(1, vt.get("type_strindex", 0)) + _int(2, vt.get("unit_strindex", 0)) if vt else b""


def _pb_sample(s: dict) -> bytes:
    return (
        _int(1, s.get("stack_index", 0))
        + _packed(2, s.get("attribute_indices", []))
        + _int(3, s.get("link_index", 0))
        + _packed(4, s.get("values", []))
        + _packed_fixed64(5, s.get("timestamps_unix_nano", []))
    )


def _pb_profile(p: dict) -> bytes:
    out = _len(1, _pb_value_type(p.get("sample_type"))) if p.get("sample_type") else b""
    out += b"".join(_len(2, _pb_sample(s)) for s in p.get("samples", []))
    out += _fixed64(3, p.get("time_unix_nano", 0)) + _int(4, p.get("duration_nano", 0))
    out += _len(5, _pb_value_type(p["period_type"])) if p.get("period_type") else b""
    out += _int(6, p.get("period", 0)) + _bytes(7, p.get("profile_id", b""))
    return out + _packed(11, p.get("attribute_indices", []))


def _pb_dictionary(d: dict) -> bytes:
    out = b""
    for m in d.get("mapping_table", []):
        out += _len(
            1,
            _int(1, m.get("memory_start", 0))
            + _int(2, m.get("memory_limit", 0))
            + _int(3, m.get("file_offset", 0))
            + _int(4, m.get("filename_strindex", 0))
            + _packed(5, m.get("attribute_indices", [])),
        )
    for loc in d.get("location_table", []):
        lines = b"".join(_len(3, _int(1, ln.get("function_index", 0))) for ln in loc.get("lines", []))
        out += _len(
            2,
            _int(1, loc.get("mapping_index", 0))
            + _int(2, loc.get("address", 0))
            + lines
            + _packed(4, loc.get("attribute_indices", [])),
        )
    for f in d.get("function_table", []):
        out += _len(
            3,
            _int(1, f.get("name_strindex", 0))
            + _int(2, f.get("system_name_strindex", 0))
            + _int(3, f.get("filename_strindex", 0)),
        )
    for link in d.get("link_table", []):
        out += _len(4, _bytes(1, link.get("trace_id", b"")) + _bytes(2, link.get("span_id", b"")))
    for s in d.get("string_table", []):
        out += _len(5, s.encode())
    for a in d.get("attribute_table", []):
        out += _len(
            6,
            _int(1, a.get("key_strindex", 0))
            + (_len(2, _pb_any(a["value"])) if a.get("value") else b"")
            + _int(3, a.get("unit_strindex", 0)),
        )
    for st in d.get("stack_table", []):
        out += _len(7, _packed(1, st.get("location_indices", [])))
    return out


def to_proto(model: dict) -> bytes:
    out = b""
    for rp in model.get("resource_profiles", []):
        res = b"".join(_len(1, _pb_kv(kv)) for kv in rp.get("resource", {}).get("attributes", []))
        body = _len(1, res)
        for sp in rp.get("scope_profiles", []):
            scope = sp.get("scope", {})
            sbody = _len(1, _str(1, scope.get("name", "")) + _str(2, scope.get("version", "")))
            sbody += b"".join(_len(2, _pb_profile(p)) for p in sp.get("profiles", []))
            body += _len(2, sbody)
        out += _len(1, body)
    if "dictionary" in model:
        out += _len(2, _pb_dictionary(model["dictionary"]))
    return out


def decode_fields(data: bytes) -> dict[int, list]:
    """Minimal protobuf reader for the export response: {field: [varint | bytes]}."""
    fields: dict[int, list] = {}
    i = 0
    while i < len(data):
        key, i = _read_varint(data, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            val, i = _read_varint(data, i)
        elif wire == 2:
            ln, i = _read_varint(data, i)
            val, i = data[i : i + ln], i + ln
        else:
            raise ValueError(f"unexpected wire type {wire}")
        fields.setdefault(field, []).append(val)
    return fields


def _read_varint(data: bytes, i: int) -> tuple[int, int]:
    shift = result = 0
    while True:
        b = data[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, i
        shift += 7


def snappy_raw(data: bytes) -> bytes:
    """Raw (unframed) snappy block made only of literal chunks; valid input for any snappy decoder."""
    out = bytearray(_varint(len(data)))
    for i in range(0, len(data), 65536):
        chunk = data[i : i + 65536]
        n = len(chunk) - 1
        if n < 60:
            out.append(n << 2)
        elif n < 256:
            out += bytes([60 << 2, n])
        else:
            out += bytes([61 << 2]) + n.to_bytes(2, "little")
        out += chunk
    return bytes(out)


def ingest_json(
    client: OpenObserveClient,
    stream: str | None,
    body: Any,
    *,
    path: str = "v1/profiles",
    content_type: str = "application/json",
    **kw: Any,
) -> requests.Response:
    data = body if isinstance(body, bytes | str) else json.dumps(body)
    headers = {"Content-Type": content_type, **kw.pop("headers", {})}
    if stream is not None:
        headers["stream-name"] = stream
    return client.post(path, data=data, headers=headers, **kw)


def ingest_proto(client: OpenObserveClient, stream: str | None, body: bytes | dict, **kw: Any) -> requests.Response:
    data = body if isinstance(body, bytes) else to_proto(body)
    return ingest_json(client, stream, data, content_type="application/x-protobuf", **kw)


def query(
    client: OpenObserveClient, stream: str, endpoint: str, body: dict | None = None, *, method: str = "POST", **kw: Any
) -> requests.Response:
    return client.request(method, f"{stream}/profiles/{endpoint}", json=body, **kw)


def merge(client: OpenObserveClient, stream: str, body: dict, **kw: Any) -> requests.Response:
    return query(client, stream, "merge", body, **kw)


def merge_ok(client: OpenObserveClient, stream: str, body: dict) -> dict:
    resp = merge(client, stream, body)
    assert resp.status_code == 200, f"merge {body} -> {resp.status_code} {resp.text[:500]}"
    return resp.json()


def wait_merge_total(
    client: OpenObserveClient,
    stream: str,
    body: dict,
    expected: int,
    *,
    timeout: float = 60,
    request_timeout: float = 30,
) -> dict:
    """Poll merge until `total == expected`; times out loudly with the last body."""
    last: dict = {}

    def _ready() -> dict | None:
        nonlocal last
        resp = merge(client, stream, body, timeout=request_timeout)
        last = {"status": resp.status_code, "body": resp.text[:300]}
        if resp.status_code == 200 and resp.json().get("total") == expected:
            return resp.json()
        return None

    try:
        return wait_until(_ready, timeout=timeout, interval=0.5, msg=f"merge total {expected} on {stream}")
    except WaitTimeout as e:
        raise WaitTimeout(f"{e}; last merge response: {last}") from e


def search_rows(
    client: OpenObserveClient, stream: str, *, start_us: int, end_us: int, where: str = "", size: int = 2000
) -> list[dict]:
    sql = f'SELECT * FROM "{stream}"' + (f" WHERE {where}" if where else "") + " ORDER BY _timestamp ASC"
    resp = client.post(
        "_search?type=profiles",
        json={"query": {"sql": sql, "start_time": start_us, "end_time": end_us, "from": 0, "size": size}},
    )
    assert resp.status_code == 200, f"_search on {stream} -> {resp.status_code} {resp.text[:300]}"
    return resp.json().get("hits", [])


def wait_rows(
    client: OpenObserveClient,
    stream: str,
    count: int,
    *,
    start_us: int | None = None,
    end_us: int | None = None,
    where: str = "",
    timeout: float = 60,
) -> list[dict]:
    """Poll `_search` until exactly `count` rows are visible."""
    start = start_us if start_us is not None else now_us() - 6 * 3600 * US
    end = end_us if end_us is not None else now_us() + 26 * 3600 * US
    return wait_until(
        lambda: (rows := search_rows(client, stream, start_us=start, end_us=end, where=where))
        and len(rows) == count
        and rows,
        timeout=timeout,
        msg=f"{count} rows in {stream} where {where!r}",
    )


def profiles_streams(client: OpenObserveClient) -> list[str]:
    resp = client.get("streams?type=profiles")
    assert resp.status_code == 200, resp.text
    return [s["name"] for s in resp.json().get("list", [])]


def count_nodes(node: dict) -> int:
    return 1 + sum(count_nodes(c) for c in node.get("children") or [])


def child(node: dict, name: str) -> dict:
    matches = [c for c in node.get("children") or [] if c["name"] == name]
    assert len(matches) == 1, (
        f"expected one child {name!r} under {node['name']!r}, got {[c['name'] for c in node.get('children') or []]}"
    )
    return matches[0]


def assert_tree_sums(node: dict) -> None:
    kids = node.get("children") or []
    assert node["total"] == node["self"] + sum(c["total"] for c in kids), (
        f"node {node['name']} total != self + children"
    )
    for c in kids:
        assert_tree_sums(c)


def window(start_us: int, end_us: int, **extra: Any) -> dict:
    return {"start_time": start_us, "end_time": end_us, **extra}


def recent_window(**extra: Any) -> dict:
    """A window that covers every per-test profile (now - 6h .. now + 26h)."""
    return window(now_us() - 6 * 3600 * US, now_us() + 26 * 3600 * US, **extra)


def cpu(**extra: Any) -> dict:
    return {"profile_type": "cpu", "profile_unit": "nanoseconds", **extra}


TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
SPAN_ID = "b7ad6b7169203331"
XSS = "<img src=x onerror=window.__xss=1>"
CHECKOUT_TOTAL = 12_000_000_000
ALL_CPU_TOTAL = 21_015_000_000
CATALOG_TOTAL = 5_515_000_000
PAYMENTS = {
    "cpu": (3_500_000_000, "nanoseconds"),
    "alloc_space": (1_572_864, "bytes"),
    "inuse_space": (6_291_456, "bytes"),
}


@dataclass(frozen=True)
class RefData:
    stream: str
    t0_us: int

    def win(self, **extra: Any) -> dict:
        """T0 - 1m .. T0 + 9m, the window that holds every reference profile."""
        return window(self.t0_us - MIN_US, self.t0_us + 9 * MIN_US, **extra)

    def bucket(self, minutes: int) -> int:
        """Start (us) of the one-minute bucket that holds T0 + `minutes`."""
        return self.t0_us - 5 * US + minutes * MIN_US


def reference_t0_ns() -> int:
    minute = now_ns() // (60 * NS) * 60 * NS
    return minute - 10 * 60 * NS + 5 * NS


def reference_model(t0_ns: int) -> dict:
    b = ProfilesBuilder()
    m = 60 * NS

    def res(svc, ver, env, inst, host):
        return {
            "service.name": svc,
            "service.version": ver,
            "deployment.environment": env,
            "service.instance.id": inst,
            "host.name": host,
        }

    order = ["handle_order", "main"]
    c1 = [(["db_query", *order], 2 * NS), (["json_encode", *order], NS), (order, NS)]
    b.resource(
        [b.profile(b.stacks_samples(c1), time_ns=t0_ns)], res("checkout", "v1.4.0", "prod", "checkout-1", "host-a")
    )

    proc = ["process", "main"]
    b.resource(
        [
            b.profile(
                b.stacks_samples([(["charge_card", *proc], 1_200_000_000), (["validate", *proc], 800_000_000)]),
                time_ns=t0_ns + 2 * m,
            ),
            b.profile(
                b.stacks_samples([(["alloc_buffer", *proc], 1_048_576), (["alloc_json", *proc], 524_288)]),
                type_="alloc_space",
                unit="bytes",
                time_ns=t0_ns + 2 * m,
            ),
            b.profile(
                b.stacks_samples([(["cache_put", *proc], 2_097_152)]),
                type_="inuse_space",
                unit="bytes",
                time_ns=t0_ns + 2 * m,
            ),
        ],
        res("payments", "v1.4.0", "prod", "payments-1", "host-d"),
    )

    link = b.link(TRACE_ID, SPAN_ID)
    c2 = b.stacks_samples(
        [
            (["db_query", *order], 4 * NS),
            (["json_encode", *order], 3 * NS),
            (order, 500_000_000),
            ([XSS, *order], 100_000_000),
        ]
    )
    c2.append(b.sample(["process_payment", *order], values=[250_000_000], link=link))
    b.resource([b.profile(c2, time_ns=t0_ns + 4 * m)], res("checkout", "v1.5.0", "prod", "checkout-2", "host-b"))

    b.resource(
        [
            b.profile(b.stacks_samples([(["charge_card", *proc], 1_500_000_000)]), time_ns=t0_ns + 5 * m),
            b.profile(
                b.stacks_samples([(["cache_put", *proc], 4_194_304)]),
                type_="inuse_space",
                unit="bytes",
                time_ns=t0_ns + 5 * m,
            ),
        ],
        res("payments", "v1.5.0", "prod", "payments-2", "host-e"),
    )

    b.resource(
        [b.profile(b.stacks_samples([(["gc_sweep", "runtime_main"], 150_000_000)]), time_ns=t0_ns + 6 * m)],
        res("checkout", "v1.5.0", "stage", "checkout-3", "host-c"),
    )

    k1 = [([f"wide_fn_{n:03d}", "wide_root", "catalog_main"], (n + 1) * 100_000) for n in range(300)]
    k1.append(([f"deep_{i:04d}" for i in range(1100)], NS))
    b.resource(
        [b.profile(b.stacks_samples(k1), time_ns=t0_ns + 7 * m)],
        res("catalog", "v1.5.0", "stage", "catalog-1", "host-f"),
    )
    return b.model()


def ingest_ok(client: OpenObserveClient, stream: str | None, model: dict) -> None:
    """JSON ingest that must be fully accepted (200 and an empty OTLP response)."""
    resp = ingest_json(client, stream, to_json(model))
    assert resp.status_code == 200, f"ingest -> {resp.status_code} {resp.text[:500]}"
    assert resp.json() == {}, f"expected full success, got {resp.text[:500]}"


def by_stack(rows: list[dict]) -> dict[str, dict]:
    out = {r.get("stack", ""): r for r in rows}
    assert len(out) == len(rows), f"duplicate stacks in {rows}"
    return out


MIB = 1_048_576


def snapshot_model(minute_ns: int, threads: tuple[str, str] | None = None) -> dict:
    """One instance, two inuse snapshots (1 MiB at +5 s, 3 MiB at +25 s) inside the minute starting at `minute_ns`."""
    b = ProfilesBuilder()
    profiles = []
    for i, (offset, value) in enumerate(((5, MIB), (25, 3 * MIB))):
        attrs = {"thread.name": threads[i]} if threads else None
        sample = b.sample(["snap_leaf", "snap_root"], values=[value], attrs=attrs)
        profiles.append(b.profile([sample], type_="inuse_space", unit="bytes", time_ns=minute_ns + offset * NS))
    b.resource(profiles, {"service.name": "svc-snap", "service.instance.id": "snap-1", "host.name": "h1"})
    return b.model()


def native_model(frame_type: str | None = None) -> dict:
    """Two unsymbolized frames of /usr/lib/libqa.so.1 (build id deadbeefcafe) under symbolized root `a9_root`, value 9."""
    b = ProfilesBuilder()
    build_id = b.attr("process.executable.build_id.htlhash", "deadbeefcafe")
    mapping = b.mapping("/usr/lib/libqa.so.1", 0x1000, 0, attrs=[build_id])
    loc_attrs = [b.attr("profile.frame.type", frame_type)] if frame_type else []
    locs = [b.loc_raw(mapping_index=mapping, address=addr, attribute_indices=loc_attrs) for addr in (0x1110, 0x1120)]
    stack = b.stack_locs([*locs, b.loc_fn("a9_root")])
    b.resource([b.profile([b.sample(stack=stack, values=[9])], time_ns=now_ns() - 60 * NS)], {"service.name": "svc-a"})
    return b.model()

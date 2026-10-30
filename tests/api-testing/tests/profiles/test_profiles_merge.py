"""Profiles `merge` API: call tree, top functions, max_nodes cut, depth cap, native folding, filters, errors (feature §3.5)."""

from __future__ import annotations

import uuid

import pytest
import requests

from support.client import OpenObserveClient

from .profiles_helpers import (
    ALL_CPU_TOTAL,
    CATALOG_TOTAL,
    CHECKOUT_TOTAL,
    MIB,
    NS,
    PAYMENTS,
    SPAN_ID,
    TRACE_ID,
    XSS,
    ProfilesBuilder,
    RefData,
    assert_tree_sums,
    child,
    count_nodes,
    cpu,
    ingest_ok,
    merge,
    merge_ok,
    native_model,
    now_ns,
    query,
    recent_window,
    simple_request,
    snapshot_model,
    wait_merge_total,
    wait_rows,
)

CHECKOUT_TOP = [
    {"name": "db_query", "self": 6_000_000_000, "total": 6_000_000_000},
    {"name": "json_encode", "self": 4_000_000_000, "total": 4_000_000_000},
    {"name": "handle_order", "self": 1_500_000_000, "total": 11_850_000_000},
    {"name": "process_payment", "self": 250_000_000, "total": 250_000_000},
    {"name": "gc_sweep", "self": 150_000_000, "total": 150_000_000},
    {"name": XSS, "self": 100_000_000, "total": 100_000_000},
    {"name": "main", "self": 0, "total": 11_850_000_000},
    {"name": "runtime_main", "self": 0, "total": 150_000_000},
]


def _checkout(ref: RefData, **extra) -> dict:
    return ref.win(**cpu(service_name="checkout", **extra))


def _catalog(ref: RefData, **extra) -> dict:
    return ref.win(**cpu(service_name="catalog", **extra))


def _names(node: dict) -> list[str]:
    return sorted(c["name"] for c in node.get("children") or [])


def _walk(node: dict):
    yield node
    for c in node.get("children") or []:
        yield from _walk(c)


def _assert_400(resp: requests.Response, message: str) -> None:
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert resp.json()["message"] == message


def _ingest_stacks(client: OpenObserveClient, stream: str, stacks: list[tuple[list[str], int]], total: int) -> dict:
    ingest_ok(client, stream, simple_request(stacks))
    return wait_merge_total(client, stream, recent_window(**cpu()), total)


def test_mrg01_checkout_totals(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _checkout(ref))
    assert body["total"] == body["merged_total"] == CHECKOUT_TOTAL
    assert body["truncated"] is False
    assert body["tree_truncated"] is False
    assert (body["unit"], body["profile_type"]) == ("nanoseconds", "cpu")


def test_mrg02_tree_shape(client: OpenObserveClient, ref: RefData):
    root = merge_ok(client, ref.stream, _checkout(ref))["root"]
    assert (root["name"], root["total"], root["self"]) == ("total", CHECKOUT_TOTAL, 0)
    assert _names(root) == ["main", "runtime_main"]
    assert child(root, "main")["total"] == 11_850_000_000
    assert child(root, "runtime_main")["total"] == 150_000_000
    order = child(child(root, "main"), "handle_order")
    assert (order["total"], order["self"]) == (11_850_000_000, 1_500_000_000)
    totals = {c["name"]: c["total"] for c in order["children"]}
    assert totals == {
        "db_query": 6_000_000_000,
        "json_encode": 4_000_000_000,
        "process_payment": 250_000_000,
        XSS: 100_000_000,
    }
    assert child(child(root, "runtime_main"), "gc_sweep")["self"] == 150_000_000
    assert_tree_sums(root)


def test_mrg03_top_exact_and_ordered(client: OpenObserveClient, ref: RefData):
    top = merge_ok(client, ref.stream, _checkout(ref))["top"]
    assert top == CHECKOUT_TOP


def test_mrg04_top_tie_break(client: OpenObserveClient, prof_stream: str):
    body = _ingest_stacks(client, prof_stream, [(["a"], 5), (["b"], 5), (["bc", "b"], 4), (["c"], 5)], 19)
    assert [(t["name"], t["self"], t["total"]) for t in body["top"]] == [
        ("b", 5, 9),
        ("a", 5, 5),
        ("c", 5, 5),
        ("bc", 4, 4),
    ]


def test_mrg05_recursion_counted_once(client: OpenObserveClient, prof_stream: str):
    body = _ingest_stacks(client, prof_stream, [(["f", "g", "f", "main"], 10)], 10)
    assert {t["name"]: (t["self"], t["total"]) for t in body["top"]} == {"f": (10, 10), "g": (0, 10), "main": (0, 10)}


def test_mrg06_get_equals_post(client: OpenObserveClient, ref: RefData):
    post = merge_ok(client, ref.stream, _checkout(ref))
    resp = query(client, ref.stream, "merge", method="GET", params=_checkout(ref))
    assert resp.status_code == 200, resp.text
    get = resp.json()
    assert (get["root"], get["total"], get["top"]) == (post["root"], post["total"], post["top"])


@pytest.mark.parametrize("ptype", list(PAYMENTS))
def test_mrg07_payments_per_type(client: OpenObserveClient, ref: RefData, ptype: str):
    total, unit = PAYMENTS[ptype]
    body = merge_ok(client, ref.stream, ref.win(service_name="payments", profile_type=ptype, profile_unit=unit))
    assert (body["total"], body["unit"], body["profile_type"]) == (total, unit, ptype)


def test_mrg08_all_services_cpu(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, ref.win(**cpu()))
    assert body["total"] == ALL_CPU_TOTAL
    assert _names(body["root"]) == ["[truncated]", "catalog_main", "main", "runtime_main"]


def test_mrg09_filters_are_anded(client: OpenObserveClient, ref: RefData):
    v15 = {"key": "service_version", "value": "v1.5.0"}
    assert merge_ok(client, ref.stream, _checkout(ref, filters=[v15]))["total"] == 8_000_000_000
    prod = {"key": "deployment_environment", "value": "prod"}
    assert merge_ok(client, ref.stream, _checkout(ref, filters=[v15, prod]))["total"] == 7_850_000_000


def test_mrg10_dotted_key_default_op(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _checkout(ref, filters=[{"key": "service.version", "value": "v1.4.0"}]))
    assert body["total"] == 4_000_000_000


def test_mrg11_get_filters_list(client: OpenObserveClient, ref: RefData):
    params = _checkout(ref, filters="service_version=v1.4.0,deployment_environment=prod")
    resp = query(client, ref.stream, "merge", method="GET", params=params)
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 4_000_000_000


def test_mrg12_two_values_of_one_label_is_empty(client: OpenObserveClient, ref: RefData):
    filters = [{"key": "service_version", "value": "v1.4.0"}, {"key": "service_version", "value": "v1.5.0"}]
    body = merge_ok(client, ref.stream, _checkout(ref, filters=filters))
    assert (body["total"], body["top"]) == (0, [])


def test_mrg13_trace_and_span_filter(client: OpenObserveClient, ref: RefData):
    filters = [{"key": "trace_id", "value": TRACE_ID}, {"key": "span_id", "value": SPAN_ID}]
    body = merge_ok(client, ref.stream, _checkout(ref, filters=filters))
    assert body["total"] == 250_000_000
    node, path = body["root"], []
    while node.get("children"):
        assert len(node["children"]) == 1, node["children"]
        node = node["children"][0]
        path.append(node["name"])
    assert path == ["main", "handle_order", "process_payment"]
    assert node["self"] == 250_000_000


def test_mrg14_quoted_filter_value_is_safe(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _checkout(ref, filters=[{"key": "service_version", "value": "v1' OR '1'='1"}]))
    assert (body["total"], body["top"]) == (0, [])


def test_mrg15_max_nodes_50(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _catalog(ref, max_nodes=50))
    assert count_nodes(body["root"]) == 50
    assert (body["tree_truncated"], body["truncated"], body["total"]) == (True, False, CATALOG_TOTAL)
    others = [n for n in _walk(body["root"]) if n["name"] == "other"]
    assert others, "a cut tree folds dropped siblings into an `other` node"
    for node in _walk(body["root"]):
        assert [c["name"] for c in node.get("children") or []].count("other") <= 1
    for node in others:
        assert node["self"] == node["total"]
        assert not node.get("children")
    assert_tree_sums(body["root"])


def test_mrg16_max_nodes_3(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _catalog(ref, max_nodes=3))
    # Both root children have children, and keeping one also reserves a slot for its own `other`: 4 > 3.
    assert [(c["name"], c["total"]) for c in body["root"]["children"]] == [("other", CATALOG_TOTAL)]
    assert (body["tree_truncated"], body["total"]) == (True, CATALOG_TOTAL)
    assert_tree_sums(body["root"])


@pytest.mark.parametrize("max_nodes", [0, 1])
def test_mrg17_max_nodes_clamped_to_minimal_tree(client: OpenObserveClient, ref: RefData, max_nodes: int):
    body = merge_ok(client, ref.stream, _catalog(ref, max_nodes=max_nodes))
    assert body["tree_truncated"] is True
    assert [(c["name"], c["total"]) for c in body["root"]["children"]] == [("other", CATALOG_TOTAL)]


def test_mrg18_max_nodes_clamped_to_maximum(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _catalog(ref, max_nodes=999_999))
    assert count_nodes(body["root"]) == 1303
    assert body["tree_truncated"] is False


def test_mrg19_default_max_nodes_2048(client: OpenObserveClient, prof_stream: str):
    body = _ingest_stacks(client, prof_stream, [([f"wide_fn_{i:04d}", "wide_root"], 1) for i in range(3000)], 3000)
    assert count_nodes(body["root"]) == 2048
    assert body["tree_truncated"] is True
    assert len(body["top"]) == 3001


def test_mrg20_deep_stack_chain(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _catalog(ref))
    node = child(body["root"], "[truncated]")
    assert node["total"] == 1_000_000_000
    for i in range(998, -1, -1):
        node = child(node, f"deep_{i:04d}")
    assert (node["self"], node.get("children")) == (1_000_000_000, None)
    assert body["top"][0] == {"name": "deep_0000", "self": 1_000_000_000, "total": 1_000_000_000}
    assert "[truncated]" not in {t["name"] for t in body["top"]}


def test_mrg21_wide_set(client: OpenObserveClient, ref: RefData):
    body = merge_ok(client, ref.stream, _catalog(ref))
    wide = child(child(body["root"], "catalog_main"), "wide_root")
    assert len(wide["children"]) == 300
    assert wide["total"] == 4_515_000_000
    assert len(body["top"]) == 1301


def test_mrg22_native_frames_folded(client: OpenObserveClient, prof_stream: str):
    ingest_ok(client, prof_stream, native_model())
    body = wait_merge_total(client, prof_stream, recent_window(**cpu()), 9)
    folded = child(child(body["root"], "a9_root"), "[libqa.so.1]")
    assert (folded["self"], folded.get("children")) == (9, None)
    assert body["top"] == [{"name": "[libqa.so.1]", "self": 9, "total": 9}, {"name": "a9_root", "self": 0, "total": 9}]


def test_mrg23_native_frames_from_two_binaries(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    lib_a = b.mapping("/opt/libA.so", 0x1000)
    lib_b = b.mapping("/opt/libB.so", 0x9000)
    locs = [b.loc_raw(mapping_index=lib_a, address=0x1100), b.loc_raw(mapping_index=lib_b, address=0x9100)]
    stack = b.stack_locs([*locs, b.loc_fn("root23")])
    b.resource([b.profile([b.sample(stack=stack, values=[4])], time_ns=now_ns() - 60 * NS)], {"service.name": "svc-a"})
    ingest_ok(client, prof_stream, b.model())
    body = wait_merge_total(client, prof_stream, recent_window(**cpu()), 4)
    lib_b_node = child(child(body["root"], "root23"), "[libB.so]")
    assert child(lib_b_node, "[libA.so]")["self"] == 4


def test_mrg25_zero_value_stacks_skipped(client: OpenObserveClient, prof_stream: str):
    body = _ingest_stacks(client, prof_stream, [(["zero_leaf", "zr"], 0), (["five_leaf", "zr"], 5)], 5)
    assert _names(child(body["root"], "zr")) == ["five_leaf"]
    assert {t["name"] for t in body["top"]} == {"five_leaf", "zr"}


def test_mrg26_empty_stack_credited_to_root(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    b.resource(
        [b.profile([b.sample(stack=0, values=[5]), b.sample(["es_leaf"], values=[10])], time_ns=now_ns() - 60 * NS)],
        {"service.name": "svc-a"},
    )
    ingest_ok(client, prof_stream, b.model())
    body = wait_merge_total(client, prof_stream, recent_window(**cpu()), 15)
    assert body["root"]["self"] == 5
    assert _names(body["root"]) == ["es_leaf"]


def test_mrg27_inuse_snapshots_averaged(client: OpenObserveClient, prof_stream: str):
    minute = (now_ns() - 3 * 60 * NS) // (60 * NS) * 60 * NS
    ingest_ok(client, prof_stream, snapshot_model(minute))
    wait_rows(client, prof_stream, 2)
    body = merge_ok(client, prof_stream, recent_window(profile_type="inuse_space", profile_unit="bytes"))
    assert (body["total"], body["unit"]) == (2 * MIB, "bytes")


def test_mrg28_empty_window(client: OpenObserveClient, ref: RefData, empty_window: dict):
    body = merge_ok(client, ref.stream, {**empty_window, **cpu(service_name="checkout")})
    assert (body["total"], body["top"]) == (0, [])
    assert "children" not in body["root"]


MRG29_CASES = [
    ("type", {"profile_type": None}, "profile_type is required"),
    ("unit", {"profile_unit": None}, "profile_unit is required"),
    ("start-eq-end", {"start_time": "END"}, "start_time must be less than end_time"),
    ("no-start", {"start_time": None}, "start_time and end_time are required (microseconds)"),
    ("op", {"filters": [{"key": "host_name", "op": "!=", "value": "x"}]}, "only filter op '=' is supported"),
    ("key-stack", {"filters": [{"key": "stack", "value": "x"}]}, "invalid filter key: stack"),
    ("key-unsafe", {"filters": [{"key": "a;b", "value": "x"}]}, "invalid filter key: a;b"),
    ("key-129", {"filters": [{"key": "a" * 129, "value": "x"}]}, f"invalid filter key: {'a' * 129}"),
    ("timeout", {"timeout": 0}, "Invalid timeout parameter"),
]


@pytest.mark.parametrize(
    ("change", "message"), [c[1:] for c in MRG29_CASES], ids=[f"mrg29-{c[0]}" for c in MRG29_CASES]
)
def test_mrg29_validation_errors(client: OpenObserveClient, ref: RefData, change: dict, message: str):
    body = _checkout(ref)
    for key, value in change.items():
        if value is None:
            del body[key]
        else:
            body[key] = body["end_time"] if value == "END" else value
    _assert_400(merge(client, ref.stream, body), message)


def test_mrg29_unknown_filter_column(client: OpenObserveClient, ref: RefData):
    resp = merge(client, ref.stream, _checkout(ref, filters=[{"key": "no_such_col", "value": "x"}]))
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == 20004
    assert "unknown field 'no_such_col'" in resp.json()["message"]


def test_mrg29_malformed_json(client: OpenObserveClient, ref: RefData):
    resp = client.post(
        f"{ref.stream}/profiles/merge", data='{"start_time":', headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith("Failed to parse the request body as JSON"), resp.text


def test_mrg30_negative_max_nodes(client: OpenObserveClient, ref: RefData):
    resp = merge(client, ref.stream, _checkout(ref, max_nodes=-1))
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith("Failed to deserialize the JSON body"), resp.text


def test_mrg32_unknown_stream(client: OpenObserveClient, ref: RefData):
    stream = f"no_such_{uuid.uuid4().hex[:8]}"
    resp = merge(client, stream, _checkout(ref))
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == 20002
    assert resp.json()["message"] == f"Search stream not found: {stream}"


def test_mrg33_wrong_method(client: OpenObserveClient, ref: RefData):
    resp = query(client, ref.stream, "merge", _checkout(ref), method="PUT")
    assert resp.status_code == 405, resp.text


def test_mrg34_no_auth(client: OpenObserveClient, ref: RefData):
    resp = requests.post(client.url(f"{ref.stream}/profiles/merge"), json=_checkout(ref), timeout=30)
    assert resp.status_code == 401, resp.text

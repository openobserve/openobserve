"""Profiles `diff` API: before/after call tree and share-change ranking (feature §3.6)."""

from __future__ import annotations

import uuid

import pytest
import requests

from support.client import OpenObserveClient

from .profiles_helpers import (
    MIB,
    MIN_US,
    NS,
    US,
    XSS,
    RefData,
    child,
    cpu,
    ingest_ok,
    now_ns,
    query,
    snapshot_model,
    wait_rows,
    window,
)

GROUP_1875 = {"gc_sweep", "handle_order", "main", "runtime_main"}


def _side(ref: RefData, version: str, **extra) -> dict:
    return ref.win(**cpu(service_name="checkout", filters=[{"key": "service_version", "value": version}], **extra))


def _diff(client: OpenObserveClient, stream: str, body: dict) -> requests.Response:
    return query(client, stream, "diff", body)


def _diff_ok(client: OpenObserveClient, stream: str, body: dict) -> dict:
    resp = _diff(client, stream, body)
    assert resp.status_code == 200, f"diff -> {resp.status_code} {resp.text[:500]}"
    return resp.json()


def _versions(client: OpenObserveClient, ref: RefData, before: str = "v1.4.0", after: str = "v1.5.0", **extra) -> dict:
    return _diff_ok(client, ref.stream, {"baseline": _side(ref, before), "comparison": _side(ref, after), **extra})


def _assert_400(resp: requests.Response, message: str) -> None:
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert resp.json()["message"] == message


def test_dif01_checkout_versions_totals(client: OpenObserveClient, ref: RefData):
    body = _versions(client, ref)
    assert (body["baseline_total"], body["comparison_total"]) == (4_000_000_000, 8_000_000_000)
    assert (body["unit"], body["profile_type"]) == ("nanoseconds", "cpu")
    assert (body["truncated"], body["tree_truncated"]) == (False, False)


def test_dif02_top_ordered_by_share_change(client: OpenObserveClient, ref: RefData):
    top = _versions(client, ref)["top"]
    names = [t["name"] for t in top]
    assert len(top) == 8
    assert top[0] == {
        "name": "json_encode",
        "before_self": 1_000_000_000,
        "before_total": 1_000_000_000,
        "after_self": 3_000_000_000,
        "after_total": 3_000_000_000,
    }
    assert top[1] == {
        "name": "process_payment",
        "before_self": 0,
        "before_total": 0,
        "after_self": 250_000_000,
        "after_total": 250_000_000,
    }
    # The four +-1.875 pt changes are f64 shares that need not tie exactly, so only the set is fixed.
    assert set(names[2:6]) == GROUP_1875
    assert names[6:] == [XSS, "db_query"]


def test_dif03_node_values_both_sides(client: OpenObserveClient, ref: RefData):
    root = _versions(client, ref)["root"]
    assert (root["total"], root["before_total"]) == (8_000_000_000, 4_000_000_000)
    order = child(child(root, "main"), "handle_order")
    assert (order["total"], order["before_total"]) == (7_850_000_000, 4_000_000_000)
    encode = child(order, "json_encode")
    assert (encode["self"], encode["before_self"]) == (3_000_000_000, 1_000_000_000)
    gc = child(child(root, "runtime_main"), "gc_sweep")
    assert (gc["total"], gc["before_total"]) == (150_000_000, 0)


def test_dif04_swap_sides(client: OpenObserveClient, ref: RefData):
    body = _versions(client, ref, before="v1.5.0", after="v1.4.0")
    assert (body["baseline_total"], body["comparison_total"]) == (8_000_000_000, 4_000_000_000)
    assert body["top"][0]["name"] == "json_encode"
    assert (body["top"][0]["before_total"], body["top"][0]["after_total"]) == (3_000_000_000, 1_000_000_000)


def test_dif05_one_side_without_data(client: OpenObserveClient, ref: RefData):
    body = _versions(client, ref, after="v9.9.9")
    assert (body["baseline_total"], body["comparison_total"]) == (4_000_000_000, 0)


def test_dif06_different_windows_per_side(client: OpenObserveClient, ref: RefData):
    def minute(n: int) -> dict:
        return window(ref.bucket(n), ref.bucket(n) + MIN_US, **cpu(service_name="checkout"))

    body = _diff_ok(client, ref.stream, {"baseline": minute(0), "comparison": minute(4)})
    assert (body["baseline_total"], body["comparison_total"]) == (4_000_000_000, 7_850_000_000)


def test_dif07_max_nodes_cut_keeps_both_totals(client: OpenObserveClient, ref: RefData):
    body = _versions(client, ref, max_nodes=3)
    assert body["tree_truncated"] is True
    assert (body["baseline_total"], body["comparison_total"]) == (4_000_000_000, 8_000_000_000)
    assert [(c["name"], c["total"], c["before_total"]) for c in body["root"]["children"]] == [
        ("other", 8_000_000_000, 4_000_000_000)
    ]


def test_dif08_per_side_max_nodes_ignored(client: OpenObserveClient, ref: RefData):
    body = _diff_ok(
        client, ref.stream, {"baseline": _side(ref, "v1.4.0", max_nodes=3), "comparison": _side(ref, "v1.5.0")}
    )
    assert body["tree_truncated"] is False


@pytest.mark.parametrize(
    "comparison",
    [{"profile_type": "alloc_space", "profile_unit": "bytes"}, {"profile_type": "cpu", "profile_unit": "milliseconds"}],
    ids=["dif09-type", "dif10-unit"],
)
def test_dif09_10_mismatched_type_or_unit(client: OpenObserveClient, ref: RefData, comparison: dict):
    resp = _diff(
        client, ref.stream, {"baseline": _side(ref, "v1.4.0"), "comparison": {**_side(ref, "v1.5.0"), **comparison}}
    )
    _assert_400(resp, "baseline and comparison must use the same profile_type and profile_unit")


def test_dif11_comparison_missing_type(client: OpenObserveClient, ref: RefData):
    comparison = _side(ref, "v1.5.0")
    del comparison["profile_type"]
    _assert_400(
        _diff(client, ref.stream, {"baseline": _side(ref, "v1.4.0"), "comparison": comparison}),
        "profile_type is required",
    )


def test_dif12_baseline_missing_unit(client: OpenObserveClient, ref: RefData):
    baseline = _side(ref, "v1.4.0")
    del baseline["profile_unit"]
    _assert_400(
        _diff(client, ref.stream, {"baseline": baseline, "comparison": _side(ref, "v1.5.0")}),
        "profile_unit is required",
    )


def test_dif13_missing_baseline(client: OpenObserveClient, ref: RefData):
    resp = _diff(client, ref.stream, {"comparison": _side(ref, "v1.5.0")})
    assert resp.status_code == 400, resp.text
    message = resp.json()["message"]
    assert message.startswith("Failed to deserialize"), message
    assert "missing field `baseline`" in message, message


def test_dif14_bad_filter_on_one_side(client: OpenObserveClient, ref: RefData):
    comparison = _side(ref, "v1.5.0")
    comparison["filters"] = [{"key": "stack", "value": "x"}]
    _assert_400(
        _diff(client, ref.stream, {"baseline": _side(ref, "v1.4.0"), "comparison": comparison}),
        "invalid filter key: stack",
    )


def test_dif15_bad_time_on_one_side(client: OpenObserveClient, ref: RefData):
    baseline = _side(ref, "v1.4.0")
    baseline["start_time"] = baseline["end_time"]
    _assert_400(
        _diff(client, ref.stream, {"baseline": baseline, "comparison": _side(ref, "v1.5.0")}),
        "start_time must be less than end_time",
    )


def test_dif16_get_not_allowed(client: OpenObserveClient, ref: RefData):
    resp = query(client, ref.stream, "diff", method="GET")
    assert resp.status_code == 405, resp.text


def test_dif17_inuse_diff_per_snapshot(client: OpenObserveClient, prof_stream: str):
    minute = (now_ns() - 3 * 60 * NS) // (60 * NS) * 60 * NS
    ingest_ok(client, prof_stream, snapshot_model(minute))
    wait_rows(client, prof_stream, 2)
    inuse = {"profile_type": "inuse_space", "profile_unit": "bytes"}
    m = minute // 1000
    body = _diff_ok(
        client,
        prof_stream,
        {"baseline": window(m, m + 15 * US, **inuse), "comparison": window(m + 15 * US, m + 40 * US, **inuse)},
    )
    assert (body["baseline_total"], body["comparison_total"]) == (MIB, 3 * MIB)


def test_dif18_unknown_stream(client: OpenObserveClient, ref: RefData):
    stream = f"no_such_{uuid.uuid4().hex[:8]}"
    resp = _diff(client, stream, {"baseline": _side(ref, "v1.4.0"), "comparison": _side(ref, "v1.5.0")})
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == 20002
    assert resp.json()["message"] == f"Search stream not found: {stream}"


def test_dif19_no_auth(client: OpenObserveClient, ref: RefData):
    resp = requests.post(
        client.url(f"{ref.stream}/profiles/diff"),
        json={"baseline": _side(ref, "v1.4.0"), "comparison": _side(ref, "v1.5.0")},
        timeout=30,
    )
    assert resp.status_code == 401, resp.text

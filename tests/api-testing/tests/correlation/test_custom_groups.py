"""Correlation — custom semantic groups  [P1]  (enterprise-only)

Port of `Correlation/correlation-custom-groups.spec.js`. A custom semantic field
group (mapping raw fields like `dc`/`dc_region` to a canonical group id) must
shape discovery and correlation end-to-end, honour the "only new data picks up
config" (FL-1) contract, and reject configs that reference a deleted group.

Coverage:
 - CUSTOM-01 (TC-B2): custom group in distinguish_by shapes NEW data e2e
 - CUSTOM-02 (TC-B3): group added AFTER data existed — FL-1 honesty
 - CUSTOM-03 (TC-B4): deleting a referenced group -> 400 on save, config intact (F26)
"""
from __future__ import annotations

import json

DC_GROUP = {
    "id": "datacenter",
    "display": "Datacenter",
    "group": "Custom",
    "fields": ["dc", "dc_region"],
}


def test_custom_01_group_shapes_new_data_end_to_end(corr):
    """CUSTOM-01: custom group in distinguish_by shapes NEW data end-to-end (TC-B2)."""
    corr.add_semantic_group(DC_GROUP)
    status, body = corr.save_identity(
        {
            "sets": [{"id": "dcset", "label": "Datacenter", "distinguish_by": ["datacenter"]}],
            "tracked_alias_ids": ["datacenter"],
            "service_optional": False,
        }
    )
    assert status == 200, json.dumps(body)

    # NEW data carrying the custom field (FL-1: only new data picks up config).
    corr.ingest_logs("eu_b2_logs", [{"service": "pay", "dc": "eu-1", "message": "eu"}])
    corr.ingest_logs("us_b2_logs", [{"service": "pay", "dc": "us-1", "message": "us"}])

    # Discovery rows carry the custom group in disambiguation.
    rows = corr.wait_for_services(
        lambda r: any((row.get("disambiguation") or {}).get("datacenter") == "eu-1" for row in r)
        and any((row.get("disambiguation") or {}).get("datacenter") == "us-1" for row in r),
        "both datacenter rows discovered",
    )
    eu_row = next(r for r in rows if (r.get("disambiguation") or {}).get("datacenter") == "eu-1")
    assert "eu_b2_logs" in eu_row["logs_streams"]

    # Correlate from an eu-1 log returns ONLY eu streams, raw value in filters.
    status, body = corr.correlate(
        {"service": "pay", "datacenter": "eu-1"}, source_stream="eu_b2_logs", source_type="logs"
    )
    assert status == 200
    assert body is not None
    log_streams = [s["stream_name"] for s in (body.get("related_streams", {}).get("logs") or [])]
    assert "eu_b2_logs" in log_streams
    assert "us_b2_logs" not in log_streams, "us stream must be excluded when datacenter disambiguates"
    eu_filters = next(
        s for s in (body.get("related_streams", {}).get("logs") or []) if s["stream_name"] == "eu_b2_logs"
    )["filters"]
    assert "eu-1" in list((eu_filters or {}).values())


def test_custom_02_group_added_after_data_fl1_honesty(corr):
    """CUSTOM-02: group added AFTER data existed — honesty of the FL-1 contract (TC-B3)."""
    # Phase 0: discover under config v1 (k8s-cluster only).
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster"]}],
            "tracked_alias_ids": ["k8s-cluster"],
            "service_optional": False,
        }
    )
    assert status == 200
    corr.ingest_logs("b3_logs", [{"service": "web3", "k8s_cluster": "c1", "dc": "eu-1", "message": "old data"}])
    corr.wait_for_services(
        lambda r: any(row.get("service_name") == "web3" for row in r),
        "web3 discovered under v1 config",
    )

    # Phase 1: add the custom group + a NEW set (k8s set untouched so its rows
    # survive F10 cleanup) — correlate immediately, NO new ingest.
    corr.add_semantic_group(DC_GROUP)
    status, _ = corr.save_identity(
        {
            "sets": [
                {"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster"]},
                {"id": "dcset", "label": "Datacenter", "distinguish_by": ["datacenter"]},
            ],
            "tracked_alias_ids": ["k8s-cluster", "datacenter"],
            "service_optional": False,
        }
    )
    assert status == 200

    pre_status, pre_body = corr.correlate(
        {"service": "web3", "k8s-cluster": "c1", "datacenter": "eu-1"},
        source_stream="b3_logs",
        source_type="logs",
    )
    assert pre_status == 200
    # Contract pin: existing rows (unchanged set) still match via coverage —
    # config change alone must NOT hard-null existing correlation.
    assert pre_body is not None, "pre-re-ingest correlate must still match (FL-1 honesty)"

    # Phase 2: one new ingest batch → tracked dims upgrade (datacenter value
    # becomes visible on the row / correlate response).
    corr.ingest_logs("b3_logs", [{"service": "web3", "k8s_cluster": "c1", "dc": "eu-1", "message": "new data"}])
    rows = corr.wait_for_services(
        lambda r: any(
            row.get("service_name") == "web3"
            and (
                (row.get("all_dimensions") or {}).get("datacenter") == "eu-1"
                or (row.get("disambiguation") or {}).get("datacenter") == "eu-1"
            )
            for row in r
        ),
        "web3 row upgraded with datacenter after re-ingest",
    )
    row = next(r for r in rows if r["service_name"] == "web3")
    post_status, post_body = corr.correlate(
        {"service": "web3", "k8s-cluster": "c1", "datacenter": "eu-1"},
        source_stream="b3_logs",
        source_type="logs",
    )
    assert post_status == 200
    assert post_body is not None
    dims = {**(post_body.get("matched_dimensions") or {}), **(post_body.get("additional_dimensions") or {})}
    resolved = dims.get("datacenter")
    if resolved is None:
        resolved = (row.get("all_dimensions") or {}).get("datacenter")
    assert resolved == "eu-1", "datacenter must be visible after re-ingest"


def test_custom_03_delete_referenced_group_rejected_config_intact(corr):
    """CUSTOM-03: deleting a referenced group -> 400 on save, config unchanged (F26) (TC-B4)."""
    corr.add_semantic_group(DC_GROUP)
    # Orphan lives ONLY in distinguish_by: tracked_alias_ids is validated first,
    # so an orphan there would mask the set-naming F26 message.
    good = {
        "sets": [{"id": "dcset", "label": "Datacenter", "distinguish_by": ["datacenter"]}],
        "tracked_alias_ids": [],
        "service_optional": False,
    }
    status, _ = corr.save_identity(good)
    assert status == 200

    # Delete the group out from under the config.
    corr.remove_semantic_group("datacenter")

    # (a) Re-save unchanged config → 400 naming the set and the orphan id.
    status, body = corr.save_identity(good)
    assert status == 400, "orphan distinguish_by must be rejected"
    msg = json.dumps(body)
    assert "dcset" in msg
    assert "datacenter" in msg

    # (b) Orphan only in tracked_alias_ids → 400 "Unknown alias group IDs".
    status, body = corr.save_identity(
        {
            "sets": [{"id": "vm", "label": "VM", "distinguish_by": ["host"]}],
            "tracked_alias_ids": ["datacenter"],
            "service_optional": False,
        }
    )
    assert status == 400
    assert "Unknown alias group IDs" in json.dumps(body)

    # Config unchanged — still the pre-delete good config.
    cfg = corr.get_identity()
    assert [s["id"] for s in cfg["sets"]] == ["dcset"]

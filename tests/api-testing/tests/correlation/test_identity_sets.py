"""Correlation — detection rules / identity sets  [P0]  (enterprise-only)

Port of `Correlation/correlation-identity-sets.spec.js`. Identity sets route
discovered rows by shape; editing a set cleans its rows immediately; a
cluster-qualified correlate narrows while a service-only one is an honest union;
a typo'd distinguish_by is rejected without mutating config.

Coverage:
 - IDENT-01 (TC-C1/C2): two sets route correctly; editing a set cleans rows
   immediately (F8/F10)
 - IDENT-02 (TC-C3): cluster-qualified narrows; service-only is honest union (F11)
 - IDENT-03 (TC-C4): typo'd distinguish_by -> exact 400, config untouched (F26)
"""
from __future__ import annotations

import json
import re


def test_ident_01_two_sets_route_edit_cleans_rows(corr):
    """IDENT-01: two sets route correctly; editing a set cleans its rows immediately (F8/F10) (TC-C1/C2)."""
    status, _ = corr.save_identity(
        {
            "sets": [
                {"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster", "k8s-namespace"]},
                {"id": "vm", "label": "VM", "distinguish_by": ["environment", "host"]},
            ],
            "tracked_alias_ids": ["k8s-cluster", "k8s-namespace", "environment", "host"],
            "service_optional": False,
        }
    )
    assert status == 200

    # Each shape lands in its own set.
    corr.ingest_logs("c1_k8s_logs", [{"service": "ksvc", "k8s_cluster": "c1", "k8s_namespace": "n1", "message": "k8s"}])
    corr.ingest_logs("c1_vm_logs", [{"service": "vsvc", "environment": "prod", "host": "h9", "message": "vm"}])
    rows = corr.wait_for_services(
        lambda r: any(row.get("service_name") == "ksvc" for row in r)
        and any(row.get("service_name") == "vsvc" for row in r),
        "both shapes discovered",
    )
    assert next(r for r in rows if r["service_name"] == "ksvc")["set_id"] == "k8s"
    assert next(r for r in rows if r["service_name"] == "vsvc")["set_id"] == "vm"

    # Change the vm set's shape → its rows are cleaned IMMEDIATELY
    # (delete_by_set_id + cache clear + reload event on save — no flush wait).
    status, _ = corr.save_identity(
        {
            "sets": [
                {"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster", "k8s-namespace"]},
                {"id": "vm", "label": "VM", "distinguish_by": ["environment", "k8s-cluster"]},
            ],
            "tracked_alias_ids": ["k8s-cluster", "k8s-namespace", "environment", "host"],
            "service_optional": False,
        }
    )
    assert status == 200

    after = corr.list_services()
    assert [r for r in after if r.get("set_id") == "vm"] == [], "vm-set rows must be deleted immediately on shape change"
    assert len([r for r in after if r.get("set_id") == "k8s"]) == 1, "unchanged k8s set rows must survive"

    # Correlate during the transition: fresh rows or no-match — never a stale union.
    status, body = corr.correlate(
        {"service": "vsvc", "environment": "prod"}, source_stream="c1_vm_logs", source_type="logs"
    )
    assert status == 200
    assert body is None, "stale vm row must not match after cleanup"

    # New-shape data re-populates the set.
    corr.ingest_logs(
        "c1_vm_logs", [{"service": "vsvc", "environment": "prod", "k8s_cluster": "c1", "host": "h9", "message": "vm2"}]
    )
    repop = corr.wait_for_services(
        lambda r: any(row.get("service_name") == "vsvc" and row.get("set_id") == "vm" for row in r),
        "vm set repopulated under new shape",
    )
    vrow = next(r for r in repop if r["service_name"] == "vsvc" and r["set_id"] == "vm")
    assert sorted(vrow["disambiguation"].keys()) == ["environment", "k8s-cluster"]


def test_ident_02_cluster_qualified_narrows_service_only_union(corr):
    """IDENT-02: cluster-qualified correlate narrows; service-only correlate is an honest union (F11) (TC-C3)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster"]}],
            "tracked_alias_ids": ["k8s-cluster"],
            "service_optional": False,
        }
    )
    assert status == 200

    corr.ingest_logs("us_c3_logs", [{"service": "globalsvc", "k8s_cluster": "us", "message": "us"}])
    corr.ingest_logs("eu_c3_logs", [{"service": "globalsvc", "k8s_cluster": "eu", "message": "eu"}])
    corr.wait_for_services(
        lambda r: len([row for row in r if row.get("service_name") == "globalsvc"]) == 2,
        "both cluster rows discovered",
    )

    # Cluster-qualified → only that cluster's streams.
    status, body = corr.correlate(
        {"service": "globalsvc", "k8s-cluster": "us"}, source_stream="us_c3_logs", source_type="logs"
    )
    assert status == 200
    assert body is not None
    us_logs = [s["stream_name"] for s in (body.get("related_streams", {}).get("logs") or [])]
    assert "us_c3_logs" in us_logs
    assert "eu_c3_logs" not in us_logs, "eu stream must not leak into a us-qualified correlate"

    # Service-only → union is the documented contract; filters must carry ONLY
    # the service field so the UI can cue the ambiguity.
    status, body = corr.correlate(
        {"service": "globalsvc"}, source_stream="us_c3_logs", source_type="logs"
    )
    assert status == 200
    assert body is not None
    bare_logs = [s["stream_name"] for s in (body.get("related_streams", {}).get("logs") or [])]
    assert sorted(bare_logs) == ["eu_c3_logs", "us_c3_logs"]
    for s in body.get("related_streams", {}).get("logs") or []:
        keys = list((s.get("filters") or {}).keys())
        assert all(not re.search("cluster", k, re.IGNORECASE) for k in keys), (
            f"service-only union must not synthesize cluster filters (got {keys})"
        )


def test_ident_03_typo_distinguish_by_rejected_config_untouched(corr):
    """IDENT-03: typo'd distinguish_by rejected with exact message; config untouched (F26) (TC-C4)."""
    status, body = corr.save_identity(
        {
            "sets": [{"id": "typo", "label": "Typo", "distinguish_by": ["environmnet"]}],
            "tracked_alias_ids": [],
            "service_optional": False,
        }
    )
    assert status == 400
    msg = json.dumps(body)
    assert "typo" in msg
    assert "unknown distinguish_by group IDs" in msg
    assert "environmnet" in msg

    # Nothing was persisted — config has no 'typo' set.
    cfg = corr.get_identity()
    assert "typo" not in [s["id"] for s in (cfg.get("sets") or [])]

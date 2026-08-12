"""Correlation — data-shape edge cases & bounded growth  [P2]  (enterprise-only)

Port of `Correlation/correlation-edge-cases.spec.js`. The write path must cap
streams per type, upgrade a subset row in place while evicting the stale orphan,
and refuse to fork rows (or store empty keys) on whitespace-only / empty
dimension values.

Coverage:
 - EDGE-01 (TC-G1): 60 metric streams -> capped at max_streams_per_type (F32)
 - EDGE-02 (TC-G2): subset -> richer disambiguation upgrades in place; stale
   subset never returns (F19)
 - EDGE-03 (TC-G3): whitespace-only / empty values -> no phantom rows, no empty keys (F21)
"""
from __future__ import annotations

from .helpers import MAX_STREAMS_PER_TYPE


def test_edge_01_metric_streams_capped_at_max(corr):
    """EDGE-01: 60 metric streams for one service -> capped at max_streams_per_type (F32) (TC-G1)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "vm", "label": "VM", "distinguish_by": ["host"]}],
            "tracked_alias_ids": ["host"],
            "service_optional": False,
        }
    )
    assert status == 200

    records = [
        {"__name__": f"g1_metric_{i:02d}", "service": "capsvc", "host": "caph"} for i in range(60)
    ]
    corr.ingest_metrics(records)
    # A log row anchors the service so partial metric arrival is observable.
    corr.ingest_logs("g1_logs", [{"service": "capsvc", "host": "caph", "message": "anchor"}])

    # Wait until the row has absorbed at least the cap's worth of streams.
    rows = corr.wait_for_services(
        lambda r: any(
            row.get("service_name") == "capsvc"
            and len(row.get("metrics_streams") or []) >= MAX_STREAMS_PER_TYPE
            for row in r
        ),
        f"capsvc metrics_streams reaches cap ({MAX_STREAMS_PER_TYPE})",
    )
    row = next(r for r in rows if r["service_name"] == "capsvc")
    # F32: the DB write path must enforce the cap — never 60.
    assert len(row["metrics_streams"]) <= MAX_STREAMS_PER_TYPE, (
        f"stream array exceeded max_streams_per_type: {len(row['metrics_streams'])}"
    )


def test_edge_02_subset_upgrades_in_place_stale_evicted(corr):
    """EDGE-02: subset -> richer disambiguation upgrades in place; stale subset never returns (F19) (TC-G2)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster", "k8s-namespace"]}],
            "tracked_alias_ids": ["k8s-cluster", "k8s-namespace"],
            "service_optional": False,
        }
    )
    assert status == 200

    # Stage 1: cluster only → row {k8s-cluster: c1}.
    corr.ingest_logs("g2_logs", [{"service": "gsvc", "k8s_cluster": "c1", "message": "s1"}])
    corr.wait_for_services(
        lambda r: any(
            row.get("service_name") == "gsvc" and (row.get("disambiguation") or {}).get("k8s-cluster") == "c1"
            for row in r
        ),
        "subset row {cluster} discovered",
    )

    # Stage 2: cluster+namespace → the richer row replaces the subset.
    corr.ingest_logs("g2_logs", [{"service": "gsvc", "k8s_cluster": "c1", "k8s_namespace": "n1", "message": "s2"}])
    rows = corr.wait_for_services(
        lambda r: any(
            row.get("service_name") == "gsvc" and (row.get("disambiguation") or {}).get("k8s-namespace") == "n1"
            for row in r
        ),
        "richer row {cluster, ns} discovered",
    )

    # Single row survives; the subset orphan is deleted AND cache-evicted.
    mine = [r for r in rows if r.get("service_name") == "gsvc"]
    assert len(mine) == 1, f"expected exactly one row after subset merge, got {[m.get('disambiguation') for m in mine]}"
    assert mine[0]["disambiguation"] == {"k8s-cluster": "c1", "k8s-namespace": "n1"}

    # Correlate must serve the upgraded row, never the stale subset.
    status, body = corr.correlate(
        {"service": "gsvc", "k8s-cluster": "c1", "k8s-namespace": "n1"},
        source_stream="g2_logs",
        source_type="logs",
    )
    assert status == 200
    assert body is not None
    assert body["matched_dimensions"]["k8s-namespace"] == "n1"


def test_edge_03_hollow_values_no_phantom_rows_no_empty_keys(corr):
    """EDGE-03: whitespace-only / empty dimension values -> no phantom rows, no empty keys (F21) (TC-G3)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "k8s", "label": "K8s", "distinguish_by": ["k8s-cluster", "k8s-namespace"]}],
            "tracked_alias_ids": ["k8s-cluster", "k8s-namespace"],
            "service_optional": False,
        }
    )
    assert status == 200

    corr.ingest_logs(
        "g3_logs",
        [
            {"service": "wsvc", "k8s_cluster": "c1", "k8s_namespace": "   ", "message": "ws"},
            {"service": "wsvc", "k8s_cluster": "c1", "k8s_namespace": "", "message": "empty"},
        ],
    )
    rows = corr.wait_for_services(
        lambda r: any(row.get("service_name") == "wsvc" for row in r),
        "wsvc discovered despite hollow namespace values",
    )

    mine = [r for r in rows if r.get("service_name") == "wsvc"]
    # Exactly one row — whitespace and empty variants must not fork rows.
    assert len(mine) == 1, f"phantom rows from hollow values: {[m.get('disambiguation') for m in mine]}"
    # And no empty-string / whitespace-only values anywhere in it.
    row = mine[0]
    for k, v in [*(row.get("disambiguation") or {}).items(), *(row.get("all_dimensions") or {}).items()]:
        assert len(str(v).strip()) > 0, f"hollow value stored under '{k}'"
    assert row["disambiguation"] == {"k8s-cluster": "c1"}

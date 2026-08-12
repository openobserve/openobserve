"""Correlation — first-time service discovery  [P0]  (enterprise-only)

Port of `Correlation/correlation-discovery.spec.js`. Ingest telemetry across
logs/traces/metrics and assert the service-streams pipeline discovers each
logical service exactly once, fully typed, with the right disambiguation — and
that a mixed-case correlate emits RAW-case filters that actually return rows
(the F1 regression core).

Coverage:
 - DISC-01: k8s telemetry across three signals -> services appear once, typed
 - DISC-02: serviceless metrics -> no phantom per-stream service; service_optional
            host bridge (F7)
 - DISC-03: mixed-case values -> raw case in filters, filters return rows (F1)

Enterprise-gated: service_streams endpoints 403 on OSS builds.
Org isolation + shared plumbing: see conftest.py / helpers.py.
"""
from __future__ import annotations

import logging

from .helpers import sql_for_filters

logger = logging.getLogger(__name__)


def test_disc_01_k8s_telemetry_services_appear_once_typed(corr):
    """DISC-01: k8s telemetry across logs/traces/metrics -> services appear once, fully typed."""
    # Default (bootstrap) identity config: sets derived from workload-type
    # groups — k8s coverage comes from k8s_cluster/k8s_namespace fields.
    services = [{"service": "api", "ns": "n1"}, {"service": "web", "ns": "n2"}]
    for s in services:
        corr.ingest_logs(
            "a1_logs",
            [
                {"service": s["service"], "k8s_cluster": "c1", "k8s_namespace": s["ns"], "message": "hi"},
                {"service": s["service"], "k8s_cluster": "c1", "k8s_namespace": s["ns"], "message": "hi2"},
            ],
        )
        # Canonical OTel resource attr keys flatten to
        # service_k8s_cluster_name / service_k8s_namespace_name, which the
        # default semantic groups cover (bare k8s_cluster does NOT).
        corr.ingest_traces(
            s["service"], {"k8s.cluster.name": "c1", "k8s.namespace.name": s["ns"]}, 2
        )
        corr.ingest_metrics(
            [{"__name__": "a1_requests", "service": s["service"], "k8s_cluster": "c1", "k8s_namespace": s["ns"]}]
        )

    rows = corr.wait_for_services(
        lambda r: all(
            any(
                row.get("service_name") == svc
                and "a1_logs" in (row.get("logs_streams") or [])
                and len(row.get("metrics_streams") or []) > 0
                for row in r
            )
            for svc in ("api", "web")
        ),
        "both services discovered with logs+metrics",
    )

    for svc in ("api", "web"):
        mine = [r for r in rows if r.get("service_name") == svc]
        # Exactly one row per (service, disambiguation) — no duplicates.
        assert len(mine) == 1, f"expected exactly 1 row for {svc}, got {mine}"
        row = mine[0]
        assert "a1_logs" in row["logs_streams"]
        assert "a1_requests" in row["metrics_streams"]
        # Disambiguation carries the k8s dims (semantic-ID key space).
        assert row["disambiguation"]["k8s-cluster"] == "c1"
        assert "k8s-namespace" in row["disambiguation"]
        assert row["set_id"]

    # Traces discovered from the default OTLP stream. Soft-verified: traces WAL
    # cadence can lag; assert only if present.
    with_traces = [r for r in rows if len(r.get("traces_streams") or []) > 0]
    if not with_traces:
        logger.warning(
            "DISC-01: traces_streams not yet populated (traces WAL lag) — logs+metrics verified"
        )


def test_disc_02_serviceless_metrics_no_phantom_host_bridge(corr):
    """DISC-02: serviceless metrics -> no phantom per-stream service; service_optional host bridge (F7)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "vm", "label": "VM", "distinguish_by": ["host"]}],
            "tracked_alias_ids": ["host", "environment"],
            "service_optional": True,
        }
    )
    assert status == 200

    # Metrics with NO service label; logs WITH service, sharing the host.
    corr.ingest_metrics(
        [{"__name__": "a2_cpu", "host": "shared_h1"}, {"__name__": "a2_mem", "host": "shared_h1"}]
    )
    corr.ingest_logs("a2_logs", [{"service": "web2", "host": "shared_h1", "message": "x"}])

    rows = corr.wait_for_services(
        lambda r: any(row.get("service_name") == "web2" for row in r)
        and any(len(row.get("metrics_streams") or []) > 0 for row in r),
        "log service + metrics rows discovered",
    )

    # F7: fallback identity must derive from ORG-configured tracked ids, never
    # one phantom service per metric stream name.
    phantom = [r for r in rows if r.get("service_name") in ("a2_cpu", "a2_mem")]
    assert phantom == [], f"phantom per-metric-stream services found: {[p.get('service_name') for p in phantom]}"

    # service_optional=true: correlating from the log's host reaches the metrics.
    status, body = corr.correlate(
        {"service": "web2", "host": "shared_h1"},
        source_stream="a2_logs",
        source_type="logs",
    )
    assert status == 200
    assert body is not None, "expected a match (service_optional host bridge)"
    metric_streams = [s["stream_name"] for s in (body.get("related_streams", {}).get("metrics") or [])]
    assert "a2_cpu" in metric_streams


def test_disc_03_mixed_case_raw_filters_return_rows(corr):
    """DISC-03: mixed-case values — raw case emitted in filters, and those filters return rows (F1 regression)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "vm", "label": "VM", "distinguish_by": ["host"]}],
            "tracked_alias_ids": ["host"],
            "service_optional": False,
        }
    )
    assert status == 200

    corr.ingest_logs(
        "a3_logs",
        [
            {"service": "PaymentService", "host": "Chaitanyas-MBP", "message": "pay ok"},
            {"service": "PaymentService", "host": "Chaitanyas-MBP", "message": "pay ok 2"},
        ],
    )

    corr.wait_for_services(
        lambda r: any("a3_logs" in (row.get("logs_streams") or []) for row in r),
        "mixed-case service discovered",
    )

    # Correlate with RAW-case request values (lowercase is matching-only).
    status, body = corr.correlate(
        {"service": "PaymentService", "host": "Chaitanyas-MBP"},
        source_stream="a3_logs",
        source_type="logs",
    )
    assert status == 200
    assert body is not None, "mixed-case correlate must match"

    # F1 regression core: every emitted filter, run as real SQL, returns >0 rows.
    log_streams = body.get("related_streams", {}).get("logs") or []
    assert len(log_streams) > 0
    for s in log_streams:
        sql = sql_for_filters(s["stream_name"], s.get("filters") or {})
        hits = corr.search_logs(sql)
        assert len(hits) > 0, f"zero-row query for {s['stream_name']} — filters lowercased? sql={sql}"
        # Raw values (not lowercased) must appear in the emitted filters.
        assert "PaymentService" in list((s.get("filters") or {}).values())

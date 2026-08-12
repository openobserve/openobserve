"""Correlation — reset & refresh  [P1]  (enterprise-only)

Port of `Correlation/correlation-reset.spec.js`. `_reset` must empty the service
list AND make the next correlate a no-match immediately (cache clear + reload
event), and with ingest stopped it must stay a stable 200-null no-match — never
an error.

Coverage:
 - RESET-01 (TC-D1): reset empties list + correlate immediately; re-ingest re-discovers (F6)
 - RESET-02 (TC-D2): reset with ingest stopped -> 200-null no-match, stably (F28)
"""
from __future__ import annotations

import time


def test_reset_01_reset_empties_list_and_correlate_reingest_rediscovers(corr):
    """RESET-01: reset empties list AND correlate immediately; re-ingest re-discovers (F6) (TC-D1)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "vm", "label": "VM", "distinguish_by": ["host"]}],
            "tracked_alias_ids": ["host"],
            "service_optional": False,
        }
    )
    assert status == 200

    corr.ingest_logs("d1_logs", [{"service": "dsvc", "host": "dh1", "message": "1"}])
    corr.wait_for_services(
        lambda r: any(row.get("service_name") == "dsvc" for row in r),
        "dsvc discovered pre-reset",
    )

    corr.reset()

    # F6: cache cleared + reload event — both reads empty IMMEDIATELY.
    listing = corr.list_services()
    assert len(listing) == 0, "list must be empty right after reset"
    status, body = corr.correlate(
        {"service": "dsvc", "host": "dh1"}, source_stream="d1_logs", source_type="logs"
    )
    assert status == 200
    assert body is None, "correlate must be null right after reset (no resurrection)"

    # Fresh ingest → re-discovery within the temporal contract.
    corr.ingest_logs("d1_logs", [{"service": "dsvc", "host": "dh1", "message": "2"}])
    corr.wait_for_services(
        lambda r: any(row.get("service_name") == "dsvc" for row in r),
        "dsvc re-discovered after reset + fresh ingest",
    )


def test_reset_02_reset_ingest_stopped_stable_null_no_match(corr):
    """RESET-02: reset with ingest stopped -> 200-null no-match, stably (F28 backend contract) (TC-D2)."""
    status, _ = corr.save_identity(
        {
            "sets": [{"id": "vm", "label": "VM", "distinguish_by": ["host"]}],
            "tracked_alias_ids": ["host"],
            "service_optional": False,
        }
    )
    assert status == 200

    corr.ingest_logs("d2_logs", [{"service": "d2svc", "host": "d2h", "message": "x"}])
    corr.wait_for_services(
        lambda r: any(row.get("service_name") == "d2svc" for row in r),
        "d2svc discovered",
    )
    corr.reset()

    # "Null forever, honestly": no ingest → correlate stays a 200-null no-match
    # (never an error status). Sampled over 20s to catch late resurrection from
    # a straggler flush.
    for i in range(4):
        status, body = corr.correlate(
            {"service": "d2svc", "host": "d2h"}, source_stream="d2_logs", source_type="logs"
        )
        assert status == 200, "no-match must be HTTP 200, not an error"
        assert body is None, f"no-match must stay null (iteration {i})"
        time.sleep(5)

"""Alerts 4.0 (multi-alerts) — no-regression guards  [P0]

Port of `Alerts/alerts-multialert-regression.spec.js`. The prime directive of the
revamp is "zero behaviour change for existing alerts": every new field is opt-in,
nothing is inferred from an existing alert's shape.

Coverage: REG-01 (legacy round-trip), REG-02 (grouped stays simple),
REG-07/THR-08 (realtime rejects the warning family),
OUT-08/INV-6 (realtime persists no run-state; priority/tags still allowed).
"""
from __future__ import annotations

from .multialert_helpers import grouped_simple_alert, realtime_alert, simple_alert, uniq


def test_legacy_alert_roundtrips_unchanged(alerts):
    """REG-01: a legacy alert round-trips with no new fields injected."""
    name = uniq("reg_legacy")
    resp = alerts.create_alert(simple_alert(name))
    assert resp.status_code == 200, resp.text
    alert_id = alerts.find_alert_id(name)
    assert alert_id
    alerts.created.append(alert_id)

    a = alerts.get_alert_detail(alert_id)
    assert not a["query_condition"]["aggregation"], "no aggregation/multi inferred"
    assert a.get("priority") is None, "priority must not be injected"
    assert len(a.get("tags") or []) == 0, "tags must not be injected"
    assert a["trigger_condition"].get("warning_threshold") is None, "warning threshold must not be injected"


def test_grouped_alert_stays_simple_until_flag_on(alerts):
    """REG-02: a grouped alert stays simple until the per-group flag is turned on."""
    name = uniq("reg_grouped")
    resp = alerts.create_alert(grouped_simple_alert(name))
    assert resp.status_code == 200, resp.text
    alert_id = alerts.find_alert_id(name)
    assert alert_id
    alerts.created.append(alert_id)

    a = alerts.get_alert_detail(alert_id)
    agg = a["query_condition"]["aggregation"]
    assert "city" in agg["group_by"], "group_by is preserved"
    # The opt-in flag must NOT turn on merely because a group_by exists.
    assert not agg.get("multi_alert"), "multi_alert must stay off"


def test_realtime_alert_rejects_warning_family(alerts):
    """REG-07/THR-08: a realtime alert rejects the warning threshold family (400, names real-time)."""
    a = realtime_alert(uniq("reg_rt_warn"))
    a["trigger_condition"]["warning_threshold"] = 2
    a["trigger_condition"]["notify_on_warning"] = True
    resp = alerts.create_alert(a)
    assert resp.status_code == 400, resp.text
    assert "real-time" in resp.text.lower(), "the error should name real-time as the reason"


def test_realtime_alert_keeps_no_run_state_but_carries_priority(alerts):
    """OUT-08/INV-6: realtime persists no run-state but priority is allowed as inert metadata."""
    name = uniq("reg_rt")
    a = realtime_alert(name)
    a["priority"] = 2  # inert metadata IS allowed on realtime (PT-01)
    resp = alerts.create_alert(a)
    assert resp.status_code == 200, resp.text
    item = next((x for x in alerts.list_alerts() if x.get("name") == name), None)
    assert item, "the realtime alert must be listable"
    alerts.created.append(item["alert_id"])

    assert item.get("last_outcome") is None, "realtime persists no run outcome"
    assert item.get("level") is None, "realtime persists no level"
    assert item.get("priority") == 2, "priority is allowed on realtime as inert metadata"

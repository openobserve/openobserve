"""Alerts 4.0 (multi-alerts) — level-change history  [P0]

Port of `Alerts/alerts-multialert-transitions.spec.js`. Proves a multi-level
alert records each level change durably. A two-tier alert (warning >= 2,
critical >= 5) is driven up the ladder: three rows put it in the warning band,
three more push it into critical. The scheduler must record both steps in the
level-transition history (Ok -> Warning, then Warning -> Critical).
"""
from __future__ import annotations

from .multialert_helpers import fast_eval, simple_alert, uniq


def _rows(n: int) -> list[dict]:
    return [{"i": i} for i in range(n)]


def test_level_transitions_recorded_warning_then_critical(alerts):
    """Ok->Warning then Warning->Critical are both recorded as the count climbs."""
    stream = uniq("alerts_txn")
    name = uniq("txn_incr")

    # A two-tier alert on a fresh stream, seeded with just enough to breach warning first.
    a = fast_eval(simple_alert(name), stream)
    a["trigger_condition"]["threshold"] = 5
    a["trigger_condition"]["warning_threshold"] = 2
    a["trigger_condition"]["notify_on_warning"] = True
    alerts.ingest(stream, _rows(3))  # count 3 -> warning band (>= 2, < 5)
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)

    # Step 1: it settles into the warning band (Ok -> Warning).
    at_warning = alerts.wait_for_alert_level(name, "warning", timeout_s=60)
    assert at_warning, "the alert is evaluated within the poll window"
    assert at_warning["level"] == "warning", "a count of 3 sits in the warning band (>= 2, < 5)"

    # Step 2: push the count into critical (Warning -> Critical).
    alerts.ingest(stream, _rows(3))  # count 6 -> critical band (>= 5)
    at_critical = alerts.wait_for_alert_level(name, "critical", timeout_s=120)
    assert at_critical, "the level advances once the critical threshold is crossed"
    assert at_critical["level"] == "critical", "a count of 6 crosses the critical threshold (>= 5)"

    # Both level changes must be durably recorded as transitions (newest first).
    txns = alerts.get_alert_transitions(alert_id)
    to_warning = next((t for t in txns["list"] if t.get("to_level") == "warning"), None)
    to_critical = next((t for t in txns["list"] if t.get("to_level") == "critical"), None)
    assert to_warning, "the first breach records a transition into warning"
    assert to_warning.get("from_level") is None, "the alert has no prior level before its first breach"
    assert to_critical, "the climb into critical records a second transition"
    assert to_critical["from_level"] == "warning", "the increment steps up from warning, not from ok/none"

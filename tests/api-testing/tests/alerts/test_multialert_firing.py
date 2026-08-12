"""Alerts 4.0 (multi-alerts) — firing behaviour  [P0]

Port of `Alerts/alerts-multialert-firing.spec.js`. Proves an alert actually FIRES
at the right level (not just that it saves): a critical alert fires critical, a
warning alert fires warning, a per-group (multi) alert fires independently for
each breaching group, and a grouped alert in simple mode fires once as a single
rollup. Each alert is fed data into a fresh stream (deterministic count) and
polled until the scheduler records the outcome (~15s given ZO_ALERT_SCHEDULE_INTERVAL=3).
"""
from __future__ import annotations

from .multialert_helpers import (
    fast_eval,
    grouped_simple_alert,
    is_firing_outcome,
    multi_alert,
    simple_alert,
    uniq,
)


def _rows(n: int) -> list[dict]:
    return [{"i": i} for i in range(n)]


def _city_rows(city: str, n: int, latency: int) -> list[dict]:
    return [{"city": city, "latency": latency} for _ in range(n)]


def test_critical_alert_fires_critical(alerts):
    """A count of 6 (>= 5) fires the alert at critical level."""
    stream = uniq("alerts_fire_crit")
    alerts.ingest(stream, _rows(6))  # count 6 -> >= 5 critical

    name = uniq("fire_crit")
    a = fast_eval(simple_alert(name), stream)
    a["trigger_condition"]["threshold"] = 5
    a["trigger_condition"]["warning_threshold"] = 2
    a["trigger_condition"]["notify_on_warning"] = True
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    item = alerts.wait_for_alert_outcome(name, timeout_s=120)
    assert item, "the alert must be evaluated within the poll window"
    assert item["level"] == "critical", "a count of 6 crosses the critical threshold (>= 5)"
    assert is_firing_outcome(item.get("last_outcome")), f'outcome "{item.get("last_outcome")}" should be firing'


def test_warning_alert_fires_warning(alerts):
    """A count of 3 (>= 2, < 5) fires the alert at warning level."""
    stream = uniq("alerts_fire_warn")
    alerts.ingest(stream, _rows(3))  # count 3 -> >= 2 warning, < 5 critical

    name = uniq("fire_warn")
    a = fast_eval(simple_alert(name), stream)
    a["trigger_condition"]["threshold"] = 5
    a["trigger_condition"]["warning_threshold"] = 2
    a["trigger_condition"]["notify_on_warning"] = True
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    item = alerts.wait_for_alert_outcome(name, timeout_s=120)
    assert item
    assert item["level"] == "warning", "a count of 3 crosses warning (>= 2) but not critical (< 5)"
    assert is_firing_outcome(item.get("last_outcome"))


def test_per_group_alert_fires_independently_per_group(alerts):
    """Three cities each averaging > 500 latency -> three firing groups."""
    stream = uniq("alerts_fire_multi")
    alerts.ingest(stream, [
        *_city_rows("bangalore", 2, 900), *_city_rows("mumbai", 2, 900), *_city_rows("delhi", 2, 900),
    ])

    name = uniq("fire_multi")
    assert alerts.create_alert(fast_eval(multi_alert(name), stream)).status_code == 200, "multi-alert saves"
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)

    item = alerts.wait_for_alert_outcome(name, timeout_s=120)
    assert item
    assert item["groups_firing"] == 3, "all three groups breached, so three groups fire"

    groups = alerts.get_alert_groups(alert_id)
    assert len(groups["list"]) == 3, "a multi-alert tracks one row per group"


def test_grouped_simple_alert_fires_once_no_per_group_rows(alerts):
    """A grouped alert left in simple mode fires once as a rollup, no per-group rows."""
    stream = uniq("alerts_fire_simple")
    alerts.ingest(stream, [
        *_city_rows("bangalore", 2, 900), *_city_rows("mumbai", 2, 900), *_city_rows("delhi", 2, 900),
    ])

    name = uniq("fire_simple")
    assert alerts.create_alert(fast_eval(grouped_simple_alert(name), stream)).status_code == 200, \
        "grouped simple alert saves"
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)

    item = alerts.wait_for_alert_outcome(name, timeout_s=120)
    assert item
    assert is_firing_outcome(item.get("last_outcome")), "the collapsed rollup fires once"
    assert item.get("groups_firing") is None, "a simple alert has no per-group firing count"

    groups = alerts.get_alert_groups(alert_id)
    assert len(groups["list"]) == 0, "a simple alert has no per-group rows"

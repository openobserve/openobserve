"""Alert leases through real time: the 60 s expiry sweep and the pulled-forward first run.

These wait on the clock, so CI runs them in the parallel wall-clock shard, not the default set."""
from __future__ import annotations

import datetime as dt
from typing import Any

import pytest

from support.wait import wait_until

from .multialert_helpers import DEST, SECOND_US, fast_eval, lease_spec, now_us, simple_alert, uniq

# One sweep interval, plus the lease's own lead and a margin for a busy scheduler node.
SWEEP_WAIT_S = 100
SHORT_LEASE_S = 10


def _create(alerts, payload: dict) -> str:
    resp = alerts.create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json().get("id")
    assert alert_id, f"create answered without an id: {resp.text}"
    alerts.created.append(alert_id)
    return alert_id


def _only_lease(alerts, alert_id: str) -> dict:
    resp = alerts.alert_leases(alert_id)
    assert resp.status_code == 200, resp.text
    leases = resp.json()
    assert len(leases) == 1, leases
    return leases[0]


def _alert(alerts, alert_id: str) -> dict:
    alert = alerts.get_alert(alert_id)
    assert alert is not None, f"alert {alert_id} is gone"
    return alert


def test_the_sweep_disables_a_temporary_alert_at_its_end(alerts):
    """W1"""
    name = uniq("lease_w1")
    payload = simple_alert(name)
    payload["lease"] = lease_spec(SHORT_LEASE_S)
    alert_id = _create(alerts, payload)
    ends_at = payload["lease"]["ends_at_us"]
    assert _only_lease(alerts, alert_id)["state"] == "active"

    def _ended():
        lease = _only_lease(alerts, alert_id)
        return lease if lease["state"] != "active" else None

    lease = wait_until(_ended, timeout=SWEEP_WAIT_S, interval=3, msg="the sweep ended the temporary alert's lease")
    assert lease["state"] == "ended", lease
    assert lease["ended_at_us"] >= ends_at
    assert _alert(alerts, alert_id)["enabled"] is False
    item = alerts.list_item(name)
    assert item is not None, "the alert is disabled, not deleted"
    assert item["enabled"] is False
    assert "leases" not in item


def test_the_sweep_restores_incident_creation_at_a_timed_toggles_end(alerts):
    """W2"""
    name = uniq("lease_w2")
    alert_id = _create(alerts, simple_alert(name))
    until = now_us() + SHORT_LEASE_S * SECOND_US
    resp = alerts.set_creates_incident(alert_id, {"value": True, "until_us": until, "reason": "wall-clock toggle"})
    assert resp.status_code == 200, resp.text
    lease_id = resp.json()["lease"]["id"]
    assert _alert(alerts, alert_id)["creates_incident"] is True

    def _restored():
        lease = _only_lease(alerts, alert_id)
        return lease if lease["state"] != "active" else None

    lease = wait_until(_restored, timeout=SWEEP_WAIT_S, interval=3, msg="the sweep ended the timed toggle")
    assert lease["id"] == lease_id
    assert lease["state"] == "ended", lease
    assert lease["ended_at_us"] >= until
    assert _alert(alerts, alert_id)["creates_incident"] is False, "the prior value returns at the end"


def _far_cron(alert: dict, stream: str) -> dict:
    """Fires once a day at an hour about 12 h away, so only a pulled-forward run lands soon."""
    fast_eval(alert, stream)
    hour = (dt.datetime.now(dt.UTC).hour + 12) % 24
    alert["trigger_condition"].update({
        "frequency_type": "cron", "cron": f"0 0 {hour} * * *", "timezone": "UTC", "threshold": 1,
    })
    return alert


def test_a_new_temporary_alert_runs_at_once_and_a_plain_one_waits_for_its_cron(alerts):
    """W3"""
    stream = uniq("lease_w3_s")
    assert alerts.ingest(stream, [{"i": i} for i in range(3)]).status_code == 200
    temp_name, plain_name = uniq("lease_w3_tmp"), uniq("lease_w3_plain")
    plain_id = _create(alerts, _far_cron(simple_alert(plain_name), stream))
    temporary = _far_cron(simple_alert(temp_name), stream)
    temporary["lease"] = lease_spec(3600)
    _create(alerts, temporary)

    def _evaluated():
        item = alerts.list_item(temp_name)
        return item if item and item.get("last_outcome_at") else None

    item = wait_until(_evaluated, timeout=45, interval=2, msg="the temporary alert's first run was pulled to now")
    assert item["last_outcome"], item
    plain = alerts.list_item(plain_name)
    assert plain is not None, f"alert {plain_name} is not in the list"
    assert not plain.get("last_outcome_at"), f"a plain cron alert must wait for its cron: {plain}"
    assert plain["alert_id"] == plain_id


def _incident_alert(name: str, stream: str) -> dict[str, Any]:
    return {
        "name": name, "stream_type": "logs", "stream_name": stream, "is_real_time": False,
        "query_condition": {
            "type": "sql", "conditions": None, "promql": "", "promql_condition": None,
            "sql": f'SELECT service_name, count(*) AS cnt FROM "{stream}" WHERE level = \'error\' GROUP BY service_name',
            "search_event_type": "ui", "vrl_function": None, "multi_time_range": [],
        },
        "trigger_condition": {
            "period": 10, "operator": ">=", "threshold": 1, "frequency": 1, "cron": "", "silence": 0,
            "frequency_type": "minutes", "timezone": "UTC", "tolerance_in_secs": 0,
        },
        "destinations": [DEST], "enabled": True, "description": "timed incident toggle",
        "creates_incident": True, "context_attributes": {}, "row_template": "",
    }


def _require_incidents(client) -> None:
    """Skip on an OSS build; FAIL on an enterprise build whose incidents are off."""
    resp = client.get("config")
    assert resp.status_code == 200, resp.text
    config = resp.json()
    kind = config.get("build_type")
    assert kind, f"no build_type in /config: {resp.text[:200]}"
    if kind == "opensource":
        pytest.skip("incident creation is enterprise-only and this is an OSS build")
    assert config.get("incidents_enabled"), (
        f"incidents are off on this {kind} build; check O2_INCIDENTS_ENABLED. "
        "This test fails rather than skips on an enterprise build."
    )


def test_a_timed_toggle_off_stops_incidents_until_it_ends(alerts, client):
    """W4"""
    _require_incidents(client)
    stream, service, name = uniq("lease_w4_s"), uniq("svc_lease_w4"), uniq("lease_w4")
    assert alerts.ingest(stream, [{"level": "info", "service_name": service, "msg": "seed"}]).status_code == 200
    alert_id = _create(alerts, _incident_alert(name, stream))
    resp = alerts.set_creates_incident(
        alert_id, {"value": False, "until_us": now_us() + 3600 * SECOND_US, "reason": "quiet during the deploy"}
    )
    assert resp.status_code == 200, resp.text
    lease_id = resp.json()["lease"]["id"]
    assert _alert(alerts, alert_id)["creates_incident"] is False

    def _feed():
        alerts.ingest(stream, [{"level": "error", "service_name": service, "msg": "boom"}])

    incident_ids: list[str] = []
    try:
        def _notified_twice():
            _feed()
            return alerts.notifications_for(name) >= 2

        wait_until(_notified_twice, timeout=300, interval=5, msg="two firings delivered while incidents are off")
        assert alerts.incidents_for(alert_id) == [], "no incident may open while the toggle holds it off"

        ended = alerts.lease_action(alert_id, lease_id, "end")
        assert ended.status_code == 200, ended.text
        assert ended.json()["state"] == "ended", ended.text
        assert _alert(alerts, alert_id)["creates_incident"] is True

        def _opened():
            _feed()
            return alerts.incidents_for(alert_id)

        incident_ids = [i["id"] for i in wait_until(_opened, timeout=300, interval=5, msg="an incident opened")]
    finally:
        incident_ids = incident_ids or [i["id"] for i in alerts.incidents_for(alert_id)]
        for incident_id in incident_ids:
            alerts._v2("PATCH", f"alerts/incidents/{incident_id}/update", json={"status": "resolved"})

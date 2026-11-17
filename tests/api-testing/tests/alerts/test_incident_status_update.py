"""Incident status update: reopen clears resolve/ack state (o2-enterprise#3179); multi-field updates are refused (#3180)."""
from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import AlertsClient, uniq


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
        "destinations": [], "enabled": True, "description": "incident status update",
        "creates_incident": True, "context_attributes": {}, "row_template": "",
    }


@pytest.fixture(scope="module")
def incident(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """One incident opened by a fresh incident-creating alert, resolved at teardown."""
    config = client.get("config")
    assert config.status_code == 200, config.text
    if not config.json().get("incidents_enabled"):
        pytest.skip("incidents are off: an opensource build, or O2_INCIDENTS_ENABLED=false")

    alerts = AlertsClient(client)
    stream, service, name = uniq("inc_status_s"), uniq("svc_inc_status"), uniq("inc_status_alert")
    alert_id = incident_id = None
    try:
        alerts.ingest(stream, [{"level": "error", "service_name": service, "msg": "seed"}])
        resp = alerts.create_alert(_incident_alert(name, stream))
        assert resp.status_code == 200, resp.text
        alert_id = alerts.find_alert_id(name)

        def ours() -> dict | None:
            resp = alerts._v2("GET", "alerts/incidents?limit=1000")
            assert resp.status_code == 200, resp.text
            found = [i for i in resp.json()["incidents"]
                     if any(g.get("alert_id") == alert_id for g in i.get("alert_groups") or [])]
            return found[0] if found else None

        incident_id = wait_until(ours, timeout=240, interval=5, msg=f"no incident was opened for alert {alert_id}")["id"]
        yield {"alerts": alerts, "id": incident_id}
    finally:
        if alert_id:
            alerts.delete_alerts([alert_id])
        if incident_id:
            alerts._v2("PATCH", f"alerts/incidents/{incident_id}/update", json={"status": "resolved"})
        client.streams.delete(stream)


def _patch(incident: dict[str, Any], body: dict[str, Any]):
    return incident["alerts"]._v2("PATCH", f"alerts/incidents/{incident['id']}/update", json=body)


def _get(incident: dict[str, Any]) -> dict[str, Any]:
    resp = incident["alerts"]._v2("GET", f"alerts/incidents/{incident['id']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body.get("incident", body)


def test_reopening_a_resolved_incident_clears_resolution_and_ack(incident):
    acked = _patch(incident, {"status": "acknowledged"})
    assert acked.status_code == 200, acked.text
    state = _get(incident)
    assert state["status"] == "acknowledged", state
    assert state.get("acknowledged_at"), state
    assert state.get("acknowledged_by"), state

    resolved = _patch(incident, {"status": "resolved"})
    assert resolved.status_code == 200, resolved.text
    state = _get(incident)
    assert state["status"] == "resolved", state
    assert state.get("resolved_at"), state

    reopened = _patch(incident, {"status": "open"})
    assert reopened.status_code == 200, reopened.text
    state = _get(incident)
    assert state["status"] == "open", state
    assert state.get("resolved_at") is None, state
    assert state.get("acknowledged_by") is None, state
    assert state.get("acknowledged_at") is None, state


def test_a_multi_field_update_is_refused_and_changes_nothing(incident):
    before = _get(incident)
    new_title = uniq("inc_status_title")
    new_status = "acknowledged" if before["status"] != "acknowledged" else "open"

    resp = _patch(incident, {"title": new_title, "status": new_status})
    assert resp.status_code == 422, resp.text

    after = _get(incident)
    assert after["title"] == before["title"], after
    assert after["status"] == before["status"], after

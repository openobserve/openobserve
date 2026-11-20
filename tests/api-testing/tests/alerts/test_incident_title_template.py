"""Incident title templates (#15203): an alert's incident_title_template titles the incident it opens, and one that resolves nothing keeps the default title."""
from __future__ import annotations

from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import AlertsClient, fast_eval, simple_alert, uniq


def _incident_of(alerts: AlertsClient, alert_id: str) -> dict[str, Any] | None:
    resp = alerts._v2("GET", "alerts/incidents?limit=1000")
    assert resp.status_code == 200, resp.text
    found = [i for i in resp.json()["incidents"] if any(g.get("alert_id") == alert_id for g in i.get("alert_groups") or [])]
    return found[0] if found else None


def test_the_title_template_names_the_incident_and_an_unresolvable_one_falls_back(client: OpenObserveClient):
    """Variables from the alert and its rows fill the title; an all-unknown or blank template keeps the generated title."""
    config = client.get("config")
    assert config.status_code == 200, config.text
    if not config.json().get("incidents_enabled"):
        pytest.skip("incidents are off: an opensource build, or O2_INCIDENTS_ENABLED=false")

    alerts = AlertsClient(client)
    templates = {"filled": "{stream_name}: {svc} is failing ({no_such_var})", "unknown": "{no_such_var} {nor_this}", "blank": "   "}
    # One stream and service per alert, or correlation joins all three into one incident titled by whichever fired first.
    streams = {key: uniq(f"inc_title_s_{key}") for key in templates}
    svcs = {key: uniq(f"inc_title_svc_{key}") for key in templates}
    ids: dict[str, str] = {}
    try:
        for key, template in templates.items():
            alerts.ingest(streams[key], [{"level": "error", "svc": svcs[key], "i": i} for i in range(3)])
            alert = fast_eval(simple_alert(uniq(f"inc_title_{key}")), streams[key])
            alert["trigger_condition"].update(threshold=1, silence=0)
            alert.update(destinations=[], creates_incident=True, incident_title_template=template)
            resp = alerts.create_alert(alert)
            assert resp.status_code == 200, resp.text
            ids[key] = alerts.find_alert_id(alert["name"])
        assert alerts.get_alert(ids["blank"]).get("incident_title_template") is None, "a blank template must read back as unset"

        def opened() -> dict[str, dict[str, Any]] | None:
            for key in templates:
                alerts.ingest(streams[key], [{"level": "error", "svc": svcs[key]}])
            found = {key: _incident_of(alerts, alert_id) for key, alert_id in ids.items()}
            return found if all(found.values()) else None

        incidents = wait_until(opened, timeout=240, interval=5, msg="each alert opens its incident")
        assert incidents["filled"]["title"] == f"{streams['filled']}: {svcs['filled']} is failing (–)", incidents["filled"]
        for key in ("unknown", "blank"):
            name = next(a["name"] for a in alerts.list_alerts() if a.get("alert_id") == ids[key])
            assert incidents[key]["title"].startswith(name), incidents[key]
    finally:
        alerts.delete_alerts(list(ids.values()))
        for stream in streams.values():
            client.streams.delete(stream)

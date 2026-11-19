"""openobserve#16664: a destination cannot turn into Jira under alerts Jira cannot serve, and a composite whose send fails reads as not delivered."""
from __future__ import annotations

import os
from collections.abc import Generator
from typing import Any

import pytest

from helpers.webhook_sink import WebhookSink
from support.client import OpenObserveClient
from support.wait import wait_until
from tests.alerts.multialert_helpers import AlertsClient, fast_eval, simple_alert, uniq
from tests.alerts.test_composite_alerts import _composite_payload

COMPOSITE_SWEEP_S = int(os.environ.get("ZO_ALERT_COMPOSITE_SWEEP_SECS", "300"))


@pytest.fixture
def delivery(client: OpenObserveClient, webhook_sink: WebhookSink) -> Generator[dict[str, Any], None, None]:
    """A template, a stream and a factory of loopback destinations, all removed afterwards."""
    alerts = AlertsClient(client)
    made = {"alerts": [], "destinations": []}
    template = uniq("jira_conv_tmpl")
    resp = alerts._v1("POST", "alerts/templates", json={"name": template, "type": "http", "title": "", "body": '{"text": "{alert_name}"}'})
    assert resp.status_code == 200, resp.text
    stream = uniq("jira_conv_s")
    alerts.ingest(stream, [{"level": "error", "i": i} for i in range(3)])

    def destination(path: str) -> dict[str, Any]:
        body = {"name": uniq(f"jira_conv_{path}"), "url": webhook_sink.url(path), "method": "post", "type": "http",
                "skip_tls_verify": False, "template": template, "headers": {}}
        resp = alerts._v1("POST", "alerts/destinations", json=body)
        assert resp.status_code == 200, resp.text
        made["destinations"].append(body["name"])
        return body

    def alert(payload: dict[str, Any]) -> str:
        resp = alerts.create_alert(payload)
        assert resp.status_code == 200, resp.text
        made["alerts"].insert(0, alerts.find_alert_id(payload["name"]))
        return made["alerts"][0]

    try:
        yield {"alerts": alerts, "stream": stream, "template": template, "destination": destination, "alert": alert}
    finally:
        alerts.delete_alerts(made["alerts"])
        for name in made["destinations"]:
            alerts._v1("DELETE", f"alerts/destinations/{name}")
        alerts._v1("DELETE", f"alerts/templates/{template}")
        client.streams.delete(stream)


def _as_jira(destination: dict[str, Any]) -> dict[str, Any]:
    return {**destination, "destination_type_name": "jira",
            "headers": {"Content-Type": "application/json", "Authorization": "Basic Ym90QHRlc3QuaW52YWxpZDp0b2tlbg=="},
            "metadata": {"prebuilt_type": "jira", "jira_deployment": "cloud", "jira_email": "bot@test.invalid",
                         "jira_project_key": "OPS", "jira_issue_type_id": "10004"}}


def test_a_destination_cannot_become_jira_while_an_alert_jira_cannot_serve_sends_to_it(delivery: dict[str, Any]):
    """Pre-fix the conversion saved, so an alert with a one-minute silence ended up sending to Jira."""
    alerts = delivery["alerts"]
    used, spare = delivery["destination"]("conv_used"), delivery["destination"]("conv_spare")
    short = fast_eval(simple_alert(uniq("jira_conv_short")), delivery["stream"])
    short.update(destinations=[used["name"]], enabled=False)
    delivery["alert"](short)
    calm = fast_eval(simple_alert(uniq("jira_conv_calm")), delivery["stream"])
    calm["trigger_condition"]["silence"] = 10
    calm.update(destinations=[spare["name"]], enabled=False)
    delivery["alert"](calm)

    resp = alerts._v1("PUT", f"alerts/destinations/{used['name']}", json=_as_jira(used))
    assert resp.status_code == 400, resp.text
    assert short["name"] in resp.text, resp.text
    stored = alerts._v1("GET", f"alerts/destinations/{used['name']}").json()
    assert stored.get("destination_type_name") != "jira", stored

    resp = alerts._v1("PUT", f"alerts/destinations/{spare['name']}", json=_as_jira(spare))
    assert resp.status_code == 200, resp.text


def test_a_composite_whose_send_fails_reads_as_not_delivered(delivery: dict[str, Any], webhook_sink: WebhookSink):
    """Pre-fix the composite's state kept the firing outcome, so the Firing tab showed it as delivered."""
    alerts = delivery["alerts"]
    webhook_sink.respond("cmp_down", then=500)
    child_dest, down = delivery["destination"]("cmp_child"), delivery["destination"]("cmp_down")
    children = []
    for _ in range(2):
        child = fast_eval(simple_alert(uniq("cmp_fail_child")), delivery["stream"])
        child["trigger_condition"].update(threshold=1, silence=0)
        child["destinations"] = [child_dest["name"]]
        children.append(delivery["alert"](child))
    payload = _composite_payload(name=uniq("cmp_fail"), child_ids=children, enabled=True, template=delivery["template"])
    payload["destinations"] = [down["name"]]
    payload["trigger_condition"] = {"silence": 0}
    composite = delivery["alert"](payload)

    def outcome() -> str | None:
        alerts.ingest(delivery["stream"], [{"level": "error"}])
        row = next((a for a in alerts.list_alerts() if a.get("alert_id") == composite), {})
        return row.get("last_outcome") if webhook_sink.deliveries("cmp_down") else None

    wait_until(lambda: outcome() == "notify_failed" or None, timeout=COMPOSITE_SWEEP_S + 300, interval=5,
               msg="the composite's failed send never showed as notify_failed on its row")

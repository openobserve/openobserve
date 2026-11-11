"""openobserve#16633: a failed incident notification is retried in place, and only when it can still pass."""
from __future__ import annotations

import os
import time
from collections.abc import Generator
from typing import Any

import pytest

from helpers.webhook_sink import WebhookSink
from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import AlertsClient, uniq

# Must match the server's ZO_SCHEDULER_MAX_RETRIES, which also caps incident notify attempts.
MAX_ATTEMPTS = int(os.environ.get("ZO_SCHEDULER_MAX_RETRIES", "3"))
# Attempts are ~2 s apart in one call; a scheduler retry of the alert itself is at least 10 s later.
ONE_NOTIFY_CALL_S = 9
CASES = {"flip": ((500,), 200), "always500": ((), 500), "refused400": ((), 400)}


def _incident_alert(name: str, stream: str, destination: str) -> dict[str, Any]:
    return {
        "name": name, "stream_type": "logs", "stream_name": stream, "is_real_time": False,
        "query_condition": {
            "type": "sql", "conditions": None, "promql": "", "promql_condition": None,
            "sql": f'SELECT service_name, count(*) AS cnt FROM "{stream}" WHERE level = \'error\' GROUP BY service_name',
            "search_event_type": "ui", "vrl_function": None, "multi_time_range": [],
        },
        "trigger_condition": {
            "period": 1, "operator": ">=", "threshold": 1, "frequency": 1, "cron": "", "silence": 0,
            "frequency_type": "minutes", "timezone": "UTC", "tolerance_in_secs": 0,
        },
        "destinations": [destination], "enabled": True, "description": "incident notify retry",
        "creates_incident": True, "context_attributes": {}, "row_template": "",
    }


@pytest.fixture(scope="module")
def incident_alerts(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """One incident-creating alert per case, each with its own stream, service and sink path, created together."""
    config = client.get("config")
    assert config.status_code == 200, config.text
    if not config.json().get("incidents_enabled"):
        pytest.skip("incidents are off: an opensource build, or O2_INCIDENTS_ENABLED=false")

    alerts = AlertsClient(client)
    sink = WebhookSink()
    template = uniq("inc_retry_tmpl")
    created: dict[str, list[str]] = {"alerts": [], "destinations": [], "streams": []}
    services: dict[str, str] = {}
    template_created = False
    try:
        resp = alerts._v1("POST", "alerts/templates", json={
            "name": template, "type": "http", "title": "", "body": '{"text": "{alert_name}"}'})
        assert resp.status_code == 200, resp.text
        template_created = True
        ids: dict[str, str] = {}
        for case, (first, then) in CASES.items():
            sink.respond(case, *first, then=then)
            dest, stream, service = uniq(f"inc_retry_{case}"), uniq(f"inc_retry_{case}_s"), uniq(f"svc_{case}")
            resp = alerts._v1("POST", "alerts/destinations", json={
                "name": dest, "url": sink.url(case), "method": "post", "type": "http",
                "skip_tls_verify": False, "template": template, "headers": {}})
            assert resp.status_code == 200, resp.text
            created["destinations"].append(dest)
            created["streams"].append(stream)
            alerts.ingest(stream, [{"level": "error", "service_name": service, "msg": "seed"}])
            name = uniq(f"inc_retry_{case}_alert")
            resp = alerts.create_alert(_incident_alert(name, stream, dest))
            assert resp.status_code == 200, resp.text
            services[case] = service
            ids[case] = alerts.find_alert_id(name)
            created["alerts"].append(ids[case])
        yield {"alerts": alerts, "sink": sink, "ids": ids}
    finally:
        # A failed resolve still fails teardown, but must not skip the deletes below.
        try:
            _resolve_incidents(alerts, set(services.values()))
        finally:
            alerts.delete_alerts(created["alerts"])
            for dest in created["destinations"]:
                alerts._v1("DELETE", f"alerts/destinations/{dest}")
            if template_created:
                alerts._v1("DELETE", f"alerts/templates/{template}")
            for stream in created["streams"]:
                client.streams.delete(stream)
            sink.close()


def _resolve_incidents(alerts: AlertsClient, services: set[str]) -> None:
    if not services:
        return
    for status in ("open", "acknowledged"):
        resp = alerts._v2("GET", f"alerts/incidents?status={status}&limit=1000")
        assert resp.status_code == 200, resp.text
        for incident in resp.json()["incidents"]:
            if any(s in str(incident) for s in services):
                patched = alerts._v2("PATCH", f"alerts/incidents/{incident['id']}/update", json={"status": "resolved"})
                assert patched.status_code == 200, patched.text


def _first_notify_call(incident_alerts: dict[str, Any], case: str) -> list:
    """The deliveries of the first incident notification for `case`, once its retry window has passed."""
    sink: WebhookSink = incident_alerts["sink"]
    first = wait_until(lambda: sink.deliveries(case), timeout=300, interval=2,
                       msg=f"{case}: the incident notification never reached the sink")[0]
    time.sleep(max(0.0, first.at + ONE_NOTIFY_CALL_S - time.monotonic()))
    return [d for d in sink.deliveries(case) if d.at - first.at < ONE_NOTIFY_CALL_S]


def _history_has(incident_alerts: dict[str, Any], case: str, status: str) -> None:
    alert_id = incident_alerts["ids"][case]
    wait_until(lambda: any(h.get("status") == status for h in incident_alerts["alerts"].history_for(alert_id)),
               timeout=120, interval=5, msg=f"{case}: history never recorded {status}")


def _incident_opened(incident_alerts: dict[str, Any], case: str) -> None:
    alert_id = incident_alerts["ids"][case]

    def ours() -> list[dict]:
        resp = incident_alerts["alerts"]._v2("GET", "alerts/incidents?limit=1000")
        assert resp.status_code == 200, resp.text
        return [i for i in resp.json()["incidents"]
                if any(g.get("alert_id") == alert_id for g in i.get("alert_groups") or [])]

    incidents = wait_until(ours, timeout=120, interval=5, msg=f"{case}: no incident was opened for alert {alert_id}")
    # The one-shot seed recovers after a period, which auto-resolves the incident on a slow run.
    assert len(incidents) == 1, incidents
    assert incidents[0]["status"] in ("open", "resolved"), incidents


def test_incident_notification_failing_once_is_delivered_on_the_second_attempt(incident_alerts):
    call = _first_notify_call(incident_alerts, "flip")
    assert [d.status for d in call] == [500, 200], call
    _history_has(incident_alerts, "flip", "firing")
    _incident_opened(incident_alerts, "flip")


def test_incident_notification_failing_every_attempt_stops_after_the_retry_limit(incident_alerts):
    call = _first_notify_call(incident_alerts, "always500")
    assert [d.status for d in call] == [500] * MAX_ATTEMPTS, call
    _history_has(incident_alerts, "always500", "notify_failed")
    _incident_opened(incident_alerts, "always500")


def test_incident_notification_refused_with_4xx_is_not_retried(incident_alerts):
    call = _first_notify_call(incident_alerts, "refused400")
    assert [d.status for d in call] == [400], call
    _history_has(incident_alerts, "refused400", "notify_failed")
    _incident_opened(incident_alerts, "refused400")

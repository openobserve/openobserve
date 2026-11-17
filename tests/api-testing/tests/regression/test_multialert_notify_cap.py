"""openobserve#14407: groups over the per-evaluation notification cap (2 on this shard) are noted on a row that stays firing."""
from __future__ import annotations

import json
import re
from collections.abc import Generator
from typing import Any

import pytest

from helpers.webhook_sink import Delivery, WebhookSink
from support.client import OpenObserveClient
from support.wait import wait_until
from tests.alerts.multialert_helpers import AlertsClient, fast_eval, multi_alert, uniq

CAP = 2
CITIES = ("bangalore", "mumbai", "delhi")
SINK_PATH = "notify_cap"
NOTE = re.compile(
    rf"1 firing group\(s\) not notified, over the limit of {CAP} per evaluation "
    rf"\(ZO_ALERT_MAX_GROUP_NOTIFICATIONS_PER_EVAL\): city=({'|'.join(CITIES)})"
)
# Statuses a three-group firing could be misrecorded as; the first one is the capped evaluation.
FIRED_STATUSES = {"firing", "notify_failed", "suppressed", "pending"}
# Keeps the two delivered groups silenced, so the next evaluation cannot be mistaken for the first.
LONG_SILENCE_MIN = 30
# One evaluation's sends land within seconds; the next evaluation is a minute later.
ONE_EVALUATION_S = 30


@pytest.fixture(scope="module")
def cap_env(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    alerts = AlertsClient(client)
    sink = WebhookSink()
    template, destination = uniq("notify_cap_tmpl"), uniq("notify_cap_dest")
    created: dict[str, list[str]] = {"alerts": [], "streams": []}
    have = {"template": False, "destination": False}
    try:
        resp = alerts._v1("POST", "alerts/templates", json={
            "name": template, "type": "http", "title": "", "body": '{"text":"{alert_name} city={group.city}"}'})
        assert resp.status_code == 200, resp.text
        have["template"] = True
        resp = alerts._v1("POST", "alerts/destinations", json={
            "name": destination, "url": sink.url(SINK_PATH), "method": "post", "type": "http",
            "skip_tls_verify": False, "template": template, "headers": {}})
        assert resp.status_code == 200, resp.text
        have["destination"] = True
        yield {"alerts": alerts, "sink": sink, "destination": destination, "created": created}
    finally:
        try:
            alerts.delete_alerts(created["alerts"])
            if have["destination"]:
                alerts._v1("DELETE", f"alerts/destinations/{destination}")
            if have["template"]:
                alerts._v1("DELETE", f"alerts/templates/{template}")
            for stream in created["streams"]:
                client.streams.delete(stream)
        finally:
            sink.close()


def _searchable_stream(cap_env: dict[str, Any], prefix: str) -> str:
    alerts: AlertsClient = cap_env["alerts"]
    stream = uniq(prefix)
    cap_env["created"]["streams"].append(stream)
    resp = alerts.ingest(stream, [{"city": c, "latency": 900} for c in CITIES for _ in range(2)])
    assert resp.status_code == 200, resp.text

    def _all_cities():
        r = alerts._c.search.sql(f'SELECT COUNT(DISTINCT city) AS n FROM "{stream}"', minutes=10,
                                 raise_for_status=False)
        hits = r.json().get("hits", []) if r.status_code == 200 else []
        return hits and hits[0].get("n") == len(CITIES)

    wait_until(_all_cities, timeout=60, interval=2, msg=f"{stream}: all {len(CITIES)} cities searchable")
    return stream


def _create(cap_env: dict[str, Any], stream: str, destinations: list[str]) -> tuple[str, str]:
    name = uniq("notify_cap")
    payload = fast_eval(multi_alert(name), stream)
    payload["trigger_condition"]["silence"] = LONG_SILENCE_MIN
    payload["destinations"] = destinations
    resp = cap_env["alerts"].create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json().get("id")
    assert alert_id, f"create must return the new id: {resp.text}"
    cap_env["created"]["alerts"].append(alert_id)
    return name, alert_id


def _first_fired_row(alerts: AlertsClient, alert_id: str) -> dict:
    def _check():
        fired = [h for h in alerts.history_for(alert_id) if h.get("status") in FIRED_STATUSES]
        return fired[-1] if fired else None

    return wait_until(_check, timeout=180, interval=3, msg=f"alert {alert_id}: no firing evaluation in history")


def _groups_firing(alerts: AlertsClient, name: str) -> int | None:
    item = next((a for a in alerts.list_alerts() if a.get("name") == name), None)
    assert item, f"alert {name} must be listed"
    return item.get("groups_firing")


def _first_evaluation_sends(sink: WebhookSink) -> list[Delivery]:
    sent = wait_until(lambda: sink.deliveries(SINK_PATH), timeout=30, interval=1,
                      msg="the capped evaluation delivered nothing")
    return [d for d in sent if d.at - sent[0].at < ONE_EVALUATION_S]


def _delivered_city(delivery: Delivery, name: str) -> str:
    text = json.loads(delivery.body)["text"]
    assert text.startswith(f"{name} city="), f"a send for another alert reached the sink: {text!r}"
    return text.removeprefix(f"{name} city=")


def test_groups_over_the_cap_are_noted_on_a_row_that_stays_firing(cap_env):
    alerts: AlertsClient = cap_env["alerts"]
    stream = _searchable_stream(cap_env, "notify_cap_s")
    name, alert_id = _create(cap_env, stream, [cap_env["destination"]])

    row = _first_fired_row(alerts, alert_id)
    assert row["status"] == "firing", f"a group dropped by the cap is not a destination failing: {row}"
    error = row.get("error") or ""
    note = NOTE.fullmatch(error)
    assert note, f"the row must name the one group the cap dropped, and nothing else: {error!r}"
    dropped = note.group(1)

    sends = _first_evaluation_sends(cap_env["sink"])
    assert all(d.status == 200 for d in sends), [d.status for d in sends]
    delivered = sorted(_delivered_city(d, name) for d in sends)
    assert delivered == sorted(c for c in CITIES if c != dropped), (
        f"exactly the {CAP} groups the note does not name are notified; note names {dropped}, sent {delivered}"
    )
    assert _groups_firing(alerts, name) == len(CITIES), "the dropped group still counts as firing"


def test_an_alert_with_no_destination_over_the_cap_records_no_note(cap_env):
    alerts: AlertsClient = cap_env["alerts"]
    stream = _searchable_stream(cap_env, "notify_cap_nodest_s")
    name, alert_id = _create(cap_env, stream, [])

    row = _first_fired_row(alerts, alert_id)
    assert row["status"] == "firing", f"nowhere to send is not a delivery failure: {row}"
    assert not row.get("error"), f"no notification was owed, so no group went unnotified: {row}"
    assert _groups_firing(alerts, name) == len(CITIES), "all three groups fire"

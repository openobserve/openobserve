"""openobserve#16401 item 3 (openobserve#16606): re-enabling a firing multi-alert starts its groups fresh."""
from __future__ import annotations

import json
from collections.abc import Generator

import pytest

from helpers.webhook_sink import WebhookSink
from support.wait import wait_until
from tests.alerts.conftest import firing_starts, group_outcomes
from tests.alerts.multialert_helpers import fast_eval, multi_alert, uniq

CITIES = ("bangalore", "mumbai")


@pytest.fixture
def sink_destination(alerts, webhook_sink: WebhookSink) -> Generator[str, None, None]:
    template, destination = uniq("reenable_tmpl"), uniq("reenable_dest")
    body = '{"status":"{alert_status}","kind":"{notification_kind}","city":"{group.city}"}'
    assert alerts._v1("POST", "alerts/templates", json={
        "name": template, "type": "http", "title": "", "body": body}).status_code == 200
    assert alerts._v1("POST", "alerts/destinations", json={
        "name": destination, "url": webhook_sink.url(destination), "method": "post", "type": "http",
        "skip_tls_verify": False, "template": template, "headers": {}}).status_code == 200
    yield destination
    alerts.delete_alerts(alerts.created)
    alerts._v1("DELETE", f"alerts/destinations/{destination}")
    alerts._v1("DELETE", f"alerts/templates/{template}")


def _sent(webhook_sink: WebhookSink, destination: str) -> list[dict]:
    return [json.loads(d.body) for d in webhook_sink.deliveries(destination)]


def _set_enabled(alerts, alert_id: str, value: bool) -> None:
    resp = alerts._v2("PATCH", f"alerts/{alert_id}/enable?value={str(value).lower()}&type=logs&folder=default")
    assert resp.status_code == 200, resp.text


def test_re_enabling_a_firing_multi_alert_starts_fresh_and_sends_no_recovery(alerts, webhook_sink, sink_destination):
    """Re-enable resets group state, so the hour-long silence no longer hides the next firing."""
    stream = uniq("reenable_feed")

    def _feed():
        alerts.ingest(stream, [{"city": c, "latency": 900} for c in CITIES for _ in range(2)])

    _feed()
    name = uniq("reenable_multi")
    payload = fast_eval(multi_alert(name), stream)
    payload["trigger_condition"]["silence"] = 60
    payload["notify_on_recovery"] = True
    payload["destinations"] = [sink_destination]
    assert alerts.create_alert(payload).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)

    def _both_cities_sent():
        _feed()
        cities = {m["city"] for m in _sent(webhook_sink, sink_destination)}
        return cities if set(CITIES) <= cities else None

    wait_until(_both_cities_sent, timeout=180, interval=5, msg="both groups notified once")
    before = firing_starts(alerts, alert_id)
    assert len(before) == len(CITIES), before
    assert all(before.values()), before
    sent_before = len(_sent(webhook_sink, sink_destination))

    evaluated = group_outcomes(alerts, alert_id)

    def _evaluated_again():
        _feed()
        now = group_outcomes(alerts, alert_id)
        return now if all((now.get(k) or (None, 0))[1] > v[1] for k, v in evaluated.items()) else None

    wait_until(_evaluated_again, timeout=180, interval=5, msg="the scheduler evaluated the firing groups again")
    assert len(_sent(webhook_sink, sink_destination)) == sent_before, "the silence withholds repeats while enabled"

    _set_enabled(alerts, alert_id, False)
    _set_enabled(alerts, alert_id, True)

    def _paged_again():
        _feed()
        later = _sent(webhook_sink, sink_destination)[sent_before:]
        return later if set(CITIES) <= {m["city"] for m in later} else None

    wait_until(_paged_again, timeout=180, interval=5, msg="each group pages again inside the old silence window")
    after = firing_starts(alerts, alert_id)
    assert all(after.get(k) and after[k] > v for k, v in before.items()), (before, after)
    statuses = {m["status"] for m in _sent(webhook_sink, sink_destination)}
    assert statuses == {"firing"}, f"a still-firing group was resolved: {_sent(webhook_sink, sink_destination)}"

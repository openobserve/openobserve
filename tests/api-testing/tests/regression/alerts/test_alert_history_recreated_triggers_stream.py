"""openobserve#16741 (o2-enterprise#3502): alert history keeps answering after the org's triggers stream is deleted and re-created."""
from __future__ import annotations

import uuid

from support.client import OpenObserveClient
from support.wait import wait_until
from tests.alerts.multialert_helpers import DEST, SINK, STREAM, TMPL, AlertsClient, fast_eval, simple_alert, uniq


def _history(alerts: AlertsClient, alert_id: str):
    return alerts._v2("GET", "alerts/history", params={"alert_id": alert_id, "size": 50})


def _triggers_stream(alerts: AlertsClient) -> bool:
    resp = alerts._v1("GET", "streams", params={"type": "logs"})
    return any(s.get("name") == "triggers" for s in (resp.json().get("list") or [])) if resp.status_code == 200 else False


def test_alert_history_answers_after_the_triggers_stream_is_re_created(client: OpenObserveClient):
    """Pre-fix the re-created stream lacked the columns of unset fields, so history was a 500 until a restart."""
    # Its own org: deleting the shared org's triggers stream would break other tests' history.
    alerts = AlertsClient(client, org=f"hist_recreate_{uuid.uuid4().hex[:8]}")
    stream = uniq("hist_recreate")
    alert_id = None
    try:
        assert alerts.ingest(stream, [{"city": "pune", "latency": 1}] * 3).status_code == 200
        alerts.seed_alert_fixtures()
        name = uniq("hist_recreate_alert")
        resp = alerts.create_alert(fast_eval(simple_alert(name), stream))
        assert resp.status_code == 200, resp.text
        alert_id = alerts.find_alert_id(name)
        wait_until(lambda: alerts.history_for(alert_id), timeout=180, interval=5, msg="the alert wrote history")

        resp = alerts._v1("DELETE", "streams/triggers", params={"type": "logs"})
        assert resp.status_code == 200, resp.text
        wait_until(lambda: not _triggers_stream(alerts) or None, timeout=60, interval=2, msg="the triggers stream is gone")
        alerts.ingest(stream, [{"city": "pune", "latency": 1}] * 3)
        wait_until(lambda: _triggers_stream(alerts) or None, timeout=180, interval=5, msg="the next run re-creates the triggers stream")

        def answered():
            resp = _history(alerts, alert_id)
            assert resp.status_code == 200, resp.text
            return resp.json()["hits"] or None

        hits = wait_until(answered, timeout=120, interval=5, msg="history lists the run written after the re-create")
        assert all(h.get("alert_id") == alert_id for h in hits), hits
    finally:
        _clean_org(client, alerts, alert_id, stream)


def _clean_org(client: OpenObserveClient, alerts: AlertsClient, alert_id: str | None, stream: str) -> None:
    # The server has no org delete endpoint, so the emptied org itself stays behind.
    # Alert before destination before template: each delete is refused while something still names it.
    alerts.delete_alerts([alert_id])
    alerts._v1("DELETE", f"alerts/destinations/{DEST}")
    alerts._v1("DELETE", f"alerts/templates/{TMPL}")
    for name in (stream, STREAM, SINK, "triggers"):
        client.streams.delete(name, org=alerts.org)

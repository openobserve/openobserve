"""openobserve#16712: the template list with include_usage carries each template's Used by counts, as GET template does."""
from __future__ import annotations

from support.client import OpenObserveClient
from tests.alerts.multialert_helpers import AlertsClient, fast_eval, simple_alert, uniq
from tests.alerts.test_composite_alerts import _composite_payload


def test_the_template_list_with_include_usage_counts_destination_and_composite_use(client: OpenObserveClient):
    """Pre-fix the list ignored include_usage, so a template bound only to a composite read as unused."""
    alerts = AlertsClient(client)
    used, idle = uniq("tmpl_usage_used"), uniq("tmpl_usage_idle")
    destination = uniq("tmpl_usage_dest")
    stream = uniq("tmpl_usage_s")
    alert_ids: list[str] = []
    try:
        for name in (used, idle):
            resp = alerts._v1("POST", "alerts/templates", json={"name": name, "type": "http", "title": "", "body": '{"text": "{alert_name}"}'})
            assert resp.status_code == 200, resp.text
        resp = alerts._v1("POST", "alerts/destinations", json={
            "name": destination, "url": "http://127.0.0.1:9/never", "method": "post", "type": "http",
            "skip_tls_verify": False, "template": used, "headers": {}})
        assert resp.status_code == 200, resp.text
        alerts.ingest(stream, [{"level": "error"}])
        for _ in range(2):
            child = fast_eval(simple_alert(uniq("tmpl_usage_child")), stream)
            child.update(destinations=[destination], enabled=False)
            assert alerts.create_alert(child).status_code == 200
            alert_ids.append(alerts.find_alert_id(child["name"]))
        composite = _composite_payload(name=uniq("tmpl_usage_cmp"), child_ids=alert_ids, template=used)
        resp = alerts.create_alert(composite)
        assert resp.status_code == 200, resp.text
        alert_ids.insert(0, alerts.find_alert_id(composite["name"]))

        resp = alerts._v1("GET", "alerts/templates", params={"include_usage": "true"})
        assert resp.status_code == 200, resp.text
        rows = {t["name"]: t for t in resp.json() if t["name"] in (used, idle)}
        assert set(rows) == {used, idle}, rows
        single = alerts._v1("GET", f"alerts/templates/{used}").json()["used_by"]
        assert rows[used]["used_by"] == single, (rows[used], single)
        assert rows[used]["used_by"]["destinations"] >= 1, rows[used]
        assert rows[used]["used_by"]["composites"] >= 1, rows[used]
        assert not any(v for v in rows[idle]["used_by"].values() if isinstance(v, int)), rows[idle]
    finally:
        alerts.delete_alerts(alert_ids)
        alerts._v1("DELETE", f"alerts/destinations/{destination}")
        for name in (used, idle):
            alerts._v1("DELETE", f"alerts/templates/{name}")
        client.streams.delete(stream)

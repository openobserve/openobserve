"""o2-enterprise#3571 (openobserve#16887): a quote breakout in the alert history status filter matches no rows."""
from __future__ import annotations

from support.wait import wait_until
from tests.alerts.multialert_helpers import fast_eval, simple_alert, uniq

SQL_BREAKOUT = r"x\' OR 1=1 --"


def test_status_filter_with_a_quote_breakout_matches_no_rows(alerts):
    """A `\\'` in ?status= must stay inside the literal, not turn the filter into OR 1=1."""
    stream = uniq("history_quote")
    alerts.ingest(stream, [{"city": "pune", "latency": 1}] * 3)
    name = uniq("history_quote_alert")
    assert alerts.create_alert(fast_eval(simple_alert(name), stream)).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)
    rows = wait_until(lambda: alerts.history_for(alert_id), timeout=180, interval=5, msg="the alert wrote history")
    status = rows[0]["status"]

    seen = alerts._v2("GET", "alerts/history", params={"status": status, "alert_id": alert_id, "size": 50})
    assert seen.status_code == 200, seen.text
    assert any(h.get("alert_id") == alert_id for h in seen.json()["hits"]), "the status filter finds the seeded row"

    for params in ({"status": SQL_BREAKOUT}, {"status": SQL_BREAKOUT, "alert_id": alert_id}):
        resp = alerts._v2("GET", "alerts/history", params={**params, "size": 50})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["hits"] == [], f"{params} leaked rows: {body['hits'][:3]}"
        assert body["total"] == 0, params

"""openobserve#16561 P1-2 (openobserve#16591): a recovery destination the org lacks is refused on create and update."""
from __future__ import annotations

from support.client import OpenObserveClient
from support.factories import unique_name
from tests.alerts.test_v2 import _alert_payload, _get_alert_until


def test_missing_recovery_destination_is_refused_on_create_and_update(
    client: OpenObserveClient, temp_alert_prereqs: dict[str, str]
):
    """Refused like a missing firing destination, and an update keeps the saved recovery destination."""
    missing = unique_name("pyt_no_such_dest")
    alert_name = unique_name("pyt_recovery")
    payload = _alert_payload(
        name=alert_name,
        folder_id=temp_alert_prereqs["folder_id"],
        template=temp_alert_prereqs["template_name"],
        destination=temp_alert_prereqs["destination_name"],
    )
    payload["notify_on_recovery"] = True
    payload["recovery_destinations"] = [missing]

    resp = client.post("alerts", prefix="api/v2/", json=payload)
    assert resp.status_code == 404, f"{resp.status_code}: {resp.text}"
    assert f"Alert destination {missing} not found" in resp.json()["message"]
    assert alert_name not in [a.get("name") for a in client.alerts.list()], "the refused alert was not saved"

    payload["recovery_destinations"] = [temp_alert_prereqs["destination_name"]]
    resp = client.post("alerts", prefix="api/v2/", json=payload)
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
    alert_id = resp.json()["id"]
    try:
        body = _get_alert_until(
            client, alert_id, lambda b: bool(b.get("recovery_destinations")), msg="recovery destination saved"
        )
        body["recovery_destinations"] = [missing]
        resp = client.put(f"alerts/{alert_id}", prefix="api/v2/", json=body)
        assert resp.status_code == 404, f"{resp.status_code}: {resp.text}"
        assert f"Alert destination {missing} not found" in resp.json()["message"]
        kept = client.get(f"alerts/{alert_id}", prefix="api/v2/").json()["recovery_destinations"]
        assert kept == [temp_alert_prereqs["destination_name"]], kept
    finally:
        client.delete(f"alerts/{alert_id}", prefix="api/v2/")

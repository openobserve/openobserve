"""o2-enterprise#3385 items 1-3 (openobserve#16421): delete and save guards count recovery destinations and composites."""
from __future__ import annotations

from typing import Any

from support.client import OpenObserveClient
from support.factories import unique_name
from tests.alerts.multialert_helpers import uniq
from tests.alerts.test_composite_alerts import _composite_payload, _create_composite, _delete_best_effort, _list
from tests.alerts.test_v2 import _alert_payload


def test_a_recovery_only_destination_cannot_be_deleted(client: OpenObserveClient, make_destination, template_name):
    """Item 1: a destination named only in recovery_destinations still counts as in use."""
    firing = make_destination()
    recovery = make_destination()
    alert_name = uniq("e2e_3385_recovery")
    payload = _alert_payload(
        name=alert_name, folder_id="default", template=template_name, destination=firing, enabled=False
    )
    payload["notify_on_recovery"] = True
    payload["recovery_destinations"] = [recovery]
    resp = client.post("alerts?folder=default", prefix="api/v2/", json=payload, raise_for_status=False)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json()["id"]
    try:
        refused = client.delete(f"alerts/destinations/{recovery}", raise_for_status=False)
        assert refused.status_code == 409, refused.text
        assert alert_name in refused.json()["message"], refused.text
        assert client.alerts.get_destination(recovery).status_code == 200, "the destination survived"
    finally:
        client.delete(f"alerts/{alert_id}", prefix="api/v2/", raise_for_status=False)


def test_alert_folder_holding_only_a_composite_is_not_deleted(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    """Item 2: the folder delete guard counts composites, not just plain alerts."""
    response = client.post(
        "folders/alerts", prefix="api/v2/", json={"name": unique_name("cmp_only_folder"), "description": "x"}
    )
    assert response.status_code == 200, response.text
    folder_id = response.json()["folderId"]
    composite_id = None
    try:
        composite_id = _create_composite(
            client,
            folder_id,
            _composite_payload(name=unique_name("cmp_in_folder"), child_ids=composite_prereqs["child_ids"][:2]),
        )
        refused = client.delete(f"folders/alerts/{folder_id}", prefix="api/v2/")
        assert refused.status_code == 400, refused.text
        assert "Folder contains alerts" in refused.json()["message"], refused.text
        assert client.get(f"alerts/{composite_id}", prefix="api/v2/").status_code == 200, "the composite survived"
    finally:
        if composite_id is not None:
            _delete_best_effort(client, composite_id)
        client.delete(f"folders/alerts/{folder_id}", prefix="api/v2/")


def test_composite_with_a_missing_destination_or_template_is_not_saved(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    """Item 3: a composite gets the same missing destination/template refusal as a plain alert."""
    missing = unique_name("cmp_missing")
    children = composite_prereqs["child_ids"][:2]
    cases = [
        ({"destination": missing}, f"Alert destination {missing} not found"),
        ({"destination": composite_prereqs["destination"], "template": missing}, f"Alert template {missing} not found"),
    ]
    for overrides, message in cases:
        name = unique_name("cmp_missing_ref")
        response = client.post(
            f"alerts?folder={composite_prereqs['folder_id']}",
            prefix="api/v2/",
            json=_composite_payload(name=name, child_ids=children, **overrides),
        )
        if response.status_code == 200:
            _delete_best_effort(client, response.json()["id"])
        assert response.status_code == 404, response.text
        assert message in response.json()["message"], response.text
        assert name not in [row.get("name") for row in _list(client)], f"{overrides} saved anyway"

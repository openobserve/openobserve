"""o2-enterprise#3431 B41 (openobserve#16710): template guards never name another org's bindings to a non-root admin."""
from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.factories import user_payload
from support.wait import wait_until
from tests.alerts.multialert_helpers import uniq
from tests.alerts.test_templates_api import _body
from tests.alerts.test_v2 import _alert_payload


@pytest.fixture
def shared_template_bound_elsewhere(client: OpenObserveClient, temp_user_email: str):
    """A `default` template that a destination and an alert of another org name, plus a non-root default admin."""
    other_org = uniq("e2e_3431_org")
    stream = uniq("e2e_3431_seed")
    template = uniq("e2e_3431_tpl")
    destination = uniq("e2e_3431_secret_dest")
    alert_id = None
    try:
        assert client.post(f"{stream}/_json", org=other_org, json=[{"level": "info"}]).status_code == 200
        assert client.alerts.create_template({"name": template, **_body("{alert_name}")}).status_code == 200
        dest = {
            "name": destination, "url": "http://localhost:1/x", "method": "post", "template": template, "type": "http",
        }
        resp = client.alerts.create_destination(dest, org=other_org)
        assert resp.status_code == 200, "a shared template binds anywhere"
        alert_name = uniq("e2e_3431_secret_alert")
        alert = _alert_payload(
            name=alert_name, folder_id="default", template=template, destination=destination, stream_name=stream,
            enabled=False,
        )
        alert["template"] = template
        resp = client.post("alerts?folder=default", org=other_org, prefix="api/v2/", json=alert)
        assert resp.status_code == 200, resp.text
        alert_id = resp.json()["id"]
        assert client.users.create(user_payload(email=temp_user_email, role="admin")).status_code == 200
        admin = OpenObserveClient(email=temp_user_email, password="Complexpass#123")
        yield {"template": template, "destination": destination, "alert": alert_name, "admin": admin}
    finally:
        if alert_id:
            client.delete(f"alerts/{alert_id}", org=other_org, prefix="api/v2/")
        client.alerts.delete_destination(destination, org=other_org)
        client.streams.delete(stream, org=other_org)
        wait_until(
            lambda: client.alerts.delete_template(template).status_code in (200, 404), timeout=10, msg="template deleted"
        )


def test_template_guards_hide_another_orgs_binding_names_from_a_non_root_admin(
    client: OpenObserveClient, shared_template_bound_elsewhere
):
    """A default admin learns a count, never the other org's destination or alert name; root still sees it."""
    bound = shared_template_bound_elsewhere
    admin, template = bound["admin"], bound["template"]
    secrets = (bound["destination"], bound["alert"])

    single = admin.delete(f"alerts/templates/{template}")
    bulk = admin.delete("alerts/templates/bulk", json={"ids": [template]})
    existing = admin.get(f"alerts/templates/{template}").json()
    narrowed = admin.put(f"alerts/templates/{template}", json={**existing, "applies_to": ["anomaly"]})
    assert single.status_code == 409, single.text
    assert bulk.json()["unsuccessful"] == [template], bulk.text
    assert narrowed.status_code == 400, narrowed.text
    for text in (single.json()["message"], bulk.json()["err"], narrowed.json()["message"]):
        assert "1 in another organization" in text, text
        assert not any(secret in text for secret in secrets), text

    root_view = client.put(f"alerts/templates/{template}", json={**existing, "applies_to": ["anomaly"]})
    assert root_view.status_code == 400, root_view.text
    assert bound["alert"] in root_view.json()["message"], "root still sees the binding it must remove"

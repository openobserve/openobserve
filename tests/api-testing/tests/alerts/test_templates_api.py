"""Alert templates API contract: get, update, delete, bulk delete, system prebuilt and preview  [#14427]."""
from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import uniq


def _body(text: str) -> dict:
    return {"body": f'{{"text":"{text}"}}', "type": "http", "title": ""}


@pytest.fixture
def make_template(client: OpenObserveClient):
    created: list[str] = []

    def _make(text: str = "{alert_name}") -> str:
        name = uniq("e2e_14427_tpl")
        client.alerts.create_template({"name": name, **_body(text)})
        created.append(name)
        return name

    yield _make
    for name in created:
        client.alerts.delete_template(name)


def test_get_template_returns_saved_definition(client: OpenObserveClient, make_template):
    name = make_template(text="{alert_name} v1")
    resp = client.get(f"alerts/templates/{name}", raise_for_status=False)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == name
    assert body["body"] == '{"text":"{alert_name} v1"}'
    assert body["type"] == "http"
    assert body["isPrebuilt"] is False


def test_get_unknown_template_is_404(client: OpenObserveClient):
    resp = client.get(f"alerts/templates/{uniq('e2e_14427_missing')}", raise_for_status=False)

    assert resp.status_code == 404, resp.text
    assert "not found" in resp.json()["message"].lower()


def test_update_template_persists_new_body(client: OpenObserveClient, make_template):
    name = make_template(text="{alert_name} v1")
    resp = client.put(
        f"alerts/templates/{name}", json={"name": name, **_body("{alert_name} v2")}, raise_for_status=False
    )
    assert resp.status_code == 200, resp.text

    wait_until(
        lambda: client.get(f"alerts/templates/{name}", raise_for_status=False).json().get("body")
        == '{"text":"{alert_name} v2"}',
        timeout=5,
        msg="updated body visible",
    )


def test_delete_template_removes_it(client: OpenObserveClient, make_template):
    name = make_template()
    resp = client.alerts.delete_template(name)
    assert resp.status_code == 200, resp.text

    wait_until(
        lambda: client.get(f"alerts/templates/{name}", raise_for_status=False).status_code == 404,
        timeout=5,
        msg="template gone",
    )


def test_delete_unknown_template_is_404(client: OpenObserveClient):
    resp = client.alerts.delete_template(uniq("e2e_14427_missing"))

    assert resp.status_code == 404, resp.text


def test_bulk_delete_reports_successes_and_failures_separately(client: OpenObserveClient, make_template):
    keep_going = make_template()
    ghost = uniq("e2e_14427_ghost")
    resp = client.delete("alerts/templates/bulk", json={"ids": [keep_going, ghost]}, raise_for_status=False)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["successful"] == [keep_going]
    assert body["unsuccessful"] == [ghost]
    assert "not found" in (body.get("err") or "").lower()
    wait_until(
        lambda: client.get(f"alerts/templates/{keep_going}", raise_for_status=False).status_code == 404,
        timeout=5,
        msg="template gone",
    )


def test_system_templates_are_prebuilt_and_non_empty(client: OpenObserveClient):
    resp = client.get("alerts/templates/system/prebuilt", raise_for_status=False)

    assert resp.status_code == 200, resp.text
    templates = resp.json()
    assert templates, "expected at least one prebuilt template"
    assert all(t["isPrebuilt"] is True for t in templates)
    assert all(t["name"].startswith("prebuilt_") for t in templates)
    assert {"prebuilt_slack", "prebuilt_msteams"} <= {t["name"] for t in templates}


def test_preview_renders_slack_payload_from_draft(client: OpenObserveClient):
    resp = client.post(
        "alerts/templates/preview",
        json={"definition": {"title": "{alert_name} fired", "body": "hello {alert_name}"}, "channel": "slack"},
        raise_for_status=False,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "attachments" in body["payload"]
    assert "hello" in body["preview_model"]["body_html"]
    assert "{alert_name}" not in resp.text, "placeholders must be resolved against the sample"


@pytest.mark.parametrize(
    ("override", "needle"),
    [({"channel": "bogus"}, "unknown channel"), ({"severity": "bogus"}, "unknown severity")],
)
def test_preview_rejects_unknown_channel_and_severity(client: OpenObserveClient, override, needle):
    payload = {"definition": {"title": "x", "body": "y"}, "channel": "slack", **override}
    resp = client.post("alerts/templates/preview", json=payload, raise_for_status=False)

    assert resp.status_code == 400, resp.text
    assert needle in resp.json()["message"]


def test_preview_without_definition_is_rejected_as_malformed(client: OpenObserveClient):
    resp = client.post("alerts/templates/preview", json={"channel": "slack"}, raise_for_status=False)

    assert resp.status_code == 422, resp.text

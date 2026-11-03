"""Alert destinations API contract: update, bulk delete, prebuilt list, test_send validation  [#14427]."""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import uniq

log = logging.getLogger("o2-api")


@pytest.fixture
def template_name(client: OpenObserveClient):
    name = uniq("e2e_14427_dtpl")
    client.alerts.create_template({"name": name, "body": '{"text":"{alert_name}"}', "type": "http", "title": ""})
    yield name
    # Template delete returns 409 until the destination cache drops its reference.
    try:
        wait_until(
            lambda: client.alerts.delete_template(name).status_code in (200, 404),
            timeout=5,
            msg="template deletable",
        )
    except AssertionError:
        log.warning("cleanup: could not delete template %s", name)


@pytest.fixture
def make_destination(client: OpenObserveClient, template_name: str):
    created: list[str] = []

    def _make(url: str = "http://localhost:1/sink") -> str:
        name = uniq("e2e_14427_dest")
        client.alerts.create_destination(_dest(name, template_name, url))
        created.append(name)
        return name

    yield _make
    for name in created:
        client.alerts.delete_destination(name)


def _dest(name: str, template: str, url: str) -> dict:
    return {"name": name, "url": url, "method": "post", "template": template, "type": "http", "headers": {}}


def test_update_destination_persists_new_url(client: OpenObserveClient, make_destination, template_name):
    name = make_destination("http://localhost:1/before")
    resp = client.put(
        f"alerts/destinations/{name}",
        json=_dest(name, template_name, "http://localhost:1/after"),
        raise_for_status=False,
    )
    assert resp.status_code == 200, resp.text

    wait_until(
        lambda: client.alerts.get_destination(name).json().get("url")
        == "http://localhost:1/after",
        timeout=5,
        msg="updated url visible",
    )


def test_update_unknown_destination_is_rejected(client: OpenObserveClient, template_name):
    name = uniq("e2e_14427_ghost")
    resp = client.put(
        f"alerts/destinations/{name}", json=_dest(name, template_name, "http://localhost:1/x"), raise_for_status=False
    )

    assert resp.status_code == 404, resp.text
    assert client.alerts.get_destination(name).status_code == 404


def test_bulk_delete_reports_successes_and_failures_separately(client: OpenObserveClient, make_destination):
    real = make_destination()
    ghost = uniq("e2e_14427_ghost")
    resp = client.delete("alerts/destinations/bulk", json={"ids": [real, ghost]}, raise_for_status=False)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["successful"] == [real]
    assert body["unsuccessful"] == [ghost]
    assert "not found" in (body.get("err") or "").lower()
    wait_until(
        lambda: client.alerts.get_destination(real).status_code == 404,
        timeout=5,
        msg="destination gone",
    )


def test_prebuilt_destinations_ship_a_known_set(client: OpenObserveClient):
    resp = client.get("alerts/destinations/prebuilt", raise_for_status=False)

    assert resp.status_code == 200, resp.text
    prebuilt = resp.json()
    assert prebuilt, "expected prebuilt destinations"
    names = [d["name"].lower() for d in prebuilt]
    assert any("slack" in n for n in names), names
    assert any("teams" in n for n in names), names
    assert all(d["template"].startswith("prebuilt_") for d in prebuilt if d["type"] == "http")


def test_test_send_validation_arms(client: OpenObserveClient, make_destination):
    """All four validation arms of test_send, sharing one destination."""
    dest = make_destination()
    url = f"alerts/destinations/{dest}/test_send"
    ghost = uniq("e2e_14427_ghost")
    draft = {"title": "a", "body": "b"}
    neither = client.post(url, json={}, raise_for_status=False)
    both = client.post(url, json={"template_name": "x", "definition": draft}, raise_for_status=False)
    no_template = client.post(url, json={"template_name": ghost}, raise_for_status=False)
    no_dest = client.post(f"alerts/destinations/{ghost}/test_send", json={"definition": draft}, raise_for_status=False)

    assert neither.status_code == 400, neither.text
    assert "exactly one" in neither.json()["message"].lower()
    assert both.status_code == 400, both.text
    assert "not both" in both.json()["message"]
    assert no_template.status_code == 404, no_template.text
    assert no_dest.status_code == 404, no_dest.text

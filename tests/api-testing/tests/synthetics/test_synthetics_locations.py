"""Probe locations: the public row a check is saved against, its lifecycle, and the edition rule for private rows."""

from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import synthetics_check_payload, synthetics_location_id, synthetics_location_payload, unique_name

ENTERPRISE_BUILDS = ("enterprise", "cloud")


@pytest.fixture
def location_id(client: OpenObserveClient) -> Generator[str, None, None]:
    lid = synthetics_location_id()
    yield lid
    client.synthetics.delete_location(lid)


def test_public_location_create_get_list_and_duplicate(client: OpenObserveClient, location_id: str):
    created = client.synthetics.create_location(synthetics_location_payload(location_id, label="Created"))
    assert created.status_code == 200, created.text
    row = created.json()["location"]
    assert row["id"] == location_id
    assert row["kind"] == "public"
    assert row["org_id"] is None
    assert row["pool"] == f"net-{location_id}"
    assert row["enabled"] is True

    got = client.synthetics.get_location(location_id)
    assert got.status_code == 200, got.text
    assert got.json()["label"] == "Created"
    assert got.json()["kind"] == "public"

    listed = client.synthetics.list_locations()
    assert listed.status_code == 200, listed.text
    assert location_id in {loc["id"] for loc in listed.json()["locations"]}

    again = client.synthetics.create_location(synthetics_location_payload(location_id, label="Again"))
    assert again.status_code == 400, again.text
    assert again.json()["message"] == f'validation: location "{location_id}" already exists'
    assert client.synthetics.get_location(location_id).json()["label"] == "Created"


def test_location_update_keeps_enabled_unless_sent(client: OpenObserveClient, location_id: str):
    assert client.synthetics.create_location(synthetics_location_payload(location_id)).status_code == 200

    disabled = client.synthetics.update_location(location_id, {"label": "Off", "enabled": False})
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["enabled"] is False

    relabelled = client.synthetics.update_location(location_id, {"label": "Renamed"})
    assert relabelled.status_code == 200, relabelled.text
    assert relabelled.json()["label"] == "Renamed"
    assert relabelled.json()["enabled"] is False


def test_location_in_use_cannot_be_deleted_until_its_checks_are_gone(client: OpenObserveClient, location_id: str):
    assert client.synthetics.create_location(synthetics_location_payload(location_id)).status_code == 200
    created = client.synthetics.create(synthetics_check_payload("tcp", location_id))
    assert created.status_code == 200, created.text
    check_id = created.json()["id"]

    try:
        refused = client.synthetics.delete_location(location_id)
        assert refused.status_code == 400, refused.text
        assert refused.json()["message"] == (
            f'validation: location "{location_id}" is referenced by 1 synthetic(s) — remove it from them first'
        )
        assert client.synthetics.get_location(location_id).status_code == 200
    finally:
        client.synthetics.delete(check_id)

    deleted = client.synthetics.delete_location(location_id)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"deleted": True}
    assert client.synthetics.get_location(location_id).status_code == 404


def test_private_location_follows_the_edition(client: OpenObserveClient):
    config = client.get("config")
    assert config.status_code == 200, config.text
    region = unique_name("apitest-private").replace("_", "-")

    resp = client.synthetics.create_location({"kind": "private", "region": region, "label": "API test private"})
    if resp.ok:
        client.synthetics.delete_location(resp.json()["location"]["id"])

    if config.json()["build_type"] in ENTERPRISE_BUILDS:
        assert resp.status_code == 200, resp.text
        row = resp.json()["location"]
        assert row["kind"] == "private"
        assert row["org_id"] == client.org
        assert row["pool"] == f"private-{client.org}-{region}"
    else:
        assert resp.status_code == 400, resp.text
        assert resp.json()["message"].startswith("validation: private locations require enterprise")


def test_unknown_location_kind_is_a_validation_error(client: OpenObserveClient):
    resp = client.synthetics.create_location({"kind": "hybrid", "region": "r1", "label": "API test"})
    if resp.ok:
        client.synthetics.delete_location(resp.json()["location"]["id"])

    assert resp.status_code == 400, resp.text
    assert resp.json()["message"] == 'validation: invalid kind "hybrid"'

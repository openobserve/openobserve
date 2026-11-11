"""Shared variables and environments: reserved names, empty values, and secrets that are never read back."""

from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name


def var_name(prefix: str) -> str:
    return unique_name(prefix).upper()


@pytest.fixture
def environment(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("apitest-env").replace("_", "-")
    resp = client.synthetics.create_environment({"name": name, "description": "API test"})
    assert resp.status_code == 200, resp.text
    yield name
    for var in client.synthetics.list_environment_variables(name).json():
        client.synthetics.delete_environment_variable(name, var["id"])
    client.synthetics.delete_environment(name)


@pytest.fixture
def global_variable_ids(client: OpenObserveClient) -> Generator[list[str], None, None]:
    ids: list[str] = []
    yield ids
    for variable_id in ids:
        client.synthetics.delete_variable(variable_id)


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("global", "name: 'global' is reserved for the environment every org already has"),
        ("GLOBAL", "name: 'global' is reserved for the environment every org already has"),
        ("_hidden", "name: must not start with '_' — that prefix is reserved for OpenFGA wildcards"),
        ("has space", "name: invalid name 'has space' (letters, digits, '_' and '-' only)"),
    ],
)
def test_reserved_or_malformed_environment_name_is_refused(client: OpenObserveClient, name: str, message: str):
    resp = client.synthetics.create_environment({"name": name})
    if resp.ok and not resp.json().get("is_global"):
        client.synthetics.delete_environment(resp.json()["name"])

    assert resp.status_code == 400, resp.text
    assert resp.json()["message"] == message


def restore_global_variables(client: OpenObserveClient, saved: list[dict]) -> None:
    client.synthetics.list_environments()
    present = {v["name"] for v in client.synthetics.list_variables().json()}
    for var in saved:
        if var["name"] not in present:
            client.synthetics.create_variable(
                {k: var[k] for k in ("name", "value", "description", "example", "tags")}
            )


def test_every_org_has_a_global_environment_that_cannot_be_deleted(client: OpenObserveClient):
    envs = client.synthetics.list_environments()
    assert envs.status_code == 200, envs.text
    assert [e["name"] for e in envs.json() if e["is_global"]] == ["global"]
    saved = client.synthetics.list_variables()
    assert saved.status_code == 200, saved.text

    resp = client.synthetics.delete_environment("global")

    if resp.ok:
        # Global variables are plain, so a wrongly allowed delete can be undone from the snapshot.
        restore_global_variables(client, saved.json())
    assert resp.status_code == 409, resp.text
    assert resp.json()["message"].startswith("the 'global' environment cannot be deleted")


def test_environment_create_list_duplicate_and_delete(client: OpenObserveClient):
    name = unique_name("apitest-env").replace("_", "-")
    created = client.synthetics.create_environment({"name": name, "description": "first"})
    assert created.status_code == 200, created.text
    try:
        assert created.json()["name"] == name
        assert created.json()["is_global"] is False
        listed = {e["name"]: e for e in client.synthetics.list_environments().json()}
        assert listed[name]["description"] == "first"

        again = client.synthetics.create_environment({"name": name})
        assert again.status_code == 409, again.text
        assert again.json()["message"] == f"environment '{name}' already exists in this org"
    finally:
        deleted = client.synthetics.delete_environment(name)
    assert deleted.status_code == 200, deleted.text
    assert name not in {e["name"] for e in client.synthetics.list_environments().json()}


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"value": ""}, "value: must not be empty"),
        ({"value": "   "}, "value: must not be empty"),
        ({}, "value: must be set when the variable has no stored value"),
        ({"value": "s3cret", "kind": "secret"}, "kind: a secret cannot live in the 'global' environment"),
    ],
    ids=["empty", "whitespace", "missing", "secret-in-global"],
)
def test_global_variable_without_a_usable_value_is_refused(
    client: OpenObserveClient, global_variable_ids: list[str], body: dict, message: str
):
    name = var_name("APITEST_REFUSED")

    resp = client.synthetics.create_variable({"name": name, **body})
    if resp.ok:
        global_variable_ids.append(resp.json()["id"])

    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith(message), resp.text
    assert name not in {v["name"] for v in client.synthetics.list_variables().json()}


def test_reserved_credential_prefix_is_refused_as_a_variable_name(
    client: OpenObserveClient, global_variable_ids: list[str]
):
    resp = client.synthetics.create_variable({"name": "_auth_token", "value": "x"})
    if resp.ok:
        global_variable_ids.append(resp.json()["id"])

    assert resp.status_code == 400, resp.text
    assert resp.json()["message"] == "name: '_AUTH_' is reserved for credentials the probe injects itself"


def test_plain_global_variable_round_trips_its_value(client: OpenObserveClient, global_variable_ids: list[str]):
    name = var_name("APITEST_PLAIN")
    created = client.synthetics.create_variable({"name": name, "value": "one"})
    assert created.status_code == 200, created.text
    global_variable_ids.append(created.json()["id"])
    assert created.json()["kind"] == "plain"
    assert created.json()["value"] == "one"

    updated = client.synthetics.update_variable(created.json()["id"], {"name": name, "value": "two"})
    assert updated.status_code == 200, updated.text

    listed = {v["name"]: v for v in client.synthetics.list_variables().json()}
    assert listed[name]["value"] == "two"
    assert listed[name]["has_value"] is True

    cleared = client.synthetics.update_variable(created.json()["id"], {"name": name, "value": ""})
    assert cleared.status_code == 400, cleared.text
    assert {v["name"]: v for v in client.synthetics.list_variables().json()}[name]["value"] == "two"


def test_environment_secret_is_write_only(client: OpenObserveClient, environment: str):
    name = var_name("APITEST_SECRET")
    secret = unique_name("secret-value")
    created = client.synthetics.create_environment_variable(
        environment, {"name": name, "value": secret, "kind": "secret"}
    )
    assert created.status_code == 200, created.text
    assert created.json()["has_value"] is True
    assert "value" not in created.json()
    variable_id = created.json()["id"]

    listed = client.synthetics.list_environment_variables(environment)
    assert listed.status_code == 200, listed.text
    assert secret not in listed.text
    assert secret not in client.synthetics.list_environments().text

    kept = client.synthetics.update_environment_variable(environment, variable_id, {"name": name, "description": "d"})
    assert kept.status_code == 200, kept.text
    assert kept.json()["has_value"] is True
    assert kept.json()["description"] == "d"

    emptied = client.synthetics.update_environment_variable(environment, variable_id, {"name": name, "value": ""})
    assert emptied.status_code == 400, emptied.text
    assert emptied.json()["message"] == "value: must not be empty"

    retyped = client.synthetics.update_environment_variable(
        environment, variable_id, {"name": name, "kind": "plain", "value": "x"}
    )
    assert retyped.status_code == 400, retyped.text
    assert retyped.json()["message"] == "kind: a variable's kind is fixed when it is created; this one is stored as a secret"

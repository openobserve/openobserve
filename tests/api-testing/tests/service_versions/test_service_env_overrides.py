"""Env overrides, the env options list and the unresolved-services list, over spans seeded by this module."""
from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .svcver_helpers import (
    OVERRIDES,
    REGISTRY_POLL,
    REGISTRY_TIMEOUT,
    ingest,
    list_versions,
    overrides_for,
    resource_spans,
    service_override,
    uniq,
    unversioned,
    wait_for_versions,
)

pytestmark = pytest.mark.enterprise

VERSION = "3.0.0"


@pytest.fixture(scope="module")
def seeded(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """A versioned prod service in its own namespace, and one without a version; overrides left behind are removed."""
    service, unversioned = uniq("svcver-ovr"), uniq("svcver-nover")
    namespace = uniq("svcver-ns")
    ingest(
        client,
        resource_spans(service, version=VERSION, env="production", namespace=namespace),
        resource_spans(unversioned, env="production", namespace=namespace),
    )
    row = wait_for_versions(client, service, {VERSION})[VERSION]
    yield {"service": service, "unversioned": unversioned, "where_key": row["where_key"]}
    for rule_key in overrides_for(client, service):
        removed = client.delete(f"{OVERRIDES}/{rule_key}")
        assert removed.status_code in (200, 404), removed.text


def test_override_relabels_the_versions_until_it_is_removed(client: OpenObserveClient, seeded):
    put = client.put(OVERRIDES, json=service_override(seeded, "QA"))
    assert put.status_code == 200, put.text
    saved = put.json()
    assert (saved["removed"], saved["previous"]) == (False, None)
    override = saved["override"]
    assert (override["value"], override["inferred_value"], override["scope"]) == ("qa", "prod", "service")
    assert saved["affected"]["services"] == 1, saved
    key = override["rule_key"]

    listed = overrides_for(client, seeded["service"])
    assert key in listed, listed
    assert listed[key]["where_key"] == seeded["where_key"]
    relabelled = list_versions(client, seeded["service"])[0]
    assert (relabelled["env"], relabelled["env_source"], relabelled["override_key"]) == ("qa", "override", key)

    removed = client.delete(f"{OVERRIDES}/{key}")
    assert removed.status_code == 200, removed.text
    assert removed.json()["removed"]["rule_key"] == key
    assert key not in overrides_for(client, seeded["service"])
    restored = list_versions(client, seeded["service"])[0]
    assert (restored["env"], restored["override_key"]) == ("prod", None)

    again = client.delete(f"{OVERRIDES}/{key}")
    assert again.status_code == 404, again.text


def test_override_equal_to_the_inferred_env_stores_nothing(client: OpenObserveClient, seeded):
    put = client.put(OVERRIDES, json=service_override(seeded, "production"))

    assert put.status_code == 200, put.text
    assert (put.json()["removed"], put.json()["override"]) == (True, None)
    assert overrides_for(client, seeded["service"]) == {}


@pytest.mark.parametrize("value", ["", "has space", "x" * 129, "none"], ids=["empty", "space", "over-128", "no-env-literal"])
def test_override_rejects_an_invalid_value(client: OpenObserveClient, seeded, value: str):
    resp = client.put(OVERRIDES, json=service_override(seeded, value))

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid override value"


@pytest.mark.parametrize(
    "changes",
    [{"k8s_cluster": "another-cluster"}, {"scope": "cluster"}, {"scope": "where"}],
    ids=["cluster-not-in-where", "cluster-scope-with-where", "where-scope-with-service"],
)
def test_override_rejects_an_inconsistent_scope(client: OpenObserveClient, seeded, changes: dict[str, str]):
    resp = client.put(OVERRIDES, json=service_override(seeded, "qa", **changes))

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "inconsistent override scope"


def test_override_of_an_unseen_service_is_not_found(client: OpenObserveClient, seeded):
    resp = client.put(OVERRIDES, json=service_override(seeded, "qa", service_name=uniq("svcver-unseen")))

    assert resp.status_code == 404, resp.text
    assert resp.json()["error"] == "Override target not found"


def test_envs_lists_prod_with_the_seeded_service(client: OpenObserveClient, seeded):
    resp = client.get("service_identity/envs", params={"where": seeded["where_key"], "service": seeded["service"]})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["can_edit"] is True
    prod = [item for item in body["envs"] if item["env"] == "prod"]
    assert len(prod) == 1, body["envs"]
    assert (prod[0]["no_env"], prod[0]["inferred"]) == (False, False)
    assert prod[0]["services"] >= 1
    assert body["scope_counts"]["service"] == 1, body


def test_unresolved_lists_the_service_without_a_version(client: OpenObserveClient, seeded):
    def listed() -> dict[str, dict[str, Any]] | None:
        rows = unversioned(client)
        return rows if seeded["unversioned"] in rows else None

    rows = wait_until(listed, timeout=REGISTRY_TIMEOUT, interval=REGISTRY_POLL, msg="unversioned service listed")

    row = rows[seeded["unversioned"]]
    assert (row["where_key"], row["env"]) == (seeded["where_key"], "prod")
    assert seeded["service"] not in rows


def test_unresolved_rejects_a_non_numeric_limit(client: OpenObserveClient):
    resp = client.get("service_identity/unresolved", params={"limit": "many"})

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid pagination"

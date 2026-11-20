"""The version registry fed by real OTLP spans: listing, env canonicalisation, no-env scopes, delete and request validation."""
from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient

from .svcver_helpers import (
    CLUSTER,
    DAY_MICROS,
    catalog,
    compare_body,
    delete_versions,
    ingest,
    list_versions,
    now_micros,
    resource_spans,
    uniq,
    wait_for_versions,
)

pytestmark = pytest.mark.enterprise

OLD, NEW = "1.4.0", "1.5.0"
NO_ENV_VERSION = "0.9.0"
DELETED_VERSION = "7.0.0"


@pytest.fixture(scope="module")
def seeded(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """Two versions of a k8s prod service, a service reporting env "default" outside k8s, and one to delete."""
    service, no_env, doomed = uniq("svcver-reg"), uniq("svcver-noenv"), uniq("svcver-del")
    namespace = uniq("svcver-ns")
    ingest(
        client,
        resource_spans(service, version=OLD, env="production", namespace=namespace),
        resource_spans(service, version=NEW, env="production", namespace=namespace),
        resource_spans(no_env, version=NO_ENV_VERSION, env="default"),
        resource_spans(doomed, version=DELETED_VERSION, env="production", namespace=namespace),
    )
    yield {
        "service": service,
        "no_env": no_env,
        "doomed": doomed,
        "namespace": namespace,
        "versions": wait_for_versions(client, service, {OLD, NEW}),
        "no_env_versions": wait_for_versions(client, no_env, {NO_ENV_VERSION}),
        "doomed_version": wait_for_versions(client, doomed, {DELETED_VERSION})[DELETED_VERSION],
    }
    delete_versions(client, service, no_env, doomed)


def test_both_versions_are_listed_in_the_k8s_scope_with_env_prod(seeded):
    rows = seeded["versions"]

    assert set(rows) == {OLD, NEW}, rows
    assert rows[OLD]["version_key"] != rows[NEW]["version_key"]
    for row in rows.values():
        assert (row["env"], row["no_env"], row["env_source"]) == ("prod", False, "attribute"), row
        assert row["where"] == {"kind": "k8s", "k8s_cluster": CLUSTER, "k8s_namespace": seeded["namespace"]}
        assert row["where_key"] == rows[OLD]["where_key"]
        assert row["compare_disabled"] is False
        assert row["signals"]["traces"] is not None, row


def test_the_catalog_lists_the_service_under_prod_only(client: OpenObserveClient, seeded):
    service = seeded["service"]

    scopes = catalog(client, service=service)
    in_prod = catalog(client, q=service, env="prod")
    in_no_env = catalog(client, q=service, no_env="true")

    assert [scope["service"] for scope in scopes] == [service], scopes
    assert scopes[0]["newest_version"] in {OLD, NEW}
    assert scopes[0]["where_key"] == seeded["versions"][OLD]["where_key"]
    assert [scope["service"] for scope in in_prod] == [service], in_prod
    assert in_no_env == [], in_no_env


def test_env_default_reads_as_no_env_outside_kubernetes(client: OpenObserveClient, seeded):
    row = seeded["no_env_versions"][NO_ENV_VERSION]

    assert row["no_env"] is True, row
    assert row["where"]["kind"] != "k8s", row
    assert (row["where"]["k8s_cluster"], row["where"]["k8s_namespace"]) == ("", "")
    no_env_scopes = catalog(client, q=seeded["no_env"], no_env="true")
    assert [scope["service"] for scope in no_env_scopes] == [seeded["no_env"]], no_env_scopes
    assert catalog(client, q=seeded["no_env"], env="default") == []


def test_the_no_env_group_is_the_last_env_option(client: OpenObserveClient, seeded):
    resp = client.get("service_identity/envs")

    assert resp.status_code == 200, resp.text
    envs = resp.json()["envs"]
    assert envs[-1]["no_env"] is True, envs
    assert envs[-1]["env"] == ""


def test_a_deleted_version_is_gone_until_it_is_seen_again(client: OpenObserveClient, seeded):
    doomed, key = seeded["doomed"], seeded["doomed_version"]["version_key"]

    first = client.delete(f"service_versions/{key}")
    assert first.status_code == 200, first.text
    assert first.json() == {"deleted": True}
    assert DELETED_VERSION not in {row["version"] for row in list_versions(client, doomed)}
    again = client.delete(f"service_versions/{key}")
    assert again.status_code == 200, again.text
    assert again.json() == {"deleted": False}

    ingest(client, resource_spans(doomed, version=DELETED_VERSION, env="production", namespace=seeded["namespace"]))
    back = wait_for_versions(client, doomed, {DELETED_VERSION})
    assert back[DELETED_VERSION]["version_key"] == key


def test_versions_require_a_service(client: OpenObserveClient):
    resp = client.get("service_versions")

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "service is required"


def test_compare_rejects_an_arm_window_over_seven_days(client: OpenObserveClient, seeded):
    end = now_micros()
    arm = {"version": NEW, "start_time": end - 8 * DAY_MICROS, "end_time": end}

    resp = client.post("service_versions/compare", json=compare_body(seeded, NEW, OLD, a=arm))

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid arm window"


def test_compare_requires_a_service(client: OpenObserveClient, seeded):
    body = compare_body(seeded, NEW, OLD)
    del body["service"]

    resp = client.post("service_versions/compare", json=body)

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "service, where and a.version are required"


def test_compare_of_an_unseen_service_is_not_found(client: OpenObserveClient, seeded):
    resp = client.post("service_versions/compare", json=compare_body(seeded, NEW, OLD, service=uniq("svcver-unseen")))

    assert resp.status_code == 404, resp.text
    assert resp.json()["error"] == "Service scope not found"


@pytest.mark.parametrize("signals", [[], ["logs"]], ids=["empty", "unknown"])
def test_compare_rejects_signals_outside_traces_and_rum(client: OpenObserveClient, seeded, signals: list[str]):
    resp = client.post("service_versions/compare", json=compare_body(seeded, NEW, OLD, signals=signals))

    assert resp.status_code == 400, resp.text


def test_verdicts_without_where_are_rejected(client: OpenObserveClient, seeded):
    resp = client.get("service_versions/verdicts", params={"service": seeded["service"], "version": NEW})

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "where is required"

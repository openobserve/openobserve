"""Service name aliases: create, list, update, delete, bulk accept/reject and undo."""
from __future__ import annotations

from collections.abc import Callable, Generator
from typing import Any

import pytest

from support.client import OpenObserveClient

from .svcver_helpers import uniq

pytestmark = pytest.mark.enterprise

ALIASES = "service_identity/aliases"
MAX_BULK_ROWS = 500


@pytest.fixture
def make_alias(client: OpenObserveClient) -> Generator[Callable[..., dict[str, Any]], None, None]:
    """Create a rename alias and return its stored row; every alias is deleted afterwards."""
    keys: list[str] = []

    def make(**body: Any) -> dict[str, Any]:
        alias = body.pop("alias", uniq("svcver-old"))
        canonical = body.pop("canonical", uniq("svcver-new"))
        resp = client.post(ALIASES, json={"kind": "rename", "alias": alias, "canonical": canonical, **body})
        assert resp.status_code == 201, resp.text
        keys.append(resp.json()["alias_key"])
        return resp.json()

    yield make
    for key in keys:
        resp = client.delete(f"{ALIASES}/{key}")
        assert resp.status_code in (204, 404), resp.text


def listed(client: OpenObserveClient, q: str, **params: str) -> dict[str, dict[str, Any]]:
    resp = client.get(ALIASES, params={"q": q, "limit": "1000", **params})
    assert resp.status_code == 200, resp.text
    return {row["alias_key"]: row for row in resp.json()["aliases"]}


def test_create_returns_an_active_manual_alias(client: OpenObserveClient, make_alias):
    alias, canonical = uniq("svcver-old"), uniq("svcver-new")
    row = make_alias(alias=alias, canonical=canonical)

    assert (row["kind"], row["alias"], row["canonical"]) == ("rename", alias, canonical)
    assert (row["status"], row["origin"], row["confidence"]) == ("active", "manual", "high")
    assert row["accepted_by"] == client.email
    assert row["deleted_at"] is None
    assert "fencing_token" not in row
    assert "allow_collisions" not in row


def test_list_finds_the_alias_by_text_and_kind(client: OpenObserveClient, make_alias):
    row = make_alias()

    by_alias = listed(client, row["alias"].upper())
    assert row["alias_key"] in by_alias, by_alias
    assert by_alias[row["alias_key"]]["canonical"] == row["canonical"]
    assert row["alias_key"] in listed(client, row["canonical"], kind="rename")
    assert row["alias_key"] not in listed(client, row["alias"], kind="k8s_workload")


@pytest.mark.parametrize("param", ["kind", "status", "confidence"])
def test_list_rejects_an_unknown_filter_value(client: OpenObserveClient, param: str):
    resp = client.get(ALIASES, params={param: "bogus"})

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid filter"


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "bogus", "alias": "a", "canonical": "b"},
        {"kind": "rename", "scope": "ns", "alias": "a", "canonical": "b"},
        {"kind": "k8s_workload", "alias": "a", "canonical": "b"},
        {"kind": "rename", "alias": "  ", "canonical": "b"},
        {"kind": "rename", "alias": "a" * 257, "canonical": "b"},
    ],
    ids=["unknown-kind", "rename-with-scope", "workload-without-scope", "blank-alias", "alias-over-256-bytes"],
)
def test_create_rejects_an_invalid_alias(client: OpenObserveClient, body: dict[str, str]):
    resp = client.post(ALIASES, json=body)

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid alias"


def test_update_rejects_then_reaccepts_with_a_new_canonical(client: OpenObserveClient, make_alias):
    row = make_alias()
    key = row["alias_key"]

    rejected = client.put(f"{ALIASES}/{key}", json={"status": "rejected"})
    assert rejected.status_code == 200, rejected.text
    assert (rejected.json()["status"], rejected.json()["accepted_by"]) == ("rejected", None)
    assert listed(client, row["alias"])[key]["status"] == "rejected"

    canonical = uniq("svcver-renamed")
    accepted = client.put(f"{ALIASES}/{key}", json={"status": "active", "canonical": canonical})
    assert accepted.status_code == 200, accepted.text
    assert (accepted.json()["status"], accepted.json()["canonical"]) == ("active", canonical)
    assert accepted.json()["accepted_by"] == client.email


def test_update_rejects_an_unknown_status(client: OpenObserveClient, make_alias):
    row = make_alias()

    resp = client.put(f"{ALIASES}/{row['alias_key']}", json={"status": "accepted"})

    assert resp.status_code == 400, resp.text
    assert listed(client, row["alias"])[row["alias_key"]]["status"] == "active"


def test_update_and_delete_of_an_unknown_key_are_not_found(client: OpenObserveClient):
    key = uniq("svcver-missing")

    updated = client.put(f"{ALIASES}/{key}", json={"status": "active"})
    deleted = client.delete(f"{ALIASES}/{key}")

    assert updated.status_code == 404, updated.text
    assert deleted.status_code == 404, deleted.text


def test_delete_removes_the_alias_from_the_list(client: OpenObserveClient, make_alias):
    row = make_alias()

    first = client.delete(f"{ALIASES}/{row['alias_key']}")
    again = client.delete(f"{ALIASES}/{row['alias_key']}")

    assert first.status_code == 204, first.text
    assert row["alias_key"] not in listed(client, row["alias"])
    assert again.status_code == 404, again.text


def test_bulk_reject_then_undo_restores_both_aliases(client: OpenObserveClient, make_alias):
    tag = uniq("svcver-bulk")
    rows = [make_alias(alias=f"{tag}-a"), make_alias(alias=f"{tag}-b")]
    keys = [row["alias_key"] for row in rows]

    bulk = client.post(f"{ALIASES}/_bulk", json={"action": "reject", "alias_keys": keys})
    assert bulk.status_code == 200, bulk.text
    out = bulk.json()
    assert (out["changed"], out["truncated"], out["skipped_collisions"]) == (2, False, 0)
    assert {row["status"] for row in listed(client, tag).values()} == {"rejected"}

    undo = client.post(f"{ALIASES}/_undo", json={"batch_id": out["batch_id"]})
    assert undo.status_code == 200, undo.text
    assert undo.json() == {"restored": 2}
    after = listed(client, tag)
    assert set(keys) <= after.keys(), after
    assert {after[key]["status"] for key in keys} == {"active"}


def test_bulk_accept_of_already_active_aliases_changes_nothing(client: OpenObserveClient, make_alias):
    row = make_alias()

    bulk = client.post(f"{ALIASES}/_bulk", json={"action": "accept", "alias_keys": [row["alias_key"]]})

    assert bulk.status_code == 200, bulk.text
    assert (bulk.json()["changed"], bulk.json()["truncated"]) == (0, False)


@pytest.mark.parametrize(
    "body",
    [
        {"action": "reject"},
        {"action": "reject", "alias_keys": ["k"], "filter": {"status": "proposed"}},
        {"action": "archive", "alias_keys": ["k"]},
    ],
    ids=["no-selector", "both-selectors", "unknown-action"],
)
def test_bulk_rejects_an_invalid_request(client: OpenObserveClient, body: dict[str, Any]):
    resp = client.post(f"{ALIASES}/_bulk", json=body)

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid bulk request"


def test_undo_of_an_unknown_batch_restores_nothing(client: OpenObserveClient):
    resp = client.post(f"{ALIASES}/_undo", json={"batch_id": "not-a-batch"})

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"restored": 0}


@pytest.mark.slow
def test_bulk_touches_at_most_500_rows_and_flags_the_rest(client: OpenObserveClient, make_alias):
    tag = uniq("svcver-cap")
    keys = [make_alias(alias=f"{tag}-{i}")["alias_key"] for i in range(MAX_BULK_ROWS + 1)]

    bulk = client.post(f"{ALIASES}/_bulk", json={"action": "reject", "alias_keys": keys})

    assert bulk.status_code == 200, bulk.text
    assert (bulk.json()["changed"], bulk.json()["truncated"]) == (MAX_BULK_ROWS, True)
    statuses = [row["status"] for row in listed(client, tag).values()]
    assert (statuses.count("rejected"), statuses.count("active")) == (MAX_BULK_ROWS, 1)

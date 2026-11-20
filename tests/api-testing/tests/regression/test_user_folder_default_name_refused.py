"""A user folder may not take the built-in default folder's name, on create or rename (#16472).

The built-in folder (`folderId` `default`) is created lazily, on an org's first use of each folder type. A user
folder named `default` made before that took the name in the case-sensitive unique index on (org, type, name), so
creating the built-in one failed from then on. `save_folder` trims the name first; `update_folder` does not.
The match is exact, so `Default` is a different name and stays allowed.

OSS has no org delete, so the fresh org stays behind; every folder made in it is deleted.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

TAKEN = "Folder with this name already exists in this organization"
# Downtimes folders are refused with 403 on OSS before the name is read, so they are not covered here.
FOLDER_TYPES = ["dashboards", "alerts", "reports", "synthetics", "workflows", "prompts"]


@pytest.fixture(scope="module")
def fresh_org(client: OpenObserveClient) -> str:
    """An org no folder type has been used in yet, so no built-in default folder already holds the name."""
    resp = client.post("api/organizations", json={"name": unique_name("pytest_default_folder")}, prefix="")
    assert resp.status_code == 200, f"create org: {resp.status_code} {resp.text[:300]}"
    return resp.json()["identifier"]


@pytest.fixture
def created(client: OpenObserveClient, fresh_org: str) -> Generator[list[tuple[str, str]], None, None]:
    """(folder type, folder id) of every folder a test makes, deleted afterwards."""
    folders: list[tuple[str, str]] = []
    yield folders
    for kind, folder_id in folders:
        resp = client.delete(f"folders/{kind}/{folder_id}", prefix="api/v2/", org=fresh_org)
        assert resp.status_code == 200, f"cleanup {kind}/{folder_id}: {resp.status_code} {resp.text[:300]}"


def _create(client: OpenObserveClient, org: str, kind: str, name: str):
    return client.post(f"folders/{kind}", prefix="api/v2/", org=org, json={"name": name, "description": ""})


def _rename(client: OpenObserveClient, org: str, kind: str, folder_id: str, name: str):
    body = {"folderId": folder_id, "name": name, "description": ""}
    return client.put(f"folders/{kind}/{folder_id}", prefix="api/v2/", org=org, json=body)


def _folder(client: OpenObserveClient, org: str, kind: str, folder_id: str) -> dict:
    resp = client.get(f"folders/{kind}/{folder_id}", prefix="api/v2/", org=org)
    assert resp.status_code == 200, f"get {kind}/{folder_id}: {resp.status_code} {resp.text[:300]}"
    return resp.json()


def _assert_taken(resp, what: str) -> None:
    assert resp.status_code == 400, f"#16472 {what}: {resp.status_code} {resp.text[:300]}"
    assert resp.json()["message"] == TAKEN, f"#16472 {what}: {resp.text[:300]}"


def _user_folders_named_default(client: OpenObserveClient, org: str, kind: str) -> list[dict]:
    resp = client.get(f"folders/{kind}", prefix="api/v2/", org=org)
    assert resp.status_code == 200, f"list {kind}: {resp.status_code} {resp.text[:300]}"
    return [f for f in resp.json()["list"] if f["name"] == "default" and f["folderId"] != "default"]


@pytest.mark.parametrize("kind", FOLDER_TYPES)
def test_create_with_the_default_name_is_refused(
    client: OpenObserveClient, fresh_org: str, created: list[tuple[str, str]], kind: str
):
    for name in ["default", "  default  "]:
        resp = _create(client, fresh_org, kind, name)
        if resp.status_code == 200:
            created.append((kind, resp.json()["folderId"]))
        _assert_taken(resp, f"create {kind} {name!r}")
    assert _user_folders_named_default(client, fresh_org, kind) == [], f"#16472 a refused {kind} create was stored"

    # Only the exact name clashes in the case-sensitive index, so other names still work.
    for name in ["Default", unique_name("pytest_folder")]:
        resp = _create(client, fresh_org, kind, name)
        assert resp.status_code == 200, f"create {kind} {name!r}: {resp.status_code} {resp.text[:300]}"
        body = resp.json()
        created.append((kind, body["folderId"]))
        assert body["name"] == name, body
        assert body["folderId"] != "default", body
        assert _folder(client, fresh_org, kind, body["folderId"])["name"] == name


@pytest.mark.parametrize("kind", FOLDER_TYPES)
def test_rename_to_the_default_name_is_refused(
    client: OpenObserveClient, fresh_org: str, created: list[tuple[str, str]], kind: str
):
    name = unique_name("pytest_folder")
    resp = _create(client, fresh_org, kind, name)
    assert resp.status_code == 200, f"create {kind} {name!r}: {resp.status_code} {resp.text[:300]}"
    folder_id = resp.json()["folderId"]
    created.append((kind, folder_id))

    _assert_taken(_rename(client, fresh_org, kind, folder_id, "default"), f"rename {kind} to 'default'")
    assert _folder(client, fresh_org, kind, folder_id)["name"] == name, f"#16472 a refused {kind} rename was stored"
    assert _user_folders_named_default(client, fresh_org, kind) == [], f"#16472 a refused {kind} rename was stored"

    renamed = unique_name("pytest_folder_renamed")
    resp = _rename(client, fresh_org, kind, folder_id, renamed)
    assert resp.status_code == 200, f"rename {kind} to {renamed!r}: {resp.status_code} {resp.text[:300]}"
    assert resp.json()["message"] == "Folder updated", resp.text[:300]
    assert _folder(client, fresh_org, kind, folder_id)["name"] == renamed

"""AC-5.3, AC-5.4 and AC-5.5: who may change Slack, with OpenFGA off (section 7 permission rule); row 24 with it on."""
from __future__ import annotations

import time
import uuid

import pytest

from support.client import OpenObserveClient

from .instance_helpers import META, meta_install, meta_role_user, org_access_path, rbac_enabled
from .slack_helpers import (
    SlackMock,
    add_to_org,
    connect_with_proof,
    make_org,
    make_slack_org,
    make_user,
    new_team,
    self_hosted_install,
)

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def installed(client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: SlackMock) -> dict:
    team = f"T{uuid.uuid4().hex[:8].upper()}"
    mock.add_team(team, "Acme")
    body = self_hosted_install(client, slack_org, team_id=team)
    return {"id": body["installation"]["id"], "team": team}


def test_role_editor_resources_list_slack_while_on(client: OpenObserveClient, slack_org: str, slack_on: None) -> None:
    resp = client.get("resources", org=slack_org)
    assert resp.status_code == 200, resp.text
    slack = [r for r in resp.json() if r["key"] == "slack_integration"]
    assert [(r["display_name"], r["visible"], r["has_entities"]) for r in slack] == [("Slack", True, False)]


def test_a_non_admin_cannot_change_slack(
    client: OpenObserveClient, slack_org: str, installed: dict, mock: SlackMock
) -> None:
    _, editor = make_user(client, slack_org, "editor")
    i = installed["id"]
    attempts = [
        ("POST", "slack/installations", {"mode": "socket", "config_refresh_token": "xoxe-1-editor"}),
        ("PUT", f"slack/installations/{i}/credentials", {"client_secret": "x"}),
        ("POST", f"slack/installations/{i}/connection/start", {"purpose": "test"}),
        ("POST", f"slack/installations/{i}/connection", {"connect_ticket": "t"}),
        ("DELETE", f"slack/installations/{i}/connection", None),
        ("DELETE", f"slack/installations/{i}", None),
        ("PUT", f"slack/installations/{i}/linking", {"enabled": False}),
        ("PUT", f"slack/installations/{i}/channel-defaults/C0ALERTS", {"org_id": slack_org, "answer_mode": "private"}),
        ("DELETE", f"slack/installations/{i}/channel-defaults/C0ALERTS", None),
        ("POST", f"slack/installations/{i}/link-all", None),
    ]
    for method, path, body in attempts:
        kwargs = {"json": body} if body is not None else {}
        resp = editor.request(method, path, org=slack_org, **kwargs)
        assert resp.status_code == 403, f"{method} {path}: {resp.status_code} {resp.text}"
    assert len(mock.calls("tooling.tokens.rotate")) == 1, "the refused create must not reach Slack"
    still = client.get(f"slack/installations/{i}/linking", org=slack_org)
    assert still.status_code == 200, still.text


def test_an_admin_of_one_of_two_connected_orgs_cannot_act_installation_wide(
    client: OpenObserveClient, slack_org: str, installed: dict
) -> None:
    other = make_slack_org(client)
    connected = connect_with_proof(client, other, installed["id"], team_id=installed["team"])
    assert connected.status_code == 200, connected.text
    email, as_admin_of_other = make_user(client, other, "admin")
    add_to_org(client, slack_org, email, "editor")
    i = installed["id"]
    for method, path, body in [
        ("DELETE", f"slack/installations/{i}", None),
        ("PUT", f"slack/installations/{i}/linking", {"enabled": False}),
        ("POST", f"slack/installations/{i}/link-all", None),
    ]:
        kwargs = {"json": body} if body is not None else {}
        resp = as_admin_of_other.request(method, path, org=other, **kwargs)
        assert resp.status_code == 403, f"{method} {path}: {resp.status_code} {resp.text}"
        assert "every connected organization" in resp.json()["message"]
    listed = client.get("slack/installations", org=slack_org).json()["installations"]
    assert any(x["id"] == i and x["other_connected_orgs"] == 1 for x in listed), listed


def test_an_admin_of_org_b_cannot_change_org_a_channel_default(
    client: OpenObserveClient, slack_org: str, installed: dict
) -> None:
    i = installed["id"]
    set_a = client.put(
        f"slack/installations/{i}/channel-defaults/C0ALERTS",
        json={"org_id": slack_org, "answer_mode": "thread"},
        org=slack_org,
    )
    assert set_a.status_code == 200, set_a.text
    other = make_slack_org(client)
    assert connect_with_proof(client, other, i, team_id=installed["team"]).status_code == 200
    _, admin_b = make_user(client, other, "admin")
    path = f"slack/installations/{i}/channel-defaults/C0ALERTS"
    moved = admin_b.put(path, json={"org_id": other, "answer_mode": "private"}, org=other)
    assert moved.status_code == 403, moved.text
    assert moved.json()["message"] == f"Only an admin of org {slack_org} can change this channel's default"
    removed = admin_b.delete(path, org=other)
    assert removed.status_code == 403, removed.text
    row = client.get(path, org=slack_org).json()
    assert row["answer_mode"] == "thread"
    assert row["set_by_this_org"] is True


def test_org_access_route_rows_follow_the_openfga_grant(
    client: OpenObserveClient, slack_on: None, self_hosted: None, mock: SlackMock
) -> None:
    """Section 7.6: row 24 checks LIST for GET and PUT for PUT on ``slack_integration:_meta``."""
    if not rbac_enabled(client):
        pytest.skip("run against a server with O2_OPENFGA_ENABLED=true")
    inst = meta_install(client, mock, new_team(mock))
    try:
        path, body = org_access_path(inst["id"]), {"orgs": [META]}
        lister = meta_role_user(client, ["AllowList"])
        assert lister.get(path, org=META).status_code == 200
        refused = lister.put(path, json=body, org=META)
        assert refused.status_code == 403, refused.text
        writer = meta_role_user(client, ["AllowList", "AllowPut"])
        allowed = writer.put(path, json=body, org=META)
        assert allowed.status_code == 200, allowed.text
    finally:
        client.delete(f"slack/installations/{inst['id']}", org=META)


def rbac_org(client: OpenObserveClient) -> str:
    if not rbac_enabled(client):
        pytest.skip("run against a server with O2_OPENFGA_ENABLED=true")
    return make_org(client)


def role_user(client: OpenObserveClient, org: str, grants: list[tuple[str, str]]) -> OpenObserveClient:
    """An ``org`` member (role ``user``) holding only a custom role with ``grants`` as (object, permission)."""
    email, user = make_user(client, org, "user")
    role = f"rbac_{uuid.uuid4().hex[:8]}"
    created = client.post("roles", json={"role": role}, org=org)
    assert created.status_code in (200, 201), created.text
    body = {
        "add": [{"object": o, "permission": p} for o, p in grants],
        "remove": [],
        "add_users": [email],
        "remove_users": [],
    }
    granted = client.put(f"roles/{role}", json=body, org=org)
    assert granted.status_code == 200, granted.text
    # OpenFGA tuple writes are not read-your-writes.
    time.sleep(2)
    return user


def ingest_logs(client: OpenObserveClient, org: str, stream: str, row: dict) -> None:
    resp = client.post(f"{stream}/_json", json=[row] * 3, org=org)
    assert resp.status_code == 200, resp.text


def search_body(sql: str) -> dict:
    end = int(time.time() * 1_000_000) + 60_000_000
    return {"query": {"sql": sql, "start_time": end - 3_600_000_000, "end_time": end, "from": 0, "size": 10}}


def wait_for_rows(client: OpenObserveClient, org: str, stream: str) -> None:
    for _ in range(30):
        resp = client.post("_search?type=logs", json=search_body(f'SELECT * FROM "{stream}"'), org=org)
        if resp.status_code == 200 and resp.json().get("hits"):
            return
        time.sleep(1)
    raise AssertionError(f"{stream} never became searchable")


def test_sql_tables_are_authorized_under_the_type_the_sql_names(client: OpenObserveClient) -> None:
    org = rbac_org(client)
    hidden, shared = f"rbac_hidden_{uuid.uuid4().hex[:6]}", f"rbac_shared_{uuid.uuid4().hex[:6]}"
    ingest_logs(client, org, hidden, {"hidden_marker": "h"})
    ingest_logs(client, org, shared, {"shared_marker": "s"})
    wait_for_rows(client, org, hidden)
    wait_for_rows(client, org, shared)
    user = role_user(client, org, [(f"metrics:_all_{org}", "AllowAll"), (f"logs:{shared}", "AllowAll")])

    for path in ("_search?type=metrics", "_search_stream?type=metrics", "_search?type=logs"):
        refused = user.post(path, json=search_body(f'SELECT * FROM "logs"."{hidden}"'), org=org)
        assert refused.status_code == 403, f"{path}: {refused.status_code} {refused.text[:300]}"
        assert "hidden_marker" not in refused.text
    joined = f'SELECT a.* FROM "logs"."{shared}" a JOIN "logs"."{hidden}" b ON a._timestamp = b._timestamp'
    assert user.post("_search?type=metrics", json=search_body(joined), org=org).status_code == 403

    allowed = user.post("_search?type=metrics", json=search_body(f'SELECT * FROM "logs"."{shared}"'), org=org)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["hits"], allowed.text


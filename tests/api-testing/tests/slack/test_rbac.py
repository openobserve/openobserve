"""AC-5.3, AC-5.4 and AC-5.5: who may change Slack, with OpenFGA off (section 7 permission rule)."""
from __future__ import annotations

import uuid

import pytest

from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    add_to_org,
    connect_with_proof,
    make_slack_org,
    make_user,
    self_hosted_install,
)

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def installed(client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: SlackMock) -> dict:
    team = f"T{uuid.uuid4().hex[:8].upper()}"
    mock.add_team(team, "Acme")
    body = self_hosted_install(client, slack_org, team_id=team)
    return {"id": body["installation"]["id"], "team": team}


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

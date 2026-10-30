"""Phase 2 A5: the Slack app destination's save, switch and Send test (AC-P2.5.14, 5.16, 6.3, 6.4, 11-b)."""
from __future__ import annotations

import uuid
from typing import Any

import pytest

from support.client import OpenObserveClient

from .slack_helpers import SlackMock, harness_skip, self_hosted_install, slack_config

PLAIN = "C0FAKE00001"
SHARED = "C0FAKE00002"
ARCHIVED = "C0FAKE00003"
ROOM = "C0FAKE00004"


def channel(cid: str, name: str, **flags: Any) -> dict[str, Any]:
    return {"id": cid, "name": name, "is_private": False, "is_member": True, "is_shared": False, **flags}


@pytest.fixture
def workspace(client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: SlackMock) -> dict:
    team = f"T0A5{uuid.uuid4().hex[:6].upper()}"
    mock.add_team(team, "Acme", channels=[
        channel(PLAIN, "sre-prod"),
        channel(SHARED, "partners", is_shared=True, is_ext_shared=True),
        channel(ARCHIVED, "old-alerts", is_archived=True),
        channel(ROOM, "payments-oncall"),
    ])
    body = self_hosted_install(client, slack_org, team_id=team, mode="http")
    return {"id": body["installation"]["id"], "team": team}


def app_body(name: str, installation_id: str, channel_id: str, **extra: Any) -> dict[str, Any]:
    """What ``buildSlackAppDestination`` (web) sends."""
    return {
        "name": name, "type": "slack_app", "installation_id": installation_id, "channel_id": channel_id,
        "channel_name": "sre-prod", "buttons": True, "mention": "default", "refire_reuse_minutes": 30,
        "auto_investigate": "off", "shared_channel_confirmed": False, "oncall_room_confirmed": False, **extra,
    }


def webhook_body(name: str, team: str, channel_id: str) -> dict[str, Any]:
    return {
        "name": name, "type": "http", "url": f"https://hooks.slack.com/services/{team}/B0FAKE/x", "method": "post",
        "template": "prebuilt_slack", "destination_type_name": "slack",
        "metadata": {"prebuilt_type": "slack", "slack_team_id": team, "slack_channel_id": channel_id},
    }


def name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


@pytest.mark.enterprise
def test_create_reads_back_flat_and_fills_the_channel_default(
    client: OpenObserveClient, slack_org: str, workspace: dict
) -> None:
    dest = name("sre-app")
    resp = client.post("alerts/destinations", json=app_body(dest, workspace["id"], PLAIN), org=slack_org)
    assert resp.status_code == 200, resp.text
    got = client.get(f"alerts/destinations/{dest}", org=slack_org).json()
    assert got["type"] == "slack_app"
    assert got["channel_id"] == PLAIN and got["installation_id"] == workspace["id"]
    assert got["buttons"] is True and got["template"] == "prebuilt_slack"
    defaults = client.get(f"slack/installations/{workspace['id']}/channel-defaults", org=slack_org)
    assert defaults.status_code == 200, defaults.text
    row = next(d for d in defaults.json()["defaults"] if d["channel_id"] == PLAIN)
    assert row["set_from"] == "destination"


@pytest.mark.enterprise
def test_shared_and_archived_channels_are_refused_with_codes(
    client: OpenObserveClient, slack_org: str, workspace: dict
) -> None:
    resp = client.post("alerts/destinations", json=app_body(name("shared"), workspace["id"], SHARED), org=slack_org)
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "shared_channel_unconfirmed"
    ticked = app_body(name("shared"), workspace["id"], SHARED, shared_channel_confirmed=True)
    assert client.post("alerts/destinations", json=ticked, org=slack_org).status_code == 200
    resp = client.post("alerts/destinations", json=app_body(name("old"), workspace["id"], ARCHIVED), org=slack_org)
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "slack_target"


@pytest.mark.enterprise
def test_an_oncall_room_needs_the_confirm_naming_team_and_webhook(
    client: OpenObserveClient, slack_org: str, workspace: dict
) -> None:
    hook = name("pay-slack")
    assert client.post("alerts/destinations", json=webhook_body(hook, workspace["team"], ROOM), org=slack_org).status_code == 200
    team = client.post("oncall/teams", json={"name": name("payments"), "timezone": "UTC"}, org=slack_org)
    if team.status_code == 404:
        harness_skip("on-call is off; start the server with O2_ONCALL_ENABLED=true")
    assert team.status_code in (200, 201), team.text
    team_id, team_name = team.json()["id"], team.json()["name"]
    put = client.put(f"oncall/teams/{team_id}/channel", json={"destinations": [hook]}, org=slack_org)
    assert put.status_code == 200, put.text
    resp = client.post("alerts/destinations", json=app_body(name("room"), workspace["id"], ROOM), org=slack_org)
    assert resp.status_code == 400, resp.text
    assert resp.json() | {"message": ""} == {
        "code": "oncall_room_unconfirmed", "team": team_name, "destination": hook, "message": "",
    }
    ticked = app_body(name("room"), workspace["id"], ROOM, oncall_room_confirmed=True)
    assert client.post("alerts/destinations", json=ticked, org=slack_org).status_code == 200
    refused = client.put(f"oncall/teams/{team_id}/channel", json={"destinations": [ticked["name"]]}, org=slack_org)
    assert refused.status_code == 400, refused.text
    assert "cannot receive on-call pages" in refused.text
    switch = client.put(
        f"alerts/destinations/{hook}", json=app_body(hook, workspace["id"], ROOM, oncall_room_confirmed=True), org=slack_org
    )
    assert switch.status_code == 400, switch.text
    assert switch.json()["code"] == "used_by_oncall"


@pytest.mark.enterprise
def test_switch_keeps_the_name_and_switch_back_restores_the_webhook(
    client: OpenObserveClient, slack_org: str, workspace: dict
) -> None:
    hook = name("ops-hook")
    webhook = webhook_body(hook, workspace["team"], PLAIN)
    assert client.post("alerts/destinations", json=webhook, org=slack_org).status_code == 200
    previous = {"url": webhook["url"], "method": "post", "metadata": webhook["metadata"]}
    switched = app_body(hook, workspace["id"], PLAIN, previous_webhook=previous, template="prebuilt_slack")
    resp = client.put(f"alerts/destinations/{hook}", json=switched, org=slack_org)
    assert resp.status_code == 200, resp.text
    got = client.get(f"alerts/destinations/{hook}", org=slack_org).json()
    assert got["type"] == "slack_app" and got["previous_webhook"]["url"] == webhook["url"]
    resp = client.put(f"alerts/destinations/{hook}", json=webhook, org=slack_org)
    assert resp.status_code == 200, resp.text
    got = client.get(f"alerts/destinations/{hook}", org=slack_org).json()
    assert got["type"] == "http" and got["url"] == webhook["url"]


@pytest.mark.enterprise
def test_send_test_posts_now_through_the_bot(
    client: OpenObserveClient, slack_org: str, workspace: dict, mock: SlackMock
) -> None:
    body = {
        "type": "slack_app", "template": "prebuilt_slack",
        "slackApp": {k: v for k, v in app_body("x", workspace["id"], PLAIN).items() if k not in ("name", "type")},
    }
    resp = client.post("alerts/destinations/test", json=body, org=slack_org)
    assert resp.status_code == 200, resp.text
    assert resp.json()["success"] is True, resp.text
    posts = [c for c in mock.calls("chat.postMessage") if c["form"].get("channel") == PLAIN]
    assert posts, "Send test is synchronous"
    assert "[TEST]" in posts[-1]["form"].get("text", "") + posts[-1]["form"].get("blocks", "")


def test_the_oss_build_refuses_a_slack_app_destination(client: OpenObserveClient, slack_org: str) -> None:
    if slack_config(client, slack_org)["build_type"] != "opensource":
        pytest.skip("OSS build only")
    resp = client.post("alerts/destinations", json=app_body(name("oss"), "I0FAKE00001", PLAIN), org=slack_org)
    assert resp.status_code == 403, resp.text
    assert "Slack app needs Enterprise" in resp.text

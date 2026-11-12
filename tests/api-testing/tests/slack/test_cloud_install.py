"""AC-6.1, 6.2, 6.3, 6.5, 6.8, 6.11 and 6.13: the Cloud install (``--features cloud`` build).

The server runs with ``O2_SLACK_CLIENT_ID``, ``O2_SLACK_CLIENT_SECRET`` and ``O2_SLACK_REDIRECT_URL`` set to
any values (the mock accepts an unknown client) and ``ZO_SSRF_ALLOW_LOOPBACK=true`` so the destination can
target the mock's incoming webhook. A Cloud build also needs non-empty ``O2_STRIPE_SECRET_KEY``,
``O2_STRIPE_WEBHOOK_SECRET`` and ``O2_AZURE_{TENANT,CLIENT}_ID``/``O2_AZURE_CLIENT_SECRET`` (placeholders) and a
running OpenFGA (``O2_OPENFGA_ENABLED=true``, Cloud authorizes through it).
"""
from __future__ import annotations

import uuid

import pytest

from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    cloud_exchange,
    form_destination_payload,
    make_org,
    make_user,
    team_destinations,
)

pytestmark = [pytest.mark.enterprise]
WEBHOOK_FIELDS = {"webhookUrl", "channel", "channelId", "teamId", "teamName"}


@pytest.fixture
def team(slack_on: None, cloud_build: None, mock: SlackMock) -> str:
    team_id = f"T{uuid.uuid4().hex[:8].upper()}"
    mock.add_team(team_id, "Acme")
    return team_id


def channel_default(client: OpenObserveClient, org: str, installation_id: str, channel_id: str) -> dict | None:
    resp = client.get(f"slack/installations/{installation_id}/channel-defaults", org=org)
    assert resp.status_code == 200, resp.text
    return next((d for d in resp.json()["defaults"] if d["channel_id"] == channel_id), None)


def test_form_path(client: OpenObserveClient, slack_org: str, team: str) -> None:
    resp = cloud_exchange(client, slack_org, "destination_form", team_id=team)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert WEBHOOK_FIELDS <= body.keys(), body
    assert body["teamId"] == team
    assert body["channelId"] == "C0ALERTS"
    assert body["installation"]["team_name"] == "Acme"
    assert set(body["installation"]) == {"id", "team_name", "status", "linking"}
    # B7: the form path creates the Slack app destination for the channel picked on Slack's consent screen.
    assert body["destination"]["channel_id"] == "C0ALERTS"
    assert body["destination"]["name"].startswith("slack-alerts")
    assert body["channel_default_set"] is True
    assert "destination_refusal" not in body
    app = client.get(f"alerts/destinations/{body['destination']['name']}", org=slack_org).json()
    assert app["type"] == "slack_app" and app["installation_id"] == body["installation"]["id"]
    assert team_destinations(client, slack_org, team) == [], "no webhook destination is created any more"

    saved = client.post(
        "alerts/destinations", json=form_destination_payload(f"slack_{team.lower()}", body), org=slack_org
    )
    assert saved.status_code == 200, saved.text
    assert len(team_destinations(client, slack_org, team)) == 1

    default = channel_default(client, slack_org, body["installation"]["id"], "C0ALERTS")
    assert default is not None
    assert default["set_from"] == "install"
    assert default["set_by_this_org"] is True


def test_settings_path_creates_the_destination_and_default(client: OpenObserveClient, slack_org: str, team: str) -> None:
    resp = cloud_exchange(client, slack_org, "settings", team_id=team, channel_id="C0OPS", channel="#ops-private")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["destination"]["channel_id"] == "C0OPS"
    assert body["channel_default_set"] is True
    assert "webhookUrl" not in body, "no webhook URL outside the form path"
    app = client.get(f"alerts/destinations/{body['destination']['name']}", org=slack_org).json()
    assert app["type"] == "slack_app" and app["channel_id"] == "C0OPS", app
    assert team_destinations(client, slack_org, team) == [], "Settings creates a Slack app destination, not a webhook"
    assert channel_default(client, slack_org, body["installation"]["id"], "C0OPS")["set_from"] == "install"


def test_a_channel_with_a_default_keeps_it(client: OpenObserveClient, slack_org: str, team: str) -> None:
    first = cloud_exchange(client, slack_org, "settings", team_id=team).json()
    installation_id = first["installation"]["id"]
    path = f"slack/installations/{installation_id}/channel-defaults/C0ALERTS"
    put = client.put(path, json={"org_id": slack_org, "answer_mode": "private"}, org=slack_org)
    assert put.status_code == 200, put.text

    again = cloud_exchange(client, slack_org, "settings", team_id=team)
    assert again.status_code == 200, again.text
    assert again.json()["channel_default_set"] is False
    row = client.get(path, org=slack_org).json()
    assert row["answer_mode"] == "private"
    assert row["set_from"] == "settings"


def test_upgrade_in_place(client: OpenObserveClient, slack_org: str, team: str, mock: SlackMock) -> None:
    legacy = {
        "webhookUrl": f"{mock.base_url}/services/{team}/BLEGACY",
        "channel": "#general",
        "channelId": "C0GENERAL",
        "teamId": team,
        "teamName": "Acme",
    }
    name = f"legacy_{team.lower()}"
    assert client.post("alerts/destinations", json=form_destination_payload(name, legacy), org=slack_org).status_code == 200
    before = client.get(f"alerts/destinations/{name}", org=slack_org).json()

    listed = client.get("slack/installations", org=slack_org).json()
    candidate = next(c for c in listed["upgrade_candidates"] if c["team_id"] == team)
    assert [d["name"] for d in candidate["destinations"]] == [name]

    resp = cloud_exchange(client, slack_org, "upgrade_banner", team_id=team)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert client.get(f"alerts/destinations/{name}", org=slack_org).json() == before
    assert len(team_destinations(client, slack_org, team)) == 2
    installation_id = body["installation"]["id"]
    assert channel_default(client, slack_org, installation_id, "C0GENERAL") is not None
    assert channel_default(client, slack_org, installation_id, "C0ALERTS") is not None


def test_a_second_org_gets_a_connect_ticket(client: OpenObserveClient, slack_org: str, team: str) -> None:
    first = cloud_exchange(client, slack_org, "settings", team_id=team).json()
    second_org = make_org(client)

    resp = cloud_exchange(client, second_org, "settings", team_id=team, channel_id="C0OPS", channel="#ops-private")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["already_installed"] == {
        "installation_id": first["installation"]["id"],
        "team_name": "Acme",
        "this_org_connected": False,
    }
    assert slack_org not in resp.text, "no other org's name is returned"
    assert "webhookUrl" not in body

    path = f"slack/installations/{first['installation']['id']}/connection"
    connected = client.post(path, json={"connect_ticket": body["connect_ticket"]}, org=second_org)
    assert connected.status_code == 200, connected.text
    assert connected.json()["connected"] is True
    assert connected.json()["destination"]["channel_id"] == "C0OPS"
    assert connected.json()["channel_default_set"] is True
    app = client.get(f"alerts/destinations/{connected.json()['destination']['name']}", org=second_org).json()
    assert app["type"] == "slack_app", app
    assert team_destinations(client, second_org, team) == []

    reused = client.post(path, json={"connect_ticket": body["connect_ticket"]}, org=second_org)
    assert reused.status_code == 410, reused.text


def test_form_path_linking_summary(client: OpenObserveClient, slack_org: str, team: str) -> None:
    body = cloud_exchange(client, slack_org, "destination_form", team_id=team).json()
    linking = body["installation"]["linking"]
    assert linking["source"] == "manual"
    assert set(linking) == {"enabled", "source", "domains"}

    public_team = f"T{uuid.uuid4().hex[:8].upper()}"
    _, gmail_admin = make_user(client, slack_org, "admin", email=f"slack_{uuid.uuid4().hex[:6]}@gmail.com")
    public = cloud_exchange(gmail_admin, slack_org, "destination_form", team_id=public_team).json()
    assert public["installation"]["linking"]["enabled"] is False
    assert public["installation"]["linking"]["domains"] == []


def test_form_upgrade_banner(client: OpenObserveClient, slack_org: str, team: str) -> None:
    _, editor = make_user(client, slack_org, "editor")
    hidden = editor.get("slack/installations", org=slack_org)
    assert hidden.status_code == 403, hidden.text

    body = cloud_exchange(client, slack_org, "destination_form", team_id=team).json()
    assert WEBHOOK_FIELDS <= body.keys()
    saved = client.post(
        "alerts/destinations", json=form_destination_payload(f"banner_{team.lower()}", body), org=slack_org
    )
    assert saved.status_code == 200, saved.text
    assert len(team_destinations(client, slack_org, team)) == 1

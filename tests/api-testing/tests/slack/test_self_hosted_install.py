"""AC-7.3, 7.5, 7.6, 7.8 and 7.11: the self-hosted install with a configuration refresh token."""
from __future__ import annotations

import uuid
from urllib.parse import urlparse

import pytest

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

from .slack_helpers import SlackMock, query_param, self_hosted_install

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def installation_ids(client: OpenObserveClient, org: str) -> set[str]:
    resp = client.get("slack/installations", org=org)
    assert resp.status_code == 200, resp.text
    return {i["id"] for i in resp.json()["installations"]}


def create(client: OpenObserveClient, org: str, token: str) -> tuple[int, dict]:
    resp = client.post(
        "slack/installations",
        json={"mode": "socket", "config_refresh_token": token, "app_name": "O2 test"},
        org=org,
    )
    return resp.status_code, resp.json()


def test_config_token_rotates_once_creates_the_app_and_returns_o2s_bot_only_url(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    status, body = create(client, slack_org, "xoxe-1-first")
    assert status == 201, body
    rotations = ready.calls("tooling.tokens.rotate")
    assert [r["form"]["refresh_token"] for r in rotations] == ["xoxe-1-first"]
    creates = ready.calls("apps.manifest.create")
    assert len(creates) == 1
    assert creates[0]["bearer"].startswith("xoxe.xoxp-"), "the app is created with the rotated access token"
    app = ready.apps()[0]

    url = urlparse(body["authorize_url"])
    assert (url.scheme, url.netloc, url.path) == ("https", "slack.com", "/oauth/v2/authorize")
    assert query_param(body["authorize_url"], "client_id") == app["client_id"]
    assert "user_scope" not in body["authorize_url"]
    assert query_param(body["authorize_url"], "redirect_uri").endswith("/web/slack/oauth/callback")
    assert body["installation"]["status"] == "pending"
    assert body["installation"]["has_config_refresh_token"] is True
    assert body["app_settings_url"] == f"https://api.slack.com/apps/{app['app_id']}/general"


def test_a_refused_token_stores_nothing(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> None:
    before = installation_ids(client, slack_org)
    status, body = create(client, slack_org, "xoxe-1-expired")
    assert status == 422, body
    assert body["message"] == "This token has expired. Generate a new one"
    assert installation_ids(client, slack_org) == before
    assert ready.calls("apps.manifest.create") == []


def test_forget_clears_only_o2s_copy(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> None:
    installed = self_hosted_install(client, slack_org, team_id=f"T{uuid.uuid4().hex[:8].upper()}")
    installation_id = installed["installation"]["id"]
    rotations = len(ready.calls("tooling.tokens.rotate"))

    resp = client.put(
        f"slack/installations/{installation_id}/credentials", json={"config_refresh_token": None}, org=slack_org
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["has_config_refresh_token"] is False
    assert ready.calls("auth.revoke") == [], "Slack keeps its token; only O2's copy goes"

    manifest = client.get("slack/manifest?mode=socket&name=O2%20test", org=slack_org)
    assert manifest.status_code == 200, manifest.text
    assert manifest.json()["display_information"]["name"] == "O2 test"
    assert len(ready.calls("tooling.tokens.rotate")) == rotations


def test_finish_install_and_start_over(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> None:
    status, body = create(client, slack_org, "xoxe-1-pending")
    assert status == 201, body
    installation_id = body["installation"]["id"]

    finish = client.post(f"slack/installations/{installation_id}/install-url", org=slack_org)
    assert finish.status_code == 200, finish.text
    assert query_param(finish.json()["authorize_url"], "client_id") == ready.apps()[0]["client_id"]

    over = client.delete(f"slack/installations/{installation_id}", org=slack_org)
    assert over.status_code == 200, over.text
    assert len(ready.calls("apps.manifest.delete")) == 1
    assert ready.apps() == [], "no second app is left in Slack"
    assert installation_id not in installation_ids(client, slack_org)


def test_credentials_from_another_app_are_refused_and_a_valid_update_keeps_the_install(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    team = f"T{uuid.uuid4().hex[:8].upper()}"
    installed = self_hosted_install(client, slack_org, team_id=team)
    installation_id = installed["installation"]["id"]
    path = f"slack/installations/{installation_id}/credentials"

    other = client.put(path, json={"client_id": "999.888"}, org=slack_org)
    assert other.status_code == 409, other.text
    assert other.json()["message"] == "These credentials belong to another Slack app"

    finish = client.post(f"slack/installations/{installation_id}/install-url", org=slack_org)
    state = query_param(finish.json()["authorize_url"], "state")
    wrong_app = client.post(
        "slack/install/exchange", json={"code": mock_code(team_id=team, app_id="A0OTHER"), "state": state}, org=slack_org
    )
    assert wrong_app.status_code == 409, wrong_app.text

    valid = client.put(path, json={"app_token": "xapp-1-mock-new", "signing_secret": "s-2"}, org=slack_org)
    assert valid.status_code == 200, valid.text
    assert valid.json()["id"] == installation_id
    assert installation_id in installation_ids(client, slack_org)

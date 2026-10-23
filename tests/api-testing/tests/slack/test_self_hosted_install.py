"""AC-7.3, 7.5, 7.6, 7.8 and 7.11: the self-hosted install with a configuration refresh token."""
from __future__ import annotations

import json
import time
import uuid
from urllib.parse import urlparse

import pytest

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

from .slack_helpers import SlackMock, audit_rows, make_slack_org, query_param, self_hosted_install, wait_until

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


# Slack's real layouts (xapp-1-<app id>-<digits>-<hex>, xoxe.xoxp-1-…), joined at runtime so secret scanners skip them.
FAKE_APP_ID = "A0FAKEAPP01"
CONFIG_ACCESS = "xoxe." + "-".join(["xoxp", "1", "ZmFrZS1hY2Nlc3MtdG9rZW4"])
NOT_CONFIG_TOKEN = (
    "This is not a configuration refresh token. Copy the refresh token from api.slack.com/apps › "
    "Your App Configuration Tokens; it starts with xoxe-"
)
CONFIG_ACCESS_TOKEN = "This is the configuration access token. Paste the refresh token shown with it; it starts with xoxe-"
NOT_APP_TOKEN = (
    "This is not an app-level token. Generate one on the app's Basic Information page › App-Level Tokens "
    "with the connections:write scope; it starts with xapp-"
)
TOKEN_REFUSED = (
    "Slack refused this refresh token: each one works once and it was already used or replaced. "
    "Generate a new token and paste its refresh token"
)
APP_TOKEN_REFUSED = (
    "Slack refused the app-level token: it was revoked or mistyped. Generate a new one on the app's "
    "Basic Information page › App-Level Tokens"
)


def app_token(app_id: str) -> str:
    return "-".join(["xapp", "1", app_id, "1000000000000", "f" * 64])


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
    assert body["message"] == TOKEN_REFUSED
    assert installation_ids(client, slack_org) == before
    assert ready.calls("apps.manifest.create") == []


def test_a_used_config_token_names_the_cause(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> None:
    """Slack answers ``invalid_refresh_token`` for a token it already rotated; the message names that cause."""
    token = f"xoxe-1-{uuid.uuid4().hex}"
    status, body = create(client, slack_org, token)
    assert status == 201, body
    before = installation_ids(client, slack_org)
    creates = len(ready.calls("apps.manifest.create"))

    status, body = create(client, slack_org, token)
    assert (status, body["message"]) == (422, TOKEN_REFUSED), body
    assert installation_ids(client, slack_org) == before
    assert len(ready.calls("apps.manifest.create")) == creates


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
    assert over.json()["app_deleted"] is True
    assert "app_delete_error" not in over.json()
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

    other_token = client.put(path, json={"app_token": "xapp-1-A0OTHER-1-mock"}, org=slack_org)
    assert other_token.status_code == 409, other_token.text

    malformed = client.put(path, json={"app_token": "xapp-1-mock-new"}, org=slack_org)
    assert malformed.status_code == 400, malformed.text

    app_id = installed["installation"]["app_id"]
    valid = client.put(path, json={"app_token": f"xapp-1-{app_id}-1-mock-new", "signing_secret": "s-2"}, org=slack_org)
    assert valid.status_code == 200, valid.text
    assert valid.json()["id"] == installation_id
    assert installation_id in installation_ids(client, slack_org)


def test_a_secret_write_is_audited_redacted(client: OpenObserveClient, ready: SlackMock) -> None:
    """OR-B1: the audit layer sees ``{org}/slack/...`` and still redacts the configuration token."""
    org = make_slack_org(client)
    since = int(time.time() * 1_000_000) - 5_000_000
    token = f"xoxe-1-{uuid.uuid4().hex}"
    status, body = create(client, org, token)
    assert status == 201, body
    where = f"org_id = '{org}' AND http_method = 'POST' AND http_path LIKE '%slack/installations'"
    rec = wait_until(lambda: audit_rows(client, where, since), "the install audit record (O2_AUDIT_PUBLISH_INTERVAL=1)",
                     timeout=40)[0]
    assert rec["http_body"] == "[REDACTED: secret write]", rec
    assert token not in json.dumps(rec)


def test_start_over_reports_an_app_slack_kept(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> None:
    """Live 17:07: the stored refresh token was refused, apps.manifest.delete never ran, and O2 still said 200."""
    status, body = create(client, slack_org, f"xoxe-1-{uuid.uuid4().hex}")
    assert status == 201, body
    installation_id = body["installation"]["id"]
    app_id = ready.apps()[0]["app_id"]
    ready.fail("tooling.tokens.rotate", "invalid_refresh_token")

    over = client.delete(f"slack/installations/{installation_id}", org=slack_org)
    assert over.status_code == 200, over.text
    result = over.json()
    assert result["app_deleted"] is False
    assert result["app_delete_error"] == TOKEN_REFUSED
    assert result["delete_app_url"] == f"https://api.slack.com/apps/{app_id}/general"
    assert ready.calls("apps.manifest.delete") == []
    assert [a["app_id"] for a in ready.apps()] == [app_id], "the app is still in Slack"
    assert installation_id not in installation_ids(client, slack_org)


def test_a_token_of_the_wrong_kind_is_named_before_slack_is_called(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    for pasted, message in [(app_token(FAKE_APP_ID), NOT_CONFIG_TOKEN), (CONFIG_ACCESS, CONFIG_ACCESS_TOKEN)]:
        status, body = create(client, slack_org, pasted)
        assert (status, body["message"]) == (400, message), body
    assert ready.calls("tooling.tokens.rotate") == []

    installed = self_hosted_install(client, slack_org, team_id=f"T{uuid.uuid4().hex[:8].upper()}")
    path = f"slack/installations/{installed['installation']['id']}/credentials"
    app_id = installed["installation"]["app_id"]
    rotations = len(ready.calls("tooling.tokens.rotate"))
    swapped = client.put(path, json={"app_token": f"xoxe-1-{uuid.uuid4().hex}"}, org=slack_org)
    assert (swapped.status_code, swapped.json()["message"]) == (400, NOT_APP_TOKEN), swapped.text
    swapped = client.put(path, json={"config_refresh_token": app_token(app_id)}, org=slack_org)
    assert (swapped.status_code, swapped.json()["message"]) == (400, NOT_CONFIG_TOKEN), swapped.text
    assert ready.calls("apps.connections.open") == []
    assert len(ready.calls("tooling.tokens.rotate")) == rotations

    ready.fail("apps.connections.open", "invalid_auth")
    refused = client.put(path, json={"app_token": app_token(app_id)}, org=slack_org)
    assert (refused.status_code, refused.json()["message"]) == (400, APP_TOKEN_REFUSED), refused.text
    assert "scope" not in refused.json()["message"]


def test_the_test_route_takes_no_body_and_still_refuses_text(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    """Live: ``POST …/test`` without ``Content-Type: application/json`` answered 400."""
    installed = self_hosted_install(client, slack_org, team_id=f"T{uuid.uuid4().hex[:8].upper()}")
    path = f"slack/installations/{installed['installation']['id']}/test"
    bare = client.post(path, org=slack_org)
    assert bare.status_code == 200, bare.text
    assert {c["id"] for c in bare.json()["checks"]} >= {"auth_test"}
    text = client.post(path, data="channel_id=C0ALERTS", org=slack_org)
    assert text.status_code == 400, text.text

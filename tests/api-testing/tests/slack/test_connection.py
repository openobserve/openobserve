"""AC-7.10: Step 4's Sign in with Slack test, and the connect/test round trip (rows 14-15)."""
from __future__ import annotations

import uuid

import pytest

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

from .slack_helpers import SlackMock, query_param, self_hosted_install

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def installed(client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: SlackMock) -> dict:
    team = f"T{uuid.uuid4().hex[:8].upper()}"
    body = self_hosted_install(client, slack_org, team_id=team)
    return {"id": body["installation"]["id"], "team": team}


def sign_in(client: OpenObserveClient, org: str, installation_id: str, team: str, **claims: str):
    start = client.post(f"slack/installations/{installation_id}/connection/start", json={"purpose": "test"}, org=org)
    assert start.status_code == 200, start.text
    url = start.json()["url"]
    assert url.startswith("https://slack.com/openid/connect/authorize?")
    assert query_param(url, "team") == team
    code = mock_code(nonce=query_param(url, "nonce"), team_id=team, **claims)
    return client.post("slack/connection/confirm", json={"oidc_code": code, "oidc_state": query_param(url, "state")}, org=org)


def test_purpose_test_passes(client: OpenObserveClient, slack_org: str, installed: dict, mock: SlackMock) -> None:
    resp = sign_in(client, slack_org, installed["id"], installed["team"])
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"test": "pass"}
    tokens = mock.calls("openid.connect.token")
    assert len(tokens) == 1
    assert len(mock.calls("auth.revoke")) == 1, "the proof token is revoked"


def test_purpose_test_wrong_secret(client: OpenObserveClient, slack_org: str, installed: dict) -> None:
    put = client.put(
        f"slack/installations/{installed['id']}/credentials", json={"client_secret": "wrong"}, org=slack_org
    )
    assert put.status_code == 200, put.text
    resp = sign_in(client, slack_org, installed["id"], installed["team"])
    assert resp.status_code == 400, resp.text
    assert "client secret" in resp.json()["message"]


def test_another_workspace_is_refused(client: OpenObserveClient, slack_org: str, installed: dict) -> None:
    start = client.post(f"slack/installations/{installed['id']}/connection/start", json={"purpose": "test"}, org=slack_org)
    url = start.json()["url"]
    code = mock_code(nonce=query_param(url, "nonce"), team_id="T0ELSEWHERE")
    resp = client.post("slack/connection/confirm", json={"oidc_code": code, "oidc_state": query_param(url, "state")}, org=slack_org)
    assert resp.status_code == 403, resp.text


def test_a_nonce_mismatch_is_refused(client: OpenObserveClient, slack_org: str, installed: dict) -> None:
    start = client.post(f"slack/installations/{installed['id']}/connection/start", json={"purpose": "test"}, org=slack_org)
    url = start.json()["url"]
    code = mock_code(nonce="not-the-nonce", team_id=installed["team"])
    resp = client.post("slack/connection/confirm", json={"oidc_code": code, "oidc_state": query_param(url, "state")}, org=slack_org)
    assert resp.status_code == 400, resp.text

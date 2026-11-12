"""AC-1.6: the flag on with ``O2_MASTER_ENCRYPTION_KEY`` empty and ``ZO_DELEGATION_SIGNING_KEY`` set.

Runs against its own server run (``O2_SLACK_ENABLED=true``, master key empty, delegation key set); skips
itself unless the org config reports ``slack_disabled_reason == "master_key"``.
"""
from __future__ import annotations

from urllib.parse import urljoin

import pytest
import requests

from support.client import OpenObserveClient

from .slack_helpers import ROUTES, SlackMock, call

pytestmark = [pytest.mark.enterprise]


@pytest.fixture(scope="module")
def no_master_key(enterprise_build: str, slack_state: dict) -> dict:
    if slack_state["slack_disabled_reason"] != "master_key":
        pytest.skip("run against a server with O2_SLACK_ENABLED=true and O2_MASTER_ENCRYPTION_KEY empty")
    return slack_state


def test_org_config_says_the_master_key_is_missing(no_master_key: dict) -> None:
    assert no_master_key["slack_enabled"] is False
    assert no_master_key["slack_disabled_reason"] == "master_key"


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=[f"{m} {p}" for m, p, _ in ROUTES])
def test_every_org_route_is_404(
    client: OpenObserveClient, slack_org: str, no_master_key: dict, method: str, path: str, body: dict | None
) -> None:
    resp = call(client, method, path, body, org=slack_org)
    assert resp.status_code == 404, resp.text
    assert resp.json() == {"code": 404, "message": "Slack is not enabled"}


@pytest.mark.parametrize("kind", ["events", "commands", "interactions"])
def test_inbound_slack_routes_are_404(client: OpenObserveClient, no_master_key: dict, kind: str) -> None:
    resp = requests.post(
        urljoin(client.base_url, f"api/slack/{kind}"),
        data=b'{"type": "url_verification", "challenge": "c"}',
        headers={"Content-Type": "application/json", "X-Slack-Request-Timestamp": "1", "X-Slack-Signature": "v0=00"},
        timeout=10,
    )
    assert resp.status_code == 404, resp.text


def test_a_delegated_token_is_401(client: OpenObserveClient, slack_org: str, no_master_key: dict) -> None:
    resp = requests.get(
        urljoin(client.base_url, f"api/{slack_org}/streams"),
        headers={"Authorization": "Bearer o2dt.e30.bWFj"},
        timeout=10,
    )
    assert resp.status_code == 401, resp.text


def test_the_prerequisites_name_the_master_key(client: OpenObserveClient, slack_org: str, no_master_key: dict) -> None:
    resp = client.get("slack/prerequisites", org=slack_org)
    assert resp.status_code == 200, resp.text
    checks = {c["id"]: c for c in resp.json()["checks"]}
    assert checks["master_key"]["status"] == "fail", checks["master_key"]
    assert checks["delegation_key"]["status"] == "pass", checks["delegation_key"]


def test_an_install_attempt_stores_nothing_and_never_calls_slack(
    client: OpenObserveClient, slack_org: str, no_master_key: dict, mock: SlackMock
) -> None:
    created = client.post(
        "slack/installations", json={"mode": "socket", "config_refresh_token": "xoxe-1-nokey"}, org=slack_org
    )
    assert created.status_code == 404, created.text
    started = client.post("slack/install/start", json={"source": "settings"}, org=slack_org)
    assert started.status_code == 404, started.text
    assert mock.calls() == [], "no Slack call, so no app, token or row was made"
    assert mock.apps() == []
    assert client.get("slack/installations", org=slack_org).status_code == 404

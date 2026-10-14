"""Shared helpers for the Slack app API tests (spec section 13, kind I).

The server under test is a debug enterprise build in local mode with SQLite, started with
``O2_SLACK_API_BASE_URL`` pointing at ``helpers/slack_mock.py``. Two runs cover the suite:

- flag off (``O2_SLACK_ENABLED`` unset): ``test_disabled.py`` runs, everything else skips;
- flag on (``O2_SLACK_ENABLED=true``, ``O2_MASTER_ENCRYPTION_KEY`` set, ``ZO_SSRF_ALLOW_LOOPBACK=true``):
  the install, RBAC and allowlist tests run and ``test_disabled.py`` skips.

``SLACK_MOCK_URL`` is the mock's root (default ``http://127.0.0.1:5099``).
"""
from __future__ import annotations

import os
import uuid
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
import requests

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

PASSWORD = "Complexpass#123"
MOCK_TEAM = "T0MOCK"

# Every /api/{org}/slack/* route of commit 8 with a body that parses, so only the gate decides.
ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("POST", "slack/install/start", {"source": "settings"}),
    ("POST", "slack/install/exchange", {"code": "c", "state": "s"}),
    ("POST", "slack/connectivity", {}),
    ("GET", "slack/manifest?mode=socket", None),
    ("GET", "slack/installations", None),
    ("POST", "slack/installations", {"mode": "socket", "config_refresh_token": "xoxe-1-x"}),
    ("POST", "slack/installations/I1/install-url", None),
    ("PUT", "slack/installations/I1/credentials", {"client_secret": "x"}),
    ("POST", "slack/installations/I1/test", {}),
    ("GET", "slack/installations/I1/linking", None),
    ("PUT", "slack/installations/I1/linking", {"enabled": False}),
    ("GET", "slack/installations/I1/links/matches", None),
    ("POST", "slack/installations/I1/link-all", None),
    ("POST", "slack/installations/I1/connection/start", {"purpose": "connect"}),
    ("POST", "slack/connection/confirm", {"oidc_code": "c", "oidc_state": "s"}),
    ("POST", "slack/installations/I1/connection", {"connect_ticket": "t"}),
    ("DELETE", "slack/installations/I1/connection", None),
    ("DELETE", "slack/installations/I1", None),
    ("GET", "slack/installations/I1/channels?q=al", None),
    ("GET", "slack/installations/I1/channel-defaults", None),
    ("GET", "slack/installations/I1/channel-defaults/C1", None),
    ("PUT", "slack/installations/I1/channel-defaults/C1", {"org_id": "default", "answer_mode": "thread"}),
    ("DELETE", "slack/installations/I1/channel-defaults/C1", None),
    ("GET", "slack/installations/I1/help-contact", None),
    ("PUT", "slack/installations/I1/help-contact", {"help_contact": "#help"}),
]


class SlackMock:
    """Control client for ``helpers/slack_mock.py``."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or os.environ.get("SLACK_MOCK_URL", "http://127.0.0.1:5099")).rstrip("/")

    def reachable(self) -> bool:
        try:
            return requests.get(f"{self.base_url}/_mock/health", timeout=2).ok
        except requests.RequestException:
            return False

    def reset(self) -> None:
        requests.post(f"{self.base_url}/_mock/reset", json={}, timeout=5).raise_for_status()

    def calls(self, method: str | None = None) -> list[dict[str, Any]]:
        params = {"method": method} if method else {}
        resp = requests.get(f"{self.base_url}/_mock/requests", params=params, timeout=5)
        resp.raise_for_status()
        return resp.json()["requests"]

    def fail(self, method: str, error: str, times: int = 1) -> None:
        body = {"method": method, "error": error, "times": times}
        requests.post(f"{self.base_url}/_mock/fail", json=body, timeout=5).raise_for_status()

    def add_team(self, team_id: str, team_name: str, **extra: Any) -> None:
        body = {"team_id": team_id, "team_name": team_name, **extra}
        requests.post(f"{self.base_url}/_mock/teams", json=body, timeout=5).raise_for_status()

    def apps(self) -> list[dict[str, Any]]:
        resp = requests.get(f"{self.base_url}/_mock/state", timeout=5)
        resp.raise_for_status()
        return resp.json()["apps"]


def slack_config(client: OpenObserveClient, org: str) -> dict[str, Any]:
    """The org config keys of spec section 2."""
    resp = client.get("config", org=org)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {k: body.get(k) for k in ("slack_enabled", "slack_disabled_reason", "slack_home_region", "build_type")}


def make_org(client: OpenObserveClient) -> str:
    name = f"slackorg_{uuid.uuid4().hex[:8]}"
    resp = client.post("api/organizations", json={"name": name}, prefix="")
    assert resp.status_code == 200, resp.text
    return resp.json()["identifier"]


def make_slack_org(client: OpenObserveClient) -> str:
    """A fresh org with Slack on; skips under an ``O2_SLACK_ALLOWED_ORGS`` that leaves fresh orgs out."""
    org = make_org(client)
    state = slack_config(client, org)
    if not state["slack_enabled"]:
        pytest.skip(f"a fresh org has Slack off ({state['slack_disabled_reason']}); run without O2_SLACK_ALLOWED_ORGS")
    return org


def make_user(client: OpenObserveClient, org: str, role: str, email: str | None = None) -> tuple[str, OpenObserveClient]:
    """An org member with ``role`` and a client that acts as them."""
    email = email or f"slack_{role}_{uuid.uuid4().hex[:8]}@acme.test"
    payload = {
        "email": email, "password": PASSWORD, "first_name": "Slack",
        "last_name": role.capitalize(), "role": role, "organization": org,
    }
    resp = client.users.create(payload, org=org)
    if resp.status_code == 400 and "open-fga" in resp.text and role != "admin":
        # Enterprise without OpenFGA creates only admins; an existing user still joins an org with any role.
        home = make_org(client)
        created = client.users.create({**payload, "role": "admin", "organization": home}, org=home)
        assert created.status_code == 200, created.text
        add_to_org(client, org, email, role)
    elif resp.status_code != 200:
        raise AssertionError(f"creating {role} user failed: {resp.status_code} {resp.text}")
    return email, OpenObserveClient(email=email, password=PASSWORD, org=org)


def add_to_org(client: OpenObserveClient, org: str, email: str, role: str) -> None:
    resp = client.post(f"users/{email}", json={"role": role}, org=org)
    assert resp.status_code == 200, resp.text


def call(client: OpenObserveClient, method: str, path: str, body: dict[str, Any] | None, org: str | None = None) -> requests.Response:
    kwargs: dict[str, Any] = {"org": org}
    if body is not None or method in ("POST", "PUT"):
        kwargs["json"] = body if body is not None else {}
    return client.request(method, path, **kwargs)


def query_param(url: str, name: str) -> str:
    return parse_qs(urlparse(url).query)[name][0]


def self_hosted_install(
    client: OpenObserveClient, org: str, *, team_id: str = MOCK_TEAM, mode: str = "socket"
) -> dict[str, Any]:
    """Config-token install, then Allow: returns the settings-shape exchange body."""
    created = client.post(
        "slack/installations",
        json={"mode": mode, "config_refresh_token": f"xoxe-1-{uuid.uuid4().hex[:8]}", "app_name": "O2 test"},
        org=org,
    )
    assert created.status_code == 201, created.text
    state = query_param(created.json()["authorize_url"], "state")
    exchanged = client.post(
        "slack/install/exchange", json={"code": mock_code(team_id=team_id), "state": state}, org=org
    )
    assert exchanged.status_code == 200, exchanged.text
    return exchanged.json()


def cloud_exchange(
    client: OpenObserveClient,
    org: str,
    source: str,
    *,
    team_id: str = MOCK_TEAM,
    channel_id: str = "C0ALERTS",
    channel: str = "#alerts",
) -> requests.Response:
    """Cloud install start, Allow in the popup (simulated), then the exchange."""
    started = client.post("slack/install/start", json={"source": source}, org=org)
    assert started.status_code == 200, started.text
    state = query_param(started.json()["authorization_url"], "state")
    code = mock_code(team_id=team_id, channel_id=channel_id, channel=channel)
    return client.post("slack/install/exchange", json={"code": code, "state": state}, org=org)


def connect_with_proof(client: OpenObserveClient, org: str, installation_id: str, *, team_id: str = MOCK_TEAM) -> requests.Response:
    """Sign in with Slack (simulated): the nonce and state ride inside the mock code."""
    started = client.post(f"slack/installations/{installation_id}/connection/start", json={"purpose": "connect"}, org=org)
    assert started.status_code == 200, started.text
    url = started.json()["url"]
    code = mock_code(nonce=query_param(url, "nonce"), team_id=team_id, user_id="U0DANA")
    return client.post("slack/connection/confirm", json={"oidc_code": code, "oidc_state": query_param(url, "state")}, org=org)


def form_destination_payload(name: str, fields: dict[str, Any]) -> dict[str, Any]:
    """What the destination form's Save sends after applyConnection (usePrebuiltDestinations)."""
    return {
        "name": name,
        "type": "http",
        "url": fields["webhookUrl"],
        "method": "post",
        "template": "prebuilt_slack",
        "skip_tls_verify": False,
        "headers": {},
        "output_format": "json",
        "destination_type_name": "slack",
        "metadata": {
            "prebuilt_type": "slack",
            "setup_method": "oauth",
            "slack_team_id": fields["teamId"],
            "slack_team_name": fields["teamName"],
            "slack_channel_id": fields["channelId"],
        },
    }


def destinations(client: OpenObserveClient, org: str) -> list[dict[str, Any]]:
    resp = client.get("alerts/destinations", org=org)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body if isinstance(body, list) else body.get("list", [])


def team_destinations(client: OpenObserveClient, org: str, team_id: str) -> list[dict[str, Any]]:
    return [d for d in destinations(client, org) if (d.get("metadata") or {}).get("slack_team_id") == team_id]

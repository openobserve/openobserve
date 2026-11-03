"""Shared helpers for the Slack app API tests (spec section 13, kind I).

The server under test is a debug enterprise build in local mode with SQLite, started with
``O2_SLACK_API_BASE_URL`` pointing at ``helpers/slack_mock.py``. Two runs cover the suite:

- flag off (``O2_SLACK_ENABLED`` unset): ``test_disabled.py`` runs, everything else skips;
- flag on (``O2_SLACK_ENABLED=true``, ``O2_MASTER_ENCRYPTION_KEY`` set, ``ZO_SSRF_ALLOW_LOOPBACK=true``):
  the install and RBAC tests run and ``test_disabled.py`` skips.

``SLACK_MOCK_URL`` is the mock's root (default ``http://127.0.0.1:5099``). ``SLACK_SUITE_REQUIRED=1`` turns
every harness skip (no enterprise build, a mock unreachable, AI off, no signing key) into a failure; skips
that only say which server run a test belongs to (flag on or off, Cloud) stay skips.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from collections.abc import Callable
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import pytest
import requests

from helpers.slack_mock import DEFAULT_USER, member, mock_code
from support.client import OpenObserveClient

PASSWORD = "Complexpass#123"
MOCK_TEAM = "T0MOCK"

# Every /api/{org}/slack/* route of commits 8 and 10 with a body that parses, so only the gate decides.
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
    ("POST", "slack/link-requests/R1/start", {"sig": "x"}),
    ("POST", "slack/link-requests/confirm", {"oidc_code": "c", "oidc_state": "s"}),
    ("POST", "slack/link-requests/R1/resend", {"sig": "x"}),
    ("GET", "slack/links/me", None),
    ("DELETE", "slack/links/L1", None),
    ("GET", "slack/links", None),
]


def harness_skip(reason: str) -> None:
    """Skips, or fails under ``SLACK_SUITE_REQUIRED=1`` so a misconfigured run cannot pass empty."""
    if os.environ.get("SLACK_SUITE_REQUIRED") == "1":
        pytest.fail(f"SLACK_SUITE_REQUIRED=1 but {reason}", pytrace=False)
    pytest.skip(reason)


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

    def mode(self, method: str, http_status: int, error: str | None = None, retry_after: int | None = None) -> None:
        """Every call of ``method`` fails this way until ``clear_mode``: a Slack outage or a 429 storm."""
        body: dict[str, Any] = {"method": method, "http_status": http_status}
        if error:
            body["error"] = error
        if retry_after is not None:
            body["retry_after"] = retry_after
        requests.post(f"{self.base_url}/_mock/mode", json=body, timeout=5).raise_for_status()

    def clear_mode(self, method: str) -> None:
        requests.post(f"{self.base_url}/_mock/mode", json={"method": method, "clear": True}, timeout=5).raise_for_status()

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
    return {k: body.get(k) for k in ("slack_enabled", "slack_disabled_reason", "build_type")}


def make_org(client: OpenObserveClient) -> str:
    name = f"slackorg_{uuid.uuid4().hex[:8]}"
    resp = client.post("api/organizations", json={"name": name}, prefix="")
    assert resp.status_code == 200, resp.text
    return resp.json()["identifier"]


def make_slack_org(client: OpenObserveClient) -> str:
    """A fresh org; Slack is on or off for the whole deployment, never per org (R-92)."""
    org = make_org(client)
    state = slack_config(client, org)
    assert state["slack_enabled"], state
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
    code = mock_code(nonce=query_param(url, "nonce"), team_id=team_id, user_id=DEFAULT_USER)
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


LINK_URL = re.compile(r"https?://[^\s\"<>|]*/web/slack/link\?r=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)")


def wait_until(probe: Callable[[], Any], what: str, timeout: float = 20.0) -> Any:
    """Polls until ``probe`` returns something truthy, and returns it."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(0.25)
    raise AssertionError(f"timed out waiting for {what}")


def audit_rows(client: OpenObserveClient, where: str, since_us: int) -> list[dict[str, Any]]:
    """Rows of the ``_meta`` audit stream matching ``where`` (server needs ``O2_AUDIT_PUBLISH_INTERVAL=1``)."""
    now = int(time.time() * 1_000_000)
    body = {"query": {"sql": f'SELECT * FROM "audit" WHERE {where}', "start_time": since_us,
                      "end_time": now + 60_000_000, "from": 0, "size": 50}}
    resp = client.post("_search?type=logs", json=body, org="_meta")
    return resp.json().get("hits", []) if resp.status_code == 200 else []


def token_claims(token: str) -> dict[str, Any]:
    """The claims of an ``o2dt.`` token (its middle segment, base64url JSON)."""
    segment = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))


def signed_post(client: OpenObserveClient, kind: str, body: bytes, secret: str, content_type: str = "application/json") -> requests.Response:
    """POST to ``/api/slack/<kind>`` as Slack does: no O2 credentials, only the v0 signature."""
    stamp = str(int(time.time()))
    mac = hmac.new(secret.encode(), b"v0:" + stamp.encode() + b":" + body, hashlib.sha256).hexdigest()
    headers = {"Content-Type": content_type, "X-Slack-Request-Timestamp": stamp, "X-Slack-Signature": "v0=" + mac}
    return requests.post(urljoin(client.base_url, f"api/slack/{kind}"), data=body, headers=headers, timeout=15)


def new_team(mock: SlackMock, *members: dict[str, Any]) -> str:
    """A fresh mock workspace, so link-request limits and links never carry over between tests."""
    team_id = "T0L" + uuid.uuid4().hex[:8].upper()
    mock.add_team(team_id, f"Acme {team_id[-4:]}", members=[
        *({**m, "team_id": team_id} for m in members),
        member(DEFAULT_USER, team_id, "admin", None),
        {**member("U0BOT", team_id, "o2bot", None), "is_bot": True},
    ])
    return team_id


def slack_user(user_id: str, team_id: str, email: str, **flags: Any) -> dict[str, Any]:
    return member(user_id, team_id, user_id[2:].lower(), email, **flags)


def mention(inst: dict[str, Any], team_id: str, user_id: str, text: str = "<@U0BOT> errors in checkout?", *,
            event_id: str | None = None) -> bytes:
    """An ``app_mention`` event_callback in the shape Slack sends (ids anonymized)."""
    now = f"{time.time():.6f}"
    event = {"type": "app_mention", "user": user_id, "text": text, "ts": now, "team": team_id,
             "user_team": team_id, "channel": "C0OPS", "event_ts": now}
    return json.dumps({
        "token": "ignored", "team_id": team_id, "api_app_id": inst["app_id"], "event": event,
        "type": "event_callback", "event_id": event_id or "Ev" + uuid.uuid4().hex[:10],
        "event_time": int(time.time()),
        "authorizations": [{"enterprise_id": None, "team_id": team_id, "user_id": "U0BOT",
                            "is_bot": True, "is_enterprise_install": False}],
        "is_ext_shared_channel": False,
    }).encode()


def send_mention(client: OpenObserveClient, inst: dict[str, Any], team_id: str, user_id: str) -> None:
    resp = signed_post(client, "events", mention(inst, team_id, user_id), f"signing-{inst['app_id']}")
    assert resp.status_code == 200, resp.text


def dms_to(mock: SlackMock, user_id: str) -> list[dict[str, str]]:
    """Forms of every ``chat.postMessage`` to a user id (a DM)."""
    return [c["form"] for c in mock.calls("chat.postMessage") if c["form"].get("channel") == user_id]


def link_prompt(mock: SlackMock, user_id: str, seen: int = 0) -> tuple[str, str]:
    """The ``(request_id, sig)`` of the newest link URL DMed to ``user_id`` after ``seen`` earlier ones."""
    def found() -> list[tuple[str, str]]:
        refs = [m.groups() for f in dms_to(mock, user_id) if (m := LINK_URL.search(f.get("blocks", "")))]
        return refs if len(refs) > seen else []
    return wait_until(found, f"a link prompt DM to {user_id}")[-1]


def http_install(client: OpenObserveClient, org: str, team_id: str) -> dict[str, Any]:
    """An HTTP-mode installation in ``team_id``, as the installations list shows it."""
    exchanged = self_hosted_install(client, org, team_id=team_id, mode="http")
    resp = client.get("slack/installations", org=org)
    assert resp.status_code == 200, resp.text
    return next(i for i in resp.json()["installations"] if i["id"] == exchanged["installation"]["id"])


def sign_in_with_slack(
    user: OpenObserveClient, org: str, ref: tuple[str, str], *, slack_user_id: str, team_id: str
) -> requests.Response:
    """Start, then Slack's Accept and Continue as ``slack_user_id`` (nonce folded into the code), then confirm."""
    request_id, sig = ref
    started = user.post(f"slack/link-requests/{request_id}/start", json={"sig": sig}, org=org)
    assert started.status_code == 200, started.text
    url = started.json()["url"]
    code = mock_code(nonce=query_param(url, "nonce"), team_id=team_id, user_id=slack_user_id)
    return user.post("slack/link-requests/confirm", json={"oidc_code": code, "oidc_state": query_param(url, "state")}, org=org)


def my_links(user: OpenObserveClient, org: str) -> list[dict[str, Any]]:
    resp = user.get("slack/links/me", org=org)
    assert resp.status_code == 200, resp.text
    return resp.json()["links"]

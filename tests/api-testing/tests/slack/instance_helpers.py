"""Helpers for the instance workspace tests (spec section 7.7): a `_meta` install, row 24 and org Admins."""
from __future__ import annotations

import time
import uuid
from typing import Any

import requests

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

from .slack_helpers import SlackMock, make_user, query_param

META = "_meta"
META_HELP = "#o2-platform"


def config_token(mock: SlackMock, team_id: str) -> str:
    """A configuration refresh token whose rotation answers ``team_id``, as Slack names the token's workspace."""
    token = f"xoxe-1-{uuid.uuid4().hex}"
    body = {"refresh_token": token, "team_id": team_id}
    requests.post(f"{mock.base_url}/_mock/config_tokens", json=body, timeout=5).raise_for_status()
    return token


def manual_app(mock: SlackMock) -> dict[str, str]:
    """A Slack app created by hand (no configuration token), so O2 learns its team only at row 2."""
    app_id = "A0IW" + uuid.uuid4().hex[:7].upper()
    app = {"app_id": app_id, "client_id": f"9{uuid.uuid4().int % 10**9}.{uuid.uuid4().int % 10**9}",
           "client_secret": f"secret-{app_id}", "signing_secret": f"signing-{app_id}"}
    requests.post(f"{mock.base_url}/_mock/apps", json=app, timeout=5).raise_for_status()
    return app


def installations(client: OpenObserveClient, org: str) -> dict[str, Any]:
    """Row 9 as ``org`` sees it."""
    resp = client.get("slack/installations", org=org)
    assert resp.status_code == 200, resp.text
    return resp.json()


def view_in(client: OpenObserveClient, org: str, installation_id: str) -> dict[str, Any] | None:
    return next((i for i in installations(client, org)["installations"] if i["id"] == installation_id), None)


def meta_install(client: OpenObserveClient, mock: SlackMock, team_id: str, *, mode: str = "http") -> dict[str, Any]:
    """Row 6 from ``_meta`` with a configuration token of ``team_id``, then Allow (row 2); returns ``_meta``'s view."""
    created = client.post(
        "slack/installations",
        json={"mode": mode, "config_refresh_token": config_token(mock, team_id), "app_name": "O2 instance"},
        org=META,
    )
    assert created.status_code == 201, created.text
    state = query_param(created.json()["authorize_url"], "state")
    exchanged = client.post("slack/install/exchange", json={"code": mock_code(team_id=team_id), "state": state}, org=META)
    assert exchanged.status_code == 200, exchanged.text
    view = view_in(client, META, exchanged.json()["installation"]["id"])
    assert view is not None, "the installer org lists its installation"
    return view


def org_access_path(installation_id: str) -> str:
    return f"slack/installations/{installation_id}/org-access"


def org_access(client: OpenObserveClient, installation_id: str) -> dict[str, Any]:
    """Row 24 GET from ``_meta``."""
    resp = client.get(org_access_path(installation_id), org=META)
    assert resp.status_code == 200, resp.text
    return resp.json()


def put_org_access(client: OpenObserveClient, installation_id: str, body: dict[str, Any]) -> requests.Response:
    """Row 24 PUT from ``_meta``: ``{"all": true}`` or ``{"orgs": [...]}``, optionally ``"preview": true``."""
    return client.put(org_access_path(installation_id), json=body, org=META)


def served_ids(view: dict[str, Any]) -> set[str]:
    return {row["org_id"] for row in view["orgs"]}


def org_admin(client: OpenObserveClient, org: str) -> OpenObserveClient:
    return make_user(client, org, "admin")[1]


def org_name(client: OpenObserveClient, org: str) -> str:
    resp = client.get("api/organizations?page_size=100000", prefix="")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    rows = body.get("data", []) if isinstance(body, dict) else body
    return next(o["name"] for o in rows if o["identifier"] == org)


def rbac_enabled(client: OpenObserveClient) -> bool:
    return bool(client.get("config", org=META).json().get("rbac_enabled"))


def meta_role_user(client: OpenObserveClient, permissions: list[str]) -> OpenObserveClient:
    """A ``_meta`` member (role ``user``) holding only a custom role with ``permissions`` on ``slack_integration`` (OpenFGA on)."""
    email, user = make_user(client, META, "user")
    role = f"slack_iw_{uuid.uuid4().hex[:8]}"
    created = client.post("roles", json={"role": role}, org=META)
    assert created.status_code in (200, 201), created.text
    grants = [{"object": f"slack_integration:_all_{META}", "permission": p} for p in permissions]
    body = {"add": grants, "remove": [], "add_users": [email], "remove_users": []}
    granted = client.put(f"roles/{role}", json=body, org=META)
    assert granted.status_code == 200, granted.text
    # OpenFGA tuple writes are not read-your-writes.
    time.sleep(2)
    return user


def set_default(
    user: OpenObserveClient, org: str, installation_id: str, channel_id: str, target_org: str, mode: str = "thread"
) -> requests.Response:
    """Row 22 PUT as ``user`` acting in ``org``."""
    return user.put(
        f"slack/installations/{installation_id}/channel-defaults/{channel_id}",
        json={"org_id": target_org, "answer_mode": mode},
        org=org,
    )


def defaults_by_channel(client: OpenObserveClient, org: str, installation_id: str) -> dict[str, dict[str, Any]]:
    """Row 21 as ``org`` sees it, keyed by channel id."""
    resp = client.get(f"slack/installations/{installation_id}/channel-defaults", org=org)
    assert resp.status_code == 200, resp.text
    return {d["channel_id"]: d for d in resp.json()["defaults"]}

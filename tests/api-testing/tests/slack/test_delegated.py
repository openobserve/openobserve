"""AC-4.1 and AC-4.3: the delegated token over the API (spec section 6).

Phase 1 has no route that hands a token out (the bridge of commit 11 mints them), so the test mints
one exactly as ``config::utils::delegation::sign`` does: HKDF-SHA256 over the decoded
``O2_MASTER_ENCRYPTION_KEY`` (no salt, info ``o2-slack-delegation-v1``), or the
``ZO_DELEGATION_SIGNING_KEY`` override when set; both must be the server's own values.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from typing import Any
from urllib.parse import urljoin

import pytest
import requests

from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    add_to_org,
    connect_with_proof,
    http_install,
    make_org,
    make_slack_org,
    make_user,
    my_links,
    new_team,
    send_mention,
    slack_user,
    wait_until,
)

pytestmark = [pytest.mark.enterprise]

STREAM = "slack_delegated"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def signing_key() -> bytes:
    override = os.environ.get("ZO_DELEGATION_SIGNING_KEY", "")
    if override:
        return base64.b64decode(override)
    master = os.environ.get("O2_MASTER_ENCRYPTION_KEY", "")
    if not master:
        pytest.skip("set O2_MASTER_ENCRYPTION_KEY (or ZO_DELEGATION_SIGNING_KEY) to the server's value")
    prk = hmac.new(b"\0" * 32, base64.b64decode(master), hashlib.sha256).digest()
    return hmac.new(prk, b"o2-slack-delegation-v1\x01", hashlib.sha256).digest()


def mint(key: bytes, *, sub: str, org: str, lid: str) -> str:
    now = int(time.time())
    claims = {"v": 1, "sub": sub, "org": org, "lid": lid, "scope": "assistant",
              "iat": now, "exp": now + 3600, "jti": uuid.uuid4().hex}
    claims_b64 = b64url(json.dumps(claims, separators=(",", ":")).encode())
    mac = hmac.new(key, b"o2dt.v1\0" + claims_b64.encode(), hashlib.sha256).digest()
    return f"o2dt.{claims_b64}.{b64url(mac)}"


def search(client: OpenObserveClient, org: str, token: str) -> requests.Response:
    now = int(time.time() * 1_000_000)
    body = {"query": {"sql": f'SELECT * FROM "{STREAM}"', "start_time": now - 3_600_000_000,
                      "end_time": now + 60_000_000, "from": 0, "size": 10}}
    return requests.post(urljoin(client.base_url, f"api/{org}/_search?type=logs"), json=body,
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)


@pytest.fixture
def linked(client: OpenObserveClient, slack_on: None, self_hosted: None, mock: SlackMock) -> dict[str, Any]:
    """An Admin of a fresh org A, linked automatically to a Slack user of a workspace connected to A."""
    key = signing_key()
    org_a = make_slack_org(client)
    email = f"ann_{uuid.uuid4().hex[:8]}@acme.test"
    _, ann = make_user(client, org_a, "admin", email=email)
    team = new_team(mock, slack_user("U0ANN", "", email))
    inst = http_install(client, org_a, team)
    put = client.put(f"slack/installations/{inst['id']}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=org_a)
    assert put.status_code == 200, put.text
    send_mention(client, inst, team, "U0ANN")
    link = wait_until(lambda: my_links(ann, org_a), "the automatic link")[0]
    ingest = client.post(f"{STREAM}/_json", json=[{"level": "error", "message": "checkout timeout"}], org=org_a)
    assert ingest.status_code == 200, ingest.text
    return {"key": key, "org": org_a, "email": email, "link": link, "inst": inst, "team": team}


def test_search(client: OpenObserveClient, linked: dict[str, Any]) -> None:
    token = mint(linked["key"], sub=linked["email"], org=linked["org"], lid=linked["link"]["id"])
    resp = wait_until(
        lambda: (r := search(client, linked["org"], token)).status_code == 200 and r.json().get("hits") and r,
        "the delegated search to see the ingested record",
    )
    assert resp.json()["hits"][0]["message"] == "checkout timeout"
    forged = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    assert search(client, linked["org"], forged).status_code == 401


def test_path_org(client: OpenObserveClient, linked: dict[str, Any]) -> None:
    token = mint(linked["key"], sub=linked["email"], org=linked["org"], lid=linked["link"]["id"])
    unconnected = make_org(client)
    add_to_org(client, unconnected, linked["email"], "admin")
    resp = search(client, unconnected, token)
    assert resp.status_code == 403, resp.text

    connected = make_slack_org(client)
    add_to_org(client, connected, linked["email"], "admin")
    proof = connect_with_proof(client, connected, linked["inst"]["id"], team_id=linked["team"])
    assert proof.status_code == 200, proof.text
    resp = search(client, connected, token)
    assert resp.status_code == 403, resp.text

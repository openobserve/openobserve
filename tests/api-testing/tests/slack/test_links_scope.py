"""AC-9.15 (R-10): an Admin of org B, connected to the same workspace as org A, cannot list, see
matches for, or delete the links of users who are not members of B (spec section 7.3).
"""
from __future__ import annotations

import uuid
from typing import Any

import pytest

from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    connect_with_proof,
    http_install,
    make_slack_org,
    make_user,
    my_links,
    new_team,
    send_mention,
    slack_user,
    wait_until,
)

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def link_ids(admin: OpenObserveClient, org: str, installation_id: str) -> list[str]:
    resp = admin.get(f"slack/links?installation_id={installation_id}", org=org)
    assert resp.status_code == 200, resp.text
    return [link["id"] for link in resp.json()["links"]]


def matches(admin: OpenObserveClient, org: str, installation_id: str) -> list[dict[str, Any]]:
    resp = admin.get(f"slack/installations/{installation_id}/links/matches", org=org)
    assert resp.status_code == 200, resp.text
    return resp.json()["members"]


def test_org_b_admin_never_reaches_links_of_org_a_members(client: OpenObserveClient, ready: SlackMock) -> None:
    org_a, org_b = make_slack_org(client), make_slack_org(client)
    ann_email = f"ann_{uuid.uuid4().hex[:8]}@acme.test"
    _, ann = make_user(client, org_a, "editor", email=ann_email)
    _, a_admin = make_user(client, org_a, "admin")
    _, b_admin = make_user(client, org_b, "admin")
    team = new_team(ready, slack_user("U0ANN", "", ann_email))
    inst = http_install(client, org_a, team)
    connected = connect_with_proof(client, org_b, inst["id"], team_id=team)
    assert connected.status_code == 200, connected.text
    put = client.put(f"slack/installations/{inst['id']}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=org_a)
    assert put.status_code == 200, put.text

    assert [m["slack_user_id"] for m in matches(a_admin, org_a, inst["id"])] == ["U0ANN"]
    assert matches(b_admin, org_b, inst["id"]) == [], "B sees no match for a user who is not in B"

    send_mention(client, inst, team, "U0ANN")
    link = wait_until(lambda: my_links(ann, org_a), "Ann's automatic link")[0]

    assert link_ids(a_admin, org_a, inst["id"]) == [link["id"]]
    assert link_ids(b_admin, org_b, inst["id"]) == []
    every = b_admin.get("slack/links", org=org_b)
    assert every.status_code == 200, every.text
    assert every.json()["links"] == []

    refused = b_admin.delete(f"slack/links/{link['id']}", org=org_b)
    assert refused.status_code == 404, refused.text
    assert [mine["id"] for mine in my_links(ann, org_a)] == [link["id"]], "the link survives"

    removed = a_admin.delete(f"slack/links/{link['id']}", org=org_a)
    assert removed.status_code == 204, removed.text
    assert my_links(ann, org_a) == []

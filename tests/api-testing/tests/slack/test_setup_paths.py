"""Phase 2 B7: the unlinked on-call list, Remind and the pre-shift DM (spec 7.2, 7.3, 8.3 Before shifts; MK-15).

Runs on the self-hosted enterprise build with ``O2_ONCALL_ENABLED=true``, Slack on and the Slack mock. The
Cloud connect exchange (form and Settings sources create the Slack app destination) needs a
``--features cloud`` build and lives in ``test_cloud_install.py``; the self-hosted app has no incoming
webhook, so its exchange never reaches that path.
"""
from __future__ import annotations

import time
import uuid

import pytest

from support.client import OpenObserveClient

from tests.oncall.oncall_helpers import micros_from_now, oncall_enabled, rotation, shift_rule
from .slack_helpers import (
    SlackMock,
    dms_to,
    http_install,
    link_prompt,
    make_user,
    new_team,
    send_mention,
    sign_in_with_slack,
    slack_user,
    wait_until,
)

pytestmark = [pytest.mark.enterprise]
WEEK_MICROS = 7 * 24 * 60 * 60 * 1_000_000


@pytest.fixture
def world(client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, mock: SlackMock) -> dict:
    if not oncall_enabled(client, slack_org):
        pytest.skip("needs O2_ONCALL_ENABLED=true")
    tag = uuid.uuid4().hex[:6]
    dana, dana_client = make_user(client, slack_org, "editor", email=f"dana_{tag}@acme.test")
    lee, lee_client = make_user(client, slack_org, "editor", email=f"lee_{tag}@acme.test")
    kim, _ = make_user(client, slack_org, "editor", email=f"kim_{tag}@acme.test")
    # kim has an OpenObserve account but no Slack user: Slack answers users_not_found for them.
    team = new_team(mock, slack_user("U0DANA", "", dana), slack_user("U0LEE", "", lee))
    inst = http_install(client, slack_org, team)
    return {
        "tag": tag, "team": team, "inst": inst, "dana": dana, "dana_client": dana_client,
        "lee": lee, "lee_client": lee_client, "kim": kim,
    }


def oncall_team(client: OpenObserveClient, org: str, name: str, timezone: str, members: list[str],
                primary: dict, secondary: dict) -> str:
    """A real on-call team with a roster and one rotation, through the on-call API."""
    created = client.post("oncall/teams", json={"name": name, "timezone": timezone}, org=org)
    assert created.status_code == 200, created.text
    team_id = created.json()["id"]
    for email in members:
        added = client.post(f"oncall/teams/{team_id}/members", json={"user_email": email}, org=org)
        assert added.status_code == 200, added.text
    # Adding members auto-creates the two rotations the policy pages; keep their ids, replace their rules (full save).
    got = client.get(f"oncall/teams/{team_id}/schedule", org=org)
    assert got.status_code == 200, got.text
    rotations = [rotation(r["id"], r["name"], [primary if r["name"] == "Primary" else secondary])
                 for r in got.json()["rotations"]]
    assert any(r["name"] == "Primary" for r in rotations), got.text
    body = {"timezone": timezone, "rotations": rotations, "overrides": [], "unavailability": []}
    put = client.put(f"oncall/teams/{team_id}/schedule", json=body, org=org)
    assert put.status_code == 200, put.text
    return team_id


def unlinked(client: OpenObserveClient, org: str, installation_id: str, team_id: str) -> dict[str, dict]:
    resp = client.get(f"slack/installations/{installation_id}/oncall-unlinked", org=org)
    assert resp.status_code == 200, resp.text
    return {m["email"]: m for m in resp.json()["members"] if m["team_id"] == team_id}


def test_unlinked_list_remind_and_the_pre_shift_dm(
    client: OpenObserveClient, slack_org: str, mock: SlackMock, world: dict
) -> None:
    inst, team, dana, lee, kim = world["inst"], world["team"], world["dana"], world["lee"], world["kim"]
    name = f"payments-{world['tag']}"
    # dana's shift starts in an hour, lee's a week later; kim's rotation only starts in a month.
    start = micros_from_now(hours=1)
    primary = {**shift_rule("weekly", [dana, lee], anchor_micros=start, shift_micros=WEEK_MICROS), "starts_at": start}
    later = micros_from_now(days=30)
    secondary = {**shift_rule("later", [kim], anchor_micros=later, shift_micros=WEEK_MICROS), "starts_at": later}
    team_id = oncall_team(client, slack_org, name, "Europe/London", [dana, lee, kim], primary, secondary)
    try:
        # lee links the usual way first, so the list and the DMs must skip them.
        send_mention(client, inst, team, "U0LEE")
        ref = link_prompt(mock, "U0LEE")
        linked = sign_in_with_slack(world["lee_client"], slack_org, ref, slack_user_id="U0LEE", team_id=team)
        assert linked.status_code == 200, linked.text

        rows = unlinked(client, slack_org, inst["id"], team_id)
        assert set(rows) == {dana, kim}, rows
        assert rows[dana]["team_name"] == name
        now = micros_from_now()
        assert now < rows[dana]["next_shift_at"] <= micros_from_now(hours=2), rows[dana]
        assert rows[dana]["reminded_at"] is None
        assert rows[kim]["next_shift_at"] is None and rows[kim]["reminded_at"] is None

        _, viewer = make_user(client, slack_org, "viewer")
        assert viewer.get(f"slack/installations/{inst['id']}/oncall-unlinked", org=slack_org).status_code == 403
        assert viewer.post(f"slack/installations/{inst['id']}/oncall-unlinked/remind", org=slack_org).status_code == 403

        before = time.time()
        sent = client.post(f"slack/installations/{inst['id']}/oncall-unlinked/remind", org=slack_org)
        assert sent.status_code == 200, sent.text
        assert sent.json() == {"sent": 1}, "dana only: lee is linked, Slack does not know kim"
        dm = wait_until(lambda: dms_to(mock, "U0DANA"), "the pre-shift DM")[0]
        blocks = dm["blocks"]
        assert f"You're on call for {name} from" in blocks, blocks
        assert "Europe/London" in blocks and "Link your account" in blocks and "Not now" in blocks, blocks
        assert "once per schedule" in blocks, blocks
        assert not [d for d in dms_to(mock, "U0LEE") if "once per schedule" in d["blocks"]], "lee is linked"
        lookups = [c["form"].get("email") for c in mock.calls("users.lookupByEmail")]
        assert dana in lookups and kim in lookups and lee not in lookups, lookups

        rows = unlinked(client, slack_org, inst["id"], team_id)
        assert rows[dana]["reminded_at"] is not None and rows[dana]["reminded_at"] / 1_000_000 >= before - 1
        assert rows[kim]["reminded_at"] is None, "nothing is recorded for a person Slack does not know"

        again = client.post(f"slack/installations/{inst['id']}/oncall-unlinked/remind", org=slack_org)
        assert again.json() == {"sent": 1}, "Remind re-sends once per call"
        assert len(wait_until(lambda: dms_to(mock, "U0DANA") if len(dms_to(mock, "U0DANA")) == 2 else [],
                              "the second DM")) == 2

        # The DM's button is a real link request: dana links through it and leaves the list.
        request_id, sig = link_prompt(mock, "U0DANA", seen=1)
        confirmed = sign_in_with_slack(world["dana_client"], slack_org, (request_id, sig),
                                       slack_user_id="U0DANA", team_id=team)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["linked_as"] == dana
        rows = unlinked(client, slack_org, inst["id"], team_id)
        assert set(rows) == {kim}, rows
    finally:
        client.delete(f"oncall/teams/{team_id}", org=slack_org)


def test_an_unknown_installation_is_404_and_the_list_is_per_org(
    client: OpenObserveClient, slack_org: str, world: dict
) -> None:
    inst = world["inst"]
    assert client.get("slack/installations/I0FAKE00000/oncall-unlinked", org=slack_org).status_code == 404
    assert client.post("slack/installations/I0FAKE00000/oncall-unlinked/remind", org=slack_org).status_code == 404
    resp = client.get(f"slack/installations/{inst['id']}/oncall-unlinked", org=slack_org)
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json()["members"], list)

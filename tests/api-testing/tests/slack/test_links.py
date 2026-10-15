"""AC-9.1, 9.2, 9.5, 9.7, 9.9, 9.12, 9.14 and AC-12.3 (backend): linking a Slack user (spec sections 7.3, 7.4).

Runs against the flag-on self-hosted server and the Slack mock. A mention reaches the bot as Slack
sends it (signed HTTP event); the link prompt is read back from the mock's ``chat.postMessage`` DM,
and Sign in with Slack is simulated by folding the nonce and the Slack user into the mock code.
"""
from __future__ import annotations

import uuid
from typing import Any

import pytest

from helpers.slack_mock import mock_code
from support.client import OpenObserveClient

from .slack_helpers import (
    SlackMock,
    dms_to,
    http_install,
    link_prompt,
    make_slack_org,
    make_user,
    my_links,
    new_team,
    query_param,
    send_mention,
    sign_in_with_slack,
    slack_user,
    wait_until,
)

pytestmark = [pytest.mark.enterprise]


@pytest.fixture
def ready(slack_on: None, self_hosted: None, mock: SlackMock) -> SlackMock:
    return mock


def uniq() -> str:
    return uuid.uuid4().hex[:8]


def test_an_unlinked_mention_gets_the_prompt_and_one_click_links(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    email, dana = make_user(client, slack_org, "editor", email=f"dana_{uniq()}@acme.test")
    team = new_team(ready, slack_user("U0DANA", "", f"dana_{uniq()}@elsewhere.test"))
    inst = http_install(client, slack_org, team)

    send_mention(client, inst, team, "U0DANA")
    request_id, sig = link_prompt(ready, "U0DANA")
    ephemeral = wait_until(
        lambda: [c["form"] for c in ready.calls("chat.postEphemeral") if c["form"].get("user") == "U0DANA"],
        "the private L1 prompt in the channel",
    )[0]
    assert ephemeral["channel"] == "C0OPS"
    assert "Link your account" in ephemeral["blocks"]
    assert "Not now" in ephemeral["blocks"]

    started = dana.post(f"slack/link-requests/{request_id}/start", json={"sig": sig}, org=slack_org)
    assert started.status_code == 200, started.text
    body = started.json()
    url = body["url"]
    assert url.startswith("https://slack.com/openid/connect/authorize?")
    assert query_param(url, "team") == team
    assert query_param(url, "scope") == "openid email profile"
    assert query_param(url, "redirect_uri").endswith("/web/slack/link/callback")
    assert query_param(url, "nonce")
    assert query_param(url, "state")
    assert body["request"]["question_preview"] == "<@U0BOT> errors in checkout?"
    assert body["request"]["team_name"].startswith("Acme")

    confirmed = sign_in_with_slack(dana, slack_org, (request_id, sig), slack_user_id="U0DANA", team_id=team)
    assert confirmed.status_code == 200, confirmed.text
    linked = confirmed.json()
    assert (linked["linked_as"], linked["org_id"]) == (email, slack_org)
    assert slack_org in linked["orgs"]
    assert linked["return_url"] == f"https://slack.com/app_redirect?team={team}&channel=C0OPS"

    token_form = ready.calls("openid.connect.token")[-1]["form"]
    assert token_form["client_id"]
    assert token_form["client_secret"]
    assert token_form["grant_type"] == "authorization_code"
    assert token_form["redirect_uri"] == query_param(url, "redirect_uri")
    assert ready.calls("auth.revoke"), "the Sign in with Slack user token is revoked"
    assert not [c for c in ready.calls() if "userInfo" in c["method"]]

    links = my_links(dana, slack_org)
    assert len(links) == 1
    assert (links[0]["slack_display_name"], links[0]["link_method"], links[0]["default_org_id"]) == (
        "dana", "oidc", slack_org,
    )
    assert any("Linked as" in f.get("text", "") for f in dms_to(ready, "U0DANA"))


def test_another_slack_user_or_a_reused_state_is_refused(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    _, dana = make_user(client, slack_org, "editor", email=f"dana_{uniq()}@acme.test")
    team = new_team(ready, slack_user("U0DANA", "", f"dana_{uniq()}@elsewhere.test"))
    inst = http_install(client, slack_org, team)
    send_mention(client, inst, team, "U0DANA")
    ref = link_prompt(ready, "U0DANA")

    forwarded = sign_in_with_slack(dana, slack_org, ref, slack_user_id="U0MALLORY", team_id=team)
    assert forwarded.status_code == 403, forwarded.text
    assert forwarded.json()["error_detail"] == "wrong_account"
    assert forwarded.json()["message"].startswith("This link was sent to @dana in Acme")
    assert my_links(dana, slack_org) == []

    request_id, sig = ref
    started = dana.post(f"slack/link-requests/{request_id}/start", json={"sig": sig}, org=slack_org)
    url = started.json()["url"]
    redeem = {
        "oidc_code": mock_code(nonce=query_param(url, "nonce"), team_id=team, user_id="U0DANA"),
        "oidc_state": query_param(url, "state"),
    }
    assert dana.post("slack/link-requests/confirm", json=redeem, org=slack_org).status_code == 200
    again = dana.post("slack/link-requests/confirm", json=redeem, org=slack_org)
    assert again.status_code in (400, 410), again.text
    assert len(my_links(dana, slack_org)) == 1


def test_no_o2_account_in_a_connected_org_is_403_no_access_with_the_help_contact(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    team = new_team(ready, slack_user("U0EVE", "", f"eve_{uniq()}@elsewhere.test"))
    inst = http_install(client, slack_org, team)
    put = client.put(f"slack/installations/{inst['id']}/help-contact", json={"help_contact": "#o2-help"}, org=slack_org)
    assert put.status_code == 200, put.text
    send_mention(client, inst, team, "U0EVE")
    request_id, sig = link_prompt(ready, "U0EVE")
    assert "Ask #o2-help for access" in dms_to(ready, "U0EVE")[-1]["blocks"]

    other = make_slack_org(client)
    _, eve = make_user(client, other, "admin", email=f"eve_{uniq()}@acme.test")
    resp = eve.post(f"slack/link-requests/{request_id}/start", json={"sig": sig}, org=other)
    assert resp.status_code == 403, resp.text
    assert resp.json()["error_detail"] == "no_access"
    assert resp.json()["hint"] == "#o2-help"
    assert resp.json()["message"].startswith("You don't have access to OpenObserve in Acme")


def test_bad_unknown_and_resent_links(client: OpenObserveClient, slack_org: str, ready: SlackMock) -> None:
    _, dana = make_user(client, slack_org, "editor", email=f"dana_{uniq()}@acme.test")
    team = new_team(ready, slack_user("U0DANA", "", f"dana_{uniq()}@elsewhere.test"))
    inst = http_install(client, slack_org, team)
    send_mention(client, inst, team, "U0DANA")
    request_id, sig = link_prompt(ready, "U0DANA")

    bad = dana.post(f"slack/link-requests/{request_id}/start", json={"sig": "x" + sig}, org=slack_org)
    assert (bad.status_code, bad.json()["message"]) == (400, "This link expired")
    unknown = dana.post("slack/link-requests/nope/start", json={"sig": sig}, org=slack_org)
    assert unknown.status_code in (400, 404), unknown.text

    resent = dana.post(f"slack/link-requests/{request_id}/resend", json={"sig": sig}, org=slack_org)
    assert resent.status_code == 202, resent.text
    new_id, _ = link_prompt(ready, "U0DANA", seen=1)
    assert new_id != request_id


def test_a_qualifying_member_links_on_first_mention_and_an_unlink_is_never_undone_automatically(
    client: OpenObserveClient, slack_org: str, ready: SlackMock
) -> None:
    email = f"kim_{uniq()}@acme.test"
    _, kim = make_user(client, slack_org, "editor", email=email)
    team = new_team(ready, slack_user("U0KIM", "", email))
    inst = http_install(client, slack_org, team)
    put = client.put(f"slack/installations/{inst['id']}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=slack_org)
    assert put.status_code == 200, put.text

    send_mention(client, inst, team, "U0KIM")
    links = wait_until(lambda: my_links(kim, slack_org), "the automatic link")
    assert (links[0]["link_method"], links[0]["default_org_id"]) == ("email", slack_org)
    n5 = wait_until(lambda: dms_to(ready, "U0KIM"), "the N5 DM")
    assert len(n5) == 1
    assert "linked to OpenObserve" in n5[0]["text"]
    assert "o2_unlink" in n5[0]["blocks"]

    unlinked = kim.delete(f"slack/links/{links[0]['id']}", org=slack_org)
    assert unlinked.status_code == 204, unlinked.text
    assert my_links(kim, slack_org) == []

    send_mention(client, inst, team, "U0KIM")
    link_prompt(ready, "U0KIM")
    assert my_links(kim, slack_org) == [], "an unlinked user is never linked automatically again"


@pytest.mark.parametrize(
    "flags",
    [{"is_restricted": True}, {"is_ultra_restricted": True}, {"is_email_confirmed": False}],
    ids=["guest", "single_channel_guest", "unconfirmed_email"],
)
def test_who_never_links_automatically(
    client: OpenObserveClient, slack_org: str, ready: SlackMock, flags: dict[str, Any]
) -> None:
    email = f"gus_{uniq()}@acme.test"
    _, gus = make_user(client, slack_org, "editor", email=email)
    team = new_team(ready, slack_user("U0GUS", "", email, **flags))
    inst = http_install(client, slack_org, team)
    put = client.put(f"slack/installations/{inst['id']}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=slack_org)
    assert put.status_code == 200, put.text
    send_mention(client, inst, team, "U0GUS")
    link_prompt(ready, "U0GUS")
    assert my_links(gus, slack_org) == []

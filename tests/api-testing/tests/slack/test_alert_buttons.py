"""Phase 2 B5: the alert message buttons, clicked as Slack posts them (AC-P2.7.1 to 7.6, spec 8.1-8.3).

One alert fires once into a Slack app destination (real scheduler run); every test clicks the
buttons of that message and reads the truth back through the alert routes. Needs the flag-on
enterprise server of ``slack_helpers`` with ``ZO_ALERT_SCHEDULE_INTERVAL`` low and the Slack mock.
The OpenFGA wording of a refusal (rule ``fga``) needs OpenFGA on and is a stage Z check.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any
from urllib.parse import urlencode

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from tests.alerts.multialert_helpers import AlertsClient, fast_eval, simple_alert, uniq
from tests.oncall.oncall_helpers import OnCallClient, oncall_enabled
from .slack_helpers import (
    SlackMock,
    dms_to,
    link_prompt,
    make_user,
    self_hosted_install,
    sign_in_with_slack,
    signed_post,
    slack_user,
)
from .test_alert_messages import CHANNEL, color, first_post, updates

pytestmark = [pytest.mark.enterprise]

ACKED = "#ECB22E"
OUTSIDER = "Only members of this Slack workspace can use OpenObserve here."


class Firing:
    """The one posted alert message every test clicks on."""

    def __init__(self, client: OpenObserveClient, org: str, mock: SlackMock, alerts: AlertsClient, *,
                 auto_investigate: str = "off", name: str | None = None, oncall_team: str | None = None) -> None:
        self.client, self.org, self.mock, self.alerts = client, org, mock, alerts
        self.team = f"T0B5{uuid.uuid4().hex[:6].upper()}"
        self.users: dict[str, tuple[str, OpenObserveClient]] = {}
        members = []
        for uid, role in (("U0ANN", "editor"), ("U0BOB", "editor"), ("U0VIK", "viewer")):
            email, as_user = make_user(client, org, role, email=f"{uid[2:].lower()}_{uuid.uuid4().hex[:6]}@acme.test")
            self.users[uid] = (email, as_user)
            members.append(slack_user(uid, self.team, email))
        members.append(slack_user("U0ZED", self.team, f"zed_{uuid.uuid4().hex[:6]}@elsewhere.test"))
        members.append({**slack_user("U0BOT", self.team, ""), "is_bot": True})
        mock.add_team(self.team, "Acme", members=members, channels=[
            {"id": CHANNEL, "name": "sre-prod", "is_private": False, "is_member": True, "is_shared": False},
        ])
        exchanged = self_hosted_install(client, org, team_id=self.team, mode="http")
        inst_id = exchanged["installation"]["id"]
        resp = client.get("slack/installations", org=org)
        assert resp.status_code == 200, resp.text
        self.inst = next(i for i in resp.json()["installations"] if i["id"] == inst_id)
        put = client.put(f"slack/installations/{inst_id}/linking", json={"enabled": True, "domains": ["acme.test"]}, org=org)
        assert put.status_code == 200, put.text
        self.destination = f"sre-app-{uuid.uuid4().hex[:6]}"
        body = {
            "name": self.destination, "type": "slack_app", "installation_id": inst_id, "channel_id": CHANNEL,
            "channel_name": "sre-prod", "buttons": True, "mention": "default", "refire_reuse_minutes": 30,
            "auto_investigate": auto_investigate, "shared_channel_confirmed": False, "oncall_room_confirmed": False,
        }
        resp = client.post("alerts/destinations", json=body, org=org)
        assert resp.status_code == 200, resp.text
        stream = uniq("b5_buttons")
        alerts.ingest(stream, [{"city": "bangalore", "latency": 900} for _ in range(5)])
        self.name = name or uniq("b5_alert")
        payload = fast_eval(simple_alert(self.name), stream)
        payload["destinations"] = [self.destination]
        if oncall_team is not None:
            payload["oncall_team"] = oncall_team
        resp = alerts.create_alert(payload)
        assert resp.status_code == 200, resp.text
        self.alert_id = alerts.find_alert_id(self.name)
        alerts.created.append(self.alert_id)  # type: ignore[attr-defined]
        post = first_post(mock, self.name)
        self.ts = post["response"]["ts"]
        self.blocks = all_blocks(post["form"])
        self.ref = element(self.blocks, "o2_alert_ack")["value"]

    def click(self, user: str, action: dict[str, Any], *, user_team: str | None = None, selected: str | None = None,
              ts: str | None = None) -> None:
        """A ``block_actions`` payload as Slack posts it for a button or a menu pick, signed.

        ``user_team`` is the clicker's own workspace: Slack Connect posts an outsider's click under the app's team.
        """
        team = self.team
        ts = ts or self.ts
        action = {**action, "action_ts": f"{time.time():.6f}"}
        if selected is not None:
            action["selected_option"] = {"text": {"type": "plain_text", "text": "pick"}, "value": selected}
        payload = {
            "type": "block_actions", "user": {"id": user, "username": user[2:].lower(), "team_id": user_team or team},
            "api_app_id": self.inst["app_id"], "token": "ignored",
            "container": {"type": "message", "message_ts": ts, "channel_id": CHANNEL, "is_ephemeral": False},
            "trigger_id": f"{int(time.time())}.1.{uuid.uuid4().hex[:12]}", "team": {"id": team, "domain": "acme"},
            "enterprise": None, "is_enterprise_install": False, "channel": {"id": CHANNEL, "name": "sre-prod"},
            "message": {"type": "message", "ts": ts, "user": "U0BOT", "bot_id": "B0BOT"},
            "response_url": "https://hooks.slack.com/actions/T0/1/x", "actions": [action],
        }
        body = urlencode({"payload": json.dumps(payload)}).encode()
        resp = signed_post(self.client, "interactions", body, f"signing-{self.inst['app_id']}",
                           content_type="application/x-www-form-urlencoded")
        assert resp.status_code == 200, resp.text

    def button(self, user: str, action_id: str, value: str | None = None, *, ts: str | None = None) -> None:
        self.click(user, {"type": "button", "action_id": action_id, "value": value or self.ref}, ts=ts)

    def pick(self, user: str, action_id: str, value: str, *, ts: str | None = None) -> None:
        self.click(user, {"type": "static_select", "action_id": action_id}, selected=value, ts=ts)

    def acks(self) -> list[dict[str, Any]]:
        resp = self.client.get(f"alerts/{self.alert_id}/acks", org=self.org, prefix="api/v2/")
        assert resp.status_code == 200, resp.text
        return resp.json()["acks"]

    def mutes(self) -> list[dict[str, Any]]:
        resp = self.client.get("downtimes?page_size=200", org=self.org, prefix="api/v2/")
        assert resp.status_code == 200, resp.text
        rows = resp.json()["items"]
        return [d for d in rows if self.alert_id in json.dumps(d) and d.get("status") in ("active", "scheduled")]

    def private(self, user: str, since: int = 0) -> list[dict[str, str]]:
        return [c["form"] for c in self.mock.calls("chat.postEphemeral") if c["form"].get("user") == user][since:]

    def reset(self) -> None:
        """Back to a plain firing: no ack, no quick mute, so the next test starts clean."""
        for ack in self.acks():
            body = {"group_key": ack["group_key"], "firing_started_at": ack["firing_started_at"]}
            resp = self.client.post(f"alerts/{self.alert_id}/unack", json=body, org=self.org, prefix="api/v2/")
            assert resp.status_code == 200 and resp.json()["changed"], resp.text
        for d in self.mutes():
            resp = self.client.post(f"alerts/{self.alert_id}/mute/{d['id']}/cancel", json={}, org=self.org, prefix="api/v2/")
            assert resp.status_code == 200, resp.text
        assert not self.acks() and not self.mutes(), "the reset left state behind"


class Paged:
    """A second alert on the same destination whose firing pages an on-call team (spec 6.5, 8.1 Resolve)."""

    def __init__(self, f: Firing) -> None:
        self.f = f
        self.oncall = OnCallClient(f.client, f.org)
        self.team_id = self.oncall.staffed_team([f.users["U0ANN"][0], f.users["U0BOB"][0]], name=uniq("b5_sre"))
        stream = uniq("b5_paged")
        f.alerts.ingest(stream, [{"city": "bangalore", "latency": 900} for _ in range(5)])
        self.name = uniq("b5_paged_alert")
        payload = fast_eval(simple_alert(self.name), stream)
        payload["destinations"] = [f.destination]
        payload["oncall_team"] = self.team_id
        payload["priority"] = 1
        resp = f.alerts.create_alert(payload)
        assert resp.status_code == 200, resp.text
        self.alert_id = f.alerts.find_alert_id(self.name)
        f.alerts.created.append(self.alert_id)  # type: ignore[attr-defined]
        post = first_post(f.mock, self.name)
        self.ts = post["response"]["ts"]
        self.blocks = all_blocks(post["form"])
        self.ref = element(self.blocks, "o2_alert_ack")["value"]

    def pages(self) -> list[dict[str, Any]]:
        return self.oncall.pages_for(self.alert_id)

    def response(self, response_id: str) -> dict[str, Any]:
        resp = self.oncall.get_response(response_id)
        assert resp.status_code == 200, resp.text
        return resp.json()["response"]

    def open_pages(self) -> list[dict[str, Any]]:
        return [p for p in self.pages() if p.get("closed_at") is None]

    def mutes(self) -> list[dict[str, Any]]:
        resp = self.f.client.get("downtimes?page_size=200", org=self.f.org, prefix="api/v2/")
        assert resp.status_code == 200, resp.text
        return [d for d in resp.json()["items"] if self.alert_id in json.dumps(d) and d.get("status") in ("active", "scheduled")]

    def unmute(self) -> None:
        for d in self.mutes():
            resp = self.f.client.post(f"alerts/{self.alert_id}/mute/{d['id']}/cancel", json={}, org=self.f.org, prefix="api/v2/")
            assert resp.status_code == 200, resp.text


def all_blocks(form: dict[str, str]) -> list[dict[str, Any]]:
    """The message's blocks: the top level and every attachment's."""
    blocks = list(json.loads(form.get("blocks") or "[]"))
    for a in json.loads(form.get("attachments") or "[]"):
        blocks.extend(a.get("blocks", []))
    return blocks


def payload_text(form: dict[str, str]) -> str:
    return (form.get("text") or "") + (form.get("blocks") or "") + (form.get("attachments") or "")


def element(blocks: list[dict[str, Any]], action_id: str) -> dict[str, Any]:
    for b in blocks:
        for e in [*b.get("elements", []), *([b["accessory"]] if "accessory" in b else [])]:
            if e.get("action_id") == action_id:
                return e
    raise AssertionError(f"no {action_id} in {json.dumps(blocks)[:2000]}")


def has_element(blocks: list[dict[str, Any]], action_id: str) -> bool:
    try:
        element(blocks, action_id)
    except AssertionError:
        return False
    return True


@pytest.fixture(scope="module")
def alerts(client: OpenObserveClient, slack_org: str):
    ac = AlertsClient(client, slack_org)
    ac.seed_alert_fixtures()
    created: list[str] = []
    ac.created = created  # type: ignore[attr-defined]
    try:
        yield ac
    finally:
        ac.delete_alerts(created)


@pytest.fixture(scope="module")
def firing(client: OpenObserveClient, slack_org: str, slack_on: None, self_hosted: None, alerts: AlertsClient) -> Firing:
    mock = SlackMock()
    if not mock.reachable():
        pytest.skip(f"Slack mock not reachable at {mock.base_url}")
    mock.reset()
    return Firing(client, slack_org, mock, alerts)


@pytest.fixture(scope="module")
def paged(firing: Firing) -> Paged:
    if not oncall_enabled(firing.client, firing.org):
        pytest.skip("on-call is off; start the server with O2_ONCALL_ENABLED=true")
    return Paged(firing)


@pytest.fixture
def f(firing: Firing) -> Firing:
    firing.reset()
    yield firing
    firing.reset()


def wait_private(f: Firing, user: str, phrase: str, since: int = 0) -> dict[str, str]:
    return wait_until(lambda: next((p for p in f.private(user, since) if phrase in p.get("blocks", "")), None),
                      timeout=30, interval=1, msg=f"a private reply to {user} saying {phrase!r}")


def test_acknowledge_acks_as_the_clicker_with_source_slack_and_the_header_turns_amber(f: Firing) -> None:
    """AC-P2.7.1: the button calls POST .../ack as the linked clicker; the edit arrives through the outbox."""
    ann_email, _ = f.users["U0ANN"]
    assert not f.acks()
    f.button("U0ANN", "o2_alert_ack")
    ack = wait_until(lambda: (f.acks() or [None])[0], timeout=30, interval=1, msg="the ack row")
    assert (ack["acked_by"], ack["ack_source"]) == (ann_email, "slack")
    edit = wait_until(lambda: ([u for u in updates(f.mock, f.ts) if color(u) == ACKED] or [None])[-1],
                      timeout=60, interval=2, msg="the amber header")
    assert "acknowledged" in payload_text(edit["form"]).lower()
    assert not f.private("U0ANN"), "a success says nothing privately"


def test_a_second_acknowledge_is_private_and_take_over_reassigns(f: Firing) -> None:
    """Spec 8.3: two clicks at once; the second clicker sees who holds the ack and may take over."""
    ann_email, _ = f.users["U0ANN"]
    bob_email, _ = f.users["U0BOB"]
    f.button("U0ANN", "o2_alert_ack")
    wait_until(lambda: f.acks(), timeout=30, interval=1, msg="the first ack")
    seen = len(f.private("U0BOB"))
    f.button("U0BOB", "o2_alert_ack")
    reply = wait_private(f, "U0BOB", "Already acknowledged by", seen)
    blocks = json.loads(reply["blocks"])
    assert element(blocks, "o2_alert_more")["value"] == f"take_over:{f.ref}"
    assert f.acks()[0]["acked_by"] == ann_email, "the second click changed nothing"
    f.button("U0BOB", "o2_alert_more", f"take_over:{f.ref}")
    taken = wait_until(lambda: next((a for a in f.acks() if a["acked_by"] == bob_email), None),
                       timeout=30, interval=1, msg="the take over")
    assert taken.get("taken_over_from") == ann_email


def test_a_viewer_is_refused_with_the_names_and_nothing_changes(f: Firing) -> None:
    """AC-P2.7.3 (role rule, OpenFGA off): the private reply names who can act; the FGA wording is stage Z."""
    ann_email, _ = f.users["U0ANN"]
    seen = len(f.private("U0VIK"))
    dms_before = len(dms_to(f.mock, "U0VIK"))
    f.button("U0VIK", "o2_alert_ack")
    reply = wait_private(f, "U0VIK", "You can't acknowledge this alert", seen)
    text = reply["blocks"]
    assert f"Admin or Editor role in {f.org}, or a seat on the team being paged" in text, text
    assert "People who can act:" in text and ("<@U0ANN>" in text or ann_email in text), text
    assert "A copy of this message is in your DMs" in text
    copy = wait_until(lambda: [d for d in dms_to(f.mock, "U0VIK")[dms_before:] if "You can't acknowledge" in d.get("blocks", "")],
                      timeout=20, interval=1, msg="the DM copy")
    assert "A copy of this message" not in copy[0]["blocks"]
    assert not f.acks(), "nothing changed"


def test_an_external_user_is_refused(f: Firing) -> None:
    """AC-P2.7.4: a Slack Connect outsider gets the Phase 1 refusal before any action runs."""
    seen = len([c for c in f.mock.calls("chat.postEphemeral") if c["form"].get("user") == "U0EXT"])
    f.click("U0EXT", {"type": "button", "action_id": "o2_alert_ack", "value": f.ref}, user_team="T0OTHER")
    reply = wait_until(lambda: ([c["form"] for c in f.mock.calls("chat.postEphemeral") if c["form"].get("user") == "U0EXT"][seen:] or [None])[0],
                       timeout=20, interval=1, msg="the outsider refusal")
    assert reply["text"] == OUTSIDER, reply
    assert not f.acks()


def test_mute_picks_a_quick_mute_extend_with_a_stale_version_shows_the_current_end_and_unmute_cancels(f: Firing) -> None:
    """AC-P2.4.1/4.9/4.10 (Slack): the alert-scoped mute routes behind the Mute, Extend and ⋯ Unmute elements."""
    bob_email, _ = f.users["U0BOB"]
    f.pick("U0BOB", "o2_alert_mute", f"for30:{f.ref}")
    mute = wait_until(lambda: (f.mutes() or [None])[0], timeout=30, interval=1, msg="the quick mute")
    assert mute.get("mute_source") in (None, "slack"), mute
    assert mute.get("created_by", bob_email) == bob_email
    rendered = wait_until(lambda: ([u for u in updates(f.mock, f.ts) if "o2_alert_extend" in payload_text(u["form"])] or [None])[-1],
                          timeout=60, interval=2, msg="the message shows Extend")
    blocks = all_blocks(rendered["form"])
    assert has_element(blocks, "o2_alert_extend") and not has_element(blocks, "o2_alert_mute")
    assert "Muted until" in payload_text(rendered["form"])

    rendered_version = element(blocks, "o2_alert_extend")["option_groups"][0]["options"][1]["value"]
    assert rendered_version == f"more30:{f.ref}:v{mute['version']}", rendered_version
    bumped = f.client.post(f"alerts/{f.alert_id}/mute/{mute['id']}/extend",
                           json={"version": mute["version"], "minutes": 10}, org=f.org, prefix="api/v2/")
    assert bumped.status_code == 200, bumped.text
    seen = len(f.private("U0BOB"))
    f.pick("U0BOB", "o2_alert_extend", f"more60:{f.ref}:v{mute['version']}")
    stale = wait_private(f, "U0BOB", "This mute changed before your click", seen)
    assert "nothing was changed" in stale["blocks"]
    current = wait_until(lambda: (f.mutes() or [None])[0], timeout=10, interval=1, msg="the mute row")
    assert current["version"] == bumped.json()["version"], "the stale Extend changed nothing"

    f.button("U0BOB", "o2_alert_more", f"unmute:{f.ref}")
    wait_until(lambda: not f.mutes(), timeout=30, interval=1, msg="the mute is cancelled")


def test_the_24h_pick_asks_first_and_the_confirm_runs_it(f: Firing) -> None:
    """MK-12 and Δ6: in Slack the 24 h Mute is a private prompt; its button carries the plain pick."""
    seen = len(f.private("U0ANN"))
    f.pick("U0ANN", "o2_alert_mute", f"ask_for1440:{f.ref}")
    prompt = wait_private(f, "U0ANN", "Mute for 24 hours?", seen)
    assert not f.mutes(), "the pick alone mutes nothing"
    confirm = element(json.loads(prompt["blocks"]), "o2_alert_mute")
    assert confirm["value"] == f"for1440:{f.ref}"
    f.button("U0ANN", "o2_alert_mute", confirm["value"])
    mute = wait_until(lambda: (f.mutes() or [None])[0], timeout=30, interval=1, msg="the 24 h mute")
    window = mute.get("current_window") or mute.get("next_window")
    ends_in_h = (window["end"] - time.time() * 1_000_000) / 3_600_000_000
    assert 23 < ends_in_h <= 24.1, mute


def test_an_unlinked_click_is_held_and_runs_once_the_clicker_links(f: Firing) -> None:
    """AC-P2.7.2: N1 privately and by DM, then the held Acknowledge runs as the newly linked user."""
    seen = len(f.private("U0ZED"))
    f.button("U0ZED", "o2_alert_ack")
    n1 = wait_private(f, "U0ZED", "Your Acknowledge will apply when you link", seen)
    assert "Not now (discard click)" in n1["blocks"]
    request_id, sig = link_prompt(f.mock, "U0ZED")
    assert not f.acks(), "nothing runs before linking"
    zed_email, zed = make_user(f.client, f.org, "editor", email=f"zed_{uuid.uuid4().hex[:6]}@acme.test")
    confirmed = sign_in_with_slack(zed, f.org, (request_id, sig), slack_user_id="U0ZED", team_id=f.team)
    assert confirmed.status_code == 200, confirmed.text
    ack = wait_until(lambda: (f.acks() or [None])[0], timeout=60, interval=1, msg="the held Acknowledge runs")
    assert (ack["acked_by"], ack["ack_source"]) == (zed_email, "slack")
    linked = wait_until(lambda: [d for d in dms_to(f.mock, "U0ZED") if "Applying your Acknowledge now" in d.get("blocks", "")],
                        timeout=20, interval=1, msg="the linked DM names the held click")
    assert f"<#{CHANNEL}>" in linked[0]["blocks"]


def test_resolve_is_absent_without_an_incident_or_page(f: Firing) -> None:
    """AC-P2.7.6, first half: Resolve renders only with an incident or an open page."""
    assert not has_element(f.blocks, "o2_alert_resolve"), f.blocks
    assert has_element(f.blocks, "o2_alert_ack") and has_element(f.blocks, "o2_alert_mute")


def test_a_mute_snoozes_the_clickers_open_page_for_the_same_minutes(paged: Paged) -> None:
    """Spec 6.5: the view carries the firing's page, so the Slack Mute also snoozes it and says so privately."""
    f = paged.f
    page = wait_until(lambda: (paged.open_pages() or [None])[0], timeout=60, interval=2, msg="the firing's page")
    assert page.get("snoozed_until") is None, page
    seen = len(f.private("U0BOB"))
    before = time.time() * 1_000_000
    try:
        f.pick("U0BOB", "o2_alert_mute", f"for30:{paged.ref}", ts=paged.ts)
        wait_until(lambda: paged.mutes() or None, timeout=30, interval=1, msg="the quick mute")
        note = wait_private(f, "U0BOB", "is snoozed until", seen)
        assert "was not snoozed" not in note["blocks"], note
        current = paged.response(page["id"])
        snoozed_for_min = (current["snoozed_until"] - before) / 60_000_000
        assert 29 < snoozed_for_min <= 31, current
        assert current.get("closed_at") is None and current.get("acked_at") is None, "a snooze is not an ack"
    finally:
        paged.unmute()


def test_resolve_shows_with_an_open_page_and_resolves_it_once(paged: Paged) -> None:
    """AC-P2.7.6, second half: the page is on the view, so Resolve renders, resolves it, and a repeat changes nothing."""
    f = paged.f
    page = wait_until(lambda: (paged.open_pages() or [None])[0], timeout=60, interval=2, msg="the firing's page")
    assert has_element(paged.blocks, "o2_alert_resolve"), paged.blocks
    f.button("U0BOB", "o2_alert_resolve", paged.ref, ts=paged.ts)

    def closed() -> dict[str, Any] | None:
        current = paged.response(page["id"])
        return current if current.get("closed_at") else None

    resolved = wait_until(closed, timeout=30, interval=1, msg="the page is resolved")
    assert resolved["state"] == "resolved", resolved
    assert not paged.open_pages()
    seen = len(f.private("U0BOB"))
    f.button("U0BOB", "o2_alert_resolve", paged.ref, ts=paged.ts)
    wait_private(f, "U0BOB", "Nothing to resolve", seen)
    again = paged.response(page["id"])
    assert again["closed_at"] == resolved["closed_at"], "the second Resolve changed nothing"

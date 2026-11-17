from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit

import pytest
import requests

from helpers.twilio_mock import TwilioMock, parse_twiml
from support.client import OpenObserveClient
from support.wait import retry_on_db_lock, wait_until

from ..oncall_helpers import (
    LADDER_POLL,
    LADDER_TIMEOUT,
    PAGE_POLL,
    PAGE_TIMEOUT,
    RUNG_LATER,
    OnCallClient,
    make_user,
    paging_alert,
    uniq,
    user_target,
)

CALLBACK_HOST = "o2-telephony.test"
# Only the org shard's Mailpit takes this; reachability reads @test.invalid as reserved and Mailpit refuses MAILBOX_DOMAIN.
LANDING_MAIL_DOMAIN = "oncall-ok.openobserve.ai"
PHONE_CHANNELS = ["email", "sms", "voice"]

# A page is due every frequency-1 alert cycle, so two cycles plus scheduler slack proves "no repeat".
TWO_EVAL_CYCLES = 125.0
# A rung this far out cannot race a press made right after the page opens, and fires inside a test's budget.
RUNG_SOON = 90 * 1_000_000
BREAKER_OPEN_SECS = 60
DEPLOYMENT_SID = "AC" + "0" * 32
DEPLOYMENT_FROM = "+99900000000001"

PROMPT = "Press 4 to acknowledge, 6 to resolve, or 8 to escalate."
NO_KEY_LINE = "No key pressed. You can acknowledge from the link in your text. Goodbye."
NO_CALLBACK_LINE = "You can acknowledge from the link in your text. Goodbye."
REFUSED_LINE = "This page can't be changed by phone. Use the link in your text. Goodbye."
CLOSED_LINE = "This page is already resolved. Goodbye."
RESOLVED_LINE = "Resolved. Goodbye."
ESCALATED_LINE = "Escalated. Paging the next level now. Goodbye."
ESCALATED_NOBODY_LINE = "Escalated, but the next level pages nobody right now. Goodbye."
NOBODY_ABOVE_LINE = "There is nobody above you to escalate to. Goodbye."
ALREADY_ACKED_RE = re.compile(r"(.+) already acknowledged this page\. Goodbye\.")
BREAKER_RE = re.compile(r"\S+ is circuit-broken on this node after repeated failures; the page was not attempted")
LINK_RE = re.compile(r"Acknowledge: (\S+)\Z")
TOO_MANY_CODES_RE = re.compile(r"Too many codes\. Try again in ([0-9]+) minutes?\.")


class OpenBugSymptom(AssertionError):
    """A filed bug's exact symptom; `xfail(raises=OpenBugSymptom)` then leaves a broken setup or any other wrong answer red."""


@dataclass
class Team:
    id: str
    name: str


@dataclass
class Fired:
    id: str
    alert_id: str
    alert_name: str
    stream: str
    title: str
    rows: list[dict[str, Any]]


def new_sid() -> str:
    return "AC" + uuid.uuid4().hex


def new_token() -> str:
    return "o2tok-canary-" + uuid.uuid4().hex


def new_phone() -> str:
    """Passes the number rule, is unique per call for the 5/user and 10/number caps, and +999 is unassigned so nothing can ring."""
    return f"+999{uuid.uuid4().int % 10**11:011d}"


def new_org(client: OpenObserveClient) -> str:
    name = f"oncall_tel_{uuid.uuid4().hex[:10]}"
    resp = retry_on_db_lock(lambda: client.post("api/organizations", json={"name": name}, prefix=""))
    assert resp.status_code == 200, f"creating org {name} failed: {resp.status_code} {resp.text}"
    return resp.json()["identifier"]


def telephony_body(sid: str, token: str | None, from_number: str) -> dict[str, Any]:
    body: dict[str, Any] = {"provider": "twilio", "account_sid": sid, "from_number": from_number}
    if token is not None:
        body["auth_token"] = token
    return body


def assert_token_absent(text: str, token: str, where: str) -> None:
    """Fails without an `assert`, whose rewritten message would print the token."""
    __tracebackhide__ = True
    if token in text:
        pytest.fail(f"the canary token leaked in the {where}", pytrace=False)


@dataclass
class TelephonyEnv:
    client: OpenObserveClient
    org: str
    mock: TwilioMock | None = None
    sid: str = field(default_factory=new_sid)
    token: str = field(default_factory=new_token, repr=False)
    from_number: str = field(default_factory=new_phone)
    oc: OnCallClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.oc = OnCallClient(self.client, self.org)

    def register_account(self, **kw: Any) -> None:
        numbers = [{"number": self.from_number, "sms": True, "voice": True}]
        self.mock.add_account(self.sid, self.token, numbers=numbers, **kw)

    def put_telephony(self, sid: str | None = None, token: str | None = None,
                      from_number: str | None = None) -> requests.Response:
        body = telephony_body(sid or self.sid, token, from_number or self.from_number)
        return self.client.put("telephony", org=self.org, json=body)

    def get_telephony(self) -> dict[str, Any]:
        resp = self.client.get("telephony", org=self.org)
        assert resp.status_code == 200, f"GET telephony: {resp.status_code} {resp.text}"
        return resp.json()

    def connect(self) -> None:
        self.register_account()
        resp = self.put_telephony(token=self.token)
        assert resp.status_code == 200, f"connecting the org account: {resp.status_code} {resp.text}"

    def disconnect(self) -> None:
        resp = self.client.delete("telephony", org=self.org)
        assert resp.status_code == 200, f"disconnecting the org account: {resp.status_code} {resp.text}"

    def teardown(self) -> None:
        self.oc.sweep()
        try:
            self.client.delete("telephony", org=self.org)
        except requests.RequestException:
            pass


@dataclass
class Person:
    email: str
    client: OpenObserveClient
    org: str
    role: str
    display_name: str
    phone: str | None = None
    # Newest fake record at the end of setup, so a page's sends read apart from the verification text.
    seq: int = 0

    def path(self, suffix: str = "", email: str | None = None) -> str:
        return f"oncall/contacts/{email or self.email}{suffix}"

    def get_contact(self, org: str | None = None) -> dict[str, Any]:
        resp = self.client.get(self.path(), org=org or self.org)
        assert resp.status_code == 200, f"GET own contact: {resp.status_code} {resp.text}"
        return resp.json()

    def put_phone(self, phone: str | None, org: str | None = None) -> requests.Response:
        return self.client.put(self.path(), org=org or self.org, json={"phone": phone})

    def save_phone(self, phone: str, org: str | None = None) -> dict[str, Any]:
        resp = self.put_phone(phone, org)
        assert resp.status_code == 200, f"saving {phone}: {resp.status_code} {resp.text}"
        self.phone = resp.json().get("phone")
        return resp.json()

    def send_code(self, org: str | None = None) -> requests.Response:
        return self.client.post(self.path("/verify"), org=org or self.org, json={})

    def confirm(self, code: str, org: str | None = None) -> requests.Response:
        return self.client.post(self.path("/verify/confirm"), org=org or self.org, json={"code": code})

    def on_call(self, org: str | None = None) -> OnCallClient:
        return OnCallClient(self.client, org or self.org)


def _create_user(client: OpenObserveClient, org: str, role: str, domain: str,
                 first_name: str) -> tuple[str, OpenObserveClient]:
    delay = 0.5
    for _ in range(3):
        try:
            return make_user(client, org, role, domain=domain, first_name=first_name)
        except AssertionError as e:
            if "database is locked" not in str(e):
                raise
            time.sleep(delay)
            delay *= 2
    return make_user(client, org, role, domain=domain, first_name=first_name)


def newest_seq(mock: TwilioMock, phone: str) -> int:
    return max((r["seq"] for r in mock.requests(to=phone)), default=0)


def verify_phone(person: Person, mock: TwilioMock) -> None:
    """Root cannot seed a phone and no API marks one verified, so each person goes through the fake."""
    sent = person.send_code()
    assert sent.status_code == 204, f"sending a code: {sent.status_code} {sent.text}"
    confirmed = person.confirm(mock.last_code(person.phone))
    assert confirmed.status_code == 200, f"confirming: {confirmed.status_code} {confirmed.text}"
    assert person.get_contact()["phone_is_pageable"] is True, f"{person.email} is still not pageable"
    person.seq = newest_seq(mock, person.phone)


def make_person(client: OpenObserveClient, env: TelephonyEnv, *, role: str = "user", verified: bool = True,
                with_phone: bool = True, phone: str | None = None, domain: str = "test.invalid",
                first_name: str = "OnCall") -> Person:
    """Default role is `user`, so an exempt role can never make a press pass."""
    email, as_person = _create_user(client, env.org, role, domain, first_name)
    env.oc.users.append(email)
    person = Person(email=email, client=as_person, org=env.org, role=role,
                    display_name=f"{first_name} {role.capitalize()}")
    if with_phone:
        person.save_phone(phone or new_phone())
    if verified:
        assert with_phone, "a verified person needs a phone"
        verify_phone(person, env.mock)
    return person


def make_team(env: TelephonyEnv, people: Iterable[Person], *, name: str | None = None) -> Team:
    name = name or uniq("tel_team")
    created = retry_on_db_lock(lambda: env.oc.create_team(name))
    assert created.status_code == 200, f"creating team {name}: {created.status_code} {created.text}"
    team_id = created.json()["id"]
    for person in people:
        added = retry_on_db_lock(lambda email=person.email: env.oc.add_member(team_id, email))
        assert added.status_code == 200, f"adding {person.email}: {added.status_code} {added.text}"
    return Team(id=team_id, name=name)


def set_rungs(env: TelephonyEnv, team: Team, rungs: list[list[Any]], *,
              channels: list[str] | None = None, delays: list[int] | None = None, priority: int = 1) -> None:
    delays = delays if delays is not None else [i * RUNG_LATER for i in range(len(rungs))]
    steps = [
        {"after_micros": delay, "targets": [t if isinstance(t, dict) else user_target(t.email) for t in rung]}
        for delay, rung in zip(delays, rungs, strict=True)
    ]
    ladder_body = {"priority": priority, "steps": steps, "channels": channels or PHONE_CHANNELS}
    resp = env.oc.set_policy(team.id, [ladder_body])
    assert resp.status_code == 200, f"setting the policy: {resp.status_code} {resp.text}"


def page_team(env: TelephonyEnv, rungs: list[list[Person]], *, roster: Iterable[Person] = (),
              name: str | None = None, **kw: Any) -> Team:
    people = {p.email: p for rung in rungs for p in rung} | {p.email: p for p in roster}
    team = make_team(env, people.values(), name=name)
    set_rungs(env, team, rungs, **kw)
    return team


def fire_page(env: TelephonyEnv, team: Team, *, name: str | None = None, priority: int = 1,
              aggregation: dict[str, Any] | None = None, rows: list[dict[str, Any]] | None = None) -> Fired:
    """A real alert fired by the scheduler, since a manual trigger never routes to a team."""
    stream = uniq("tel_stream")
    rows = rows or [{"latency": 900, "service": "checkout"}]
    alert_name = name or uniq("tel_alert")
    payload = paging_alert(alert_name, stream, oncall_team=team.id, priority=priority, aggregation=aggregation)
    seeded = env.oc.seed_rows(stream, rows)
    assert seeded.status_code == 200, f"seeding {stream}: {seeded.status_code} {seeded.text}"
    resp = env.oc.create_alert(payload)
    assert resp.status_code == 200, f"creating the alert: {resp.status_code} {resp.text}"
    alert_id = resp.json()["id"]

    def _paged() -> list[dict[str, Any]]:
        env.oc.seed_rows(stream, rows)
        return env.oc.pages_for(alert_id)

    page = wait_until(_paged, timeout=PAGE_TIMEOUT, interval=PAGE_POLL, msg=f"a page for alert {alert_id}")[0]
    # o2-enterprise#3486: acking before the firing is saved never acks the alert; multi-alert saves first.
    if not (aggregation or {}).get("multi_alert"):
        wait_until(lambda: alert_firing_since(env, alert_id), timeout=30, interval=1,
                   msg=f"the firing of alert {alert_id} saved")
    return Fired(id=page["id"], alert_id=alert_id, alert_name=alert_name, stream=stream,
                 title=page.get("title") or "", rows=rows)


def record(env: TelephonyEnv, page_id: str) -> dict[str, Any]:
    resp = env.oc.get_response(page_id)
    assert resp.status_code == 200, f"reading page {page_id}: {resp.status_code} {resp.text}"
    return resp.json()["response"]


def timeline(env: TelephonyEnv, page_id: str) -> list[dict[str, Any]]:
    resp = env.oc.get_response(page_id)
    assert resp.status_code == 200, f"reading page {page_id}: {resp.status_code} {resp.text}"
    return resp.json()["events"]


def alert_firing_since(env: TelephonyEnv, alert_id: str) -> int | None:
    resp = env.oc.v2("GET", "alerts?folder=default&page_size=1000")
    assert resp.status_code == 200, f"listing alerts: {resp.status_code} {resp.text}"
    alerts = resp.json().get("list", [])
    return next((a.get("firing_started_at") for a in alerts if a.get("alert_id") == alert_id), None)


def alert_acks(env: TelephonyEnv, alert_id: str) -> list[dict[str, Any]]:
    resp = env.oc.v2("GET", f"alerts/{alert_id}/acks?folder=default")
    assert resp.status_code == 200, f"reading acks of {alert_id}: {resp.status_code} {resp.text}"
    return resp.json()["acks"]


def wait_alert_acked(env: TelephonyEnv, alert_id: str) -> list[dict[str, Any]]:
    return wait_until(lambda: alert_acks(env, alert_id), timeout=30, interval=2, msg=f"an ack on alert {alert_id}")


def ledger_of(env: TelephonyEnv, page_id: str) -> dict[str, Any]:
    resp = env.oc.deliveries(page_id)
    assert resp.status_code == 200, f"reading the ledger of {page_id}: {resp.status_code} {resp.text}"
    return resp.json()


def matching_rows(ledger: dict[str, Any], *, recipient: str, channel: str,
                  rung_micros: int | None = None) -> list[dict[str, Any]]:
    return [
        row for row in ledger.get("deliveries", [])
        if (row.get("recipient") or "").lower() == recipient.lower() and row.get("channel") == channel
        and (rung_micros is None or row.get("rung_micros") == rung_micros)
    ]


def rows_for(ledger: dict[str, Any], *, recipient: str, channel: str, rung_micros: int | None = None) -> dict[str, Any]:
    """Finds a row by person and channel, never by index, and proves the one-row-per-step grain."""
    rows = matching_rows(ledger, recipient=recipient, channel=channel, rung_micros=rung_micros)
    assert len(rows) == 1, f"expected one {channel} row for {recipient}, got {len(rows)}: {ledger}"
    return rows[0]


def wait_row(env: TelephonyEnv, page_id: str, person: Person, channel: str, *, rung_micros: int | None = None,
             timeout: float = LADDER_TIMEOUT) -> dict[str, Any]:
    def _row() -> dict[str, Any] | None:
        ledger = ledger_of(env, page_id)
        if not matching_rows(ledger, recipient=person.email, channel=channel, rung_micros=rung_micros):
            return None
        return rows_for(ledger, recipient=person.email, channel=channel, rung_micros=rung_micros)

    return wait_until(_row, timeout=timeout, interval=LADDER_POLL, msg=f"a {channel} row for {person.email}")


def hold_count(mock: TwilioMock, phone: str, kind: str | None, count: int, *, seconds: float,
               since_seq: int | None = None, sid: str | None = None) -> list[dict[str, Any]]:
    """Fails the moment the count leaves `count`, over a window the caller justifies; a repeat has no event to poll."""
    deadline = time.monotonic() + seconds
    while True:
        found = mock.requests(to=phone, kind=kind, since_seq=since_seq, sid=sid)
        assert len(found) == count, f"{kind} to {phone}: expected {count} during the hold, saw {len(found)}: {found}"
        if time.monotonic() >= deadline:
            return found
        time.sleep(1)


def escalate(env: TelephonyEnv, page_id: str) -> None:
    resp = env.oc.escalate(page_id)
    assert resp.status_code == 200, f"escalating {page_id}: {resp.status_code} {resp.text}"


def send_test_page(env: TelephonyEnv, team: Team, *, priority: int = 1) -> dict[str, Any]:
    resp = env.oc.oc("POST", f"teams/{team.id}/test-page", json={"priority": priority})
    assert resp.status_code == 200, f"test page: {resp.status_code} {resp.text}"
    return resp.json()


def attempt_on(answer: dict[str, Any], channel: str) -> dict[str, Any]:
    rows = [a for a in answer.get("attempts", []) if a.get("channel") == channel]
    assert len(rows) == 1, f"expected one {channel} attempt: {answer}"
    return rows[0]


def link_in(sms: dict[str, Any]) -> str:
    found = LINK_RE.search(sms["body"])
    assert found, f"no acknowledge link at the end of the text: {sms['body']!r}"
    return found.group(1)


def link_token(link: str) -> str:
    return parse_qs(urlsplit(link).query)["token"][0]


def ack_url(env: TelephonyEnv) -> str:
    return urljoin(env.client.base_url, f"api/v2/{env.org}/oncall/ack")


def post_link(env: TelephonyEnv, link: str) -> requests.Response:
    return requests.post(ack_url(env), data={"token": link_token(link)}, allow_redirects=False, timeout=30)


def open_link(env: TelephonyEnv, link: str) -> requests.Response:
    return requests.get(ack_url(env), params={"token": link_token(link)}, allow_redirects=False, timeout=30)


def action_path(call: dict[str, Any]) -> str:
    return urlsplit(call["twiml_parsed"]["gather"]["action"]).path


def post_voice_path(client: OpenObserveClient, path: str, digits: str | None = "4") -> requests.Response:
    """A press on a path the test built, with no login and no signature, as Twilio would send it."""
    data = {} if digits is None else {"Digits": digits}
    return requests.post(urljoin(client.base_url, path.lstrip("/")), data=data, allow_redirects=False, timeout=30)


def assert_refused_twiml(resp: requests.Response) -> None:
    """Every voice refusal is a 200 with one Say and a Hangup (M3, M4)."""
    assert resp.status_code == 200, f"{resp.status_code}: {resp.text[:300]}"
    assert resp.headers.get("Content-Type", "").startswith("text/xml"), resp.headers
    parsed, error = parse_twiml(resp.text)
    assert error is None, f"{error}: {resp.text[:300]}"
    assert parsed["says"] == [REFUSED_LINE], parsed
    assert parsed["gather"] is None, parsed
    assert parsed["hangup"] is True, parsed


def member_of(reachability: dict[str, Any], person: Person) -> dict[str, Any]:
    rows = [m for m in reachability.get("members", []) if m.get("user_email", "").lower() == person.email.lower()]
    assert len(rows) == 1, f"{person.email} not in reachability: {reachability}"
    return rows[0]


def channel_of(member: dict[str, Any], channel: str) -> dict[str, Any]:
    rows = [c for c in member.get("channels", []) if c.get("channel") == channel]
    assert len(rows) == 1, f"no {channel} verdict: {member}"
    return rows[0]


def read_reachability(env: TelephonyEnv, team: Team) -> tuple[dict[str, Any], str]:
    resp = env.oc.reachability(team.id)
    assert resp.status_code == 200, f"reachability: {resp.status_code} {resp.text}"
    return resp.json(), resp.text


def json_keys(value: Any) -> set[str]:
    """Every object key at any depth; `configured_but_unverified` legitimately lists "phone" as a value."""
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in json_keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in json_keys(item)}
    return set()


def poll(predicate: Callable[[], Any], *, timeout: float = LADDER_TIMEOUT, interval: float = LADDER_POLL,
         msg: str) -> Any:
    return wait_until(predicate, timeout=timeout, interval=interval, msg=msg)


def assert_acknowledged_by(env: TelephonyEnv, page_id: str, person: Person) -> dict[str, Any]:
    state = record(env, page_id)
    assert state["state"] == "acknowledged", state
    assert state["acked_by"] == person.email, state
    return state


def ack_through_link(env: TelephonyEnv, page_id: str, link: str, person: Person) -> None:
    acked = post_link(env, link)
    assert acked.status_code == 200, acked.text[:300]
    assert_acknowledged_by(env, page_id, person)


def assert_unanswered(env: TelephonyEnv, page_id: str) -> dict[str, Any]:
    state = record(env, page_id)
    assert state["state"] in ("triggered", "triaged"), state
    assert state.get("acked_by") is None, state
    return state

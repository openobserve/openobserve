from __future__ import annotations

import re

import pytest

from support.client import OpenObserveClient

from ...oncall_helpers import MAILBOX_DOMAIN, uniq
from ..telephony_helpers import (
    PROMPT,
    Person,
    TelephonyEnv,
    ack_through_link,
    action_path,
    attempt_on,
    fire_page,
    hold_count,
    ledger_of,
    link_in,
    make_person,
    make_team,
    matching_rows,
    open_link,
    page_team,
    set_rungs,
    send_test_page,
    wait_alert_acked,
    wait_row,
)

pytestmark = pytest.mark.enterprise

LONG_TITLE_CHARS = 200
# Sends in a step start together and one never runs past 15 s, so a send on an unticked channel lands inside this.
UNTICKED_SETTLE_SECS = 15
TWIML_LIMIT = 4000


def texts_since(env: TelephonyEnv, person: Person, count: int = 1) -> list[dict]:
    return env.mock.wait_for(person.phone, "sms", count, since_seq=person.seq)


def test_s01_the_text_has_the_exact_form(client: OpenObserveClient, env: TelephonyEnv):
    """S-01, 3.5, A7."""
    person = make_person(client, env)
    team = page_team(env, [[person]])
    page = fire_page(env, team)
    assert page.alert_name in page.title, f"the page title must name the alert: {page.title!r}"
    [sms] = texts_since(env, person)
    assert sms["from"] == env.from_number, sms
    assert sms["sid"] == env.sid, sms
    link = link_in(sms)
    assert sms["body"] == f"[P1] {page.title} - {team.name}\nAcknowledge: {link}"
    assert re.search(rf"/api/v2/{env.org}/oncall/ack\?token=\S+$", link), link
    assert wait_row(env, page.id, person, "sms")["delivered"] is True
    hold_count(env.mock, person.phone, "sms", 1, seconds=15, since_seq=person.seq)


def test_s02_the_link_in_the_text_acknowledges_as_that_person(client: OpenObserveClient, env: TelephonyEnv):
    """S-02, 02d 1, AK-2, AK-4, D36, A7."""
    person = make_person(client, env)
    team = page_team(env, [[person]])
    page = fire_page(env, team)
    link = link_in(texts_since(env, person)[0])

    ack_through_link(env, page.id, link, person)
    assert wait_alert_acked(env, page.alert_id)[0]["acked_by"] == person.email

    again = open_link(env, link)
    assert again.status_code == 200, again.text[:300]
    assert person.email.lower() in again.text.lower(), again.text[:300]


def test_s03_a_long_ascii_title_is_cut_and_the_link_kept(client: OpenObserveClient, env: TelephonyEnv):
    """S-03, M6, M5."""
    person = make_person(client, env)
    # Alert names refuse `&`, so the team carries it through the same escaped line.
    team_name = uniq("tel_<&>_team")
    team = page_team(env, [[person]], name=team_name)
    alert_name = uniq("tel_<long>") + "_" + "x" * LONG_TITLE_CHARS
    page = fire_page(env, team, name=alert_name)
    [sms] = texts_since(env, person)
    link = link_in(sms)
    assert sms["segments"] <= 3, sms
    assert sms["encoding"] == "GSM-7", sms
    head = sms["body"].splitlines()[0]
    assert "..." in head, f"the title must be cut: {head!r}"
    assert page.title not in head, f"the title must be cut: {head!r}"

    [call] = env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    assert call["twiml_error"] is None, call
    assert len(call["twiml"]) <= TWIML_LIMIT, len(call["twiml"])
    assert "&amp;" in call["twiml"], "the team's & must reach the call escaped"
    assert "&lt;" in call["twiml"], "the title's < must reach the call escaped"
    spoken = " ".join(call["twiml_parsed"]["says"] + call["twiml_parsed"]["gather"]["says"])
    assert team_name in spoken, spoken
    assert action_path(call).startswith(f"/api/v2/{env.org}/oncall/ack/voice/"), call
    assert env.mock.press(to=person.phone, digits="1")["gather"]["says"].count(PROMPT) == 2, "the action must still answer"
    ack_through_link(env, page.id, link, person)


def test_s04_a_non_gsm_title_stays_inside_three_parts(client: OpenObserveClient, env: TelephonyEnv):
    """S-04, M6."""
    person = make_person(client, env)
    team = page_team(env, [[person]], name=uniq("tel_é_team"))
    page = fire_page(env, team, name=uniq("tel_é") + "_" + "é" * LONG_TITLE_CHARS)
    [sms] = texts_since(env, person)
    assert sms["segments"] <= 3, sms
    assert sms["body"].startswith("[P1] "), sms
    ack_through_link(env, page.id, link_in(sms), person)

    # A 67-a-part page cannot hold the link once é is in it, so the switch is only observable on a text with no link.
    since = max(r["seq"] for r in env.mock.requests(to=person.phone))
    send_test_page(env, team)
    [plain] = env.mock.wait_for(person.phone, "sms", since_seq=since)
    assert plain["encoding"] == "UCS-2", plain
    assert plain["segments"] == 1, plain


def test_s05_only_a_verified_phone_gets_phone_rows(client: OpenObserveClient, env: TelephonyEnv):
    """S-05, D3, D5, section 2."""
    verified = make_person(client, env)
    unverified = make_person(client, env, verified=False)
    phoneless = make_person(client, env, verified=False, with_phone=False)
    team = page_team(env, [[verified, unverified, phoneless]])
    page = fire_page(env, team)
    for channel in ("email", "sms", "voice"):
        assert wait_row(env, page.id, verified, channel)["delivered"] is True, channel
    for person in (unverified, phoneless):
        assert wait_row(env, page.id, person, "email")["delivered"] is True

    ledger = ledger_of(env, page.id)
    for person in (unverified, phoneless):
        for channel in ("sms", "voice"):
            assert matching_rows(ledger, recipient=person.email, channel=channel) == [], ledger
    assert env.mock.requests(to=unverified.phone) == [], "an unverified number must never reach the provider"


def test_s06_a_refused_email_does_not_block_the_phone(client: OpenObserveClient, env: TelephonyEnv):
    """S-06, D2, 3.4, guide 9."""
    person = make_person(client, env, domain=MAILBOX_DOMAIN)
    team = page_team(env, [[person]])
    page = fire_page(env, team)
    env.mock.wait_for(person.phone, "sms", since_seq=person.seq)
    env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    assert wait_row(env, page.id, person, "email")["delivered"] is False
    assert wait_row(env, page.id, person, "sms")["delivered"] is True
    assert wait_row(env, page.id, person, "voice")["delivered"] is True


def test_s07_a_slow_text_does_not_hold_the_call(client: OpenObserveClient, env: TelephonyEnv):
    """S-07, D2, 3.4."""
    held_secs = 4
    person = make_person(client, env)
    env.mock.fail(to=person.phone, kind="sms", delay_ms=held_secs * 1000)
    team = page_team(env, [[person]])
    fire_page(env, team)
    [sms] = env.mock.wait_for(person.phone, "sms", since_seq=person.seq)
    [call] = env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    assert call["at"] < sms["at"] + held_secs, f"the call waited for the text: {call['at']} vs {sms['at']}"


def test_s08_a_test_page_has_no_link_no_gather_and_no_record(client: OpenObserveClient, env: TelephonyEnv):
    """S-08, D10, 3.5, guide 7, M8."""
    person = make_person(client, env)
    team = make_team(env, [person])
    set_rungs(env, team, [[person]])
    answer = send_test_page(env, team)
    assert answer["not_sent_because"] is None, answer
    assert attempt_on(answer, "sms")["delivered"] is True, answer
    assert attempt_on(answer, "voice")["delivered"] is True, answer

    [sms] = env.mock.wait_for(person.phone, "sms", since_seq=person.seq)
    assert sms["body"] == f"[Test] {team.name} test page. No action needed.", sms
    [call] = env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    assert call["twiml_parsed"]["gather"] is None, call
    assert call["twiml_parsed"]["says"] == [f"This is a test page for {team.name}. No action needed."], call
    assert call["twiml_parsed"]["after_gather_says"] == [], call
    assert call["twiml_parsed"]["hangup"] is True, call
    assert env.oc.list_responses(include_resolved=True) == [], "a test page must leave no record"


@pytest.mark.parametrize("ticked", [["email"], ["email", "sms"]], ids=["email-only", "email-and-sms"])
def test_s10_a_verified_phone_gets_only_the_channels_the_policy_ticks(client: OpenObserveClient, env: TelephonyEnv, ticked: list[str]):
    """S-10, D3."""
    person = make_person(client, env)
    page = fire_page(env, page_team(env, [[person]], channels=ticked))
    for channel in ticked:
        assert wait_row(env, page.id, person, channel)["delivered"] is True, channel

    sends = len(ticked) - 1
    hold_count(env.mock, person.phone, None, sends, seconds=UNTICKED_SETTLE_SECS, since_seq=person.seq)
    assert sorted(r["channel"] for r in ledger_of(env, page.id)["deliveries"]) == sorted(ticked)
    assert "call" not in [r["kind"] for r in env.mock.requests(to=person.phone, since_seq=person.seq)]

"""The deployment's own account against the fake (D-01 to D-06); no test may fail this shared account."""
from __future__ import annotations

import pytest

from support.client import OpenObserveClient

from ..telephony_helpers import (
    DEPLOYMENT_FROM,
    DEPLOYMENT_SID,
    NO_CALLBACK_LINE,
    TelephonyEnv,
    ack_through_link,
    attempt_on,
    escalate,
    fire_page,
    hold_count,
    link_in,
    make_person,
    make_team,
    page_team,
    send_test_page,
    set_rungs,
    wait_row,
)

pytestmark = pytest.mark.enterprise

# One send never runs past 15 s, so any fallback to the deployment would have started inside this.
AFTER_RETRIES_SECS = 20


def test_d01_get_telephony_hides_the_deployment_sid(client: OpenObserveClient, env: TelephonyEnv):
    """D-01, U7, U3, A3."""
    resp = env.client.get("telephony", org=env.org)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["deployment_account_present"] is True, body
    assert body["deployment_from_number"] == DEPLOYMENT_FROM, body
    assert body["press4_available"] is False, body
    assert body["org"] is None, body
    assert DEPLOYMENT_SID not in resp.text, "the deployment SID must never be shown"
    assert "ci-deployment-fixture" not in resp.text, "the deployment token must never be shown"

    person = make_person(client, env, verified=False, with_phone=False)
    contact = person.get_contact()
    assert contact["phone_provider_available"] is True, contact
    assert contact["press4_available"] is False, contact


def test_d02_with_no_callback_the_call_only_speaks(client: OpenObserveClient, env: TelephonyEnv):
    """D-02, 3.5, P1."""
    person = make_person(client, env)
    page = fire_page(env, page_team(env, [[person]]))
    [call] = env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    assert call["sid"] == DEPLOYMENT_SID, call
    assert call["from"] == DEPLOYMENT_FROM, call
    assert call["twiml_parsed"]["gather"] is None, call
    assert call["twiml_parsed"]["says"][-1] == NO_CALLBACK_LINE, call
    assert call["twiml_parsed"]["hangup"] is True, call

    [sms] = env.mock.wait_for(person.phone, "sms", since_seq=person.seq)
    assert sms["sid"] == DEPLOYMENT_SID, sms
    ack_through_link(env, page.id, link_in(sms), person)


def test_d03_the_org_account_wins_until_it_is_deleted(client: OpenObserveClient, env: TelephonyEnv):
    """D-03, P1, P7, P8."""
    env.connect()
    first = make_person(client, env)
    second = make_person(client, env)
    page = fire_page(env, page_team(env, [[first], [second]]))
    env.mock.wait_for(first.phone, "sms", since_seq=first.seq)
    env.mock.wait_for(first.phone, "call", since_seq=first.seq)
    assert {r["sid"] for r in env.mock.requests(to=first.phone, since_seq=first.seq)} == {env.sid}

    env.disconnect()
    escalate(env, page.id)
    env.mock.wait_for(second.phone, "sms", since_seq=second.seq)
    env.mock.wait_for(second.phone, "call", since_seq=second.seq)
    assert {r["sid"] for r in env.mock.requests(to=second.phone, since_seq=second.seq)} == {DEPLOYMENT_SID}


def test_d04_an_org_failure_never_falls_back_to_the_deployment(client: OpenObserveClient, env: TelephonyEnv):
    """D-04, P2, 00-SCOPE."""
    env.connect()
    person = make_person(client, env)
    env.mock.fail(sid=env.sid, kind="sms", status=500)
    page = fire_page(env, page_team(env, [[person]]))
    env.mock.wait_for(person.phone, "sms", since_seq=person.seq, sid=env.sid, accepted=False)
    row = wait_row(env, page.id, person, "sms")
    assert row["delivered"] is False, row
    hold_count(env.mock, person.phone, None, 0, seconds=AFTER_RETRIES_SECS, since_seq=person.seq, sid=DEPLOYMENT_SID)


def test_d05_verify_goes_through_the_deployment_account(client: OpenObserveClient, env: TelephonyEnv):
    """D-05, V4, P1."""
    person = make_person(client, env, verified=False)
    assert person.send_code().status_code == 204
    [sms] = env.mock.requests(to=person.phone, kind="sms")
    assert sms["sid"] == DEPLOYMENT_SID, sms
    assert sms["from"] == DEPLOYMENT_FROM, sms
    assert person.confirm(env.mock.last_code(person.phone)).status_code == 200
    assert person.get_contact()["phone_is_pageable"] is True


def test_d06_a_test_page_goes_through_the_deployment_account(client: OpenObserveClient, env: TelephonyEnv):
    """D-06, D10, M8."""
    person = make_person(client, env)
    team = make_team(env, [person])
    set_rungs(env, team, [[person]])
    answer = send_test_page(env, team)
    assert attempt_on(answer, "voice")["delivered"] is True, answer
    [call] = env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    assert call["sid"] == DEPLOYMENT_SID, call
    assert call["twiml_parsed"]["gather"] is None, call
    assert call["twiml_parsed"]["says"] == [f"This is a test page for {team.name}. No action needed."], call
    assert call["twiml_parsed"]["hangup"] is True, call

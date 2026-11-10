"""On-call telephony with no provider and no master key (N-01 to N-12): needs no fake, runs on ent_oncall."""
from __future__ import annotations

import time
from collections.abc import Generator

import pytest
import requests

from support.client import OpenObserveClient

from .oncall_helpers import MAILBOX_DOMAIN, SINK_DEST, user_target
from .telephony.telephony_helpers import (
    PHONE_CHANNELS,
    TelephonyEnv,
    assert_refused_twiml,
    channel_of,
    fire_page,
    json_keys,
    ledger_of,
    make_person,
    make_team,
    matching_rows,
    member_of,
    new_phone,
    new_sid,
    new_token,
    page_team,
    post_voice_path,
    read_reachability,
    telephony_body,
    wait_row,
)

pytestmark = pytest.mark.enterprise

# No event says a channel was dropped, so a stray SMS or Voice row can only be ruled out after sends had time to land.
LEDGER_SETTLE_SECS = 15.0


@pytest.fixture
def env(client: OpenObserveClient, oncall_org: str) -> Generator[TelephonyEnv, None, None]:
    env = TelephonyEnv(client=client, org=oncall_org)
    yield env
    env.oc.sweep()


def contact_calls(caller: OpenObserveClient, email: str, org: str) -> dict[str, requests.Response]:
    path = f"oncall/contacts/{email}"
    return {
        "GET": caller.get(path, org=org),
        "PUT": caller.put(path, org=org, json={"phone": new_phone()}),
        "DELETE": caller.delete(path, org=org),
        "verify": caller.post(f"{path}/verify", org=org, json={}),
        "confirm": caller.post(f"{path}/verify/confirm", org=org, json={"code": "000000"}),
    }


def p1_channels(env: TelephonyEnv, team_id: str, priority: int = 1) -> set[str]:
    resp = env.oc.get_policy(team_id)
    assert resp.status_code == 200, resp.text
    rungs = [r for r in resp.json()["rungs"] if r["priority"] == priority]
    assert len(rungs) == 1, resp.text
    return set(rungs[0]["channels"])


def test_n01_send_with_a_saved_phone_and_no_provider_is_refused(client: OpenObserveClient, env: TelephonyEnv):
    """N-01, V4, V8."""
    person = make_person(client, env, verified=False)
    resp = person.send_code()
    assert resp.status_code == 400, resp.text
    assert resp.json()["reason"] == "no_provider", resp.text
    assert resp.json()["message"] == "your organisation has no phone provider", resp.text
    assert person.get_contact()["phone_is_pageable"] is False


def test_n02_saving_an_account_with_no_master_key_stores_nothing(env: TelephonyEnv):
    """N-02, P14."""
    resp = env.put_telephony(token=new_token(), from_number=new_phone())
    assert resp.status_code == 400, resp.text
    assert resp.json()["reason"] == "no_master_key", resp.text
    assert resp.json()["message"] == "ask your operator to set O2_MASTER_ENCRYPTION_KEY or O2_ONCALL_MASTER_KEY", resp.text
    assert env.get_telephony()["org"] is None


def test_n03_a_bad_from_number_and_a_bad_sid_are_refused(env: TelephonyEnv):
    """N-03, P4, P14, guide 4.3."""
    bad_from = env.client.put("telephony", org=env.org, json=telephony_body(new_sid(), new_token(), "4155550100"))
    assert bad_from.status_code == 400, bad_from.text
    assert bad_from.json()["reason"] == "bad_from_number", bad_from.text

    bad_sid = env.client.put("telephony", org=env.org, json=telephony_body("SK123", new_token(), new_phone()))
    assert bad_sid.status_code == 400, bad_sid.text
    assert bad_sid.json()["reason"] == "bad_sid", bad_sid.text
    assert bad_sid.json()["message"] == "That is not a Twilio Account SID; it starts with AC.", bad_sid.text
    assert env.get_telephony()["org"] is None


def test_n04_get_telephony_has_no_deployment_and_no_org_account(env: TelephonyEnv):
    """N-04, U7."""
    resp = env.client.get("telephony", org=env.org)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["deployment_account_present"] is False, body
    assert body["org"] is None, body
    assert not {"account_sid", "auth_token"} & set(body), body
    assert "auth_token" not in resp.text, body


def test_n05_only_the_owner_reaches_the_contact_routes(client: OpenObserveClient, env: TelephonyEnv):
    """N-05, V3, A2, 3.8."""
    owner = make_person(client, env, verified=False)
    saved = owner.phone
    admin = make_person(client, env, role="admin", verified=False, with_phone=False)
    teammate = make_person(client, env, verified=False, with_phone=False)
    for label, caller in (("admin", admin.client), ("root", client), ("teammate", teammate.client)):
        for route, resp in contact_calls(caller, owner.email, env.org).items():
            assert resp.status_code == 403, f"{label} {route}: {resp.status_code} {resp.text}"
    assert owner.get_contact()["phone"] == saved, "a refused caller must not change the phone"

    upper = owner.path(email=owner.email.upper())
    assert owner.client.get(upper, org=env.org).status_code == 200
    moved = new_phone()
    put = owner.client.put(upper, org=env.org, json={"phone": moved})
    assert put.status_code == 200, put.text
    assert owner.get_contact()["phone"] == moved
    sent = owner.client.post(f"{upper}/verify", org=env.org, json={})
    assert (sent.status_code, sent.json()["reason"]) == (400, "no_provider"), sent.text
    confirmed = owner.client.post(f"{upper}/verify/confirm", org=env.org, json={"code": "000000"})
    assert (confirmed.status_code, confirmed.json()["reason"]) == (400, "no_code"), confirmed.text
    assert owner.client.delete(upper, org=env.org).status_code == 200
    assert owner.get_contact().get("phone") is None


def test_n06_numbers_are_normalised_and_bad_ones_refused(client: OpenObserveClient, env: TelephonyEnv):
    """N-06, V1."""
    person = make_person(client, env, verified=False, with_phone=False)
    number = new_phone()
    written = f"{number[:4]} ({number[4:7]}) {number[7:10]}-{number[10:12]}.{number[12:]}"
    for raw, stored in ((written, number), ("+1234567", "+1234567"), ("+123456789012345", "+123456789012345")):
        resp = person.put_phone(raw)
        assert resp.status_code == 200, f"{raw}: {resp.text}"
        assert person.get_contact()["phone"] == stored
    for bad in ("+0123456789", "14155550100", "+123456", "+1234567890123456", "<script>alert(1)</script>"):
        resp = person.put_phone(bad)
        assert resp.status_code == 400, f"{bad}: {resp.status_code} {resp.text}"
        assert person.get_contact()["phone"] == "+123456789012345", f"{bad} must not replace the saved number"


def test_n07_a_garbage_voice_token_gets_the_refused_line(client: OpenObserveClient, env: TelephonyEnv):
    """N-07, M3, M4, 3.5."""
    path = f"/api/v2/{env.org}/oncall/ack/voice/garbage-token"
    assert_refused_twiml(post_voice_path(client, path))
    got = requests.get(client.url(path.lstrip("/"), prefix=""), allow_redirects=False, timeout=30)
    # M4 says POST only without naming a code, so any client error passes.
    assert 400 <= got.status_code < 500, f"{got.status_code}: {got.text[:300]}"
    assert "<Response>" not in got.text, got.text[:300]


def test_n08_phone_channels_need_email_and_webhook_only_passes(client: OpenObserveClient, env: TelephonyEnv):
    """N-08, D13."""
    person = make_person(client, env, verified=False, with_phone=False)
    team = make_team(env, [person])
    env.oc.seed_destinations()
    before = p1_channels(env, team.id)
    target = [{"after_micros": 0, "targets": [user_target(person.email)]}]
    for channels in (["sms"], ["voice"], ["sms", "voice"]):
        refused = env.oc.set_policy(team.id, [{"priority": 1, "steps": target, "channels": channels}])
        assert refused.status_code == 400, f"{channels}: {refused.status_code} {refused.text}"
        assert p1_channels(env, team.id) == before, f"{channels} must not be stored"
    webhook = env.oc.set_policy(team.id, [{"priority": 1, "steps": target, "channels": ["webhook"]}],
                                destinations=[SINK_DEST])
    assert webhook.status_code == 200, webhook.text
    assert p1_channels(env, team.id) == {"webhook"}


def test_n09_a_new_policy_defaults_by_priority(client: OpenObserveClient, env: TelephonyEnv):
    """N-09, D14, 3.2."""
    person = make_person(client, env, verified=False, with_phone=False)
    team = make_team(env, [person])
    assert p1_channels(env, team.id, 1) == set(PHONE_CHANNELS)
    assert p1_channels(env, team.id, 2) == set(PHONE_CHANNELS)
    assert p1_channels(env, team.id, 3) == {"email"}


def test_n10_with_no_provider_phone_channels_are_blocked_and_email_still_lands(client: OpenObserveClient, env: TelephonyEnv):
    """N-10, S1, 3.6, A4, U5."""
    person = make_person(client, env, verified=False, domain=MAILBOX_DOMAIN)
    team = make_team(env, [person])
    body, raw = read_reachability(env, team)
    member = member_of(body, person)
    assert person.get_contact()["phone_provider_available"] is False
    # No number can be verified on this server, so the provider's own sentence is pinned by L-02 instead.
    for channel in ("sms", "voice"):
        assert channel_of(member, channel)["deliverable"] is False, member
    assert channel_of(member, "email")["deliverable"] is True, member
    assert person.phone not in raw, "reachability must never carry the number"
    assert "phone" not in json_keys(body), "reachability must have no phone key"


def test_n11_a_page_with_no_provider_writes_only_email_rows(client: OpenObserveClient, env: TelephonyEnv):
    """N-11, D3, D5."""
    with_phone = make_person(client, env, verified=False)
    without = make_person(client, env, verified=False, with_phone=False)
    team = page_team(env, [[with_phone, without]])
    page = fire_page(env, team)
    for person in (with_phone, without):
        wait_row(env, page.id, person, "email")
    time.sleep(LEDGER_SETTLE_SECS)
    ledger = ledger_of(env, page.id)
    for person in (with_phone, without):
        for channel in ("sms", "voice"):
            assert matching_rows(ledger, recipient=person.email, channel=channel) == [], ledger
        assert len(matching_rows(ledger, recipient=person.email, channel="email")) == 1, ledger


def test_n12_null_and_delete_clear_the_phone(client: OpenObserveClient, env: TelephonyEnv):
    """N-12, U3, o2-enterprise#3420 SC5."""
    person = make_person(client, env, verified=False)
    cleared = person.put_phone(None)
    assert cleared.status_code == 200, cleared.text
    assert person.get_contact().get("phone") is None

    person.save_phone(new_phone())
    assert person.get_contact().get("phone") == person.phone
    deleted = person.client.delete(person.path(), org=env.org)
    assert deleted.status_code == 200, deleted.text
    assert person.get_contact().get("phone") is None

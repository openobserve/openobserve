from __future__ import annotations

import math
import time

import pytest

from helpers.twilio_mock import TwilioMock
from support.client import OpenObserveClient

from ..telephony_helpers import (
    TOO_MANY_CODES_RE,
    Person,
    TelephonyEnv,
    make_person,
    new_phone,
)

pytestmark = pytest.mark.enterprise

CODE_TEXT = "Your OpenObserve verification code is {code}. It expires in 10 minutes."
RESEND_GAP_SECS = 61
# o2-enterprise#3420 SC1: the spec says a rolling day and the code an hour, so the wait is bounded by both instead of choosing one.
SHORTER_LIMIT_WINDOW_SECS = 3600
LONGER_LIMIT_WINDOW_SECS = 86400


def assert_refused(resp, status: int, reason: str) -> dict:
    assert resp.status_code == status, f"wanted {status} {reason}: {resp.status_code} {resp.text}"
    body = resp.json()
    assert body["reason"] == reason, body
    return body


def wrong_digit(code: str) -> str:
    return ("1" if code[0] != "1" else "2") + code[1:]


def send_and_read(person: Person, mock: TwilioMock) -> str:
    sent = person.send_code()
    assert sent.status_code == 204, f"{sent.status_code} {sent.text}"
    return mock.last_code(person.phone)


def assert_too_many_codes(body: dict) -> None:
    """The limits table: whole minutes, rounded up from the seconds the same body reports."""
    assert body["retry_after_secs"] > 0, body
    found = TOO_MANY_CODES_RE.fullmatch(body["message"])
    assert found, body
    assert int(found.group(1)) == math.ceil(body["retry_after_secs"] / 60), body


def assert_limit_wait(body: dict, started: float) -> None:
    """V8: the wait runs to the end of the first send's window, which began no earlier than `started`."""
    assert_too_many_codes(body)
    remaining = SHORTER_LIMIT_WINDOW_SECS - (time.time() - started)
    assert remaining - 1 <= body["retry_after_secs"] <= LONGER_LIMIT_WINDOW_SECS, f"{remaining:.0f} s of the hour left: {body}"


def test_v01_the_texted_code_verifies_once_and_never_comes_back(client: OpenObserveClient, env: TelephonyEnv):
    """V-01, V1, V2, V5, V8."""
    person = make_person(client, env, verified=False)
    assert person.get_contact()["phone_is_pageable"] is False

    sent = person.send_code()
    assert sent.status_code == 204, sent.text
    assert sent.text == "", "the code must never come back in a reply"
    [sms] = env.mock.requests(to=person.phone, kind="sms")
    code = env.mock.last_code(person.phone)
    assert sms["body"] == CODE_TEXT.format(code=code)
    assert sms["from"] == env.from_number
    assert sms["sid"] == env.sid
    assert sms["auth_ok"] is True

    confirmed = person.confirm(code)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["phone_verified_at"] > 0, confirmed.text
    assert code not in confirmed.text
    contact = person.get_contact()
    assert contact["phone_is_pageable"] is True, contact
    assert contact["phone_verified_at"] == confirmed.json()["phone_verified_at"], contact
    assert code not in str(contact), "the code must never come back in a reply"

    body = assert_refused(person.confirm(code), 400, "no_code")
    assert body["message"] == "No code is waiting for this number. Send one first.", body


def test_v02_a_wrong_code_says_tries_left(client: OpenObserveClient, env: TelephonyEnv):
    """V-02, V8."""
    person = make_person(client, env, verified=False)
    code = send_and_read(person, env.mock)
    body = assert_refused(person.confirm(wrong_digit(code)), 400, "wrong_code")
    assert body["message"] == "Wrong code. 4 tries left.", body
    assert body["tries_left"] == 4, body
    assert person.get_contact()["phone_is_pageable"] is False

    assert person.confirm(code).status_code == 200
    assert person.get_contact()["phone_is_pageable"] is True


def test_v03_five_wrong_tries_burn_the_code(client: OpenObserveClient, env: TelephonyEnv):
    """V-03, V2, V8."""
    person = make_person(client, env, verified=False)
    code = send_and_read(person, env.mock)
    for left in (4, 3, 2, 1):
        assert assert_refused(person.confirm(wrong_digit(code)), 400, "wrong_code")["tries_left"] == left
    # o2-enterprise#3420 V-03: V2 gives five tries and V8 the too-many sentence, but neither says which reply the fifth wrong try gets.
    assert person.confirm(wrong_digit(code)).status_code == 400

    body = assert_refused(person.confirm(code), 400, "too_many_tries")
    assert body["message"] == "Too many wrong tries. Send a new code.", body
    assert person.get_contact()["phone_is_pageable"] is False


def test_v04_confirm_with_no_code_and_send_with_no_phone_are_refused(client: OpenObserveClient, env: TelephonyEnv):
    """V-04, V8."""
    person = make_person(client, env, verified=False)
    body = assert_refused(person.confirm("000000"), 400, "no_code")
    assert body["message"] == "No code is waiting for this number. Send one first.", body

    phoneless = make_person(client, env, verified=False, with_phone=False)
    assert_refused(phoneless.send_code(), 400, "no_phone")
    assert env.mock.requests(sid=env.sid, kind="sms") == [], "a refused send must not text anyone"


def test_v05_resend_gap_then_a_new_code_replaces_the_old(client: OpenObserveClient, env: TelephonyEnv):
    """V-05, V7, V8."""
    person = make_person(client, env, verified=False)
    old = send_and_read(person, env.mock)
    assert assert_refused(person.confirm(wrong_digit(old)), 400, "wrong_code")["tries_left"] == 4

    assert_too_many_codes(assert_refused(person.send_code(), 429, "too_soon"))
    assert len(env.mock.requests(to=person.phone, kind="sms")) == 1, "a refused send must not text"

    # The server has no way to move its clock, so this waits out the 60 s gap.
    time.sleep(RESEND_GAP_SECS)
    new = send_and_read(person, env.mock)
    assert new != old, "the fake's newest code is the old one, so the resend proved nothing"
    assert len(env.mock.requests(to=person.phone, kind="sms")) == 2

    body = assert_refused(person.confirm(old), 400, "wrong_code")
    assert body["tries_left"] == 4, f"a resend must reset tries to 5: {body}"
    assert person.confirm(new).status_code == 200
    assert person.get_contact()["phone_is_pageable"] is True


def test_v06_changing_a_number_drops_its_proof(client: OpenObserveClient, env: TelephonyEnv):
    """V-06, V6, 3.3."""
    person = make_person(client, env)
    assert person.get_contact()["phone_is_pageable"] is True
    person.save_phone(new_phone())
    contact = person.get_contact()
    assert contact["phone_is_pageable"] is False, contact
    assert contact.get("phone_verified_at") is None, contact

    pending = send_and_read(person, env.mock)
    person.save_phone(new_phone())
    body = assert_refused(person.confirm(pending), 400, "no_code")
    assert body["message"] == "No code is waiting for this number. Send one first.", body
    assert person.get_contact()["phone_is_pageable"] is False


def test_v07_proof_crosses_orgs_for_the_same_number_only(client: OpenObserveClient, env: TelephonyEnv, other_env: TelephonyEnv):
    """V-07, V5, 00-SCOPE."""
    copied = make_person(client, env)
    joined = client.post(f"users/{copied.email}", json={"role": "user"}, org=other_env.org)
    assert joined.status_code == 200, joined.text
    other_env.oc.users.append(copied.email)
    copied.save_phone(copied.phone, org=other_env.org)
    assert copied.get_contact(other_env.org)["phone_is_pageable"] is True, "the number's proof must copy to the second org"
    assert env.mock.requests(to=copied.phone, since_seq=copied.seq) == [], "copying proof must not text"

    copied.save_phone(new_phone(), org=other_env.org)
    assert copied.get_contact(other_env.org)["phone_is_pageable"] is False, "a different number has no proof"

    both = make_person(client, env, verified=False)
    joined = client.post(f"users/{both.email}", json={"role": "user"}, org=other_env.org)
    assert joined.status_code == 200, joined.text
    other_env.oc.users.append(both.email)
    both.save_phone(both.phone, org=other_env.org)
    assert both.get_contact(other_env.org)["phone_is_pageable"] is False
    code = send_and_read(both, env.mock)
    assert both.confirm(code).status_code == 200
    assert both.get_contact(other_env.org)["phone_is_pageable"] is True, "a confirm must mark every row with this number"


def test_v08_the_sixth_code_a_person_asks_for_is_refused(client: OpenObserveClient, env: TelephonyEnv):
    """V-08, V7, V8, o2-enterprise#3420 SC1."""
    person = make_person(client, env, verified=False)
    started = time.time()
    for _ in range(5):
        sent = person.send_code()
        assert sent.status_code == 204, sent.text
        person.save_phone(new_phone())
    assert_limit_wait(assert_refused(person.send_code(), 429, "user_daily_limit"), started)
    assert env.mock.requests(to=person.phone) == [], "a refused send must not text"


def test_v09_the_eleventh_person_on_a_number_is_refused(client: OpenObserveClient, env: TelephonyEnv):
    """V-09, V7, V8, o2-enterprise#3420 SC1."""
    shared = new_phone()
    started = time.time()
    for _ in range(10):
        person = make_person(client, env, verified=False, phone=shared)
        sent = person.send_code()
        assert sent.status_code == 204, sent.text
    eleventh = make_person(client, env, verified=False, phone=shared)
    assert_limit_wait(assert_refused(eleventh.send_code(), 429, "number_daily_limit"), started)
    assert len(env.mock.requests(to=shared, kind="sms")) == 10, "the eleventh send must not text"


@pytest.mark.parametrize("code", [21610, 21211])
def test_v10_a_rejected_number_is_refused_and_still_counts(client: OpenObserveClient, env: TelephonyEnv, code: int):
    """V-10, V8, limits table."""
    person = make_person(client, env, verified=False)
    env.mock.fail(to=person.phone, kind="sms", status=400, code=code)
    body = assert_refused(person.send_code(), 400, "number_rejected")
    assert body["message"] == "This number can't receive texts.", body
    assert [r["response_status"] for r in env.mock.requests(to=person.phone, kind="sms")] == [400]
    assert_refused(person.send_code(), 429, "too_soon")


@pytest.mark.parametrize("rule", [{"status": 500}, {"status": 429}, {"delay_ms": 6000}], ids=["500", "429", "timeout"])
def test_v11_an_unavailable_provider_is_503_and_still_counts(client: OpenObserveClient, env: TelephonyEnv, rule: dict):
    """V-11, V8."""
    person = make_person(client, env, verified=False)
    env.mock.fail(to=person.phone, kind="sms", **rule)
    body = assert_refused(person.send_code(), 503, "provider_unavailable")
    assert body["message"] == "The code could not be sent right now. Try again in a minute.", body
    assert len(env.mock.requests(to=person.phone, kind="sms")) == 1, "verification sends once, with no retry"
    assert_refused(person.send_code(), 429, "too_soon")



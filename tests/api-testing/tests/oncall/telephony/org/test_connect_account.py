from __future__ import annotations

import hashlib

import pytest

from support.client import OpenObserveClient

from ..telephony_helpers import (
    TelephonyEnv,
    assert_token_absent,
    escalate,
    fire_page,
    hold_count,
    ledger_of,
    make_person,
    matching_rows,
    new_phone,
    new_sid,
    new_token,
    page_team,
    wait_row,
)

pytestmark = pytest.mark.enterprise

# Sends in a rung start together and one never runs past 15 s, so a stale account's send lands inside this.
PHONE_SENDS_SETTLE_SECS = 15.0


def sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def account_checks(env: TelephonyEnv) -> list[dict]:
    return env.mock.requests(sid=env.sid, kind="account")


def test_c01_connect_checks_with_the_provider_then_saves(bare_env: TelephonyEnv):
    """C-01, P5, P6, U7."""
    env = bare_env
    env.register_account()
    saved = env.put_telephony(token=env.token)
    assert saved.status_code == 200, saved.status_code
    assert saved.json() == {"provider": "twilio", "account_sid": env.sid, "from_number": env.from_number}

    checks = account_checks(env)
    assert checks, "the fake never saw the account check"
    assert all(c["auth_ok"] is True and c["auth_user"] == env.sid for c in checks), checks
    wanted = sha(env.token)
    assert env.mock.token_hash(checks[-1]["seq"]) == wanted

    body = env.get_telephony()
    assert body["org"]["account_sid"] == env.sid, body
    assert body["org"]["from_number"] == env.from_number, body
    assert body["press4_available"] is True, body
    assert "auth_token" not in body["org"], body


def refuse_401(env: TelephonyEnv) -> None:
    env.register_account()
    env.mock.fail(sid=env.sid, kind="account", status=401, code=20003)


def refuse_403(env: TelephonyEnv) -> None:
    env.register_account()
    env.mock.fail(sid=env.sid, kind="account", status=403)


def suspended(env: TelephonyEnv) -> None:
    env.register_account()
    env.mock.fail(sid=env.sid, kind="account", status=200, body={"sid": env.sid, "status": "suspended", "type": "Full"})


def closed(env: TelephonyEnv) -> None:
    env.register_account()
    env.mock.fail(sid=env.sid, kind="account", status=200, body={"sid": env.sid, "status": "closed", "type": "Full"})


def refuse_500(env: TelephonyEnv) -> None:
    env.register_account()
    env.mock.fail(sid=env.sid, kind="account", status=500)


def time_out(env: TelephonyEnv) -> None:
    env.register_account()
    env.mock.fail(sid=env.sid, kind="account", delay_ms=6000)


@pytest.mark.parametrize(
    ("arrange", "reason"),
    [(refuse_401, "account_rejected"), (refuse_403, None), (suspended, "account_rejected"), (closed, None),
     (refuse_500, None), (time_out, None)],
    ids=["401", "403", "suspended", "closed", "500", "timeout"],
)
def test_c02_a_failed_check_saves_nothing(bare_env: TelephonyEnv, arrange, reason: str | None):
    """C-02, P5, guide 4.3, o2-enterprise#3420 SC3a."""
    env = bare_env
    arrange(env)
    resp = env.put_telephony(token=env.token)
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    if reason is not None:
        assert resp.json()["reason"] == reason, resp.text
        assert resp.json()["message"] == (
            "Twilio did not accept this account. Check the Account SID and auth token, and that the account is active."
        ), resp.text
    assert account_checks(env), "the fake never saw the check it was meant to refuse"
    assert env.get_telephony()["org"] is None, "nothing may be stored when the check fails"


def test_c03_a_blank_token_keeps_the_stored_one(env: TelephonyEnv):
    """C-03, P6, 3.2."""
    before = max(c["seq"] for c in account_checks(env))
    kept = env.put_telephony()
    assert kept.status_code == 200, kept.text
    checks = env.mock.requests(sid=env.sid, kind="account", since_seq=before)
    assert checks, "a blank-token save must still check the account"
    wanted = sha(env.token)
    assert env.mock.token_hash(checks[-1]["seq"]) == wanted

    replacement = new_token()
    env.mock.add_account(env.sid, replacement, numbers=[{"number": env.from_number, "sms": True, "voice": True}])
    before = max(c["seq"] for c in account_checks(env))
    replaced = env.put_telephony(token=replacement)
    assert replaced.status_code == 200, replaced.status_code
    checks = env.mock.requests(sid=env.sid, kind="account", since_seq=before)
    assert checks, "the replacing save must check the account"
    wanted = sha(replacement)
    assert env.mock.token_hash(checks[-1]["seq"]) == wanted


def test_c04_a_changed_sid_needs_its_own_token(env: TelephonyEnv):
    """C-04, ENT#3021, ENT#3116."""
    other = new_sid()
    resp = env.put_telephony(sid=other)
    assert resp.status_code == 400, resp.text
    assert resp.json()["reason"] == "token_required", resp.text
    assert env.get_telephony()["org"]["account_sid"] == env.sid
    assert env.mock.requests(sid=other) == [], "the old token must never be tried on another SID"


def test_c05_the_token_never_comes_back(bare_env: TelephonyEnv):
    """C-05, P6, U7."""
    env = bare_env
    env.register_account()
    rule = env.mock.fail(sid=env.sid, kind="account", status=401, code=20003)
    refused = env.put_telephony(token=env.token)
    assert refused.status_code == 400, refused.status_code
    assert_token_absent(refused.text, env.token, "refusal body")
    env.mock.clear_fail(rule)

    saved = env.put_telephony(token=env.token)
    assert saved.status_code == 200, saved.status_code
    assert_token_absent(saved.text, env.token, "save body")

    read = env.client.get("telephony", org=env.org)
    assert read.status_code == 200, read.status_code
    assert read.json()["org"]["account_sid"] == env.sid, "this read must show the connected account"
    assert_token_absent(read.text, env.token, "read body")

    bad_from = env.put_telephony(token=env.token, from_number="not-a-number")
    assert bad_from.status_code == 400, bad_from.status_code
    assert_token_absent(bad_from.text, env.token, "validation refusal body")


def test_c06_deleting_the_account_drops_phones_at_the_next_rung(client: OpenObserveClient, env: TelephonyEnv):
    """C-06, P1, P7, P8."""
    first = make_person(client, env)
    second = make_person(client, env)
    team = page_team(env, [[first], [second]])
    page = fire_page(env, team)
    [sms] = env.mock.wait_for(first.phone, "sms", since_seq=first.seq)
    assert sms["sid"] == env.sid, sms

    env.disconnect()
    escalate(env, page.id)
    assert wait_row(env, page.id, second, "email")["delivered"] is True
    hold_count(env.mock, second.phone, None, 0, seconds=PHONE_SENDS_SETTLE_SECS, since_seq=second.seq)
    ledger = ledger_of(env, page.id)
    assert matching_rows(ledger, recipient=second.email, channel="sms") == [], ledger
    assert matching_rows(ledger, recipient=second.email, channel="voice") == [], ledger


def test_c07_an_updated_account_is_used_from_the_next_rung(client: OpenObserveClient, env: TelephonyEnv):
    """C-07, P7, P8."""
    first = make_person(client, env)
    second = make_person(client, env)
    page = fire_page(env, page_team(env, [[first], [second]]))
    [old] = env.mock.wait_for(first.phone, "sms", since_seq=first.seq)
    assert old["sid"] == env.sid, old

    sid, token, from_number = new_sid(), new_token(), new_phone()
    env.mock.add_account(sid, token, numbers=[{"number": from_number, "sms": True, "voice": True}])
    updated = env.put_telephony(sid=sid, token=token, from_number=from_number)
    assert updated.status_code == 200, updated.status_code

    escalate(env, page.id)
    [sms] = env.mock.wait_for(second.phone, "sms", since_seq=second.seq)
    [call] = env.mock.wait_for(second.phone, "call", since_seq=second.seq)
    assert (sms["sid"], sms["from"]) == (sid, from_number), sms
    assert (call["sid"], call["from"]) == (sid, from_number), call

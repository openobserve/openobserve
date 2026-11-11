"""Provider failures on real and test pages against the fake (F-01 to F-06); the org is per test because the breaker is per org."""
from __future__ import annotations

import re
import time

import pytest

from support.client import OpenObserveClient

from ...oncall_helpers import LADDER_TIMEOUT, MAILBOX_DOMAIN
from ..telephony_helpers import (
    BREAKER_OPEN_SECS,
    BREAKER_RE,
    LANDING_MAIL_DOMAIN,
    OpenBugSymptom,
    Person,
    TelephonyEnv,
    attempt_on,
    channel_of,
    escalate,
    fire_page,
    hold_count,
    ledger_of,
    make_person,
    make_team,
    member_of,
    page_team,
    poll,
    read_reachability,
    rows_for,
    send_test_page,
    set_rungs,
    timeline,
    wait_row,
)

pytestmark = pytest.mark.enterprise

# One send never runs past 15 s, so a rule's retries are over well before this.
AFTER_RETRIES_SECS = 20
# A lost step came back 35 s later in a live run, so this leaves room for two more chances to re-send.
AFTER_STEP_RETRY_SECS = 65
LAST_N_FAILED_RE = re.compile(r"the last ([0-9]+) SMS attempts failed")


def failure_texts(env: TelephonyEnv, page_id: str) -> list[str]:
    bodies = [e.get("body") or "" for e in timeline(env, page_id)]
    return bodies + [r.get("body") or "" for r in ledger_of(env, page_id).get("deliveries", [])]


def assert_row(env: TelephonyEnv, page_id: str, person: Person, channel: str, delivered: bool) -> None:
    row = wait_row(env, page_id, person, channel)
    assert row["delivered"] is delivered, row


def test_f01_a_500_is_retried_three_times_and_shows_in_reachability(client: OpenObserveClient, env: TelephonyEnv):
    """F-01, 3.7, section 10, P9, guide 9, S1."""
    person = make_person(client, env, domain=LANDING_MAIL_DOMAIN)
    env.mock.fail(to=person.phone, kind="sms", status=500)
    team = page_team(env, [[person], [person]])
    page = fire_page(env, team)

    attempts = env.mock.wait_for(person.phone, "sms", 3, since_seq=person.seq, accepted=False)
    assert_row(env, page.id, person, "sms", False)
    hold_count(env.mock, person.phone, "sms", 3, seconds=5, since_seq=person.seq)
    assert attempts[1]["at"] - attempts[0]["at"] >= 0.9, attempts
    assert attempts[2]["at"] - attempts[1]["at"] >= 1.9, attempts
    assert_row(env, page.id, person, "email", True)
    assert_row(env, page.id, person, "voice", True)

    # S1's N needs at least 2 failures with nothing landing, and one page makes one row, so the second rung makes the other.
    escalate(env, page.id)
    poll(lambda: sum(r.get("channel") == "sms" and r.get("delivered") is False
                     for r in ledger_of(env, page.id)["deliveries"]) >= 2, msg="a second failed SMS row")
    body, _raw = read_reachability(env, team)
    reason = channel_of(member_of(body, person), "sms")["blocked_because"]
    found = LAST_N_FAILED_RE.fullmatch(reason or "")
    assert found, reason
    assert int(found.group(1)) >= 2, reason
    email = channel_of(member_of(body, person), "email")
    assert email["deliverable"] is True, f"SMS failures must leave Email green: {email}"
    assert email.get("blocked_because") is None, f"SMS failures must leave Email green: {email}"


def test_f02_a_401_is_not_retried(client: OpenObserveClient, env: TelephonyEnv):
    """F-02, P9."""
    person = make_person(client, env)
    env.mock.fail(to=person.phone, kind="sms", status=401, code=20003)
    page = fire_page(env, page_team(env, [[person]]))
    env.mock.wait_for(person.phone, "sms", since_seq=person.seq, accepted=False)
    assert_row(env, page.id, person, "sms", False)
    hold_count(env.mock, person.phone, "sms", 1, seconds=AFTER_RETRIES_SECS, since_seq=person.seq)


def test_f03_rejected_recipients_never_trip_the_breaker(client: OpenObserveClient, env: TelephonyEnv):
    """F-03, P9, P11, M7, 3.7, o2-enterprise#3420 SC12."""
    rejected = [make_person(client, env) for _ in range(5)]
    next_up = make_person(client, env)
    for person in rejected:
        env.mock.fail(to=person.phone, kind="sms", status=400, code=21610)
    page = fire_page(env, page_team(env, [rejected, [next_up]]))

    # o2-enterprise#3420 SC12: a STOP's own SMS row is left open, so only the other channels and the missing retry are read.
    for person in rejected:
        env.mock.wait_for(person.phone, "sms", since_seq=person.seq, accepted=False)
        assert_row(env, page.id, person, "email", True)
        assert_row(env, page.id, person, "voice", True)
    for person in rejected:
        hold_count(env.mock, person.phone, "sms", 1, seconds=1, since_seq=person.seq)

    # All of a rung's sends are admitted before any outcome counts, so only the next rung can see the breaker; F-05 is the control.
    escalate(env, page.id)
    env.mock.wait_for(next_up.phone, "sms", since_seq=next_up.seq)
    assert_row(env, page.id, next_up, "sms", True)
    assert not [t for t in failure_texts(env, page.id) if BREAKER_RE.search(t)], "a rejected recipient must never open the breaker"


def test_f04_a_hanging_provider_is_bounded(client: OpenObserveClient, env: TelephonyEnv):
    """F-04, 3.7, section 10."""
    person = make_person(client, env)
    env.mock.fail(to=person.phone, kind="sms", delay_ms=6000)
    page = fire_page(env, page_team(env, [[person]]))
    env.mock.wait_for(person.phone, "sms", since_seq=person.seq, accepted=False)
    assert_row(env, page.id, person, "sms", False)
    attempts = hold_count(env.mock, person.phone, "sms", 3, seconds=AFTER_RETRIES_SECS, since_seq=person.seq)
    assert attempts[-1]["at"] - attempts[0]["at"] < 15, attempts


def test_f05_the_breaker_opens_then_lets_a_probe_through(client: OpenObserveClient, env: TelephonyEnv):
    """F-05, 3.7, P10."""
    five = [make_person(client, env) for _ in range(5)]
    second = make_person(client, env)
    third = make_person(client, env)
    rule = env.mock.fail(sid=env.sid, kind="sms", status=500)
    page = fire_page(env, page_team(env, [five, [second], [third]]))

    for person in five:
        assert_row(env, page.id, person, "sms", False)

    escalate(env, page.id)
    assert_row(env, page.id, second, "voice", True)
    assert_row(env, page.id, second, "email", True)
    assert_row(env, page.id, second, "sms", False)
    assert env.mock.requests(to=second.phone, kind="sms", since_seq=second.seq) == [], "an open breaker must not attempt the send"
    assert [t for t in failure_texts(env, page.id) if BREAKER_RE.search(t)], failure_texts(env, page.id)

    # Open is a fixed minute with no clock seam, so this waits it out.
    time.sleep(BREAKER_OPEN_SECS + 5)
    env.mock.clear_fail(rule)
    escalate(env, page.id)
    env.mock.wait_for(third.phone, "sms", since_seq=third.seq)
    assert_row(env, page.id, third, "sms", True)


def test_f07_one_orgs_open_breaker_leaves_another_org_alone(client: OpenObserveClient, env: TelephonyEnv, other_env: TelephonyEnv):
    """F-07, P10, 3.7."""
    five = [make_person(client, env) for _ in range(5)]
    second = make_person(client, env)
    other_first = make_person(client, other_env)
    other_next = make_person(client, other_env)
    # Fired first because a page takes longer to open than the breaker stays open; the escalate below lands inside the minute.
    other_page = fire_page(other_env, page_team(other_env, [[other_first], [other_next]]))
    env.mock.fail(sid=env.sid, kind="sms", status=500)
    page = fire_page(env, page_team(env, [five, [second]]))
    for person in five:
        assert_row(env, page.id, person, "sms", False)

    escalate(env, page.id)
    assert_row(env, page.id, second, "sms", False)
    assert env.mock.requests(to=second.phone, kind="sms", since_seq=second.seq) == [], "this org's breaker must be open"

    escalate(other_env, other_page.id)
    [sms] = env.mock.wait_for(other_next.phone, "sms", since_seq=other_next.seq)
    assert sms["sid"] == other_env.sid, sms
    assert_row(other_env, other_page.id, other_next, "sms", True)


# o2-enterprise#3420 R4: serial, because a phone page must tick email and Mailpit's 550 5.1.0 opens the node-wide email breaker, silencing every other test's mail.
@pytest.mark.serial
def test_f08_a_step_where_every_send_failed_is_retried(client: OpenObserveClient, env: TelephonyEnv):
    """F-08, D7, 3.7."""
    person = make_person(client, env, domain=MAILBOX_DOMAIN)
    sms_down = env.mock.fail(to=person.phone, kind="sms", status=500)
    env.mock.fail(to=person.phone, kind="call", status=500)
    page = fire_page(env, page_team(env, [[person]]))
    env.mock.wait_for(person.phone, "sms", 3, since_seq=person.seq, accepted=False)
    assert_row(env, page.id, person, "sms", False)
    assert_row(env, page.id, person, "voice", False)
    assert_row(env, page.id, person, "email", False)

    env.mock.clear_fail(sms_down)
    [landed] = env.mock.wait_for(person.phone, "sms", since_seq=person.seq, timeout=LADDER_TIMEOUT)
    assert landed["sid"] == env.sid, landed
    poll(lambda: rows_for(ledger_of(env, page.id), recipient=person.email, channel="sms")["delivered"] is True,
         msg="the retried SMS row")
    hold_count(env.mock, person.phone, "sms", 4, seconds=AFTER_STEP_RETRY_SECS, since_seq=person.seq)


TEST_PAGE_ANSWERS = [
    pytest.param({"status": 201}, True, id="201"),
    pytest.param({"status": 201, "body": {"sid": "SM0", "status": "suspended"}}, False, id="201-suspended"),
    pytest.param({"status": 201, "body": {"sid": "SM0", "status": "closed"}}, False, id="201-closed"),
    pytest.param({"status": 201, "raw_body": "not json"}, True, id="201-unparseable"),
    pytest.param({"status": 302}, False, id="302"),
    pytest.param({"status": 400}, False, id="400"),
]


@pytest.mark.parametrize(("rule", "delivered"), TEST_PAGE_ANSWERS)
def test_f06_a_test_page_classifies_each_answer(client: OpenObserveClient, env: TelephonyEnv, rule: dict, delivered: bool):
    """F-06, P9."""
    person = make_person(client, env)
    team = make_team(env, [person])
    set_rungs(env, team, [[person]])
    env.mock.fail(to=person.phone, kind="sms", **rule)
    answer = send_test_page(env, team)
    assert attempt_on(answer, "sms")["delivered"] is delivered, answer
    # o2-enterprise#3420 R2: exactly one request comes from the code, because the spec does not say a test page skips retries.
    [sms] = env.mock.requests(to=person.phone, kind="sms", since_seq=person.seq)
    assert sms["response_status"] == rule["status"], sms


@pytest.mark.xfail(strict=True, raises=OpenBugSymptom,
                   reason="o2-enterprise#3410: a 3xx with a Location is followed, so its 200 counts as a send, not as unavailable")
def test_f09_a_redirect_counts_as_unavailable(client: OpenObserveClient, env: TelephonyEnv):
    """F-09, P9, V8."""
    paged = make_person(client, env)
    new_number = make_person(client, env, verified=False)
    team = make_team(env, [paged])
    set_rungs(env, team, [[paged]])
    # The account route answers a followed GET with 200 and this account's own auth, the worst case for a client that follows.
    landing = f"/2010-04-01/Accounts/{env.sid}.json"
    for phone, kind in ((new_number.phone, "sms"), (paged.phone, "sms"), (paged.phone, "call")):
        env.mock.fail(to=phone, kind=kind, status=302, location=landing)

    sent = new_number.send_code()
    answer = send_test_page(env, team)
    delivered = {channel: attempt_on(answer, channel)["delivered"] for channel in ("sms", "voice")}
    for phone, kind, since in ((new_number.phone, "sms", new_number.seq), (paged.phone, "sms", paged.seq), (paged.phone, "call", paged.seq)):
        assert [r["response_status"] for r in env.mock.requests(to=phone, kind=kind, since_seq=since)] == [302], (phone, kind)

    if sent.status_code == 204 and delivered == {"sms": True, "voice": True}:
        raise OpenBugSymptom(f"o2-enterprise#3410: followed the redirect: verify {sent.status_code}, test page {delivered}")
    assert sent.status_code == 503, f"{sent.status_code} {sent.text}"
    body = sent.json()
    assert body["reason"] == "provider_unavailable", body
    assert body["message"] == "The code could not be sent right now. Try again in a minute.", body
    assert delivered == {"sms": False, "voice": False}, answer

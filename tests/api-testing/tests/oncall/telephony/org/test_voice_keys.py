"""Voice pages and keys 4, 6, 8 against the fake (K-01 to K-15); every press goes through the fake with no login or signature."""
from __future__ import annotations

from urllib.parse import urlsplit

import pytest
import requests

from support.client import OpenObserveClient
from support.wait import wait_until

from ...oncall_helpers import PAGE_POLL, PAGE_TIMEOUT, micros_from_now, rotation, rotation_target, shift_rule
from ..telephony_helpers import (
    ALREADY_ACKED_RE,
    CALLBACK_HOST,
    CLOSED_LINE,
    ESCALATED_LINE,
    ESCALATED_NOBODY_LINE,
    NO_KEY_LINE,
    NOBODY_ABOVE_LINE,
    PROMPT,
    REFUSED_LINE,
    RESOLVED_LINE,
    TWO_EVAL_CYCLES,
    Fired,
    OpenBugSymptom,
    Person,
    TelephonyEnv,
    ack_url,
    action_path,
    alert_acks,
    assert_acknowledged_by,
    assert_refused_twiml,
    assert_unanswered,
    fire_page,
    hold_count,
    link_in,
    link_token,
    make_person,
    make_team,
    page_team,
    poll,
    post_voice_path,
    record,
    set_rungs,
    timeline,
    wait_alert_acked,
)

pytestmark = pytest.mark.enterprise

# Sends in a step start together and one never runs past 15 s, so a re-page from the press lands inside this.
NO_REPAGE_SECS = 15.0
OPEN_STATES = ("triggered", "triaged")
ACTED_LINES = (RESOLVED_LINE, ESCALATED_LINE, ESCALATED_NOBODY_LINE, NOBODY_ABOVE_LINE)


def ring(env: TelephonyEnv, person: Person) -> dict:
    [call] = env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    return call


def rung_done(env: TelephonyEnv, page_id: str) -> None:
    # Key 8 counts a level as paged only once its page row lands, after every send; a press before re-picks it.
    poll(lambda: any(e["kind"] == "page" for e in timeline(env, page_id)), timeout=45, interval=0.5,
         msg=f"the first level of page {page_id} to finish sending")


def page_one_rung(env: TelephonyEnv, people: list[Person]) -> Fired:
    page = fire_page(env, page_team(env, [people]))
    for person in people:
        ring(env, person)
    rung_done(env, page.id)
    return page


def spoken(env: TelephonyEnv, person: Person, digits: str | None) -> list[str]:
    return env.mock.press(to=person.phone, digits=digits)["says"]


def page_facts(env: TelephonyEnv, page_id: str) -> dict:
    state = record(env, page_id)
    facts = {key: state.get(key) for key in ("state", "acked_by", "acked_at", "closed_at")}
    return facts | {"state": "open" if state["state"] in OPEN_STATES else state["state"]}


def assert_already_resolved_line(said: list[str]) -> None:
    if said == [REFUSED_LINE]:
        raise OpenBugSymptom(f"o2-enterprise#3409: a teammate on a resolved page heard {said}")
    assert said == [CLOSED_LINE], said


def assert_press_did_nothing(env: TelephonyEnv, page_id: str, before: dict, reply: dict) -> None:
    """o2-enterprise#3420 SC7 SC8a SC8b SC9: a refusal's words stay open, but every source has it say something, hang up and change nothing."""
    assert reply["says"], reply
    assert reply["gather"] is None, reply
    assert reply["hangup"] is True, reply
    assert not reply["says"][0].startswith("Acknowledged."), reply
    assert not set(reply["says"]) & set(ACTED_LINES), reply
    assert page_facts(env, page_id) == before, reply


def test_k01_the_call_script_and_an_unsigned_key_four_acknowledge(client: OpenObserveClient, env: TelephonyEnv):
    """K-01, 3.5, M1, M2, M8, section 4, A7, 02d 1."""
    person = make_person(client, env)
    team = page_team(env, [[person]])
    page = fire_page(env, team)
    call = ring(env, person)
    assert call["sid"] == env.sid, call
    assert call["from"] == env.from_number, call
    assert call["url"] is None, "the script goes inline, never a Url"

    parsed = call["twiml_parsed"]
    gather = parsed["gather"]
    assert gather["numDigits"] == "1", gather
    assert gather["finishOnKey"] == "", gather
    assert gather["method"] == "POST", gather
    assert gather["action"].startswith(f"https://{CALLBACK_HOST}/api/v2/{env.org}/oncall/ack/voice/"), gather
    assert parsed["says"] + gather["says"] == [
        f"OpenObserve page. Priority 1, for {team.name}. {page.title}.", PROMPT, PROMPT,
    ], parsed
    assert parsed["after_gather_says"] == [NO_KEY_LINE], parsed
    assert parsed["hangup"] is True, parsed

    reply = env.mock.press(to=person.phone, digits="4")
    # o2-enterprise#3420 SC6: the spec has two sentences for pressing 4, so only the start is read.
    assert reply["says"][0].startswith("Acknowledged."), reply
    assert reply["gather"] is None, reply
    assert reply["hangup"] is True, reply
    assert_acknowledged_by(env, page.id, person)
    assert wait_alert_acked(env, page.alert_id)[0]["acked_by"] == person.email


def test_k02_no_key_and_other_keys_spend_nothing(client: OpenObserveClient, env: TelephonyEnv):
    """K-02, M1, M3, M8."""
    person = make_person(client, env)
    page = page_one_rung(env, [person])

    assert spoken(env, person, None) == [NO_KEY_LINE]
    assert_unanswered(env, page.id)
    for key in ("1", "#", "*"):
        reply = env.mock.press(to=person.phone, digits=key)
        assert reply["gather"] is not None, f"{key}: {reply}"
        assert PROMPT in reply["gather"]["says"], f"{key}: {reply}"
        assert_unanswered(env, page.id)

    assert spoken(env, person, "4")[0].startswith("Acknowledged.")
    assert_acknowledged_by(env, page.id, person)


def test_k03_key_six_resolves_as_the_tokens_person(client: OpenObserveClient, env: TelephonyEnv):
    """K-03, M9, D37."""
    first = make_person(client, env)
    second = make_person(client, env)
    holder = make_person(client, env, verified=False, with_phone=False)
    team = page_team(env, [[first, second]], roster=[holder])
    page = fire_page(env, team)
    ring(env, first)
    ring(env, second)
    assert holder.on_call().acknowledge(page.id).status_code == 200
    wait_alert_acked(env, page.alert_id)

    assert spoken(env, first, "6") == [RESOLVED_LINE]
    state = record(env, page.id)
    assert state["state"] == "resolved", state
    assert state["closed_at"], state
    closes = [e for e in timeline(env, page.id) if e["kind"] == "state" and "resolved" in e["body"]]
    assert [e["actor"] for e in closes] == [first.email], closes
    poll(lambda: alert_acks(env, page.alert_id) == [], timeout=30, interval=2, msg="the resolve to clear the alert's ack")


@pytest.mark.xfail(strict=True, raises=OpenBugSymptom,
                   reason="o2-enterprise#3409: a teammate's key 6 on a resolved page hears the refused line, not the already-resolved line")
def test_k03_a_teammates_key_six_on_the_resolved_page_keeps_the_first_close(client: OpenObserveClient, env: TelephonyEnv):
    """K-03, M9, M3."""
    first = make_person(client, env)
    second = make_person(client, env)
    page = page_one_rung(env, [first, second])
    assert spoken(env, first, "6") == [RESOLVED_LINE]
    closed = record(env, page.id)
    assert closed["state"] == "resolved", closed

    said = spoken(env, second, "6")
    assert record(env, page.id)["closed_at"] == closed["closed_at"], "the first close time must be kept"
    assert_already_resolved_line(said)


def test_k04_a_still_firing_alert_pages_again_after_key_six(client: OpenObserveClient, env: TelephonyEnv):
    """K-04, D37."""
    person = make_person(client, env)
    page = page_one_rung(env, [person])
    assert spoken(env, person, "6") == [RESOLVED_LINE]

    # Needs the org shard's 30 s O2_ONCALL_FLAP_DAMPENING_SECS: the 5 minute default outlasts the test budget.
    def _next_page() -> list[dict] | None:
        env.oc.seed_rows(page.stream, page.rows)
        found = [p for p in env.oc.pages_for(page.alert_id) if p["id"] != page.id]
        return found or None

    again = wait_until(_next_page, timeout=PAGE_TIMEOUT, interval=PAGE_POLL, msg="a new page for the still-firing alert")
    assert again[0]["state"] in ("triggered", "triaged"), again
    assert record(env, page.id)["state"] == "resolved", "the new page must not reopen the old one"
    env.mock.wait_for(person.phone, "sms", 2, since_seq=person.seq)


def test_k05_key_eight_pages_the_next_level_once(client: OpenObserveClient, env: TelephonyEnv):
    """K-05, M10, 3.5."""
    first = make_person(client, env)
    next_up = make_person(client, env)
    page = fire_page(env, page_team(env, [[first], [next_up]]))
    ring(env, first)
    rung_done(env, page.id)
    assert env.mock.requests(to=next_up.phone, since_seq=next_up.seq) == [], "the next level must wait for the press"

    assert spoken(env, first, "8") == [ESCALATED_LINE]
    env.mock.wait_for(next_up.phone, "sms", since_seq=next_up.seq)
    ring(env, next_up)
    assert_unanswered(env, page.id)
    hold_count(env.mock, next_up.phone, "sms", 1, seconds=TWO_EVAL_CYCLES, since_seq=next_up.seq)
    assert len(env.mock.requests(to=next_up.phone, kind="call", since_seq=next_up.seq)) == 1


def test_k06_key_eight_keeps_the_owner_of_an_acked_page(client: OpenObserveClient, env: TelephonyEnv):
    """K-06, M10, 3.5."""
    owner = make_person(client, env)
    other = make_person(client, env)
    next_up = make_person(client, env)
    page = fire_page(env, page_team(env, [[owner, other], [next_up]]))
    ring(env, owner)
    ring(env, other)
    assert spoken(env, owner, "4")[0].startswith("Acknowledged.")

    assert spoken(env, other, "8") == [ESCALATED_LINE]
    env.mock.wait_for(next_up.phone, "sms", since_seq=next_up.seq)
    assert_acknowledged_by(env, page.id, owner)


def test_k07_key_eight_at_the_top_says_nobody_is_above(client: OpenObserveClient, env: TelephonyEnv):
    """K-07, M10."""
    person = make_person(client, env)
    page = page_one_rung(env, [person])
    assert spoken(env, person, "8") == [NOBODY_ABOVE_LINE]
    assert_unanswered(env, page.id)


def test_k08_key_eight_to_an_empty_level_says_so_and_changes_nothing(client: OpenObserveClient, env: TelephonyEnv):
    """K-08, M10."""
    person = make_person(client, env)
    team = make_team(env, [person])
    # A layer not yet in effect puts nobody on call while staying a valid target; a future anchor alone still rosters someone.
    nobody = "R_nobody"
    rule = shift_rule("Later", [person.email]) | {"starts_at": micros_from_now(days=7)}
    assert env.oc.set_schedule(team.id, [rotation(nobody, "Nobody", [rule])]).status_code == 200
    set_rungs(env, team, [[person], [rotation_target(nobody)]])
    page = fire_page(env, team)
    ring(env, person)
    env.mock.wait_for(person.phone, "sms", since_seq=person.seq)
    rung_done(env, page.id)
    assert spoken(env, person, "8") == [ESCALATED_NOBODY_LINE]
    assert_unanswered(env, page.id)
    hold_count(env.mock, person.phone, None, 2, seconds=NO_REPAGE_SECS, since_seq=person.seq)


def test_k09_key_eight_after_a_resolve_changes_nothing(client: OpenObserveClient, env: TelephonyEnv):
    """K-09, M10."""
    first = make_person(client, env)
    second = make_person(client, env)
    next_up = make_person(client, env)
    page = fire_page(env, page_team(env, [[first, second], [next_up]]))
    ring(env, first)
    ring(env, second)
    assert spoken(env, first, "6") == [RESOLVED_LINE]
    before = page_facts(env, page.id)
    assert before["state"] == "resolved", before

    assert_press_did_nothing(env, page.id, before, env.mock.press(to=second.phone, digits="8"))
    hold_count(env.mock, next_up.phone, None, 0, seconds=NO_REPAGE_SECS, since_seq=next_up.seq)


@pytest.mark.xfail(strict=True, raises=OpenBugSymptom,
                   reason="o2-enterprise#3409: a teammate's key 8 on a resolved page hears the refused line, not the already-resolved line")
def test_k09_key_eight_after_a_resolve_says_already_resolved(client: OpenObserveClient, env: TelephonyEnv):
    """K-09, M10, M3."""
    first = make_person(client, env)
    second = make_person(client, env)
    page = page_one_rung(env, [first, second])
    assert spoken(env, first, "6") == [RESOLVED_LINE]
    said = spoken(env, second, "8")
    assert record(env, page.id)["state"] == "resolved"
    assert_already_resolved_line(said)


def test_k10_replays_and_a_second_person_name_the_owner_then_the_closed_line(client: OpenObserveClient, env: TelephonyEnv):
    """K-10, 3.5, M3, M4, section 4, o2-enterprise#3420 SC9."""
    owner = make_person(client, env, first_name="Owner")
    other = make_person(client, env, first_name="Other")
    assert owner.display_name != other.display_name, "the reply must be able to tell them apart"
    page = page_one_rung(env, [owner, other])
    assert spoken(env, owner, "4")[0].startswith("Acknowledged.")
    acked = assert_acknowledged_by(env, page.id, owner)

    for person, key in ((owner, "4"), (owner, "6"), (owner, "8"), (other, "4")):
        [line] = spoken(env, person, key)
        found = ALREADY_ACKED_RE.fullmatch(line)
        assert found, f"key {key}: {line!r}"
        assert found.group(1) == owner.display_name, line
        replayed = assert_acknowledged_by(env, page.id, owner)
        assert replayed["acked_at"] == acked["acked_at"], "a replay must not re-acknowledge"

    assert env.oc.resolve(page.id).status_code == 200
    closed = record(env, page.id)
    assert closed["state"] == "resolved", closed
    assert spoken(env, owner, "4") == [CLOSED_LINE]
    assert record(env, page.id)["closed_at"] == closed["closed_at"]


def test_k11_a_token_only_works_on_its_own_orgs_path(client: OpenObserveClient, env: TelephonyEnv, other_env: TelephonyEnv):
    """K-11, A7, M3."""
    person = make_person(client, env)
    page = page_one_rung(env, [person])
    call = env.mock.requests(to=person.phone, kind="call", since_seq=person.seq)[0]
    path = action_path(call)
    assert urlsplit(call["twiml_parsed"]["gather"]["action"]).netloc == CALLBACK_HOST
    foreign = path.replace(f"/api/v2/{env.org}/", f"/api/v2/{other_env.org}/")
    assert foreign != path, path

    assert_refused_twiml(post_voice_path(client, foreign))
    assert_unanswered(env, page.id)
    assert spoken(env, person, "4")[0].startswith("Acknowledged.")
    assert_acknowledged_by(env, page.id, person)


def test_k12_a_person_removed_from_the_org_is_refused(client: OpenObserveClient, env: TelephonyEnv):
    """K-12, A7, M3."""
    leaver = make_person(client, env)
    stays = make_person(client, env)
    page = page_one_rung(env, [leaver, stays])
    removed = client.users.delete(leaver.email, org=env.org)
    assert removed.status_code == 200, removed.text

    assert spoken(env, leaver, "4") == [REFUSED_LINE]
    assert_unanswered(env, page.id)
    assert spoken(env, leaver, "4") == [REFUSED_LINE]
    assert_unanswered(env, page.id)


@pytest.mark.parametrize("before_the_press", ["nobody_acted", "someone_acked", "someone_resolved"])
def test_k13_a_user_taken_off_the_team_changes_nothing_with_any_key(client: OpenObserveClient, env: TelephonyEnv, before_the_press: str):
    """K-13, M4, A7, 02d 3, o2-enterprise#3420 SC7 SC8a SC8b SC9."""
    leavers = {key: make_person(client, env) for key in ("4", "6", "8")}
    stays = make_person(client, env)
    next_up = make_person(client, env)
    team = page_team(env, [[*leavers.values(), stays], [next_up]])
    page = fire_page(env, team)
    for person in (*leavers.values(), stays):
        ring(env, person)
    for leaver in leavers.values():
        removed = env.oc.remove_member(team.id, leaver.email)
        assert removed.status_code == 200, removed.text
    members = [m.get("user_email") for m in env.oc.members(team.id)]
    assert not {leaver.email for leaver in leavers.values()} & set(members), members

    if before_the_press == "someone_acked":
        assert spoken(env, stays, "4")[0].startswith("Acknowledged.")
    elif before_the_press == "someone_resolved":
        assert spoken(env, stays, "6") == [RESOLVED_LINE]
    before = page_facts(env, page.id)

    for key, leaver in leavers.items():
        for _press in ("first", "second"):
            assert_press_did_nothing(env, page.id, before, env.mock.press(to=leaver.phone, digits=key))
    hold_count(env.mock, next_up.phone, None, 0, seconds=NO_REPAGE_SECS, since_seq=next_up.seq)


def test_k14_two_people_on_key_eight_page_the_next_level_once(client: OpenObserveClient, env: TelephonyEnv):
    """K-14, M10."""
    first = make_person(client, env)
    second = make_person(client, env)
    next_up = make_person(client, env)
    page = fire_page(env, page_team(env, [[first, second], [next_up]]))
    ring(env, first)
    ring(env, second)
    rung_done(env, page.id)

    assert spoken(env, first, "8") == [ESCALATED_LINE]
    # o2-enterprise#3420 R5: M10 names no reply for the second person's key 8, and top of the ladder is an equally valid reading.
    assert spoken(env, second, "8") in ([ESCALATED_LINE], [NOBODY_ABOVE_LINE])
    env.mock.wait_for(next_up.phone, "sms", since_seq=next_up.seq)
    ring(env, next_up)
    hold_count(env.mock, next_up.phone, "sms", 1, seconds=NO_REPAGE_SECS, since_seq=next_up.seq)
    assert len(env.mock.requests(to=next_up.phone, kind="call", since_seq=next_up.seq)) == 1
    assert_unanswered(env, page.id)


def test_k15_a_token_is_refused_on_the_other_kind_of_path(client: OpenObserveClient, env: TelephonyEnv):
    """K-15, M3, A7."""
    person = make_person(client, env)
    page = page_one_rung(env, [person])
    [sms] = env.mock.wait_for(person.phone, "sms", since_seq=person.seq)
    [call] = env.mock.requests(to=person.phone, kind="call", since_seq=person.seq)
    voice_prefix, _, voice_token = action_path(call).rpartition("/")

    assert_refused_twiml(post_voice_path(client, f"{voice_prefix}/{link_token(link_in(sms))}"))
    assert_unanswered(env, page.id)
    on_link = requests.post(ack_url(env), data={"token": voice_token}, allow_redirects=False, timeout=30)
    # o2-enterprise#3420 E70: the spec has no line for a call token on the link path, so any client error passes.
    assert 400 <= on_link.status_code < 500, f"{on_link.status_code}: {on_link.text[:300]}"
    assert_unanswered(env, page.id)

    assert spoken(env, person, "4")[0].startswith("Acknowledged."), "the same token must still work on its own path"
    assert_acknowledged_by(env, page.id, person)

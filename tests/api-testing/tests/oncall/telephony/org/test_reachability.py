from __future__ import annotations

import pytest

from support.client import OpenObserveClient

from ...oncall_helpers import MAILBOX_DOMAIN
from ..telephony_helpers import (
    TelephonyEnv,
    channel_of,
    json_keys,
    make_person,
    make_team,
    member_of,
    read_reachability,
)

pytestmark = pytest.mark.enterprise


def test_l01_each_person_gets_their_own_reason(client: OpenObserveClient, env: TelephonyEnv):
    """L-01, S1, 3.6, A4, U5."""
    # An address on the reserved test domain reads as undeliverable, which would say nothing about the phone channels.
    none = make_person(client, env, verified=False, with_phone=False, domain=MAILBOX_DOMAIN)
    unverified = make_person(client, env, verified=False, domain=MAILBOX_DOMAIN)
    verified = make_person(client, env, domain=MAILBOX_DOMAIN)
    team = make_team(env, [none, unverified, verified])
    body, raw = read_reachability(env, team)

    for channel in ("sms", "voice"):
        assert channel_of(member_of(body, none), channel)["blocked_because"] == "no phone on file", body
        assert channel_of(member_of(body, unverified), channel)["blocked_because"] == "phone not verified", body
        reached = channel_of(member_of(body, verified), channel)
        assert reached["deliverable"] is True, reached
        assert reached.get("blocked_because") is None, reached
    for person in (none, unverified, verified):
        assert channel_of(member_of(body, person), "email")["deliverable"] is True, body
    assert unverified.phone not in raw, "reachability must never carry a number"
    assert verified.phone not in raw, "reachability must never carry a number"
    assert "phone" not in json_keys(body), "reachability must have no phone key"
    assert '"code"' not in raw, "reachability must never carry code data"

    env.disconnect()
    body, _raw = read_reachability(env, team)
    gone = channel_of(member_of(body, verified), "sms")
    assert gone["blocked_because"] == "no phone provider for this organisation", gone
    assert channel_of(member_of(body, verified), "email")["deliverable"] is True, body


def test_l02_a_verified_phone_in_an_org_that_never_had_a_provider_is_blocked_by_that(
    client: OpenObserveClient, env: TelephonyEnv, unconnected_env: TelephonyEnv,
):
    """L-02, S1, 3.6, A4, U5."""
    person = make_person(client, env, domain=MAILBOX_DOMAIN)
    joined = client.post(f"users/{person.email}", json={"role": "user"}, org=unconnected_env.org)
    assert joined.status_code == 200, joined.text
    unconnected_env.oc.users.append(person.email)
    # A proof on file is the only way past the earlier reasons where no code can be sent (V5).
    person.save_phone(person.phone, org=unconnected_env.org)
    assert unconnected_env.get_telephony()["org"] is None

    team = make_team(unconnected_env, [person])
    body, raw = read_reachability(unconnected_env, team)
    member = member_of(body, person)
    for channel in ("sms", "voice"):
        verdict = channel_of(member, channel)
        assert verdict["deliverable"] is False, verdict
        assert verdict["blocked_because"] == "no phone provider for this organisation", verdict
    assert channel_of(member, "email")["deliverable"] is True, member
    assert person.phone not in raw, "reachability must never carry the number"
    assert "phone" not in json_keys(body), "reachability must have no phone key"

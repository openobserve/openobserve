from __future__ import annotations

import pytest

from support.client import OpenObserveClient

from ...oncall_helpers import COL_SERVICE, PAGE_POLL, PAGE_TIMEOUT, RUNG_NOW, group_aggregation, paging_alert, uniq
from ..telephony_helpers import (
    RUNG_SOON,
    TelephonyEnv,
    alert_acks,
    assert_acknowledged_by,
    fire_page,
    hold_count,
    make_person,
    page_team,
    poll,
    wait_alert_acked,
)

pytestmark = pytest.mark.enterprise

# o2-enterprise#3420 SC6: the spec has two sentences for pressing 4, so every acknowledge reply in this file is read only up to its first word.

# A-03 is the control for this window: the same rung, unpressed, must fire inside it; kept short for the 6-minute budget.
RUNG_TWO_DUE_SECS = RUNG_SOON / 1_000_000 + 90


def incident_of(env: TelephonyEnv, alert_name: str) -> dict | None:
    resp = env.oc.v2("GET", "alerts?folder=default&page_size=1000")
    assert resp.status_code == 200, f"listing alerts: {resp.status_code} {resp.text}"
    return next((a.get("incident") for a in resp.json().get("list", []) if a.get("name") == alert_name), None)


def incident_status(env: TelephonyEnv, incident_id: str) -> str:
    resp = env.oc.v2("GET", f"alerts/incidents/{incident_id}")
    assert resp.status_code == 200, f"reading incident {incident_id}: {resp.status_code} {resp.text}"
    body = resp.json()
    return body.get("incident", body)["status"]


def test_a01_key_four_covers_every_group(client: OpenObserveClient, env: TelephonyEnv):
    """A-01, D22."""
    person = make_person(client, env)
    team = page_team(env, [[person]])
    rows = [{"latency": 900, COL_SERVICE: "checkout"}, {"latency": 900, COL_SERVICE: "billing"}]
    page = fire_page(env, team, aggregation=group_aggregation([COL_SERVICE], multi_alert=True), rows=rows)
    env.mock.wait_for(person.phone, "call", since_seq=person.seq)

    assert env.mock.press(to=person.phone, digits="4")["says"][0].startswith("Acknowledged.")
    assert_acknowledged_by(env, page.id, person)

    def _both_groups() -> list[dict] | None:
        acks = alert_acks(env, page.alert_id)
        return acks if len({a["group_key"] for a in acks}) == len(rows) else None

    acks = poll(_both_groups, timeout=30, interval=2, msg="an ack on both firing groups")
    assert {a["acked_by"] for a in acks} == {person.email}, acks


def test_a02_key_four_stops_the_next_rung(client: OpenObserveClient, env: TelephonyEnv):
    """A-02, 02d 1, D19."""
    first = make_person(client, env)
    second = make_person(client, env)
    team = page_team(env, [[first], [second]], delays=[RUNG_NOW, RUNG_SOON])
    page = fire_page(env, team)
    env.mock.wait_for(first.phone, "call", since_seq=first.seq)
    assert env.mock.press(to=first.phone, digits="4")["says"][0].startswith("Acknowledged.")
    assert_acknowledged_by(env, page.id, first)

    hold_count(env.mock, second.phone, None, 0, seconds=RUNG_TWO_DUE_SECS, since_seq=second.seq)


def test_a03_control_with_no_press_the_next_rung_fires(client: OpenObserveClient, env: TelephonyEnv):
    """A-03, 02d 1."""
    first = make_person(client, env)
    second = make_person(client, env)
    team = page_team(env, [[first], [second]], delays=[RUNG_NOW, RUNG_SOON])
    fire_page(env, team)
    env.mock.wait_for(first.phone, "call", since_seq=first.seq)

    env.mock.wait_for(second.phone, "sms", since_seq=second.seq, timeout=RUNG_TWO_DUE_SECS)
    env.mock.wait_for(second.phone, "call", since_seq=second.seq)


def test_a04_key_four_after_the_alert_was_deleted(client: OpenObserveClient, env: TelephonyEnv):
    """A-04, D36."""
    person = make_person(client, env)
    team = page_team(env, [[person]])
    page = fire_page(env, team)
    env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    deleted = env.oc.delete_alert(page.alert_id)
    assert deleted.status_code == 200, deleted.text

    assert env.mock.press(to=person.phone, digits="4")["says"][0].startswith("Acknowledged.")
    assert_acknowledged_by(env, page.id, person)


def test_a05_key_four_on_an_alert_in_an_incident_acknowledges_the_incident(client: OpenObserveClient, env: TelephonyEnv):
    """A-05, 02d 6.3, AK-1, D18."""
    person = make_person(client, env)
    team = page_team(env, [[person]])
    stream = uniq("tel_stream")
    rows = [{"latency": 900, "service": "checkout"}]
    alert_name = uniq("tel_alert")
    assert env.oc.seed_rows(stream, rows).status_code == 200
    created = env.oc.create_alert(paging_alert(alert_name, stream, oncall_team=team.id) | {"creates_incident": True})
    assert created.status_code == 200, created.text
    alert_id = created.json()["id"]

    # A correlated firing pages under the incident, not the alert, so `fire_page`'s lookup by alert id never finds it.
    def _page() -> list[dict] | None:
        env.oc.seed_rows(stream, rows)
        return env.oc.list_responses() or None

    [page] = poll(_page, timeout=PAGE_TIMEOUT, interval=PAGE_POLL, msg="a page for the incident")
    env.mock.wait_for(person.phone, "call", since_seq=person.seq)
    incident = poll(lambda: incident_of(env, alert_name), timeout=30, interval=2, msg="the alert to name its incident")
    assert incident_status(env, incident["id"]) != "acknowledged", incident

    assert env.mock.press(to=person.phone, digits="4")["says"][0].startswith("Acknowledged.")
    assert_acknowledged_by(env, page["id"], person)
    poll(lambda: incident_status(env, incident["id"]) == "acknowledged", timeout=30, interval=2, msg="the incident to read acknowledged")
    assert wait_alert_acked(env, alert_id)[0]["acked_by"] == person.email

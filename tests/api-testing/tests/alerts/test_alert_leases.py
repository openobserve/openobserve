"""Alert leases (#17068): temporary alerts and timed incident creation, driven by the lease API.

Nothing here waits on the 60 s expiry sweep (see the _wallclock file); leases end an hour out."""
from __future__ import annotations

import pytest

from .multialert_helpers import (
    DAY_US,
    SECOND_US,
    lease_spec,
    now_us,
    realtime_alert,
    simple_alert,
    uniq,
)

HOUR_S = 3600
REASON = "api lease test"


def _create(alerts, payload: dict) -> str:
    resp = alerts.create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json().get("id")
    assert alert_id, f"create answered without an id: {resp.text}"
    alerts.created.append(alert_id)
    return alert_id


def _temporary(alerts, prefix: str = "lease_tmp", ends_in_s: float = HOUR_S, **spec) -> tuple[str, str, dict]:
    name = uniq(prefix)
    payload = simple_alert(name)
    payload["lease"] = lease_spec(ends_in_s, **spec)
    alert_id = _create(alerts, payload)
    leases = _leases(alerts, alert_id)
    assert len(leases) == 1, leases
    return name, alert_id, leases[0]


def _plain(alerts, prefix: str = "lease_plain") -> tuple[str, str]:
    name = uniq(prefix)
    return name, _create(alerts, simple_alert(name))


def _leases(alerts, alert_id: str, state: str | None = None) -> list[dict]:
    resp = alerts.alert_leases(alert_id, state)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _org_lease_ids(alerts, state: str | None = None) -> list[str]:
    resp = alerts.org_alert_leases(state)
    assert resp.status_code == 200, resp.text
    return [lease["id"] for lease in resp.json()]


def _alert(alerts, alert_id: str) -> dict:
    alert = alerts.get_alert(alert_id)
    assert alert is not None, f"alert {alert_id} is gone"
    return alert


def _item(alerts, name: str) -> dict:
    item = alerts.list_item(name)
    assert item is not None, f"alert {name} is not in the list"
    return item


def _timed(alerts, alert_id: str, value: bool = True, until_s: float = HOUR_S, **extra):
    body = {"value": value, "until_us": now_us() + int(until_s * SECOND_US), "reason": REASON, **extra}
    return alerts.set_creates_incident(alert_id, body)


def _timed_lease(alerts, alert_id: str, value: bool = True) -> dict:
    resp = _timed(alerts, alert_id, value)
    assert resp.status_code == 200, resp.text
    lease = resp.json()["lease"]
    assert lease["kind"] == "creates_incident", lease
    assert lease["state"] == "active", lease
    return lease


def _conflict(resp, code: str) -> dict:
    assert resp.status_code == 409, f"expected 409 {code}, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body["code"] == code, body
    return body


def _bad_request(resp, message: str) -> None:
    assert resp.status_code == 400, f"expected 400 '{message}', got {resp.status_code}: {resp.text}"
    assert resp.json()["message"] == message, resp.text


def _end(alerts, alert_id: str, lease_id: str) -> dict:
    resp = alerts.lease_action(alert_id, lease_id, "end")
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.parametrize("make", [simple_alert, realtime_alert], ids=["scheduled", "realtime"])
def test_a_temporary_alert_lists_its_active_lease(alerts, make):
    """A1"""
    name = uniq("lease_a1")
    payload = make(name)
    payload["lease"] = lease_spec(HOUR_S, reason="  checkout latency watch  ", origin_ref="inc-a1")
    alert_id = _create(alerts, payload)

    item = _item(alerts, name)
    assert item["enabled"] is True
    assert len(item["leases"]) == 1, item["leases"]
    lease = item["leases"][0]
    assert lease["alert_id"] == alert_id
    assert lease["kind"] == "created"
    assert lease["state"] == "active"
    assert lease["set_by"] == alerts._c.email
    assert lease["set_by_name"] == alerts._c.email
    assert lease["reason"] == "checkout latency watch", "the reason is stored trimmed"
    assert lease["origin_ref"] == "inc-a1"
    assert lease["ends_at_us"] == payload["lease"]["ends_at_us"]
    assert "ended_at_us" not in lease
    assert _leases(alerts, alert_id) == [lease]
    assert "leases" not in _alert(alerts, alert_id), "the single GET carries no leases"


@pytest.mark.parametrize(
    ("ends_in_s", "reason", "message"),
    [
        (-60, REASON, "The end time must be in the future."),
        (7 * 24 * HOUR_S + 60, REASON, "The end time must be within 7 days."),
        (HOUR_S, "", "Give a reason; it is shown on the alert."),
        (HOUR_S, "   ", "Give a reason; it is shown on the alert."),
        (HOUR_S, "x" * 501, "The reason must be at most 500 characters."),
    ],
    ids=["past_end", "over_7_days", "empty_reason", "whitespace_reason", "501_char_reason"],
)
def test_an_invalid_lease_refuses_the_create(alerts, ends_in_s, reason, message):
    """A2-A5"""
    name = uniq("lease_bad")
    payload = simple_alert(name)
    payload["lease"] = lease_spec(ends_in_s, reason=reason)
    _bad_request(alerts.create_alert(payload), message)
    assert alerts.list_item(name) is None, "a refused temporary alert must not be saved"


def test_a_500_char_reason_is_accepted_whole(alerts):
    """A5 boundary"""
    _, _, lease = _temporary(alerts, "lease_r500", reason="r" * 500)
    assert lease["reason"] == "r" * 500


def test_a_composite_or_anomaly_alert_cannot_be_temporary(alerts):
    """A6"""
    _, child = _plain(alerts, "lease_child")
    composite = uniq("lease_cmp")
    anomaly = uniq("lease_anom")
    payloads = [
        {
            "alert_type": "composite", "name": composite, "description": "lease", "enabled": True,
            "destinations": ["auto_p0_dest"], "template": "auto_p0_tmpl", "context_attributes": {},
            "trigger_condition": {"silence": 0}, "creates_incident": False, "workflows": [],
            "priority": 2, "tags": [],
            "composite_condition": {
                "expression": f"{{{child}}}", "warning_counts_as_firing": True, "stale_child_policy": "use_last_state",
            },
        },
        {**simple_alert(anomaly), "alert_type": "anomaly_detection"},
    ]
    for payload in payloads:
        payload["lease"] = lease_spec(HOUR_S)
        _bad_request(
            alerts.create_alert(payload), "Only a scheduled or real-time alert can be created as a temporary alert"
        )
    assert alerts.list_item(composite) is None
    assert alerts.list_item(anomaly) is None


def test_ending_a_temporary_alert_disables_it_and_keeps_it(alerts):
    """A7"""
    name, alert_id, lease = _temporary(alerts, "lease_a7")
    before = now_us()
    ended = _end(alerts, alert_id, lease["id"])
    assert ended["state"] == "ended"
    assert ended["id"] == lease["id"]
    assert ended["ended_at_us"] >= before
    assert _alert(alerts, alert_id)["enabled"] is False
    item = _item(alerts, name)
    assert item["enabled"] is False
    assert "leases" not in item, "an ended lease leaves the list row"
    assert _leases(alerts, alert_id) == [ended]
    _conflict(alerts.lease_action(alert_id, lease["id"], "end"), "not_active")


def test_keeping_a_temporary_alert_makes_it_ordinary(alerts):
    """A8"""
    name, alert_id, lease = _temporary(alerts, "lease_a8")
    resp = alerts.lease_action(alert_id, lease["id"], "keep")
    assert resp.status_code == 200, resp.text
    kept = resp.json()
    assert kept["state"] == "kept"
    assert kept["state_reason"] == f"Kept by {alerts._c.email}"
    assert _alert(alerts, alert_id)["enabled"] is True
    assert "leases" not in _item(alerts, name)
    _conflict(alerts.lease_action(alert_id, lease["id"], "end"), "not_active")
    _conflict(alerts.lease_action(alert_id, lease["id"], "keep"), "not_active")
    assert _alert(alerts, alert_id)["enabled"] is True, "a refused end must not disable a kept alert"


def test_a_temporary_alert_blocks_a_timed_toggle_until_kept(alerts):
    """A9"""
    _, alert_id, lease = _temporary(alerts, "lease_a9")
    blocked = _conflict(_timed(alerts, alert_id), "lease_active")
    assert blocked["lease_id"] == lease["id"]
    assert _alert(alerts, alert_id)["creates_incident"] is False
    assert [x["id"] for x in _leases(alerts, alert_id)] == [lease["id"]]

    assert alerts.lease_action(alert_id, lease["id"], "keep").status_code == 200
    timed = _timed_lease(alerts, alert_id)
    assert _alert(alerts, alert_id)["creates_incident"] is True
    assert {x["id"]: x["state"] for x in _leases(alerts, alert_id)} == {lease["id"]: "kept", timed["id"]: "active"}


def test_an_untimed_toggle_changes_the_value_without_a_lease(alerts):
    """A10"""
    name, alert_id = _plain(alerts, "lease_a10")
    for value in (True, False):
        resp = alerts.set_creates_incident(alert_id, {"value": value})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["creates_incident"] is value
        assert isinstance(body["version"], int)
        assert "lease" not in body
        assert _alert(alerts, alert_id)["creates_incident"] is value
    assert _leases(alerts, alert_id) == []
    assert "leases" not in _item(alerts, name)


def test_a_timed_toggle_holds_the_value_and_its_end_restores_the_prior_one(alerts):
    """A11"""
    name, alert_id = _plain(alerts, "lease_a11")
    resp = _timed(alerts, alert_id, True, origin_ref="inc-a11")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    lease = body["lease"]
    assert body["creates_incident"] is True
    assert lease["kind"] == "creates_incident"
    assert lease["state"] == "active"
    assert lease["set_value"] is True
    assert lease["reason"] == REASON
    assert lease["origin_ref"] == "inc-a11"
    assert lease["version"] == body["version"]
    assert _alert(alerts, alert_id)["creates_incident"] is True
    assert [x["id"] for x in _item(alerts, name)["leases"]] == [lease["id"]]

    ended = _end(alerts, alert_id, lease["id"])
    assert ended["state"] == "ended"
    assert "ended_at_us" in ended
    assert _alert(alerts, alert_id)["creates_incident"] is False, "the prior value returns at the end"
    assert "leases" not in _item(alerts, name)


def test_a_second_timed_toggle_is_refused(alerts):
    """A12"""
    _, alert_id = _plain(alerts, "lease_a12")
    first = _timed_lease(alerts, alert_id, True)
    second = _conflict(_timed(alerts, alert_id, False), "lease_active")
    assert second["lease_id"] == first["id"]
    assert _alert(alerts, alert_id)["creates_incident"] is True
    assert [x["id"] for x in _leases(alerts, alert_id)] == [first["id"]]


@pytest.mark.parametrize(
    ("until_s", "reason", "message"),
    [
        (HOUR_S, None, "Give a reason; it is shown on the alert."),
        (HOUR_S, "  ", "Give a reason; it is shown on the alert."),
        (-60, REASON, "The end time must be in the future."),
        (7 * 24 * HOUR_S + 60, REASON, "The end time must be within 7 days."),
    ],
    ids=["no_reason", "blank_reason", "past_until", "over_7_days"],
)
def test_an_invalid_timed_toggle_changes_nothing(alerts, until_s, reason, message):
    """A12"""
    _, alert_id = _plain(alerts, "lease_a12_bad")
    body = {"value": True, "until_us": now_us() + int(until_s * SECOND_US)}
    if reason is not None:
        body["reason"] = reason
    _bad_request(alerts.set_creates_incident(alert_id, body), message)
    assert _alert(alerts, alert_id)["creates_incident"] is False
    assert _leases(alerts, alert_id) == []


def test_expected_version_guards_the_toggle(alerts):
    """A13"""
    _, alert_id = _plain(alerts, "lease_a13")
    first = alerts.set_creates_incident(alert_id, {"value": True})
    assert first.status_code == 200, first.text
    v1 = first.json()["version"]

    second = alerts.set_creates_incident(alert_id, {"value": False, "expected_version": v1})
    assert second.status_code == 200, second.text
    v2 = second.json()["version"]
    assert v2 > v1

    stale = _conflict(alerts.set_creates_incident(alert_id, {"value": True, "expected_version": v1}), "version_changed")
    assert stale["version"] == v2, "the conflict carries the current version"
    assert _alert(alerts, alert_id)["creates_incident"] is False, "a stale toggle must not land"
    timed_stale = _timed(alerts, alert_id, True, expected_version=v1)
    _conflict(timed_stale, "version_changed")
    assert _leases(alerts, alert_id) == []


def _superseded_by_edit(alerts, view: dict) -> None:
    assert view["state"] == "superseded", view
    assert view["state_reason"] == f"Left as it is: {alerts._c.email} changed the alert after this began."


def test_an_edit_after_a_timed_toggle_wins_over_its_end(alerts):
    """A14: PUT"""
    _, alert_id = _plain(alerts, "lease_a14_put")
    lease = _timed_lease(alerts, alert_id, True)
    edited = _alert(alerts, alert_id)
    edited["description"] = "edited during the lease"
    assert alerts.update_alert(alert_id, edited).status_code == 200

    _superseded_by_edit(alerts, _end(alerts, alert_id, lease["id"]))
    after = _alert(alerts, alert_id)
    assert after["creates_incident"] is True, "the end must not undo a value a person saved"
    assert after["description"] == "edited during the lease"


def test_a_disable_after_a_timed_toggle_wins_over_its_end(alerts):
    """A14: /enable"""
    _, alert_id = _plain(alerts, "lease_a14_enable")
    lease = _timed_lease(alerts, alert_id, True)
    assert alerts.enable_alert(alert_id, False).status_code == 200

    _superseded_by_edit(alerts, _end(alerts, alert_id, lease["id"]))
    after = _alert(alerts, alert_id)
    assert after["enabled"] is False
    assert after["creates_incident"] is True


def test_an_edited_temporary_alert_stays_enabled_after_its_end(alerts):
    """A14: temporary alert"""
    _, alert_id, lease = _temporary(alerts, "lease_a14_tmp")
    edited = _alert(alerts, alert_id)
    edited["description"] = "kept on by a person"
    assert alerts.update_alert(alert_id, edited).status_code == 200

    _superseded_by_edit(alerts, _end(alerts, alert_id, lease["id"]))
    after = _alert(alerts, alert_id)
    assert after["enabled"] is True
    assert after["description"] == "kept on by a person"


def test_ending_the_lease_of_a_deleted_temporary_alert_supersedes_it(alerts):
    """A15"""
    _, alert_id, lease = _temporary(alerts, "lease_a15")
    assert lease["id"] in _org_lease_ids(alerts)
    deleted = alerts._v2("DELETE", f"alerts/{alert_id}?folder=default")
    assert deleted.status_code == 200, deleted.text
    assert alerts.get_alert(alert_id) is None

    ended = _end(alerts, alert_id, lease["id"])
    assert ended["state"] == "superseded"
    assert ended["state_reason"] == "The alert was deleted."
    assert lease["id"] not in _org_lease_ids(alerts), "a deleted alert's leases leave the org list"
    assert [(x["id"], x["state"]) for x in _leases(alerts, alert_id)] == [(lease["id"], "superseded")]
    assert alerts.get_alert(alert_id) is None, "ending the lease must not bring the alert back"


def test_extend_moves_the_end_within_the_window(alerts):
    """A16"""
    name, alert_id, lease = _temporary(alerts, "lease_a16")
    _, other_id, other = _temporary(alerts, "lease_a16_other")
    new_end = now_us() + 2 * HOUR_S * SECOND_US
    resp = alerts.lease_action(alert_id, lease["id"], "extend", {"ends_at_us": new_end})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ends_at_us"] == new_end
    assert resp.json()["state"] == "active"
    assert _leases(alerts, alert_id)[0]["ends_at_us"] == new_end
    assert _item(alerts, name)["leases"][0]["ends_at_us"] == new_end

    for bad_end, message in [
        (now_us() - 60 * SECOND_US, "The end time must be in the future."),
        (now_us() + 7 * DAY_US + 60 * SECOND_US, "The end time must be within 7 days."),
    ]:
        _bad_request(alerts.lease_action(alert_id, lease["id"], "extend", {"ends_at_us": bad_end}), message)
    assert _leases(alerts, alert_id)[0]["ends_at_us"] == new_end, "a refused extend changes nothing"

    for wrong in (other["id"], "2zzzzzzzzzzzzzzzzzzzzzzzzzz"):
        stray = alerts.lease_action(alert_id, wrong, "extend", {"ends_at_us": new_end + SECOND_US})
        assert stray.status_code == 404, stray.text
    assert _leases(alerts, other_id)[0]["ends_at_us"] == other["ends_at_us"], "a foreign lease is untouched"

    _end(alerts, alert_id, lease["id"])
    _conflict(alerts.lease_action(alert_id, lease["id"], "extend", {"ends_at_us": new_end}), "not_active")


def test_lease_lists_are_newest_first_and_filter_by_state(alerts):
    """A17"""
    _, alert_id = _plain(alerts, "lease_a17")
    older = _timed_lease(alerts, alert_id, True)
    _end(alerts, alert_id, older["id"])
    newer = _timed_lease(alerts, alert_id, True)

    assert [x["id"] for x in _leases(alerts, alert_id)] == [newer["id"], older["id"]]
    assert [x["id"] for x in _leases(alerts, alert_id, "active")] == [newer["id"]]
    assert [x["id"] for x in _leases(alerts, alert_id, "ended")] == [older["id"]]
    assert _leases(alerts, alert_id, "kept") == []

    everything = _org_lease_ids(alerts)
    assert everything.index(newer["id"]) < everything.index(older["id"])
    active, ended = _org_lease_ids(alerts, "active"), _org_lease_ids(alerts, "ended")
    assert newer["id"] in active
    assert older["id"] not in active
    assert older["id"] in ended
    assert newer["id"] not in ended

    assert alerts.alert_leases(alert_id, "bogus").status_code == 400
    assert alerts.org_alert_leases("bogus").status_code == 400

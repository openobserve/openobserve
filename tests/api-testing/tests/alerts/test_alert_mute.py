"""Mute and "Until it clears" through the alert-scoped routes (Slack app Phase 2, §6)  [P1]

A quick mute is a one-time downtime that names one alert and nothing else, written through
`/alerts/{id}/mute`. Until it clears ends the row when the firing clears, 24 hours at most;
a group mute withholds only the groups it names. Alerts here evaluate every minute against a
self-ingest sink. Downtimes are enterprise only, so an OSS build answers every route with 403.
"""
from __future__ import annotations

import time

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import fast_eval, multi_alert, simple_alert, uniq

SYSTEM_ACTOR = "system@openobserve.ai"
GROUP_TMPL = "auto_mute_group_tmpl"
GROUP_DEST = "auto_mute_group_dest"
MICROS = 1_000_000
MINUTE = 60 * MICROS
DAY = 24 * 60 * MINUTE


@pytest.fixture(scope="module")
def mute_served(client: OpenObserveClient) -> bool:
    """An enterprise build looks the alert up (404); the OSS build refuses the route (403)."""
    r = client.request("POST", "alerts/no-such-alert/mute?folder=default", org="default",
                       prefix="api/v2/", json={"minutes": 30})
    return r.status_code != 403


@pytest.fixture
def enterprise(mute_served: bool) -> None:
    if not mute_served:
        pytest.skip("this build does not serve the mute routes")


def _mute(alerts, alert_id: str, body: dict):
    return alerts._v2("POST", f"alerts/{alert_id}/mute?folder=default", json=body)


def _extend(alerts, alert_id: str, downtime_id: str, body: dict):
    return alerts._v2("POST", f"alerts/{alert_id}/mute/{downtime_id}/extend?folder=default", json=body)


def _cancel(alerts, alert_id: str, downtime_id: str):
    return alerts._v2("POST", f"alerts/{alert_id}/mute/{downtime_id}/cancel?folder=default")


def _downtime(alerts, downtime_id: str) -> dict:
    r = alerts._v2("GET", f"downtimes/{downtime_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _item(alerts, name: str) -> dict:
    return next(a for a in alerts.list_alerts() if a.get("name") == name)


def _now() -> int:
    return int(time.time() * MICROS)


def _single(alerts, stream: str) -> tuple[str, str]:
    alerts.ingest(stream, [{"i": i} for i in range(6)])
    name = uniq("mute_single")
    a = fast_eval(simple_alert(name), stream)
    a["trigger_condition"]["threshold"] = 1
    a["trigger_condition"]["silence"] = 0
    assert alerts.create_alert(a).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)
    return name, alert_id


def _fire(alerts, name: str, stream: str) -> dict:
    def _firing():
        alerts.ingest(stream, [{"i": i} for i in range(3)])
        item = _item(alerts, name)
        return item if item.get("firing_started_at") and alerts.notifications_for(name) >= 1 else None

    return wait_until(_firing, timeout=240, interval=5, msg=f"{name} fires and delivers")


def _evaluations(alerts, name: str, feed, n: int) -> None:
    seen = {_item(alerts, name).get("last_outcome_at")}

    def _check():
        feed()
        seen.add(_item(alerts, name).get("last_outcome_at"))
        return len(seen) > n

    wait_until(_check, timeout=90 * n + 60, interval=5, msg=f"{n} more evaluation(s) of {name}")


def test_the_oss_build_refuses_every_mute_route(alerts, mute_served):
    if mute_served:
        pytest.skip("an enterprise build serves the mute routes")
    for r in (
        _mute(alerts, "a1", {"minutes": 30}),
        _extend(alerts, "a1", "d1", {"version": 1, "minutes": 30}),
        _cancel(alerts, "a1", "d1"),
    ):
        assert r.status_code == 403, r.text


def test_a_timed_mute_withholds_sends_and_extend_and_unmute_change_only_quick_mutes(alerts, enterprise):
    stream = uniq("mute_single_s")
    name, alert_id = _single(alerts, stream)
    _fire(alerts, name, stream)

    assert _mute(alerts, alert_id, {"minutes": 30, "until_clear": True}).status_code == 400
    assert _mute(alerts, alert_id, {"minutes": 1441}).status_code == 400
    assert _mute(alerts, alert_id, {"minutes": 5, "group_keys": ["g"]}).status_code == 400, "a single-row alert has no groups"

    before = _now()
    muted = _mute(alerts, alert_id, {"minutes": 30, "reason": "deploy"})
    assert muted.status_code == 201, muted.text
    body = muted.json()
    assert body["version"] == 1 and "end_on_clear" not in body and "alert_groups" not in body
    assert before + 30 * MINUTE <= body["ends_at"] <= _now() + 30 * MINUTE
    dt = body["downtime_id"]
    row = _downtime(alerts, dt)
    assert row["name"] == f"Quick mute · {name}"
    assert row["folder_id"] == "default", "a mute without folder_id is filed in the default downtimes folder"
    assert row["source"] == "api" and row["reason"] == "deploy"
    assert row["targets"] == [{"module": "alerts", "folders": {"kind": "all"}, "ids": [alert_id]}]
    assert row["schedule"]["repeat"] == "none" and row["status"] == "active"
    chip = _item(alerts, name)["active_downtime"]
    assert chip["id"] == dt and chip["version"] == 1 and chip["ends_at"] == body["ends_at"]
    assert chip["source"] == "api"

    again = _mute(alerts, alert_id, {"until_clear": True})
    assert again.status_code == 409, again.text
    assert again.json() == {"code": "already_muted", "downtime_id": dt, "version": 1, "ends_at": body["ends_at"]}

    feed = lambda: alerts.ingest(stream, [{"i": i} for i in range(3)])  # noqa: E731
    _evaluations(alerts, name, feed, 1)
    sent = alerts.notifications_for(name)
    _evaluations(alerts, name, feed, 2)
    assert alerts.notifications_for(name) == sent, "the muted alert sends nothing"

    stale = _extend(alerts, alert_id, dt, {"version": 0, "minutes": 60})
    assert stale.status_code == 409, stale.text
    assert stale.json() == {"code": "version_changed", "version": 1, "ends_at": body["ends_at"]}
    longer = _extend(alerts, alert_id, dt, {"version": 1, "minutes": 60})
    assert longer.status_code == 200, longer.text
    assert longer.json()["version"] == 2 and longer.json()["ends_at"] == body["ends_at"] + 60 * MINUTE
    to_clear = _extend(alerts, alert_id, dt, {"version": 2, "until_clear": True}).json()
    assert to_clear["end_on_clear"] == {"alert_id": alert_id, "group_key": None}
    assert abs(to_clear["ends_at"] - (_now() + DAY)) < 5 * MINUTE
    assert _downtime(alerts, dt)["end_on_clear"] == {"alert_id": alert_id, "group_key": None}
    assert _item(alerts, name)["active_downtime"]["end_on_clear"]["alert_id"] == alert_id

    ended = _cancel(alerts, alert_id, dt)
    assert ended.status_code == 200, ended.text
    row = _downtime(alerts, dt)
    assert row["cancelled_by"] == alerts._c.email and row["status"] in ("cancelled", "ended_early")
    assert "active_downtime" not in _item(alerts, name) or not _item(alerts, name)["active_downtime"]
    wait_until(lambda: (feed(), alerts.notifications_for(name) > sent)[1], timeout=240, interval=10,
               msg="sends resume after the unmute")

    wide = alerts._v2("POST", "downtimes?folder=default", json={
        "targets": [{"module": "alerts", "folders": {"kind": "all"}}],
        "schedule": {"repeat": "none", "starts_at": _now(), "ends_at": _now() + 10 * MINUTE,
                     "timezone": "UTC", "duration_secs": 600},
        "show_banner": False,
    })
    assert wide.status_code == 201, wide.text
    wide_id = wide.json()["id"]
    try:
        assert _extend(alerts, alert_id, wide_id, {"version": 1, "minutes": 5}).json() == {"code": "not_a_quick_mute"}
        assert _cancel(alerts, alert_id, wide_id).json() == {"code": "not_a_quick_mute"}
    finally:
        alerts._v2("POST", f"downtimes/{wide_id}/cancel?folder=default")


def _seed_group_destination(alerts) -> None:
    alerts._v1("POST", "alerts/templates", json={
        "name": GROUP_TMPL, "body": '{"text":"{alert_name} city={group.city}"}', "type": "http", "title": "",
    })
    base = alerts._c.base_url.rstrip("/")
    destination = {
        "name": GROUP_DEST, "url": f"{base}/api/{alerts.org}/alerts_notify_sink/_json",
        "method": "post", "template": GROUP_TMPL, "type": "http",
        "headers": {"Authorization": alerts._c.session.headers["Authorization"]},
    }
    alerts._v1("POST", "alerts/destinations", json=destination)
    alerts._v1("PUT", f"alerts/destinations/{GROUP_DEST}", json=destination)


def _groups(alerts, alert_id: str) -> dict[str, dict]:
    return {g["group_labels"]: g for g in alerts.get_alert_groups(alert_id).get("list", [])}


def _feed_cities(alerts, stream: str, high: tuple[str, ...], low: tuple[str, ...] = ()) -> None:
    rows = [{"city": c, "latency": 900} for _ in range(3) for c in high]
    rows += [{"city": c, "latency": 0} for _ in range(40) for c in low]
    alerts.ingest(stream, rows)


def test_a_group_mute_withholds_only_its_group_and_until_it_clears_ends_on_that_groups_clear(alerts, enterprise):
    _seed_group_destination(alerts)
    stream = uniq("mute_groups_s")
    both = ("bangalore", "mumbai")
    _feed_cities(alerts, stream, both)
    name = uniq("mute_groups")
    payload = fast_eval(multi_alert(name), stream)
    payload["trigger_condition"]["silence"] = 0
    payload["destinations"] = [GROUP_DEST]
    assert alerts.create_alert(payload).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)
    sends = lambda city: alerts.notifications_for(f"{name} city={city}")  # noqa: E731

    def _both_firing():
        _feed_cities(alerts, stream, both)
        firing = {k: g for k, g in _groups(alerts, alert_id).items() if g.get("firing_started_at")}
        return firing if len(firing) == 2 and all(sends(c) >= 1 for c in both) else None

    groups = wait_until(_both_firing, timeout=240, interval=5, msg="both groups fire and deliver")
    blr = groups["city=bangalore"]
    assert _mute(alerts, alert_id, {"until_clear": True, "group_keys": ["no-such-group"]}).status_code == 400

    muted = _mute(alerts, alert_id, {"until_clear": True, "group_keys": [blr["group_key"]]})
    assert muted.status_code == 201, muted.text
    body = muted.json()
    assert body["alert_groups"] == [{"alert_id": alert_id, "group_key": blr["group_key"],
                                     "group_labels": {"city": "bangalore"}}]
    assert body["end_on_clear"] == {"alert_id": alert_id, "group_key": blr["group_key"]}
    dt = body["downtime_id"]
    assert _downtime(alerts, dt)["alert_groups"][0]["group_labels"] == {"city": "bangalore"}
    assert _item(alerts, name)["active_downtime"]["alert_groups"][0]["group_key"] == blr["group_key"]
    whole = _mute(alerts, alert_id, {"minutes": 30, "group_keys": [blr["group_key"]]})
    assert whole.status_code == 409 and whole.json()["code"] == "already_muted"

    feed = lambda: _feed_cities(alerts, stream, both)  # noqa: E731
    _evaluations(alerts, name, feed, 1)
    blr_sent, bom_sent = sends("bangalore"), sends("mumbai")
    _evaluations(alerts, name, feed, 2)
    assert sends("bangalore") == blr_sent, "the muted group sends nothing"
    assert sends("mumbai") > bom_sent, "the other group keeps notifying"

    def _cleared(city: str, high: tuple[str, ...]):
        def _check():
            _feed_cities(alerts, stream, high, (city,))
            g = _groups(alerts, alert_id).get(f"city={city}")
            return g if g and not g.get("firing_started_at") else None
        return _check

    wait_until(_cleared("mumbai", ("bangalore",)), timeout=300, interval=5, msg="mumbai clears")
    assert not _downtime(alerts, dt).get("cancelled_at"), "another group's clear leaves the mute"

    wait_until(_cleared("bangalore", ()), timeout=300, interval=5, msg="bangalore clears")
    row = wait_until(lambda: (d := _downtime(alerts, dt)).get("cancelled_at") and d, timeout=60, interval=3,
                     msg="the group's clear ends its mute")
    assert row["cancelled_by"] == SYSTEM_ACTOR
    assert row["cancelled_at"] <= _now()


def test_deleting_the_alert_ends_its_until_it_clears_mute(alerts, enterprise):
    stream = uniq("mute_delete_s")
    name, alert_id = _single(alerts, stream)
    _fire(alerts, name, stream)
    muted = _mute(alerts, alert_id, {"until_clear": True})
    assert muted.status_code == 201, muted.text
    dt = muted.json()["downtime_id"]
    assert alerts._v2("DELETE", f"alerts/{alert_id}?folder=default").status_code == 200
    alerts.created.remove(alert_id)
    row = wait_until(lambda: (d := _downtime(alerts, dt)).get("cancelled_at") and d, timeout=60, interval=3,
                     msg="the delete ends the mute")
    assert row["cancelled_by"] == SYSTEM_ACTOR


def test_a_mute_past_the_org_cap_answers_409_and_changes_nothing(alerts, enterprise):
    stream = uniq("mute_cap_s")
    name, alert_id = _single(alerts, stream)
    fillers: list[str] = []
    start = _now() + DAY
    try:
        for _ in range(80):
            r = alerts._v2("POST", "downtimes?folder=default", json={
                "targets": [{"module": "alerts", "folders": {"kind": "all"}, "ids": [alert_id]}],
                "schedule": {"repeat": "none", "starts_at": start, "ends_at": start + MINUTE,
                             "timezone": "UTC", "duration_secs": 60},
                "show_banner": False,
            })
            if r.status_code != 201:
                assert "the most allowed" in r.text, r.text
                break
            fillers.append(r.json()["id"])
        else:
            pytest.skip("O2_DOWNTIMES_MAX_PER_ORG is above 80 on this server")
        capped = _mute(alerts, alert_id, {"minutes": 30})
        assert capped.status_code == 409, capped.text
        assert capped.json()["code"] == "downtime_cap" and "the most allowed" in capped.json()["message"]
        assert not _item(alerts, name).get("active_downtime")
    finally:
        for dt in fillers:
            alerts._v2("POST", f"downtimes/{dt}/cancel?folder=default")
            alerts._v2("DELETE", f"downtimes/{dt}?folder=default")

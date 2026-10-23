"""Acknowledge (Slack app Phase 2, §5.2-5.5) through real scheduler runs  [P1]

An ack withholds the repeats of the firing it names and nothing else: a new firing
starts unacknowledged, an unack lets repeats resume, and every run an ack kept quiet
shows in the history with who acked it. Alerts here use silence 0, so without an ack
every evaluation (~1 min, `fast_eval`) delivers to the self-ingest sink.
"""
from __future__ import annotations

import concurrent.futures

from support.client import OpenObserveClient
from support.wait import wait_until

from .multialert_helpers import fast_eval, multi_alert, simple_alert, uniq

GROUP_TMPL = "auto_ack_group_tmpl"
GROUP_DEST = "auto_ack_group_dest"


def _ack(alerts, alert_id: str, body: dict, client=None):
    c = client or alerts._c
    return c.request("POST", f"alerts/{alert_id}/ack?folder=default", org=alerts.org, prefix="api/v2/", json=body)


def _unack(alerts, alert_id: str, body: dict):
    return alerts._v2("POST", f"alerts/{alert_id}/unack?folder=default", json=body)


def _acks(alerts, alert_id: str) -> list[dict]:
    r = alerts._v2("GET", f"alerts/{alert_id}/acks?folder=default")
    assert r.status_code == 200, r.text
    return r.json()["acks"]


def _item(alerts, name: str) -> dict:
    return next(a for a in alerts.list_alerts() if a.get("name") == name)


def _single(alerts, stream: str) -> tuple[str, str]:
    alerts.ingest(stream, [{"i": i} for i in range(6)])
    name = uniq("ack_single")
    a = fast_eval(simple_alert(name), stream)
    a["trigger_condition"]["threshold"] = 1
    a["trigger_condition"]["silence"] = 0
    assert alerts.create_alert(a).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)
    return name, alert_id


def _feed(alerts, stream: str) -> None:
    alerts.ingest(stream, [{"i": i, "city": c, "latency": 900} for i in range(3) for c in ("bangalore", "mumbai")])


def _evaluations(alerts, name: str, stream: str, n: int, per_run_s: int = 90) -> None:
    """Wait for `n` more scheduler runs of the alert, feeding it so it keeps firing."""
    seen = {_item(alerts, name).get("last_outcome_at")}

    def _check():
        _feed(alerts, stream)
        seen.add(_item(alerts, name).get("last_outcome_at"))
        return len(seen) > n

    wait_until(_check, timeout=per_run_s * n + 60, interval=5, msg=f"{n} more evaluation(s) of {name}")


def _history(alerts, alert_id: str) -> list[dict]:
    return alerts.history_for(alert_id)


def test_an_ack_withholds_a_single_row_alerts_repeats_until_it_is_unacked(alerts):
    stream = uniq("ack_single_s")
    name, alert_id = _single(alerts, stream)

    def _firing():
        _feed(alerts, stream)
        item = _item(alerts, name)
        return item if item.get("firing_started_at") and alerts.notifications_for(name) >= 1 else None

    started = wait_until(_firing, timeout=180, interval=5, msg="the alert fired and delivered")["firing_started_at"]

    stale = _ack(alerts, alert_id, {"firing_started_at": started - 1})
    assert stale.status_code == 409, stale.text
    assert stale.json() == {"code": "firing_changed", "firing_started_at": started}
    assert _ack(alerts, alert_id, {"group_key": "a-group"}).status_code == 409, "a single-row alert has no groups"

    first = _ack(alerts, alert_id, {"firing_started_at": started})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["changed"] is True
    assert [a["firing_started_at"] for a in body["acks"]] == [started]
    assert body["acks"][0]["ack_source"] == "api"
    assert body["other_groups_unacked"] == 0
    again = _ack(alerts, alert_id, {}).json()
    assert again["changed"] is False, "a second ack of the same firing changes nothing"
    assert _acks(alerts, alert_id)[0]["acked_by"] == alerts._c.email
    item = _item(alerts, name)
    assert item["ack"]["acked_by"] == alerts._c.email and item["ack"]["groups_acked"] == 1
    assert item["firing_started_at"] == started

    _evaluations(alerts, name, stream, 1)
    sent = alerts.notifications_for(name)
    _evaluations(alerts, name, stream, 2)
    assert alerts.notifications_for(name) == sent, "repeats of the acked firing are withheld"
    item = _item(alerts, name)
    assert item["last_outcome"] in ("firing", "notify_failed"), "the alert stays firing while acked"
    assert item["firing_started_at"] == started

    def _rows():
        rows = _history(alerts, alert_id)
        suppressed = [r for r in rows if r.get("status") == "suppressed" and r.get("acked_by")]
        events = [r for r in rows if r.get("status") == "ack_event"]
        return (suppressed, events) if suppressed and events else None

    suppressed, events = wait_until(_rows, timeout=120, interval=5, msg="ack rows in the run history")
    assert suppressed[0]["acked_by"] == alerts._c.email
    assert events[-1]["ack_action"] == "ack" and events[-1]["ack_source"] == "api"

    off = _unack(alerts, alert_id, {"group_key": ""})
    assert off.status_code == 200 and off.json()["changed"] is True, off.text
    assert _acks(alerts, alert_id) == []
    assert _unack(alerts, alert_id, {"group_key": ""}).json()["changed"] is False

    def _resumed():
        _feed(alerts, stream)
        return alerts.notifications_for(name) > sent

    wait_until(_resumed, timeout=240, interval=10, msg="repeats resume after the unack (silence 0)")
    wait_until(
        lambda: any(r.get("ack_action") == "unack" for r in _history(alerts, alert_id)),
        timeout=120, interval=5, msg="the unack is in the history",
    )


def test_concurrent_acks_leave_one_and_take_over_moves_it(alerts, temp_user_email):
    stream = uniq("ack_race_s")
    name, alert_id = _single(alerts, stream)

    def _firing():
        _feed(alerts, stream)
        return _item(alerts, name).get("firing_started_at")

    wait_until(_firing, timeout=180, interval=5, msg="the alert fired")
    password = "Complexpass#123"
    created = alerts._c.users.create({
        "email": temp_user_email, "password": password, "first_name": "Ack", "last_name": "Admin",
        "role": "admin", "organization": alerts.org,
    })
    assert created.status_code == 200, created.text
    other = OpenObserveClient(email=temp_user_email, password=password, org=alerts.org)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(pool.map(lambda c: _ack(alerts, alert_id, {}, client=c), [alerts._c, other]))
    assert all(a.status_code == 200 for a in answers), [a.text for a in answers]
    bodies = [a.json() for a in answers]
    assert sorted(b["changed"] for b in bodies) == [False, True], bodies
    winner = next(b for b in bodies if b["changed"])["acks"][0]["acked_by"]
    loser = next(b for b in bodies if not b["changed"])
    assert loser["acks"][0]["acked_by"] == winner, "the loser answers with the winner's ack"
    assert len(_acks(alerts, alert_id)) == 1

    taker = other if winner == alerts._c.email else alerts._c
    moved = _ack(alerts, alert_id, {"take_over": True}, client=taker).json()
    assert moved["changed"] is True
    assert moved["acks"][0]["taken_over_from"] == winner
    assert moved["acks"][0]["acked_by"] == taker.email
    wait_until(
        lambda: any(r.get("ack_action") == "take_over" and r.get("taken_over_from") == winner
                    for r in _history(alerts, alert_id)),
        timeout=120, interval=5, msg="the take over is in the history",
    )


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


def _group_sends(alerts, name: str, city: str) -> int:
    return alerts.notifications_for(f"{name} city={city}")


def _groups(alerts, alert_id: str) -> dict[str, dict]:
    return {g["group_labels"]: g for g in alerts.get_alert_groups(alert_id).get("list", [])}


def test_a_group_ack_withholds_only_that_group_and_a_new_firing_starts_unacked(alerts):
    _seed_group_destination(alerts)
    stream = uniq("ack_groups_s")
    _feed(alerts, stream)
    name = uniq("ack_groups")
    payload = fast_eval(multi_alert(name), stream)
    payload["trigger_condition"]["silence"] = 0
    payload["destinations"] = [GROUP_DEST]
    assert alerts.create_alert(payload).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)

    def _both_firing():
        _feed(alerts, stream)
        groups = _groups(alerts, alert_id)
        firing = {k: g for k, g in groups.items() if g.get("firing_started_at")}
        sent = all(_group_sends(alerts, name, c) >= 1 for c in ("bangalore", "mumbai"))
        return firing if len(firing) == 2 and sent else None

    groups = wait_until(_both_firing, timeout=240, interval=5, msg="both groups fire and deliver")
    blr = groups["city=bangalore"]
    assert _ack(alerts, alert_id, {"group_key": "no-such-group"}).json() == {"code": "not_firing"}
    assert _ack(alerts, alert_id, {}).status_code == 409, "a multi-alert is acked per group"

    acked = _ack(alerts, alert_id, {"group_key": blr["group_key"], "firing_started_at": blr["firing_started_at"]})
    assert acked.status_code == 200, acked.text
    assert acked.json()["other_groups_unacked"] == 1, "mumbai still fires un-acked"
    view = _groups(alerts, alert_id)
    assert view["city=bangalore"]["ack"]["acked_by"] == alerts._c.email
    assert "ack" not in view["city=mumbai"]
    assert _item(alerts, name)["ack"]["groups_acked"] == 1

    _evaluations(alerts, name, stream, 1)
    blr_sent, bom_sent = _group_sends(alerts, name, "bangalore"), _group_sends(alerts, name, "mumbai")
    _evaluations(alerts, name, stream, 2)
    assert _group_sends(alerts, name, "bangalore") == blr_sent, "the acked group's repeats are withheld"
    assert _group_sends(alerts, name, "mumbai") > bom_sent, "the other group keeps notifying"

    every = _ack(alerts, alert_id, {"all_groups": True}).json()
    assert every["other_groups_unacked"] == 0 and len(every["acks"]) == 2
    assert _item(alerts, name)["ack"]["groups_acked"] == 2

    # The same data now evaluates Normal: the firing ends and its acks stop being in force.
    cleared = alerts.get_alert(alert_id)
    cleared["query_condition"]["aggregation"]["having"]["value"] = 5000
    assert alerts.update_alert(alert_id, cleared).status_code == 200

    def _normal():
        _feed(alerts, stream)
        g = _groups(alerts, alert_id)
        return g if g and not any(x.get("firing_started_at") for x in g.values()) else None

    wait_until(_normal, timeout=240, interval=5, msg="every group cleared")
    assert _acks(alerts, alert_id) == []

    cleared["query_condition"]["aggregation"]["having"]["value"] = 500
    assert alerts.update_alert(alert_id, cleared).status_code == 200
    refired = wait_until(_both_firing, timeout=240, interval=5, msg="the groups fire again")
    assert refired["city=bangalore"]["firing_started_at"] != blr["firing_started_at"]
    assert all("ack" not in g for g in refired.values()), "a new firing starts unacknowledged"
    assert "ack" not in _item(alerts, name)


def test_an_unack_reopens_the_groups_silence_window(alerts):
    stream = uniq("ack_silence_s")
    _feed(alerts, stream)
    name = uniq("ack_silence")
    payload = fast_eval(multi_alert(name), stream)
    payload["trigger_condition"]["silence"] = 30
    assert alerts.create_alert(payload).status_code == 200
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)

    def _firing():
        _feed(alerts, stream)
        g = _groups(alerts, alert_id).get("city=bangalore")
        return g if g and g.get("firing_started_at") else None

    blr = wait_until(_firing, timeout=240, interval=5, msg="bangalore fires")
    assert _ack(alerts, alert_id, {"group_key": blr["group_key"]}).json()["changed"] is True
    off = _unack(alerts, alert_id, {"group_key": blr["group_key"], "firing_started_at": blr["firing_started_at"]})
    assert off.status_code == 200 and off.json()["changed"] is True, off.text
    unacked_at = off.json()["ack"]["acked_at"]
    after = _groups(alerts, alert_id)["city=bangalore"]
    assert after["silenced_until"] >= unacked_at + 30 * 60 * 1_000_000, "repeats wait one silence window"


def test_an_ack_withholds_a_composites_repeats(alerts):
    stream = uniq("ack_cmp_s")
    children = []
    for _ in range(2):
        child, child_id = _single(alerts, stream)
        children.append(child_id)
    name = uniq("ack_cmp")
    payload = {
        "alert_type": "composite", "name": name, "description": "ack", "enabled": True,
        "destinations": ["auto_p0_dest"], "template": "auto_p0_tmpl", "context_attributes": {},
        "trigger_condition": {"silence": 0}, "creates_incident": False, "workflows": [],
        "priority": 2, "tags": [],
        "composite_condition": {
            "expression": " && ".join(f"{{{c}}}" for c in children),
            "warning_counts_as_firing": True, "stale_child_policy": "use_last_state",
        },
    }
    created = alerts._v2("POST", "alerts?folder=default", json=payload)
    assert created.status_code == 200, created.text
    composite_id = alerts.find_alert_id(name)
    alerts.created.insert(0, composite_id)

    def _firing():
        _feed(alerts, stream)
        item = _item(alerts, name)
        return item if item.get("firing_started_at") and alerts.notifications_for(name) >= 1 else None

    started = wait_until(_firing, timeout=300, interval=5, msg="the composite fired and delivered")["firing_started_at"]
    acked = _ack(alerts, composite_id, {"firing_started_at": started})
    assert acked.status_code == 200 and acked.json()["changed"] is True, acked.text

    # A steadily firing composite re-evaluates on the sweep (ZO_ALERT_COMPOSITE_SWEEP_SECS, 300 s).
    _evaluations(alerts, name, stream, 1, per_run_s=330)
    sent = alerts.notifications_for(name)
    _evaluations(alerts, name, stream, 2, per_run_s=330)
    assert alerts.notifications_for(name) == sent, "repeats of the acked composite are withheld"
    assert _item(alerts, name)["ack"]["acked_by"] == alerts._c.email

    assert _unack(alerts, composite_id, {"group_key": ""}).json()["changed"] is True

    def _resumed():
        _feed(alerts, stream)
        return alerts.notifications_for(name) > sent

    wait_until(_resumed, timeout=420, interval=10, msg="the composite notifies again after the unack")

"""Firing cycle (`firing_started_at`) through real scheduler runs  [P1]

The start of a firing is the key acknowledgements and Slack messages hang off, so
it must stay put while a group keeps firing (repeats, delivery failures) and clear
when the group goes Normal. Each test feeds a fresh stream and lets the scheduler
evaluate the alert (~1 min cadence via `fast_eval`), then reads the groups API.
"""
from __future__ import annotations

from support.wait import wait_until

from .conftest import firing_starts, group_outcomes
from .multialert_helpers import fast_eval, multi_alert, uniq

CITIES = ("bangalore", "mumbai")


def _feed(alerts, stream: str) -> None:
    alerts.ingest(stream, [{"city": c, "latency": 900} for c in CITIES for _ in range(2)])


def _create(alerts, stream: str, destination: str | None = None) -> str:
    _feed(alerts, stream)
    name = uniq("firing_cycle")
    payload = fast_eval(multi_alert(name), stream)
    if destination:
        payload["destinations"] = [destination]
    assert alerts.create_alert(payload).status_code == 200, "multi-alert saves"
    alert_id = alerts.find_alert_id(name)
    alerts.created.append(alert_id)
    return alert_id


def _wait_for_starts(alerts, alert_id: str) -> dict[str, int]:
    def _check():
        starts = firing_starts(alerts, alert_id)
        return starts if len(starts) == len(CITIES) and all(starts.values()) else None

    return wait_until(_check, timeout=180, interval=5, msg="every group has a firing start")


def _wait_for_next_evaluation(alerts, alert_id: str, after: dict, stream: str) -> dict:
    def _check():
        _feed(alerts, stream)
        now = group_outcomes(alerts, alert_id)
        moved = all((now.get(k) or (None, 0))[1] > v[1] for k, v in after.items())
        return now if moved else None

    return wait_until(_check, timeout=180, interval=10, msg="the scheduler evaluated the alert again")


def test_a_repeating_firing_keeps_its_start_and_normal_clears_it(alerts):
    stream = uniq("firing_cycle_ok")
    alert_id = _create(alerts, stream)

    first = _wait_for_starts(alerts, alert_id)
    _wait_for_next_evaluation(alerts, alert_id, group_outcomes(alerts, alert_id), stream)
    assert firing_starts(alerts, alert_id) == first, "a repeat of the same firing keeps its start"

    # Raise the threshold so the same data now evaluates Normal for every group.
    payload = alerts.get_alert(alert_id)
    payload["query_condition"]["aggregation"]["having"]["value"] = 5000
    assert alerts.update_alert(alert_id, payload).status_code == 200

    def _cleared():
        starts = firing_starts(alerts, alert_id)
        outcomes = group_outcomes(alerts, alert_id)
        normal = outcomes and all(o == "normal" for o, _ in outcomes.values())
        return starts if normal and not any(starts.values()) else None

    wait_until(_cleared, timeout=180, interval=5, msg="every group cleared to Normal with no firing start")


def test_a_failing_delivery_keeps_the_start(alerts, failing_destination):
    stream = uniq("firing_cycle_fail")
    alert_id = _create(alerts, stream, failing_destination)

    first = _wait_for_starts(alerts, alert_id)

    def _failed():
        outcomes = group_outcomes(alerts, alert_id)
        return outcomes if any(o == "notify_failed" for o, _ in outcomes.values()) else None

    wait_until(_failed, timeout=180, interval=5, msg="a refused delivery records notify_failed")
    assert firing_starts(alerts, alert_id) == first, "a failed delivery does not restart the firing"

    _wait_for_next_evaluation(alerts, alert_id, group_outcomes(alerts, alert_id), stream)
    assert firing_starts(alerts, alert_id) == first, "a re-fire after a failure is the same firing"

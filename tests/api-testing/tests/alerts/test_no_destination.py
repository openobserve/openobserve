"""Alerts — an alert may be saved with no destination  [PR #15267]

Save: `destinations` empty or absent is accepted; a destination that is named must
still exist. Firing: an alert with nowhere to send records `firing`, never a
delivery failure, and leaves behind no silence window for a destination attached
later to inherit — the first firing after one is attached must be delivered.
"""

from __future__ import annotations

import pytest

from support.wait import wait_until

from .multialert_helpers import DEST, fast_eval, multi_alert, simple_alert, uniq

# Far longer than any wait below, so an inherited window would visibly suppress the next send.
LONG_SILENCE_MIN = 30


def _rows() -> list[dict]:
    return [{"city": c, "latency": 900, "status": 500} for c in ("bangalore", "mumbai", "delhi")]


def _create(alerts, payload: dict) -> str:
    resp = alerts.create_alert(payload)
    assert resp.status_code == 200, resp.text
    alert_id = resp.json().get("id")
    assert alert_id, f"create must return the new id: {resp.text}"
    alerts.created.append(alert_id)
    return alert_id


def _attach_destination(alerts, alert_id: str) -> None:
    stored = alerts.get_alert(alert_id)
    assert stored, "alert must read back before it can be updated"
    stored["destinations"] = [DEST]
    resp = alerts.update_alert(alert_id, stored)
    assert resp.status_code == 200, resp.text


def _silent_firing_then_attach(alerts, name: str, feed) -> None:
    """Fire `name` with no destination, prove nothing was sent, then attach DEST."""
    item, _, seen = alerts.track_last_outcome(name, lambda oc: oc == "firing", timeout_s=150, on_poll=feed)
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert item.get("last_outcome") == "firing", f"must fire with no destination; seen={seen}"
    assert "notify_failed" not in seen, f"nowhere to send is not a delivery failure; seen={seen}"
    assert alerts.notifications_for(name) == 0, "an alert with no destination must notify nobody"
    _attach_destination(alerts, item["alert_id"])


def _first_firing_after_attach_is_delivered(alerts, name: str, feed) -> None:
    def delivered(_oc) -> bool:
        return alerts.notifications_for(name) > 0

    item, elapsed, seen = alerts.track_last_outcome(name, delivered, timeout_s=120, on_poll=feed)
    assert alerts.notifications_for(name) > 0, (
        f"the first firing after a destination is attached must be delivered, not silenced by a "
        f"window the destination-less firing opened; seen={seen} after {round(elapsed)}s"
    )
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert item.get("last_outcome") == "firing", f"seen={seen}"


# =============================================================================
# Save contract
# =============================================================================

@pytest.mark.parametrize("realtime", [False, True], ids=["scheduled", "realtime"])
@pytest.mark.parametrize("shape", ["empty", "absent"])
def test_alert_saves_with_no_destination(alerts, realtime: bool, shape: str):
    """`destinations: []` and no `destinations` key both save, and read back as []."""
    payload = simple_alert(uniq("nodest_save"))
    payload["is_real_time"] = realtime
    if shape == "empty":
        payload["destinations"] = []
    else:
        del payload["destinations"]
    alert_id = _create(alerts, payload)

    stored = alerts.get_alert(alert_id)
    assert stored, "the saved alert must read back"
    assert stored.get("destinations") == [], stored


def test_destination_can_be_removed_from_an_existing_alert(alerts):
    alert_id = _create(alerts, simple_alert(uniq("nodest_remove")))
    stored = alerts.get_alert(alert_id)
    assert stored.get("destinations") == [DEST], stored

    stored["destinations"] = []
    resp = alerts.update_alert(alert_id, stored)
    assert resp.status_code == 200, resp.text
    assert alerts.get_alert(alert_id).get("destinations") == []


@pytest.mark.parametrize(
    ("destinations", "status"),
    [(None, 422), (["nodest_does_not_exist"], 404), ([""], 404)],
    ids=["null", "unknown_name", "blank_name"],
)
def test_a_named_destination_must_still_exist(alerts, destinations, status: int):
    """Only absence was relaxed: null and names the org does not have are still refused."""
    payload = simple_alert(uniq("nodest_bad"))
    payload["destinations"] = destinations
    resp = alerts.create_alert(payload)
    if resp.status_code == 200:
        alerts.created.append(resp.json().get("id"))
    assert resp.status_code == status, resp.text
    if status == 404:
        assert "alert destination" in resp.text.lower(), resp.text


# =============================================================================
# Firing with nowhere to send (wall-clock: ~1-3 min each)
# =============================================================================

def test_alert_with_no_destination_fires_and_records_history(alerts):
    """Fires, records `firing` in history with no retries or error, and sends nothing."""
    stream = uniq("nodest_fire")
    alerts.ingest(stream, _rows())
    name = uniq("nodest_fire")
    payload = fast_eval(simple_alert(name), stream)
    payload["trigger_condition"]["threshold"] = 1
    payload["destinations"] = []
    alert_id = _create(alerts, payload)

    item, _, seen = alerts.track_last_outcome(
        name, lambda oc: oc == "firing", timeout_s=150, on_poll=lambda: alerts.ingest(stream, _rows())
    )
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert item.get("last_outcome") == "firing", f"seen={seen}"
    assert "notify_failed" not in seen, f"nowhere to send is not a delivery failure; seen={seen}"
    assert alerts.notifications_for(name) == 0

    def firing_row():
        return next((h for h in alerts.history_for(alert_id) if h.get("status") == "firing"), None)

    row = wait_until(firing_row, timeout=120, interval=5, msg=f"history row for {name}")
    assert row.get("retries", 0) == 0, f"a send with nothing to dispatch must not retry: {row}"
    assert not row.get("error"), f"a firing with nowhere to send carries no error: {row}"


def test_destination_attached_after_a_silent_firing_gets_the_next_firing(alerts):
    """Multi-level alert: a destination-less firing must not open the alert-level silence window."""
    stream = uniq("nodest_level")
    feed = lambda: alerts.ingest(stream, _rows())  # noqa: E731
    feed()
    name = uniq("nodest_level")
    payload = fast_eval(simple_alert(name), stream)
    payload["trigger_condition"].update(
        threshold=3, warning_threshold=1, notify_on_warning=True, silence=LONG_SILENCE_MIN, align_time=False,
    )
    payload["destinations"] = []
    _create(alerts, payload)

    _silent_firing_then_attach(alerts, name, feed)
    _first_firing_after_attach_is_delivered(alerts, name, feed)


def test_destination_attached_after_a_silent_multi_alert_firing_gets_the_next_firing(alerts):
    """Per-group alert: groups that fired with nowhere to send must not open their silence windows."""
    stream = uniq("nodest_groups")
    feed = lambda: alerts.ingest(stream, _rows())  # noqa: E731
    feed()
    name = uniq("nodest_groups")
    payload = fast_eval(multi_alert(name), stream)
    payload["trigger_condition"].update(silence=LONG_SILENCE_MIN, align_time=False)
    payload["destinations"] = []
    _create(alerts, payload)

    _silent_firing_then_attach(alerts, name, feed)
    _first_firing_after_attach_is_delivered(alerts, name, feed)


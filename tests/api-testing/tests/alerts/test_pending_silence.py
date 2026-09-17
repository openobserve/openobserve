"""Alerts — silence must not arm during the pending ('for') window  [regression #14556]

Guards the fix in PR #14564 (openobserve) / #14563 (branch-v1.0.0). The bug armed
the silence/cooldown the moment a condition first matched, even while delivery was
still suppressed by the pending period: next_run_at jumped to T+silence and the
alert stopped evaluating for the whole silence window. Two failure modes followed —
a sustained condition paged at T+silence instead of T+for, and a condition that
recovered mid-pending was never observed.

Both tests use a silence far LONGER than the pending window so the bug is
observable behaviourally, with no dependence on scheduler internals: the fixed
build keeps evaluating each frequency cycle through pending, so it reaches its
outcome in ~pending_period; the bugged build would defer to ~silence. Assertions
are on last_outcome + timing (the run-state the scheduler persists every
evaluation), not on the usage stream, so they hold regardless of usage flush lag.

These are wall-clock tests: ~2-3 min each at the 1-minute minimum frequency.
"""

from __future__ import annotations

import time

from .multialert_helpers import is_firing_outcome, pending_silence_alert, uniq


def _rows(n: int) -> list[dict]:
    return [{"i": i} for i in range(n)]


def test_sustained_condition_fires_at_for_window_not_silence(alerts):
    """A condition true throughout pending fires at ~pending_period, not at ~silence.

    With the bug, silence (15m) arms on the first match and the alert freezes in
    pending until T+15m; the fix keeps evaluating and fires within the for-window.
    """
    stream = uniq("pending_sustained")
    alerts.ingest(stream, _rows(3))  # >= 1 row, kept in the 5-min period across pending

    name = uniq("pending_sustained")
    a = pending_silence_alert(name, stream, pending_sec=90, silence_min=15, period_min=5)
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    item, elapsed, seen = alerts.track_last_outcome(name, is_firing_outcome, timeout_s=240, poll_s=5)
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert is_firing_outcome(item.get("last_outcome")), (
        f"must fire within the for-window; outcomes seen={seen} after {round(elapsed)}s"
    )
    assert elapsed < 300, (
        f"fired at {round(elapsed)}s (<< the 15m silence): silence must not arm during pending (#14556)"
    )
    assert "pending" in seen, f"must pass through pending before firing; seen={seen}"


def test_recovery_during_pending_is_observed_and_never_fires(alerts):
    """A condition that clears mid-pending is observed (goes normal) and never pages.

    With the bug the alert freezes in pending for the whole silence window and
    never re-evaluates, so the recovery is missed; the fix keeps evaluating on a
    1-min period, sees the empty window, and settles to normal before firing.
    """
    stream = uniq("pending_recovery")
    alerts.ingest(stream, _rows(3))

    name = uniq("pending_recovery")
    a = pending_silence_alert(name, stream, pending_sec=210, silence_min=15, period_min=1)
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    # Keep the condition true just long enough to establish pending, then stop so
    # the 1-min period empties and the condition recovers well before pending_sec.
    for _ in range(3):
        time.sleep(15)
        alerts.ingest(stream, _rows(3))

    item, elapsed, seen = alerts.track_last_outcome(name, lambda oc: oc == "normal", timeout_s=240, poll_s=5)
    assert "pending" in seen, f"must enter pending first, else the test proves nothing; seen={seen}"
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert item.get("last_outcome") == "normal", (
        f"recovery must be observed (normal) once the window empties; outcomes seen={seen} after {round(elapsed)}s"
    )
    fired = {"firing", "notify_failed"} & set(seen)
    assert not fired, f"a condition that recovered inside pending must never page; seen={seen}"

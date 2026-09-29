"""Alerts — silence must not arm during the pending ('for') window  [regression #14556]

Guards the fix in PR #14564 (openobserve) / #14563 (branch-v1.0.0). The bug armed
the silence/cooldown the moment a condition first matched, even while delivery was
still suppressed by the pending period: next_run_at jumped to T+silence and the
alert stopped evaluating for the whole silence window. Two failure modes followed —
a sustained condition paged at T+silence instead of T+for, and a condition that
recovered mid-pending was never observed.

The firing tests use a silence far LONGER than the pending window so the bug is
observable behaviourally, with no dependence on scheduler internals: the fixed
build keeps evaluating each frequency cycle through pending, so it reaches its
outcome in ~pending_period; the bugged build would defer to ~silence. Assertions
are on last_outcome + timing (the run-state the scheduler persists every
evaluation), not on the usage stream, so they hold regardless of usage flush lag.

Coverage spans every sub-path through the fixed block: single-level, multi-level
(warning+critical), cron frequency, first breach, recovery, and re-arm after a
normal period.

These are wall-clock tests: ~2-4 min each at the 1-minute minimum frequency.
"""

from __future__ import annotations

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

    # The discriminator: timeout (240s) is far under silence (900s). A build that
    # armed silence during pending would not evaluate again until ~900s, so it can
    # never reach firing within this window — this assert fails on the bug (#14556).
    item, elapsed, seen = alerts.track_last_outcome(name, is_firing_outcome, timeout_s=240, poll_s=5)
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert is_firing_outcome(item.get("last_outcome")), (
        f"must fire within the for-window, not defer to the 15m silence; seen={seen} after {round(elapsed)}s"
    )
    assert "pending" in seen, f"must pass through pending before firing; seen={seen}"


def test_recovery_during_pending_never_pages_then_rearms(alerts):
    """A condition that clears mid-pending is observed (goes normal) and never pages;
    a fresh breach then re-enters pending.

    Covers both the issue's recovery mode (pending -> normal, no page — the bug would
    freeze pending for the whole silence window and miss it) and the Normal->Pending
    re-arm (a subsequent breach must not skip pending). Merged so the shared pending
    -> normal warm-up runs once.
    """
    stream = uniq("pending_recovery")
    alerts.ingest(stream, _rows(3))

    name = uniq("pending_recovery")
    a = pending_silence_alert(name, stream, pending_sec=180, silence_min=15, period_min=1)
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    def feed():
        alerts.ingest(stream, _rows(3))

    # Phase 1: feed until pending is established (so the test can't pass vacuously).
    _, _, s1 = alerts.track_last_outcome(name, lambda oc: oc == "pending", timeout_s=90, on_poll=feed)
    assert "pending" in s1, f"must enter pending first, else the test proves nothing; seen={s1}"

    # Phase 2: stop feeding — the 1-min window empties and the condition recovers to
    # normal (timeout 150s < the 180s pending, so it must recover rather than fire).
    item, elapsed, s2 = alerts.track_last_outcome(name, lambda oc: oc == "normal", timeout_s=150)
    assert item, f"alert must be evaluated within the poll window; seen={s2}"
    assert item.get("last_outcome") == "normal", (
        f"recovery must be observed (normal) once the window empties; seen={s2} after {round(elapsed)}s"
    )
    fired = {"firing", "notify_failed"} & (set(s1) | set(s2))
    assert not fired, f"a condition that recovered inside pending must never page; seen={s1 + s2}"

    # Phase 3: a fresh breach must re-enter pending (Normal->Pending), not skip it.
    item, _, s3 = alerts.track_last_outcome(name, lambda oc: oc == "pending", timeout_s=120, on_poll=feed)
    assert item, f"alert must be evaluated within the poll window; seen={s3}"
    assert item.get("last_outcome") == "pending", f"a fresh breach after normal must re-enter pending; seen={s3}"


def test_multi_level_alert_with_pending_fires_at_for_window(alerts):
    """A warning+critical (multi-level) alert with pending fires at the for-window.

    Multi-level alerts are is_multi_alert=False, so they DO run through the fixed
    pending block — this guards that the reset does not break the warning/critical
    path (it must still evaluate through pending and fire at the right band).
    """
    stream = uniq("pending_multilevel")
    alerts.ingest(stream, _rows(3))  # count 3 -> warning band (>= 2, < 5)

    name = uniq("pending_multilevel")
    a = pending_silence_alert(name, stream, pending_sec=90, silence_min=15, period_min=5)
    a["trigger_condition"]["threshold"] = 5
    a["trigger_condition"]["warning_threshold"] = 2
    a["trigger_condition"]["notify_on_warning"] = True
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    # timeout (240s) << silence (900s): a build that armed silence during pending
    # could not reach firing here, so this fails on the bug.
    item, elapsed, seen = alerts.track_last_outcome(name, is_firing_outcome, timeout_s=240, poll_s=5)
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert is_firing_outcome(item.get("last_outcome")), (
        f"multi-level alert must fire at the for-window, not defer to silence; seen={seen} after {round(elapsed)}s"
    )
    assert item.get("level") == "warning", (
        f"a count of 3 sits in the warning band (>= 2, < 5); item level={item.get('level')}"
    )
    assert "pending" in seen, f"must pass through pending before firing; seen={seen}"


def test_cron_frequency_alert_with_pending_fires_at_for_window(alerts):
    """A cron-scheduled alert with pending fires at the for-window, not at silence.

    Cron alerts take the Schedule::from_str branch of get_next_trigger_time; the fix
    calls it with apply_silence=false during pending, so this guards that the cron
    path keeps evaluating through pending instead of jumping to the silence horizon.
    """
    stream = uniq("pending_cron")
    alerts.ingest(stream, _rows(3))

    name = uniq("pending_cron")
    a = pending_silence_alert(name, stream, pending_sec=90, silence_min=15, period_min=5)
    a["trigger_condition"]["frequency_type"] = "cron"
    a["trigger_condition"]["cron"] = "0 * * * * *"  # every minute (6-field: seconds first)
    assert alerts.create_alert(a).status_code == 200, "alert saves"
    alerts.created.append(alerts.find_alert_id(name))

    item, elapsed, seen = alerts.track_last_outcome(name, is_firing_outcome, timeout_s=300, poll_s=5)
    assert item, f"alert must be evaluated within the poll window; seen={seen}"
    assert is_firing_outcome(item.get("last_outcome")), (
        f"cron alert must fire at the for-window; outcomes seen={seen} after {round(elapsed)}s"
    )
    assert "pending" in seen, f"must pass through pending before firing; seen={seen}"

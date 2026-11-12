"""A cron check keeps its IANA zone and its next run lands at the zone's wall-clock time, not a stored offset (#16179, #16181)."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

from support.client import OpenObserveClient

ZONE = "America/New_York"
CRON = "0 0 9 * * *"


def next_local_nine(after_us: int, tz: tzinfo) -> int:
    """The first 09:00 in `tz` strictly after `after_us`, in microseconds."""
    local = datetime.fromtimestamp(after_us / 1_000_000, tz)
    candidate = datetime(local.year, local.month, local.day, 9, tzinfo=tz)
    if candidate <= local:
        nxt = local.date() + timedelta(days=1)
        candidate = datetime(nxt.year, nxt.month, nxt.day, 9, tzinfo=tz)
    return int(candidate.timestamp() * 1_000_000)


def other_season_offset_mins(now_us: int, tz: ZoneInfo) -> int:
    """The zone's UTC offset in the opposite DST season: what a check saved half a year ago still stores."""
    now = datetime.fromtimestamp(now_us / 1_000_000, UTC)
    offsets = {
        int(datetime(now.year, month, 15, 12, tzinfo=UTC).astimezone(tz).utcoffset().total_seconds() // 60)
        for month in (1, 7)
    }
    current = int(now.astimezone(tz).utcoffset().total_seconds() // 60)
    (stale,) = offsets - {current}
    return stale


def test_cron_next_run_follows_the_zone_name_not_a_stale_offset(client: OpenObserveClient, make_synthetic):
    tz = ZoneInfo(ZONE)
    created = make_synthetic("tcp", frequency={"type": "cron", "interval": 0, "cron": CRON, "timezone": ZONE})
    assert created["frequency"]["timezone"] == ZONE

    body = client.synthetics.get(created["id"]).json()
    stale = other_season_offset_mins(int(time.time() * 1_000_000), tz)
    body["tz_offset"] = stale
    before_us = int(time.time() * 1_000_000)
    # An update recomputes next_run_at right away, which a create leaves at 0 for the scheduler.
    resp = client.synthetics.update(created["id"], body)
    after_us = int(time.time() * 1_000_000)
    assert resp.status_code == 200, resp.text

    stored = client.synthetics.get(created["id"]).json()
    assert stored["frequency"]["timezone"] == ZONE
    assert stored["frequency"]["cron"] == CRON
    expected = {next_local_nine(before_us, tz), next_local_nine(after_us, tz)}
    assert stored["next_run_at"] in expected, (
        f"next_run_at {datetime.fromtimestamp(stored['next_run_at'] / 1e6, UTC)} is not 09:00 {ZONE}"
    )
    stale_tz = timezone(timedelta(minutes=stale))
    assert stored["next_run_at"] not in {next_local_nine(before_us, stale_tz), next_local_nine(after_us, stale_tz)}

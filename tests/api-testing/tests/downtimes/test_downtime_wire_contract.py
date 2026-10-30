"""The downtime body a client sends and the row it reads back.

These pin what the server fills in for an omitted field and the names it writes,
which clients and stored rows both depend on:

- a missing `folder_id` lands in the default folder and a missing `show_banner` is on;
- an alerts target without `incident_mode` reads as muted and is written without it;
- the enums and the condition tree keep their wire names (`=`, `!=`, `count_as_good`, ...);
- notifications without a lead time take the 10-minute default;
- `GET` flattens the row into the list item, beside `status` and the windows.

Downtimes need an enterprise build with the feature on; elsewhere the module skips.
"""
from __future__ import annotations

import time
from collections.abc import Callable, Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

pytestmark = pytest.mark.enterprise

V2 = "api/v2/"
HOUR_MICROS = 3600 * 1_000_000
DEFAULT_ENDING_SOON_LEAD_SECS = 600


def one_time_schedule() -> dict:
    """A one-hour window a day from now, so the row stays scheduled for the test."""
    start = (int(time.time()) + 86400) * 1_000_000
    return {
        "repeat": "none",
        "starts_at": start,
        "ends_at": start + HOUR_MICROS,
        "timezone": "UTC",
        "duration_secs": 3600,
    }


def alerts_target(**extra) -> dict:
    return {"module": "alerts", "folders": {"kind": "all"}, **extra}


@pytest.fixture(scope="module", autouse=True)
def _require_downtimes(client: OpenObserveClient) -> None:
    resp = client.get("downtimes", prefix=V2)
    if resp.status_code != 200:
        pytest.skip(f"this build does not serve downtimes ({resp.status_code})")


@pytest.fixture
def create_downtime(client: OpenObserveClient) -> Generator[Callable[[dict], dict], None, None]:
    """Create a downtime and return the row `GET` reads back; cancel and delete it afterwards."""
    ids: list[str] = []

    def create(body: dict) -> dict:
        resp = client.post("downtimes", prefix=V2, json={"name": unique_name("downtime"), **body})
        assert resp.status_code in (200, 201), resp.text
        ids.append(resp.json()["id"])
        got = client.get(f"downtimes/{ids[-1]}", prefix=V2)
        assert got.status_code == 200, got.text
        return got.json()

    yield create
    for downtime_id in ids:
        client.post(f"downtimes/{downtime_id}/cancel", prefix=V2)
        client.delete(f"downtimes/{downtime_id}", prefix=V2)


def test_omitted_folder_and_banner_take_their_defaults(create_downtime):
    row = create_downtime({"targets": [alerts_target()], "schedule": one_time_schedule()})

    assert row["folder_id"] == "default"
    assert row["show_banner"] is True
    assert row["schedule"]["weekdays"] == []
    # GET flattens the stored row beside the list item's own fields.
    assert row["org"] == "default"
    assert row["status"] == "scheduled"
    assert row["current_window"] is None
    assert row["next_window"]["end"] == row["schedule"]["ends_at"]


def test_an_alerts_target_without_the_incident_mode_reads_as_muted(create_downtime):
    muted = create_downtime({"targets": [alerts_target()], "schedule": one_time_schedule()})
    assert "incident_mode" not in muted["targets"][0], "the muted default is not written"

    explicit = create_downtime(
        {"targets": [alerts_target(incident_mode="muted")], "schedule": one_time_schedule()}
    )
    assert "incident_mode" not in explicit["targets"][0], "an explicit muted reads as the default"

    none = create_downtime(
        {"targets": [alerts_target(incident_mode="none")], "schedule": one_time_schedule()}
    )
    assert none["targets"][0]["incident_mode"] == "none"


def test_the_documented_example_keeps_its_wire_names(create_downtime):
    row = create_downtime({
        "condition": {"type": "group", "op": "and", "items": [
            {"type": "pair", "key": "service", "operator": "=", "value": "payments"},
            {"type": "group", "op": "or", "items": [
                {"type": "pair", "key": "host", "operator": "!=", "value": "db-*"},
            ]},
        ]},
        "targets": [
            alerts_target(),
            {"module": "synthetics", "folders": {"kind": "all"}, "tags": ["service:payments"]},
            {"module": "slos", "folders": {"kind": "all"}, "slo_mode": "count_as_good"},
        ],
        "schedule": {
            "repeat": "weekly", "starts_at": int(time.time()) * 1_000_000, "ends_at": None,
            "timezone": "Europe/Berlin", "start_time_local": "02:00",
            "duration_secs": 5400, "weekdays": [7],
        },
    })

    cond = row["condition"]
    assert (cond["type"], cond["op"]) == ("group", "and")
    assert cond["items"][0]["operator"] == "="
    assert cond["items"][1]["op"] == "or"
    assert cond["items"][1]["items"][0]["operator"] == "!="
    assert [t["module"] for t in row["targets"]] == ["alerts", "synthetics", "slos"]
    assert row["targets"][1]["tags"] == ["service:payments"]
    assert row["targets"][2]["slo_mode"] == "count_as_good"
    assert row["schedule"]["repeat"] == "weekly"
    assert "ends_at" not in row["schedule"]
    assert row["schedule"]["weekdays"] == [7]


def test_notifications_without_a_lead_time_take_the_default(create_downtime):
    row = create_downtime({
        "targets": [alerts_target()],
        "schedule": one_time_schedule(),
        "notifications": {"destinations": [], "events": {"ended": True}},
    })

    notifications = row["notifications"]
    assert notifications["ending_soon_lead_secs"] == DEFAULT_ENDING_SOON_LEAD_SECS
    assert notifications["events"] == {
        "started": False, "ending_soon": False, "ended": True, "cancelled": False, "extended": False,
    }
    assert "continues" not in notifications

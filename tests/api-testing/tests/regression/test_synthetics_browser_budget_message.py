"""The over-budget error for a browser check names only the levers it has, with no dangling "or" (#16330)."""

from __future__ import annotations

from support.client import OpenObserveClient
from support.factories import synthetics_check_config, synthetics_check_payload

# The default ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS is 840 s; a 900 s journey on one device with no retry exceeds it.
MAX_JOURNEY_BUDGET_MS = 900_000


def browser_config(journey_budget_ms: int) -> dict:
    return {**synthetics_check_config("browser"), "journey_budget_ms": journey_budget_ms}


def refused_message(client: OpenObserveClient, created: list[str], location: str, **overrides) -> str:
    payload = synthetics_check_payload("browser", location, frequency={"type": "minutes", "interval": 5, "cron": ""}, **overrides)
    resp = client.synthetics.create(payload)
    if resp.ok:
        created.append(resp.json()["id"])
    assert resp.status_code == 400, resp.text
    return resp.json()["message"]


def test_budget_error_joins_its_levers_with_or_only_when_there_is_more_than_one(
    client: OpenObserveClient, created_synthetics: list[str], synthetics_location: str
):
    budget_only = refused_message(client, created_synthetics, synthetics_location, retries=0, config=browser_config(MAX_JOURNEY_BUDGET_MS))
    assert "over the 14m check budget" in budget_only, budget_only
    assert "To fix it, shorten the run with config.journey_budget_ms (currently 15m)." in budget_only, budget_only
    assert "To fix it, or" not in budget_only, budget_only

    with_retries = refused_message(client, created_synthetics, synthetics_location, retries=1, config=browser_config(450_000))
    assert "To fix it, lower retries below 1, or shorten the run with config.journey_budget_ms" in with_retries, with_retries

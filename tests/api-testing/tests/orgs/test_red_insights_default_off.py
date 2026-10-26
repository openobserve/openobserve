"""RED insights default to off for an org without a saved setting  [regression #15249, #15188]."""

from __future__ import annotations

import logging
import secrets
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

SEED_STREAM = "e2e_15249_seed"


@pytest.fixture
def new_org(client: OpenObserveClient) -> Generator[str, None, None]:
    # Ingesting into an unknown org as root creates it (ZO_CREATE_ORG_THROUGH_INGESTION), and org creation writes no settings row.
    org_id = f"e2e15249{secrets.token_hex(4)}"
    ingest = client.post(f"{SEED_STREAM}/_json", json=[{"message": "bug-15249 seed"}], org=org_id)
    assert ingest.status_code == 200, (
        f"Precondition: ingestion must create the org, got {ingest.status_code}: {ingest.text}"
    )
    orgs = client.get("api/organizations", prefix="")
    assert orgs.status_code == 200, f"could not list organizations: {orgs.status_code} {orgs.text}"
    ids = [o.get("identifier") for o in orgs.json().get("data") or []]
    assert org_id in ids, f"Precondition: the new org must exist, got {ids}"
    logger.info("Created org through ingestion: %s", org_id)
    yield org_id
    try:
        client.streams.delete(SEED_STREAM, org=org_id)
    except Exception as e:
        logger.warning("could not delete %s in %s: %s", SEED_STREAM, org_id, e)


def _get_settings(client: OpenObserveClient, org_id: str) -> dict[str, Any]:
    resp = client.get("settings", org=org_id)
    assert resp.status_code == 200, f"org settings must load, got {resp.status_code}: {resp.text}"
    return resp.json().get("data") or {}


def _save_settings(client: OpenObserveClient, org_id: str, payload: dict[str, Any]) -> None:
    resp = client.post("settings", json=payload, org=org_id)
    assert resp.status_code == 200, f"saving {payload} must succeed, got {resp.status_code}: {resp.text}"


def test_new_org_reports_red_insights_off_and_keeps_it_off_once_stored(client: OpenObserveClient, new_org: str):
    """#15249: a new org with no saved settings reports RED insights off, and keeps it off once the default is stored."""
    first = _get_settings(client, new_org)
    assert first.get("red_insights_enabled") is False, (
        f"#15188: an org that never opted in must not get RED insights, got {first}"
    )

    # The first read stores the default as the org's settings row, so the second read comes from storage.
    stored = _get_settings(client, new_org)
    assert stored.get("red_insights_enabled") is False, f"the stored default must stay off, got {stored}"


def test_saving_another_setting_on_a_new_org_leaves_red_insights_off(client: OpenObserveClient, new_org: str):
    """#15249: saving another org setting on a new org leaves RED insights off."""
    _save_settings(client, new_org, {"scrape_interval": 37})

    settings = _get_settings(client, new_org)
    assert settings.get("scrape_interval") == 37, f"Precondition: the unrelated setting must be saved, got {settings}"
    assert settings.get("red_insights_enabled") is False, (
        f"a save that does not mention RED insights must not turn them on, got {settings}"
    )


def test_red_insights_saved_on_stays_on_after_another_setting_is_saved(client: OpenObserveClient, new_org: str):
    """#15249: RED insights saved as on stays on after another setting is saved."""
    _save_settings(client, new_org, {"red_insights_enabled": True})
    opted_in = _get_settings(client, new_org)
    assert opted_in.get("red_insights_enabled") is True, f"the explicit opt-in must be stored, got {opted_in}"

    _save_settings(client, new_org, {"scrape_interval": 37})
    settings = _get_settings(client, new_org)
    assert settings.get("scrape_interval") == 37, f"Precondition: the unrelated setting must be saved, got {settings}"
    assert settings.get("red_insights_enabled") is True, f"an explicit opt-in must survive later saves, got {settings}"

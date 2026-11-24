"""Pytest fixtures for the new framework.

To use these from any test file, import them in a conftest.py:

    # tests/conftest.py
    from support.fixtures import *  # noqa: F401, F403

The legacy fixtures (`create_session`, `base_url`, `org_id`, `random_string`)
in the existing conftest.py continue to work for legacy tests. New tests
should prefer `client` and the cleanup-managed `temp_*` fixtures.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Generator
from typing import Any

import pytest

from .client import OpenObserveClient
from .factories import (
    synthetics_check_payload,
    synthetics_location_id,
    synthetics_location_payload,
    unique_email,
    unique_name,
)

log = logging.getLogger("o2-api.fixtures")


# ----- client -----


@pytest.fixture(scope="session")
def client() -> OpenObserveClient:
    """A session-scoped OpenObserveClient. All session env vars must be set."""
    return OpenObserveClient()


# ----- resource fixtures with guaranteed cleanup -----


@pytest.fixture
def temp_stream_name(client: OpenObserveClient) -> Generator[str, None, None]:
    """Yield a unique stream name; delete after the test."""
    name = unique_name("stream")
    yield name
    try:
        client.streams.delete(name)
    except Exception as e:
        log.warning("temp_stream_name cleanup failed for %s: %s", name, e)


@pytest.fixture
def temp_user_email(client: OpenObserveClient) -> Generator[str, None, None]:
    """Yield a unique user email; delete after the test (best-effort)."""
    email = unique_email("user")
    yield email
    try:
        client.users.delete(email)
    except Exception as e:
        log.warning("temp_user_email cleanup failed for %s: %s", email, e)


@pytest.fixture
def temp_dashboard_id(client: OpenObserveClient) -> Generator[list[str], None, None]:
    """Yield a mutable list; append dashboard IDs you create.

    All listed IDs are deleted on teardown. Use when your test creates 1+
    dashboards and you don't want to bother with manual cleanup.
    """
    ids: list[str] = []
    yield ids
    for did in ids:
        try:
            client.dashboards.delete(did)
        except Exception as e:
            log.warning("temp_dashboard_id cleanup failed for %s: %s", did, e)


@pytest.fixture(scope="module")
def synthetics_location(client: OpenObserveClient) -> Generator[str, None, None]:
    """A public probe location of this module's own; checks cannot be saved without one."""
    config = client.get("config")
    assert config.status_code == 200, config.text
    # Fail, not skip: a silently skipped suite would hide synthetics being switched off in CI.
    assert config.json().get("synthetics_enabled") is True, "synthetics tests need ZO_SYNTHETICS_ENABLED=true"
    location_id = synthetics_location_id()
    resp = client.synthetics.create_location(synthetics_location_payload(location_id))
    assert resp.status_code == 200, resp.text
    yield location_id
    resp = client.synthetics.delete_location(location_id)
    if resp.status_code != 200:
        log.warning("synthetics_location cleanup failed for %s: %s", location_id, resp.text)


@pytest.fixture
def created_synthetics(client: OpenObserveClient) -> Generator[list[str], None, None]:
    """Check ids deleted after the test, including any a negative test wrongly got created."""
    ids: list[str] = []
    yield ids
    for check_id in ids:
        resp = client.synthetics.delete(check_id)
        if resp.status_code not in (200, 404):
            log.warning("synthetics cleanup failed for %s: %s", check_id, resp.text)


@pytest.fixture
def make_synthetic(
    client: OpenObserveClient, synthetics_location: str, created_synthetics: list[str]
) -> Callable[..., dict]:
    """Create a check through the API and return its create response; every check is deleted afterwards."""

    def create(check_type: str = "tcp", **overrides: Any) -> dict:
        resp = client.synthetics.create(synthetics_check_payload(check_type, synthetics_location, **overrides))
        assert resp.status_code == 200, resp.text
        created_synthetics.append(resp.json()["id"])
        return resp.json()

    return create

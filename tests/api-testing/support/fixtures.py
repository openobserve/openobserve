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
from collections.abc import Generator

import pytest

from .client import OpenObserveClient
from .factories import unique_email, unique_name

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

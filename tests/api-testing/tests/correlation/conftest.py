"""Fixtures for the Correlation (service-streams) API tests.

Each test gets a FRESH org (correlation discovery/identity/reset are org-global
and destructive — a shared org would let one test corrupt another). The org is
torn down best-effort after the test; uniqueness, not delete, is the isolation
guarantee.

These tests are ENTERPRISE-ONLY: the `service_streams` endpoints return 403 on
OSS builds. They also depend on the discovery temporal env (fast WAL rotation +
service-streams sampling) being set on the SERVER — see the `correlation` shard
in `.github/workflows/api-testing.yml`. Run locally against an enterprise build
started with that env.
"""
from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient

from .helpers import CorrelationClient, create_correlation_org, delete_org


@pytest.fixture
def corr(client: OpenObserveClient, request) -> Generator[CorrelationClient, None, None]:
    """Provision a fresh org and yield a CorrelationClient bound to it.

    Prefix defaults to `corr`; a test can override via indirect parametrization
    (`@pytest.mark.parametrize("corr", ["corr_disc"], indirect=True)`) purely for
    readable org names — it does not change behavior.
    """
    prefix = getattr(request, "param", None) or "corr"
    org = create_correlation_org(client, prefix)
    try:
        yield CorrelationClient(client, org)
    finally:
        delete_org(client, org)

"""Service versions are enterprise-only: the whole directory skips on OSS and fails on a broken enterprise build."""
from __future__ import annotations

import pytest

from support.client import OpenObserveClient

from .svcver_helpers import service_versions_served


# Session scope so the gate runs before any module fixture seeds spans and waits on the registry.
@pytest.fixture(scope="session", autouse=True)
def _require_service_versions(client: OpenObserveClient) -> None:
    if not service_versions_served(client):
        pytest.skip("service versions are enterprise-only and this is an OSS build")

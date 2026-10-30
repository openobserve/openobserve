"""Fixtures for the Continuous Profiling (profiles) API tests."""

from __future__ import annotations

import logging
from collections.abc import Callable, Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

from .profiles_helpers import (
    ALL_CPU_TOTAL,
    CHECKOUT_TOTAL,
    PAYMENTS,
    US,
    RefData,
    cpu,
    ingest_json,
    now_us,
    reference_model,
    reference_t0_ns,
    to_json,
    wait_merge_total,
    window,
)

log = logging.getLogger(__name__)


def _delete_profiles_stream(client: OpenObserveClient, name: str) -> None:
    try:
        resp = client.streams.delete(name, type_="profiles")
    except Exception as e:
        log.warning("profiles stream cleanup failed for %s: %s", name, e)
        return
    if resp.status_code not in (200, 404):
        log.warning("profiles stream cleanup failed for %s: %s %s", name, resp.status_code, resp.text[:200])


@pytest.fixture
def new_stream(client: OpenObserveClient) -> Generator[Callable[[str], str], None, None]:
    """Factory for unique profiles stream names; every name handed out is deleted after the test."""
    names: list[str] = []

    def _make(prefix: str = "prof") -> str:
        name = unique_name(prefix)
        names.append(name)
        return name

    yield _make
    for name in names:
        _delete_profiles_stream(client, name)


@pytest.fixture
def prof_stream(new_stream: Callable[[str], str]) -> str:
    return new_stream("prof")


@pytest.fixture(scope="module")
def ref(client: OpenObserveClient) -> Generator[RefData, None, None]:
    """Reference dataset (feature §7) in its own stream, visible before any test reads it."""
    stream = unique_name("prof_ref")
    t0_ns = reference_t0_ns()
    data = RefData(stream=stream, t0_us=t0_ns // 1000)
    try:
        resp = ingest_json(client, stream, to_json(reference_model(t0_ns)))
        assert resp.status_code == 200, f"reference ingest failed: {resp.status_code} {resp.text}"
        assert resp.json() == {}, f"reference ingest partially rejected: {resp.text}"
        wait_merge_total(client, stream, data.win(**cpu(service_name="checkout")), CHECKOUT_TOTAL)
        wait_merge_total(client, stream, data.win(**cpu()), ALL_CPU_TOTAL)
        total, unit = PAYMENTS["inuse_space"]
        wait_merge_total(client, stream, data.win(profile_type="inuse_space", profile_unit=unit), total)
        yield data
    finally:
        _delete_profiles_stream(client, stream)


@pytest.fixture
def empty_window() -> dict:
    """A one-hour window three days ago; no profile in these tests is ever stored there."""
    end = now_us() - 3 * 24 * 3600 * US
    return window(end - 3600 * US, end)

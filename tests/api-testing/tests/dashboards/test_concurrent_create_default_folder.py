"""Concurrent dashboard create in a fresh org must not 500  [regression #14163].

In a brand-new org the `default` dashboards folder does not exist yet. Several
concurrent `POST /dashboards` all passed the folder-existence check and then
raced to create it; the losers' INSERT violated the folder unique constraint and
surfaced as a raw HTTP 500. Retrying worked, because by then the folder existed.
Fixed in PR #14186 by creating default folders idempotently.

This is a check-then-act race, so it only shows up when the requests genuinely
overlap -- issuing them sequentially would pass on the unfixed build. The
requests are therefore fired from a thread pool against a freshly created org,
and the assertion is that none of them comes back 5xx.
"""

import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CONCURRENCY = 6


@pytest.fixture
def fresh_org(create_session, base_url):
    """A brand-new org, so the default dashboards folder is guaranteed absent."""
    session = create_session
    org = f"e2e_dash_race_{uuid.uuid4().hex[:8]}"
    resp = session.post(f"{base_url}api/organizations", json={"name": org})
    if resp.status_code not in (200, 201):
        pytest.skip(f"could not create a fresh org ({resp.status_code}): {resp.text[:200]}")
    identifier = resp.json().get("identifier", org)
    yield identifier


def test_concurrent_dashboard_create_does_not_500(create_session, base_url, fresh_org):
    session = create_session

    def create(i: int):
        return session.post(
            f"{base_url}api/{fresh_org}/dashboards",
            json={"title": f"race_{i}", "description": "concurrent create race", "panels": []},
        )

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        responses = list(pool.map(create, range(CONCURRENCY)))

    codes = [r.status_code for r in responses]
    logger.info("concurrent create status codes: %s", codes)

    server_errors = [r for r in responses if r.status_code >= 500]
    assert not server_errors, (
        "concurrent dashboard creates raced default-folder creation and returned "
        f"{[r.status_code for r in server_errors]}; first body: "
        f"{server_errors[0].text[:300]}"
    )

    # The race left some creates failing outright, so success is part of the contract too.
    assert any(c in (200, 201) for c in codes), \
        f"no concurrent create succeeded at all, got {codes}"

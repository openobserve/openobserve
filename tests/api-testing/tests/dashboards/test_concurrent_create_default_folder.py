"""Concurrent dashboard create in a fresh org must not 500  [regression #14163].

In a brand-new org the `default` dashboards folder does not exist yet. Several
concurrent `POST /dashboards` all passed the folder-existence check and then
raced to create it; the losers' INSERT violated the folder unique index and
surfaced as a raw HTTP 500. Retrying worked, because by then the folder existed.
PR #14186 made the creation idempotent -- `folders::get_or_create` attempts the
insert and only reports failure if the row is still absent afterwards.

This is a check-then-act race, so it only shows up when the requests genuinely
overlap; issuing them sequentially would pass on the unfixed build. The requests
are therefore fired from a thread pool against a freshly created org.

Storage contention is NOT the defect. On SQLite a concurrent burst can answer
"database is locked", which is a 5xx that says nothing about folder creation, so
those are counted and tolerated separately -- the defect's own signature is a
unique-constraint failure, which does not mention a lock. Treating every 5xx as
the bug made this test fail on CI even against a fixed build.
"""

import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CONCURRENCY = 6
LOCK_MARKERS = ("database is locked", "is locked", "locked")


def _is_storage_contention(resp) -> bool:
    body = (resp.text or "").lower()
    return any(m in body for m in LOCK_MARKERS)


@pytest.fixture(scope="module")
def fresh_org(create_session, base_url):
    """A brand-new org, so the default dashboards folder is guaranteed absent.

    Module-scoped deliberately: `DELETE /api/organizations/{id}` answers 404 on
    this build, so an org cannot be cleaned up and a function-scoped fixture
    would leak one per test. One org per module bounds that to a single row.
    """
    session = create_session
    org = f"e2e_dash_race_{uuid.uuid4().hex[:8]}"
    resp = session.post(f"{base_url}api/organizations", json={"name": org})
    if resp.status_code not in (200, 201):
        pytest.skip(f"could not create a fresh org ({resp.status_code}): {resp.text[:200]}")
    yield resp.json().get("identifier", org)


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
    contention = [r for r in responses if r.status_code >= 500 and _is_storage_contention(r)]
    defects = [r for r in responses if r.status_code >= 500 and not _is_storage_contention(r)]
    logger.info("status codes: %s (storage contention: %d)", codes, len(contention))

    assert not defects, (
        "concurrent dashboard creates raced default-folder creation and returned "
        f"{[r.status_code for r in defects]}; first body: {defects[0].text[:300]}"
    )
    assert any(c in (200, 201) for c in codes), \
        f"no concurrent create succeeded at all, got {codes}"

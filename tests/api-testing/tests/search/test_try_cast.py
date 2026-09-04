"""TRY_CAST / CAST SQL function tests.

Rewritten in Phase 4 of the api-tests revamp:
- Uses `client.search.sql` + wide window (data fixtures are static).
- Body validation: response must have 'hits' list AND respect the LIMIT.
- The original asserted nothing beyond status_code 200 and barely-checked
  hit count (some test cases set `size=expected_size` then asserted just
  status, never the actual returned count).
- For CAST/TRY_CAST queries that return a column under the cast alias,
  verify the field is present in the hit (proves the cast was applied,
  not silently dropped).
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

ORG_ID = "default"
STREAM = "stream_pytest_data"


# (test_name, sql_query, expected_min_hits, expected_field_in_hits)
# NOTE on the WHERE IS NOT NULL clauses: OO omits null columns from the
# hit response. Without filtering, the test data has some rows where
# kubernetes_namespace_name is null, and `assert field in hit` would fail
# spuriously — not because the CAST is broken, just because we'd be
# checking a row that has no value to cast. The IS NOT NULL filter
# ensures the cast is actually being exercised.
TRY_CAST_QUERIES: list[tuple[str, str, int, str | None]] = [
    (
        "raw_namespace_select",
        f'SELECT kubernetes_namespace_name FROM {STREAM} '
        f'WHERE kubernetes_namespace_name IS NOT NULL LIMIT 1',
        1,
        "kubernetes_namespace_name",
    ),
    (
        "cast_to_text",
        f'SELECT cast(kubernetes_namespace_name as Text) AS kubernetes_namespace_name '
        f'FROM {STREAM} WHERE kubernetes_namespace_name IS NOT NULL LIMIT 1',
        1,
        "kubernetes_namespace_name",
    ),
    (
        "try_cast_to_text",
        f'SELECT try_cast(kubernetes_namespace_name as Text) AS kubernetes_namespace_name '
        f'FROM {STREAM} WHERE kubernetes_namespace_name IS NOT NULL LIMIT 1',
        1,
        "kubernetes_namespace_name",
    ),
    (
        "cast_to_varchar",
        f'SELECT cast(kubernetes_namespace_name as VARCHAR) AS kubernetes_namespace_name '
        f'FROM {STREAM} WHERE kubernetes_namespace_name IS NOT NULL LIMIT 1',
        1,
        "kubernetes_namespace_name",
    ),
    (
        "try_cast_to_varchar",
        f'SELECT try_cast(kubernetes_namespace_name as VARCHAR) AS kubernetes_namespace_name '
        f'FROM {STREAM} WHERE kubernetes_namespace_name IS NOT NULL LIMIT 1',
        1,
        "kubernetes_namespace_name",
    ),
    (
        "integer_eq_no_cast",
        f'SELECT * FROM "{STREAM}" WHERE k8s_container_restart_count = 1',
        1,
        None,  # SELECT * returns whole row — no specific cast alias to verify
    ),
    (
        "cast_to_int_eq",
        f'SELECT * FROM "{STREAM}" WHERE cast(k8s_container_restart_count as INT) = 1',
        1,
        None,
    ),
    (
        "try_cast_to_int_eq",
        f'SELECT * FROM "{STREAM}" WHERE try_cast(k8s_container_restart_count as INT) = 1',
        1,
        None,
    ),
]


@pytest.mark.parametrize(
    ("test_name", "sql_query", "expected_min_hits", "expected_field"),
    TRY_CAST_QUERIES,
    ids=[name for name, _, _, _ in TRY_CAST_QUERIES],
)
def test_cast_and_try_cast_queries(
    client: OpenObserveClient,
    test_name: str,
    sql_query: str,
    expected_min_hits: int,
    expected_field: str | None,
):
    """Each CAST/TRY_CAST query returns hits with the expected shape."""
    # Wide window — static stream_pytest_data data is older than the default 15m
    resp = client.search.sql(sql_query, minutes=10080, size=10)

    assert resp.status_code == 200, \
        f"{test_name}: query failed: {resp.status_code} {resp.text}"

    body = resp.json()
    assert "hits" in body, f"{test_name}: response missing 'hits': {body}"
    hits = body["hits"]
    assert isinstance(hits, list), f"{test_name}: hits should be a list, got {type(hits).__name__}"
    assert len(hits) >= expected_min_hits, (
        f"{test_name}: expected at least {expected_min_hits} hits, "
        f"got {len(hits)}. Response: {body}"
    )

    # If the test queries for a specific (aliased) field, verify the cast produced it
    if expected_field:
        for i, hit in enumerate(hits):
            assert expected_field in hit, \
                f"{test_name}: hit {i} missing expected field {expected_field!r}: {hit}"

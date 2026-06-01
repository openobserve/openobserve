"""Fuzzy-match SQL function tests.

Rewritten in Phase 4 of the api-tests revamp:
- Original was `@pytest.mark.skip` with no reason given. Manual investigation
  shows fuzzy_match works correctly when given an adequate time window;
  the skip was likely from a period when the original test used a 1-minute
  window against `stream_pytest_data` (which holds OLDER data, not recently
  ingested), so it would return 0 hits and flake.
- Replaces the in-test retry loop (a `time.sleep` workaround for the bad
  window) with `client.search.hits()` over a wider window that's actually
  retention-safe for the static test data.
- Validates response shape and that hits contain the queried field.
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

ORG_ID = "default"
STREAM = "stream_pytest_data"


@pytest.mark.parametrize(
    ("sql_query", "expected_substring", "description"),
    [
        (
            f'SELECT * FROM "{STREAM}" WHERE fuzzy_match(kubernetes_namespace_name, \'ZINC\', 4)',
            None,
            "fuzzy_match with edit distance 4 finds 'ziox'-like namespaces",
        ),
        (
            f'SELECT * FROM "{STREAM}" WHERE fuzzy_match(kubernetes_namespace_name, \'Z\', 4)',
            None,
            "fuzzy_match with single-char target + distance 4 matches broadly",
        ),
        (
            f'SELECT * FROM "{STREAM}" WHERE kubernetes_namespace_name IS NOT NULL '
            f'AND fuzzy_match(kubernetes_namespace_name, \'Z\', 4)',
            None,
            "fuzzy_match combined with IS NOT NULL guard",
        ),
        (
            f'SELECT * FROM "{STREAM}" WHERE kubernetes_namespace_name LIKE \'%zinc%\' '
            f'AND fuzzy_match(kubernetes_namespace_name, \'zinc\', 4)',
            None,
            "fuzzy_match combined with LIKE",
        ),
    ],
    ids=["zinc-d4", "z-d4", "not-null-and-fuzzy", "like-and-fuzzy"],
)
def test_fuzzy_match_returns_hits_with_namespace_field(
    client: OpenObserveClient,
    sql_query: str,
    expected_substring: str | None,
    description: str,
):
    """Each fuzzy_match query returns hits, and each hit has kubernetes_namespace_name set.

    `stream_pytest_data` is populated by the autouse session fixture from
    test-data/logs_data.json — its records include kubernetes_namespace_name
    values like 'ziox' and 'zinc-cp1' that should match the queries.
    """
    # 1 week window — wide enough that retention doesn't bite
    hits = client.search.hits(sql_query, minutes=10080, size=10)

    assert isinstance(hits, list), f"expected hits to be a list, got {type(hits).__name__}"
    assert len(hits) >= 1, (
        f"{description}: expected at least 1 hit for query {sql_query!r}. "
        "If 0 hits, fuzzy_match may have regressed or the test data has been retention-purged."
    )

    # Body validation: each hit must include the queried field
    for i, hit in enumerate(hits):
        assert "kubernetes_namespace_name" in hit, \
            f"hit {i} missing kubernetes_namespace_name: {hit}"
        # Field should be a non-empty string (since we asserted IS NOT NULL in two queries)
        ns = hit["kubernetes_namespace_name"]
        assert isinstance(ns, str), f"hit {i} has non-string kubernetes_namespace_name: {ns!r}"
        assert ns, f"hit {i} has empty kubernetes_namespace_name"

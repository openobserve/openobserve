"""Malformed multi-stream search requests are answered with 400 (#14915).

`_search_multi` divides by the number of queries, and `_around_multi` writes each `sql` entry into
its per-stream list by position. Both requests below must be refused before those lines, or the
handler panics and the client gets no response at all.
"""

from __future__ import annotations

import pytest

from support.client import OpenObserveClient

# URL-safe base64, as config::utils::base64::encode_url produces it
DEFAULT_STREAM = "ZGVmYXVsdA.."  # default
SELECT_DEFAULT = "U0VMRUNUICogRlJPTSAiZGVmYXVsdCI."  # SELECT * FROM "default"


@pytest.mark.parametrize(
    "body",
    [
        {"sql": [], "start_time": 1, "end_time": 2},
        {"start_time": 1, "end_time": 2},
    ],
    ids=["empty-sql-list", "no-sql-field"],
)
def test_search_multi_without_queries_is_a_bad_request(client: OpenObserveClient, body):
    resp = client.post("_search_multi", json=body)
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"] == "Failed to parse multi search request"


def test_around_multi_with_more_sql_than_streams_is_a_bad_request(client: OpenObserveClient):
    resp = client.get(
        f"{DEFAULT_STREAM}/_around_multi",
        params={"key": 1, "sql": f"{SELECT_DEFAULT},{SELECT_DEFAULT}"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"] == "sql has more entries (2) than streams (1)"

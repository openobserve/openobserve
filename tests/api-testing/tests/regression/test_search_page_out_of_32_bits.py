"""A search `from` or `size` that does not fit 32 bits is a 400, not a wrapped page  [#16846].

The search request was narrowed to the cluster query with `as i32`, so `from=4294967296` wrapped to 0 and
silently served the first page, and `from=5582056768315` wrapped negative and failed in the planner. The
conversion now refuses both with "from/size is out of range".
"""

from __future__ import annotations

import time
import uuid

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

HOUR_US = 3_600_000_000


@pytest.fixture(scope="module")
def stream(client: OpenObserveClient):
    name = f"search_page_bits_{uuid.uuid4().hex[:8]}"
    resp = client.post(f"{name}/_json", json=[{"msg": "first page row"}])
    assert resp.status_code == 200, f"ingest: {resp.status_code} {resp.text[:200]}"
    wait_until(lambda: _search(client, "_search", name, 0, 10).json().get("total") == 1, timeout=60, interval=2.0,
               msg="the seeded row never became searchable")
    yield name
    client.delete(f"streams/{name}?type=logs")


def _search(client: OpenObserveClient, route: str, stream: str, offset: int, size: int):
    now = int(time.time() * 1_000_000)
    query = {"sql": f'SELECT * FROM "{stream}"', "start_time": now - HOUR_US, "end_time": now + HOUR_US,
             "from": offset, "size": size}
    return client.post(f"{route}?type=logs", json={"query": query})


@pytest.mark.parametrize("route", ["_search", "_search_stream"])
@pytest.mark.parametrize(
    ("offset", "size", "detail"),
    [
        pytest.param(4_294_967_296, 10, "from is out of range", id="from-2^32"),
        pytest.param(5_582_056_768_315, 10, "from is out of range", id="from-fuzzer-value"),
        pytest.param(0, 4_294_967_306, "size is out of range", id="size-over-2^32"),
    ],
)
def test_page_outside_32_bits_is_refused(client: OpenObserveClient, stream, route, offset, size, detail):
    resp = _search(client, route, stream, offset, size)
    assert resp.status_code == 400, f"{route} from={offset} size={size}: {resp.status_code} {resp.text[:300]}"
    assert resp.json().get("error_detail") == detail, resp.text[:300]


def test_page_inside_32_bits_still_pages(client: OpenObserveClient, stream):
    first = _search(client, "_search", stream, 0, 10)
    assert first.status_code == 200, first.text[:300]
    assert [h["msg"] for h in first.json()["hits"]] == ["first page row"], first.text[:300]
    past = _search(client, "_search", stream, 1, 10)
    assert past.status_code == 200, past.text[:300]
    assert past.json()["hits"] == [], "a page past the only row must be empty"

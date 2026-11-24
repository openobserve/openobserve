"""A join with no equality key (non-equi, CROSS, comma or ON 1=1) must scan both streams, not return zero rows (#16958)."""

from __future__ import annotations

import time
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, unique_name
from support.wait import wait_until

A_SEQ = range(1, 11)
B_SEQ = range(0, 5)


@pytest.fixture(scope="module")
def streams(client: OpenObserveClient) -> Generator[tuple[str, str], None, None]:
    a, b = unique_name("nonequi_a"), unique_name("nonequi_b")
    now_us = int(time.time() * 1_000_000)
    try:
        for name, seqs in ((a, A_SEQ), (b, B_SEQ)):
            client.streams.ingest_json(name, [{"_timestamp": now_us - i * 1_000, "seq": i} for i in seqs])
            wait_until(
                lambda name=name, n=len(seqs): _hits(client, f'SELECT count(*) AS c FROM "{name}"') == [{"c": n}],
                timeout=60,
                interval=1.0,
                msg=f"{name} not searchable",
            )
        yield a, b
    finally:
        client.streams.delete(a)
        client.streams.delete(b)


def _hits(client: OpenObserveClient, sql: str) -> list[dict[str, Any]]:
    now_us = int(time.time() * 1_000_000)
    body = search_payload(sql, start_time=now_us - 3_600_000_000, end_time=now_us + 60_000_000, size=1000)
    resp = client.post("_search?type=logs", json=body)
    assert resp.status_code == 200, f"{sql}: {resp.status_code} {resp.text[:500]}"
    return resp.json()["hits"]


@pytest.mark.parametrize(
    ("join", "expected"),
    [
        ('"{a}" x JOIN "{b}" y ON x.seq < y.seq', 6),
        ('"{a}" x CROSS JOIN "{b}" y', 50),
        ('"{a}" x, "{b}" y', 50),
        ('"{a}" x JOIN "{b}" y ON 1=1', 50),
        ('"{a}" x JOIN "{b}" y ON x.seq = y.seq', 4),
    ],
    ids=["less-than", "cross-join", "comma-join", "on-true", "equality-control"],
)
def test_join_without_equality_key_counts_every_pair(client: OpenObserveClient, streams, join: str, expected: int):
    a, b = streams
    sql = f"SELECT count(*) AS c FROM {join.format(a=a, b=b)}"
    assert _hits(client, sql) == [{"c": expected}], sql


def test_less_than_join_returns_the_exact_pairs(client: OpenObserveClient, streams):
    a, b = streams
    hits = _hits(client, f'SELECT x.seq AS s1, y.seq AS s2 FROM "{a}" x JOIN "{b}" y ON x.seq < y.seq')
    assert sorted((h["s1"], h["s2"]) for h in hits) == [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)], hits

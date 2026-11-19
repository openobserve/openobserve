"""SQL IP functions for CIDR matching and subnets work end to end on stored rows (#16413)."""

from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window, unique_name
from support.wait import wait_until

ROWS = [
    {"n": 1, "ip": "10.1.2.3"},
    {"n": 2, "ip": "10.1.2.200"},
    {"n": 3, "ip": "203.0.113.9"},
    {"n": 4, "ip": "2001:db8::1"},
    {"n": 5, "ip": "::ffff:10.0.0.1"},
    {"n": 6, "ip": "not-an-ip"},
    {"n": 7, "ip": "192.168.0.5"},
    {"n": 8, "ip": "127.0.0.1"},
]


@pytest.fixture(scope="module")
def ip_stream(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("pyt_ip_fns")
    client.streams.ingest_json(name, ROWS)
    wait_until(
        lambda: len(_query(client, name, "SELECT n FROM {s}")) == len(ROWS),
        timeout=30,
        msg=f"{name} did not store {len(ROWS)} rows",
    )
    yield name
    client.streams.delete(name)


def _query(client: OpenObserveClient, stream: str, sql: str) -> list[dict]:
    start, end = time_window(minutes=30)
    resp = client.post("_search", json=search_payload(sql.format(s=f'"{stream}"'), start_time=start, end_time=end))
    if resp.status_code != 200:
        return []
    return resp.json().get("hits", [])


@pytest.mark.parametrize(
    ("where", "expected"),
    [
        # host bits in the CIDR are cleared; a mapped IPv6 address does not match an IPv4 range
        pytest.param("ip_cidr_contains('10.9.9.9/8', ip)", [1, 2], id="cidr-v4-host-bits"),
        pytest.param("ip_cidr_contains('2001:db8::/32', ip)", [4], id="cidr-v6"),
        pytest.param("is_ipv4(ip)", [1, 2, 3, 7, 8], id="is_ipv4"),
        pytest.param("is_ipv6(ip)", [4, 5], id="is_ipv6"),
        pytest.param("is_private_ip(ip)", [1, 2, 7], id="is_private_ip-not-loopback"),
    ],
)
def test_ip_predicates_filter_stored_rows(client: OpenObserveClient, ip_stream: str, where: str, expected: list[int]):
    """openobserve#16413: these functions did not exist; a dirty value must read as no match, not fail the query."""
    start, end = time_window(minutes=30)
    sql = f'SELECT n FROM "{ip_stream}" WHERE {where}'
    resp = client.post("_search", json=search_payload(sql, start_time=start, end_time=end))
    assert resp.status_code == 200, f"{where}: {resp.status_code} {resp.text[:300]}"
    assert sorted(h["n"] for h in resp.json()["hits"]) == expected, where


def test_ip_subnet_groups_by_network_address(client: OpenObserveClient, ip_stream: str):
    """openobserve#16413: GROUP BY ip_subnet(ip, '/24', '/64') gives bare network addresses per family."""
    hits = _query(
        client,
        ip_stream,
        "SELECT ip_subnet(ip, '/24', '/64') AS subnet, count(*) AS c FROM {s} WHERE n <> 6 GROUP BY subnet",
    )
    got = {h["subnet"]: h["c"] for h in hits}
    assert got == {
        "10.1.2.0": 2,
        "203.0.113.0": 1,
        "2001:db8::": 1,
        "::ffff:10.0.0.0": 1,
        "192.168.0.0": 1,
        "127.0.0.0": 1,
    }, got


def test_a_malformed_constant_cidr_is_a_query_error(client: OpenObserveClient, ip_stream: str):
    """openobserve#16413: a bad CIDR constant must fail loudly rather than silently match nothing."""
    start, end = time_window(minutes=30)
    sql = f"SELECT n FROM \"{ip_stream}\" WHERE ip_cidr_contains('10.0.0.0/33', ip)"
    resp = client.post("_search", json=search_payload(sql, start_time=start, end_time=end))
    # an execution error comes back as a partial response that names the cause
    if resp.status_code == 200:
        body = resp.json()
        assert body.get("is_partial") is True, body
        assert "invalid CIDR '10.0.0.0/33'" in " ".join(body.get("function_error") or []), body
        assert body["hits"] == [], body
    else:
        assert resp.status_code >= 400, f"{resp.status_code} {resp.text[:300]}"
        assert "invalid CIDR" in resp.text, resp.text[:300]
